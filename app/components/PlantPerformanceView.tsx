"use client";
import React, { useEffect, useMemo, useState } from "react";
import { EmbellishmentRow, getRowStatus, getPlantAliasConfig, getSeasonAoqConfig, SeasonAoqMap, getTriggerCatalog, TriggerCatalogEntry } from "../lib/db";
import { parseEventValue, getReasonByCode } from "../lib/eventCodes";
import { applyPlantAliasConfig, getPlantAliasRuntimeConfig, resolvePlantDateTargets } from "../lib/plantUtils";
import { seasonBase } from "../lib/triggerUtils";
import { resolveGraphicAoqVerdict, AoqVerdict } from "../lib/nycVerdict";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import PlantPlanRangeExport from "./PlantPlanRangeExport";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Line, ComposedChart,
} from "recharts";

// Plant Performance — monthly PPS scorecard.
//
// Every planned PPS ("print panel / strike-off sending to branch") sits on a day and belongs to a
// plant. When the plant marks that day's PPS green ("PPS|P") it delivered on time: +points. Red
// ("PPS|F|<reason>") is a miss: -points. Graphics are counted once per plant per month (a graphic
// is often several rows — combos / styles — and several PPS cells), so:
//   allocated = onTime + failed + pending, and net points = onTime * pass - failed * fail.
// A graphic is "failed" in a month if ANY of its PPS cells that month is red, else "on time" if any
// is green, else still pending (overdue = date passed with no colour yet; upcoming = date ahead).

interface PlantPerformanceViewProps {
  rows: EmbellishmentRow[];
  // Archived (older) versions — their PPS work still counts for the plant that did it (a graphic
  // re-developed via "New Version" must not erase the old plant's results). Only fed into the
  // per-plant PPS tally below, never into the graphic-level AOQ verdict.
  archivedRows?: EmbellishmentRow[];
}

const C_ONTIME = "#10b981";
const C_FAILED = "#ef4444";
const C_PENDING = "#64748b";
const C_SCORE = "#38bdf8";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateKeyRe = /^(\d{4}-\d{2}-\d{2})(?:_.+)?$/;

type Outcome = "onTime" | "failed" | "overdue" | "upcoming";

interface GraphicResult {
  key: string;
  graphic: string;
  season: string;
  category: string;
  outcome: Outcome;
  dates: string[]; // PPS dates (ISO) that fed this result
  reason: string; // first fail reason, when failed
  // The graphic's own AOQ-approval verdict (independent of month/PPS outcome — see
  // resolveGraphicAoqVerdict). null when the graphic has no AOQ deadline to score against.
  aoqVerdict: AoqVerdict | null;
}

interface Bucket {
  onTime: number;
  failed: number;
  overdue: number;
  upcoming: number;
  approvedOnTime: number; // graphics whose AOQ verdict is "onTime" — the score's 40% half
  graphics: GraphicResult[];
}

const emptyBucket = (): Bucket => ({ onTime: 0, failed: 0, overdue: 0, upcoming: 0, approvedOnTime: 0, graphics: [] });

// A fiscal year's 4 quarters, starting April: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar (of
// fyYear + 1 — the quarter that wraps into the next calendar year, same as any Apr-start FY).
function quarterRange(fyYear: number, q: 1 | 2 | 3 | 4): { from: string; to: string } {
  const startMonth = [4, 7, 10, 1][q - 1];
  const startYear = q === 4 ? fyYear + 1 : fyYear;
  const from = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const endMonthIdx = startMonth + 2; // 1-based, may run past 12
  const endYear = startYear + Math.floor((endMonthIdx - 1) / 12);
  const endMonth = ((endMonthIdx - 1) % 12) + 1;
  const lastDay = new Date(endYear, endMonth, 0).getDate();
  const to = `${endYear}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d} ${MONTHS[Number(m) - 1]}`;
}

export default function PlantPerformanceView({ rows, archivedRows = [] }: PlantPerformanceViewProps) {
  const [yearPick, setYearPick] = useState<string>(""); // "" = newest year with PPS data
  const [month, setMonth] = useState<string>("all"); // "all" | "01".."12"
  const [season, setSeason] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [passPts, setPassPts] = useState(1);
  const [failPts, setFailPts] = useState(1);
  const [overdueAsFailed, setOverdueAsFailed] = useState(false);
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Period filter: which of these decides the active date window totals/KPIs/score are computed
  // over. "month" (default) keeps the original year+month behavior exactly. "quarter" is a fiscal
  // quarter starting April (Q1 Apr–Jun … Q4 Jan–Mar of the following calendar year). "range" is a
  // literal FROM/TO pick, for anything that doesn't line up with month/quarter boundaries. The
  // 12-month table/chart always shows the full year for context regardless of which mode is active
  // — only the totals/KPIs/scores narrow to the picked window.
  const [periodMode, setPeriodMode] = useState<"month" | "quarter" | "range">("month");
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(1);
  const [rangeFrom, setRangeFrom] = useState<string>("");
  const [rangeTo, setRangeTo] = useState<string>("");

  // AOQ config for the "approved before AOQ" half of the score — same source Score Card's AOQ
  // Approval page uses (col20 date -> Trigger catalog by name+Category+Season -> Trigger M.D code
  // -> Category+Season fallback set on Trigger Manager), plus the same configurable grace-day
  // buffer. The Trigger catalog matters because a name like "KNIT" recurs every season with its
  // own AOQ date — matching it requires the Season, not just the name.
  const [seasonAoqMap, setSeasonAoqMap] = useState<SeasonAoqMap>({});
  const [triggerCatalog, setTriggerCatalog] = useState<TriggerCatalogEntry[]>([]);
  const [graceDays, setGraceDays] = useState(1);
  useEffect(() => {
    getSeasonAoqConfig().then(setSeasonAoqMap).catch(() => {});
    getTriggerCatalog().then(setTriggerCatalog).catch(() => {});
  }, []);

  // Plant merge/hide config (Score Card page) is a module-level layer in plantUtils — load it here
  // too so this page groups plants exactly like the rest of the app, even if opened first.
  const [aliasVersion, setAliasVersion] = useState(0);
  useEffect(() => {
    getPlantAliasConfig().then((cfg) => {
      applyPlantAliasConfig(cfg);
      setAliasVersion((v) => v + 1);
    }).catch(() => {});
  }, []);

  const seasonOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { const b = seasonBase(r.col4); if (b) s.add(b); });
    return Array.from(s).sort();
  }, [rows]);

  const categoryOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      if (season !== "all" && seasonBase(r.col4) !== season) return;
      const c = String(r.col3 || "").trim();
      if (c) s.add(c);
    });
    return Array.from(s).sort();
  }, [rows, season]);

  // ── AOQ-approval verdict, once per graphic (independent of month/plant) ────────────────────
  // A graphic's "did NY approve this before the AOQ deadline" verdict is a property of the whole
  // graphic, not of any one month's PPS attempt — resolved here from ALL of its (live) rows, the
  // same way Score Card's AOQ Approval page does, so the two pages can't disagree. Keyed the same
  // way the per-plant accumulation below keys a graphic ("<season>|<graphic>").
  const graphicAoqByKey = useMemo(() => {
    const byGraphic = new Map<string, { row: Record<string, unknown>; status: string }[]>();
    rows.forEach((r) => {
      if (season !== "all" && seasonBase(r.col4) !== season) return;
      if (category !== "all" && String(r.col3 || "").trim() !== category) return;
      const status = getRowStatus(r);
      if (status === "dropped" || status === "hold") return; // out of the running, like Score Card
      const graphic = String(r.col7 || r.col6 || r.col5 || "").trim();
      if (!graphic) return;
      const gKey = `${seasonBase(r.col4)}|${graphic}`;
      const list = byGraphic.get(gKey) ?? [];
      list.push({ row: r as unknown as Record<string, unknown>, status });
      byGraphic.set(gKey, list);
    });
    const out = new Map<string, AoqVerdict>();
    byGraphic.forEach((entries, gKey) => {
      out.set(gKey, resolveGraphicAoqVerdict(entries, seasonAoqMap, { graceDays, useFallback: true, triggerCatalog }).verdict);
    });
    return out;
  }, [rows, season, category, seasonAoqMap, graceDays, triggerCatalog]);

  // ── core: per plant × month × graphic ─────────────────────────────────────
  const data = useMemo(() => {
    void aliasVersion; // recompute after the alias config lands (module-level state, invisible to useMemo)
    const excluded = new Set(getPlantAliasRuntimeConfig().excluded.map((p) => p.toUpperCase()));
    const today = todayIso();

    // plant -> month("YYYY-MM") -> graphicKey -> accumulating state
    type Acc = { graphic: string; season: string; category: string; pass: boolean; fail: boolean; overdue: boolean; dates: Set<string>; reason: string };
    const acc = new Map<string, Map<string, Map<string, Acc>>>();

    [...rows, ...archivedRows].forEach((r) => {
      if (season !== "all" && seasonBase(r.col4) !== season) return;
      if (category !== "all" && String(r.col3 || "").trim() !== category) return;
      const graphic = String(r.col7 || r.col6 || r.col5 || "").trim();
      if (!graphic) return;
      const inactive = (() => { const st = getRowStatus(r); return st === "dropped" || st === "hold"; })();

      const rec = r as unknown as Record<string, unknown>;
      const isos = new Set<string>();
      Object.keys(rec).forEach((k) => {
        const m = k.match(dateKeyRe);
        if (m && typeof rec[k] === "string") isos.add(m[1]);
      });

      isos.forEach((iso) => {
        resolvePlantDateTargets(rec, iso, { includeVerdicts: true }).forEach((t) => {
          if (t.code !== "PPS") return;
          const parsed = parseEventValue(t.rawValue);
          if (!parsed) return;
          // A pending PPS on a dropped / held graphic isn't the plant's to deliver any more; a
          // verdict it already earned still stands.
          if (parsed.status === "planned" && inactive) return;
          // An archived version's plan was superseded by the next version — only the PPS results
          // it actually recorded count; a never-done planned PPS is not the plant's miss.
          if (parsed.status === "planned" && r.is_current === false) return;
          const plant = t.plant.toUpperCase();
          if (excluded.has(plant)) return;

          const monthKey = iso.slice(0, 7);
          const gKey = `${seasonBase(r.col4)}|${graphic}`;
          const byMonth = acc.get(plant) ?? new Map<string, Map<string, Acc>>();
          acc.set(plant, byMonth);
          const byGraphic = byMonth.get(monthKey) ?? new Map<string, Acc>();
          byMonth.set(monthKey, byGraphic);
          const a = byGraphic.get(gKey) ?? {
            graphic, season: seasonBase(r.col4), category: String(r.col3 || "").trim(),
            pass: false, fail: false, overdue: false, dates: new Set<string>(), reason: "",
          };
          byGraphic.set(gKey, a);
          a.dates.add(iso);
          if (parsed.status === "pass") a.pass = true;
          else if (parsed.status === "fail") {
            a.fail = true;
            if (!a.reason) a.reason = parsed.reasonLabel || (parsed.reasonCode ? getReasonByCode(parsed.reasonCode)?.label ?? "" : "");
          } else if (iso < today) a.overdue = true;
        });
      });
    });

    // resolve outcomes + bucket per plant / month
    const plants = new Map<string, Map<string, Bucket>>();
    const years = new Set<string>();
    acc.forEach((byMonth, plant) => {
      const monthBuckets = new Map<string, Bucket>();
      byMonth.forEach((byGraphic, monthKey) => {
        years.add(monthKey.slice(0, 4));
        const b = emptyBucket();
        byGraphic.forEach((a, key) => {
          let outcome: Outcome;
          if (a.fail) outcome = "failed";
          else if (a.pass) outcome = "onTime";
          else if (a.overdue) outcome = overdueAsFailed ? "failed" : "overdue";
          else outcome = "upcoming";
          b[outcome]++;
          const aoqVerdict = graphicAoqByKey.get(key) ?? null;
          if (aoqVerdict === "onTime") b.approvedOnTime++;
          b.graphics.push({
            key, graphic: a.graphic, season: a.season, category: a.category, outcome,
            dates: Array.from(a.dates).sort(), reason: a.reason, aoqVerdict,
          });
        });
        monthBuckets.set(monthKey, b);
      });
      plants.set(plant, monthBuckets);
    });
    return { plants, years: Array.from(years).sort() };
  }, [rows, archivedRows, season, category, overdueAsFailed, aliasVersion, graphicAoqByKey]);

  const year = data.years.includes(yearPick) ? yearPick : data.years[data.years.length - 1] ?? "";

  const points = (b: { onTime: number; failed: number }) => b.onTime * passPts - b.failed * failPts;
  const allocated = (b: Bucket) => b.onTime + b.failed + b.overdue + b.upcoming;
  // Composite score: 60% weight on the on-time-submission rate (PPS green) + 40% weight on the
  // "approved before AOQ" rate (NY approval verdict vs. the graphic's AOQ deadline) — both halves
  // measured against the SAME denominator (every graphic allocated this period). A graphic still
  // pending/unresolved on either count earns 0 for that half; it's never excluded from the total,
  // so the two halves can never silently measure different-sized populations.
  const scorePct = (b: Bucket): number | null => {
    const n = allocated(b);
    if (n === 0) return null;
    return Math.round(((b.onTime / n) * 0.6 + (b.approvedOnTime / n) * 0.4) * 100);
  };

  // The active date window totals/KPIs/score are computed over. "month" mode (default) is exactly
  // the original behavior: the whole selected calendar year, or one month of it. "quarter" is a
  // fiscal quarter starting April, resolved independent of the year grid so Q4 (Jan–Mar) still
  // works when it wraps into the next calendar year. "range" is a literal FROM/TO pick.
  const effectiveWindow = useMemo((): { from: string; to: string } => {
    const fyYear = parseInt(year || "0", 10) || new Date().getFullYear();
    if (periodMode === "quarter") return quarterRange(fyYear, quarter);
    if (periodMode === "range" && (rangeFrom || rangeTo)) {
      return { from: rangeFrom || "0001-01-01", to: rangeTo || "9999-12-31" };
    }
    if (periodMode === "month" && month !== "all") {
      const lastDay = new Date(fyYear, Number(month), 0).getDate();
      return { from: `${year}-${month}-01`, to: `${year}-${month}-${String(lastDay).padStart(2, "0")}` };
    }
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }, [periodMode, quarter, rangeFrom, rangeTo, month, year]);

  const isAllPeriod = periodMode === "month" && month === "all";
  const inWindow = (dates: string[]) => dates.some((d) => d >= effectiveWindow.from && d <= effectiveWindow.to);

  // sum a plant's buckets across the active period window
  const plantRows = useMemo(() => {
    const out: {
      plant: string; total: Bucket; perMonth: (Bucket | null)[];
    }[] = [];
    data.plants.forEach((monthBuckets, plant) => {
      const perMonth: (Bucket | null)[] = MONTHS.map((_, i) => monthBuckets.get(`${year}-${String(i + 1).padStart(2, "0")}`) ?? null);
      const total = emptyBucket();
      // Scan every month this plant has data for (any year), not just the display year's grid —
      // a fiscal quarter/range spanning a calendar-year boundary (Q4: Jan–Mar) needs that to be
      // exact. Each graphic's own recorded PPS dates decide whether it falls in the window.
      monthBuckets.forEach((b) => {
        b.graphics.forEach((g) => {
          if (!inWindow(g.dates)) return;
          total[g.outcome]++;
          if (g.aoqVerdict === "onTime") total.approvedOnTime++;
          total.graphics.push({ ...g });
        });
      });
      if (perMonth.every((b) => !b)) return;
      out.push({ plant, total, perMonth });
    });
    return out
      .filter((p) => p.total.graphics.length > 0 || isAllPeriod)
      .sort((a, b) =>
        (scorePct(b.total) ?? -1) - (scorePct(a.total) ?? -1)
        || points(b.total) - points(a.total)
        || b.total.graphics.length - a.total.graphics.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, year, passPts, failPts, effectiveWindow, isAllPeriod]);

  const grand = useMemo(() => {
    const g = emptyBucket();
    plantRows.forEach((p) => {
      g.onTime += p.total.onTime; g.failed += p.total.failed;
      g.overdue += p.total.overdue; g.upcoming += p.total.upcoming;
      g.approvedOnTime += p.total.approvedOnTime;
    });
    return g;
  }, [plantRows]);

  // monthly chart: all plants, or the selected plant
  const chartData = useMemo(() => {
    const src = selectedPlant ? plantRows.filter((p) => p.plant === selectedPlant) : plantRows;
    return MONTHS.map((label, i) => {
      const b = emptyBucket();
      src.forEach((p) => {
        const m = p.perMonth[i];
        if (!m) return;
        b.onTime += m.onTime; b.failed += m.failed; b.overdue += m.overdue; b.upcoming += m.upcoming;
      });
      return {
        name: label, onTime: b.onTime, failed: b.failed, pending: b.overdue + b.upcoming,
        points: points(b),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantRows, selectedPlant, passPts, failPts]);

  const detail = selectedPlant ? plantRows.find((p) => p.plant === selectedPlant) ?? null : null;
  const pending = (b: Bucket) => b.overdue + b.upcoming;
  // Resolved-only submission rate (excludes still-pending graphics) — kept as a secondary/tooltip
  // stat; the headline "Score %" column is the 60/40 composite (scorePct) above.
  const rate = (b: Bucket) => (b.onTime + b.failed > 0 ? Math.round((b.onTime / (b.onTime + b.failed)) * 100) : null);
  const approvalRate = (b: Bucket) => (allocated(b) > 0 ? Math.round((b.approvedOnTime / allocated(b)) * 100) : null);
  const ptsColor = (n: number) => (n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-zinc-400");
  const fmtPts = (n: number) => (n > 0 ? `+${n}` : String(n));
  const periodLabel =
    periodMode === "quarter" ? `FY${year || "—"} · Q${quarter} (${fmtDay(effectiveWindow.from)}–${fmtDay(effectiveWindow.to)})`
      : periodMode === "range" && (rangeFrom || rangeTo) ? `${effectiveWindow.from} to ${effectiveWindow.to}`
        : month !== "all" ? `${year || "—"} · ${MONTHS[Number(month) - 1]}`
          : `${year || "—"}`;
  const scopeLabel = periodLabel;


  // Excel of what's on screen: Summary (plant totals for the filters, incl. month columns), Monthly
  // (plant × month for the whole year — pivot-friendly) and Graphics (every graphic behind the totals).
  const exportExcel = async () => {
    if (plantRows.length === 0) return;
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const bold = (row: ExcelJS.Row) => row.eachCell((c) => {
        c.font = { bold: true };
        c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
      const label = (o: Outcome) => (o === "onTime" ? "On time" : o === "failed" ? "Failed" : o === "overdue" ? "Overdue - not updated" : "Upcoming");
      const filters = `Period: ${periodLabel} · Season: ${season} · Category: ${category} · Pass +${passPts} / Fail -${failPts}${overdueAsFailed ? " · overdue counted as failed" : ""} · Score = 60% on-time submission + 40% approved before AOQ (grace ${graceDays}d)`;

      const sum = wb.addWorksheet("Summary");
      sum.columns = [
        { header: "PLANT", key: "plant", width: 24 },
        { header: "GRAPHICS", key: "g", width: 11 },
        { header: "ON TIME (PPS GREEN)", key: "on", width: 20 },
        { header: "FAILED (PPS RED)", key: "fail", width: 18 },
        { header: "PENDING", key: "pend", width: 11 },
        { header: "APPROVED BEFORE AOQ", key: "aoq", width: 20 },
        { header: "SCORE % (60% ON-TIME + 40% AOQ)", key: "score", width: 28 },
        { header: "ON-TIME % (RESOLVED ONLY)", key: "pct", width: 24 },
        { header: "NET POINTS", key: "pts", width: 12 },
        ...MONTHS.map((m) => ({ header: `${m} PTS`, key: `m_${m}`, width: 9 })),
      ];
      bold(sum.getRow(1));
      plantRows.forEach((p) => {
        const r: Record<string, string | number> = {
          plant: p.plant, g: allocated(p.total), on: p.total.onTime, fail: p.total.failed, pend: pending(p.total),
          aoq: p.total.approvedOnTime,
          score: scorePct(p.total) === null ? "" : `${scorePct(p.total)}%`,
          pct: rate(p.total) === null ? "" : `${rate(p.total)}%`, pts: points(p.total),
        };
        p.perMonth.forEach((b, i) => { r[`m_${MONTHS[i]}`] = b ? points(b) : ""; });
        sum.addRow(r);
      });
      sum.addRow({
        plant: "TOTAL", g: allocated(grand), on: grand.onTime, fail: grand.failed, pend: pending(grand),
        aoq: grand.approvedOnTime, score: scorePct(grand) === null ? "" : `${scorePct(grand)}%`,
        pct: rate(grand) === null ? "" : `${rate(grand)}%`, pts: points(grand),
      }).font = { bold: true };
      sum.addRow([]);
      sum.addRow([filters]);
      sum.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];

      const mon = wb.addWorksheet("Monthly");
      mon.columns = [
        { header: "PLANT", key: "plant", width: 24 },
        { header: "MONTH", key: "month", width: 12 },
        { header: "GRAPHICS", key: "g", width: 11 },
        { header: "ON TIME", key: "on", width: 10 },
        { header: "FAILED", key: "fail", width: 10 },
        { header: "PENDING", key: "pend", width: 10 },
        { header: "APPROVED BEFORE AOQ", key: "aoq", width: 20 },
        { header: "SCORE %", key: "score", width: 12 },
        { header: "ON-TIME % (RESOLVED)", key: "pct", width: 21 },
        { header: "NET POINTS", key: "pts", width: 12 },
      ];
      bold(mon.getRow(1));
      plantRows.forEach((p) => p.perMonth.forEach((b, i) => {
        if (!b) return;
        mon.addRow({
          plant: p.plant, month: `${MONTHS[i]} ${year}`, g: allocated(b), on: b.onTime, fail: b.failed, pend: pending(b),
          aoq: b.approvedOnTime, score: scorePct(b) === null ? "" : `${scorePct(b)}%`,
          pct: rate(b) === null ? "" : `${rate(b)}%`, pts: points(b),
        });
      }));
      mon.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } };
      mon.views = [{ state: "frozen", ySplit: 1 }];

      const gs = wb.addWorksheet("Graphics");
      gs.columns = [
        { header: "PLANT", key: "plant", width: 24 },
        { header: "MONTH", key: "month", width: 12 },
        { header: "GRAPHIC", key: "graphic", width: 20 },
        { header: "SEASON", key: "season", width: 10 },
        { header: "CATEGORY", key: "category", width: 18 },
        { header: "PPS DAY(S)", key: "days", width: 22 },
        { header: "RESULT", key: "result", width: 22 },
        { header: "POINTS", key: "pts", width: 10 },
        { header: "AOQ VERDICT", key: "aoq", width: 20 },
        { header: "FAIL REASON", key: "reason", width: 34 },
      ];
      bold(gs.getRow(1));
      const aoqLabel = (v: AoqVerdict | null) =>
        v === "onTime" ? "Approved before AOQ" : v === "late" ? "Approved late" : v === "rejected" ? "Rejected" : v === "pending" ? "Awaiting verdict" : v === "unscored" ? "No AOQ date" : "";
      plantRows.forEach((p) => [...p.total.graphics]
        .sort((a, b) => (a.dates[0] || "").localeCompare(b.dates[0] || "") || a.graphic.localeCompare(b.graphic))
        .forEach((g) => {
          const pts = g.outcome === "onTime" ? passPts : g.outcome === "failed" ? -failPts : 0;
          const added = gs.addRow({
            plant: p.plant, month: g.dates[0] ? `${MONTHS[Number(g.dates[0].slice(5, 7)) - 1]} ${g.dates[0].slice(0, 4)}` : "",
            graphic: g.graphic, season: g.season, category: g.category, days: g.dates.map(fmtDay).join(", "),
            result: label(g.outcome), pts, aoq: aoqLabel(g.aoqVerdict), reason: g.reason,
          });
          const c = added.getCell("result");
          if (g.outcome === "onTime") { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } }; c.font = { bold: true, color: { argb: "FF006100" } }; }
          if (g.outcome === "failed") { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } }; c.font = { bold: true, color: { argb: "FF9C0006" } }; }
        }));
      gs.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } };
      gs.views = [{ state: "frozen", ySplit: 1 }];

      const buf = await wb.xlsx.writeBuffer();
      saveAs(
        new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `Plant_Performance_${year}${periodMode === "quarter" ? `-Q${quarter}` : periodMode === "range" ? "-range" : month !== "all" ? `-${month}` : ""}.xlsx`,
      );
    } finally {
      setExporting(false);
    }
  };

  const selectCls = "bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/40";

  return (
    <div className="min-h-screen bg-[#0a0d14] text-white">
      {/* header */}
      <div className="px-6 pt-8 pb-4 border-b border-zinc-800/60">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-black tracking-tight">🏭 Plant Performance — PPS by Month</h1>
            <p className="text-zinc-400 text-sm mt-1 font-medium max-w-3xl">
              Score % = 60% on-time submission (PPS green) + 40% approved before AOQ (NY verdict vs. the graphic&apos;s AOQ deadline).
              Net points still track PPS pass/fail only. Graphics are counted once per plant per month. · {scopeLabel} · {plantRows.length} plants
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={year} onChange={(e) => setYearPick(e.target.value)} className={selectCls}
              title={periodMode === "quarter" ? "Fiscal year — Q1 starts in April of this year" : "Year"}>
              {data.years.length === 0 && <option value="">No PPS data</option>}
              {data.years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded-xl p-1" title="How the totals/KPIs/score below are windowed">
              {([["month", "Month"], ["quarter", "Quarter"], ["range", "Date range"]] as const).map(([m, lbl]) => (
                <button key={m} onClick={() => setPeriodMode(m)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${periodMode === m ? "bg-amber-500 text-black" : "text-zinc-400 hover:text-white"}`}>
                  {lbl}
                </button>
              ))}
            </div>
            {periodMode === "month" && (
              <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectCls}>
                <option value="all">All months</option>
                {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>)}
              </select>
            )}
            {periodMode === "quarter" && (
              <select value={quarter} onChange={(e) => setQuarter(Number(e.target.value) as 1 | 2 | 3 | 4)} className={selectCls}
                title="Fiscal quarter, starting April">
                <option value={1}>Q1 · Apr–Jun</option>
                <option value={2}>Q2 · Jul–Sep</option>
                <option value={3}>Q3 · Oct–Dec</option>
                <option value={4}>Q4 · Jan–Mar</option>
              </select>
            )}
            {periodMode === "range" && (
              <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5">
                <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)}
                  className="bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-xs text-zinc-200" />
                <span className="text-zinc-500 text-xs">to</span>
                <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)}
                  className="bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-xs text-zinc-200" />
              </div>
            )}
            <select value={season} onChange={(e) => { setSeason(e.target.value); setCategory("all"); }} className={selectCls}>
              <option value="all">🗓️ All Seasons</option>
              {seasonOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
              <option value="all">All Categories</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-2" title="Points a graphic earns when its PPS is green">
              Pass
              <input type="number" min={0} max={100} value={passPts}
                onChange={(e) => setPassPts(Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10))))}
                className="w-12 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-center" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-2" title="Points a graphic loses when its PPS is red (entered as a positive number, subtracted)">
              Fail −
              <input type="number" min={0} max={100} value={failPts}
                onChange={(e) => setFailPts(Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10))))}
                className="w-12 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-center" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-2"
              title="Days added to the AOQ date before an NY approval counts as late, for the score's 40% half (same grace Score Card's AOQ Approval page uses)">
              AOQ grace
              <input type="number" min={0} max={30} value={graceDays}
                onChange={(e) => setGraceDays(Math.max(0, Math.min(30, parseInt(e.target.value || "0", 10))))}
                className="w-12 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-center" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2"
              title="A PPS whose day has passed but that the plant never marked green or red. Off = shown as Pending, no points. On = counted as a failure.">
              <input type="checkbox" checked={overdueAsFailed} onChange={(e) => setOverdueAsFailed(e.target.checked)} />
              Count un-updated overdue PPS as failed
            </label>
          </div>
        </div>
      </div>

      {/* exports */}
      <div className="px-6 py-3 border-b border-zinc-800/60 flex items-center justify-between gap-4 flex-wrap">
        <button
          onClick={exportExcel}
          disabled={exporting || plantRows.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl transition-all shadow-md active:scale-[0.98]"
          title="Download what you see here as Excel — Summary, Monthly and Graphics sheets, using the current year / month / season / category filters"
        >
          {exporting ? "Exporting…" : "Export performance (Excel)"}
        </button>
        <PlantPlanRangeExport rows={rows} />
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {[
            { label: "Graphics allocated", value: allocated(grand), sub: "with a PPS this period", color: "text-blue-300" },
            { label: "Score %", value: scorePct(grand) === null ? "—" : `${scorePct(grand)}%`, sub: "60% on-time + 40% approved before AOQ", color: "text-sky-400" },
            { label: "On time (PPS green)", value: grand.onTime, sub: rate(grand) === null ? "no verdicts yet" : `${rate(grand)}% of resolved`, color: "text-emerald-400" },
            { label: "Approved before AOQ", value: grand.approvedOnTime, sub: approvalRate(grand) === null ? "no verdicts yet" : `${approvalRate(grand)}% of allocated`, color: "text-teal-400" },
            { label: "Failed (PPS red)", value: grand.failed, sub: overdueAsFailed ? "incl. overdue un-updated" : "marked red by the plant", color: "text-red-400" },
            { label: "Pending", value: pending(grand), sub: `${grand.overdue} overdue · ${grand.upcoming} upcoming`, color: "text-zinc-300" },
            { label: "Net points", value: fmtPts(points(grand)), sub: `+${passPts} pass · −${failPts} fail`, color: ptsColor(points(grand)) },
          ].map((c) => (
            <div key={c.label} className="bg-[#0f1115] border border-zinc-800 rounded-2xl p-4">
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{c.label}</p>
              <p className={`text-2xl font-black mt-1 ${c.color}`}>{c.value}</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* monthly chart */}
        <div className="bg-[#0f1115] border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-black text-base">Monthly trend — {selectedPlant ?? "all plants"}</h2>
              <p className="text-[10px] text-zinc-500 mt-0.5">Bars = graphics by PPS result · line = net points</p>
            </div>
            {selectedPlant && (
              <button onClick={() => setSelectedPlant(null)} className="px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-900 border border-zinc-700 rounded-lg">
                Show all plants
              </button>
            )}
          </div>
          <div className="p-4">
            {plantRows.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-zinc-600 text-sm">No PPS events for this filter</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                  <YAxis yAxisId="g" allowDecimals={false} tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <YAxis yAxisId="p" orientation="right" allowDecimals={false} tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#0f1115", border: "1px solid #27272a", borderRadius: 8 }} labelStyle={{ color: "#e4e4e7" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="g" dataKey="onTime" stackId="v" fill={C_ONTIME} name="On time" />
                  <Bar yAxisId="g" dataKey="failed" stackId="v" fill={C_FAILED} name="Failed" />
                  <Bar yAxisId="g" dataKey="pending" stackId="v" fill={C_PENDING} name="Pending" />
                  <Line yAxisId="p" dataKey="points" stroke={C_SCORE} strokeWidth={2} dot={{ r: 3 }} name="Net points" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* plant × month table */}
        <div className="bg-[#0f1115] border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800">
            <h2 className="font-black text-base">Plant scoreboard — {scopeLabel}</h2>
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
              Totals follow the period filter above · Score % = 60% on-time submission + 40% approved before AOQ · month cells show net points (on time / failed) · click a plant for its graphics
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800/60 bg-zinc-900/40">
                  <th className="text-left px-5 py-3 font-black">Plant</th>
                  <th className="text-center px-3 py-3 font-black">Graphics</th>
                  <th className="text-center px-3 py-3 font-black text-emerald-500">On time</th>
                  <th className="text-center px-3 py-3 font-black text-red-500">Failed</th>
                  <th className="text-center px-3 py-3 font-black">Pending</th>
                  <th className="text-center px-3 py-3 font-black text-teal-400" title="Graphics NY-approved before their AOQ deadline (+ grace)">Approved AOQ</th>
                  <th className="text-center px-3 py-3 font-black" title="60% on-time submission rate + 40% approved-before-AOQ rate, both against graphics allocated this period">Score %</th>
                  <th className="text-center px-3 py-3 font-black text-sky-400">Points</th>
                  {MONTHS.map((m, i) => (
                    <th key={m}
                      className={`text-center px-2 py-3 font-black cursor-pointer hover:text-white ${periodMode === "month" && month === String(i + 1).padStart(2, "0") ? "text-amber-400" : ""}`}
                      onClick={() => {
                        setPeriodMode("month");
                        setMonth(periodMode === "month" && month === String(i + 1).padStart(2, "0") ? "all" : String(i + 1).padStart(2, "0"));
                      }}
                      title="Click to filter the totals to this month">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plantRows.length === 0 && (
                  <tr><td colSpan={8 + MONTHS.length} className="px-5 py-10 text-center text-zinc-600">No PPS events for this filter</td></tr>
                )}
                {plantRows.map((p) => {
                  const pts = points(p.total);
                  const score = scorePct(p.total);
                  return (
                    <tr key={p.plant}
                      onClick={() => setSelectedPlant(selectedPlant === p.plant ? null : p.plant)}
                      className={`border-b border-zinc-800/40 cursor-pointer hover:bg-zinc-900/60 ${selectedPlant === p.plant ? "bg-zinc-900/80" : ""}`}>
                      <td className="px-5 py-3 font-bold text-zinc-100">{p.plant}</td>
                      <td className="text-center px-3 py-3 tabular-nums">{allocated(p.total)}</td>
                      <td className="text-center px-3 py-3 tabular-nums text-emerald-400 font-semibold">{p.total.onTime}</td>
                      <td className="text-center px-3 py-3 tabular-nums text-red-400 font-semibold">{p.total.failed}</td>
                      <td className="text-center px-3 py-3 tabular-nums text-zinc-400" title={`${p.total.overdue} overdue · ${p.total.upcoming} upcoming`}>{pending(p.total)}</td>
                      <td className="text-center px-3 py-3 tabular-nums text-teal-400 font-semibold" title={approvalRate(p.total) === null ? undefined : `${approvalRate(p.total)}% of allocated`}>{p.total.approvedOnTime}</td>
                      <td className="text-center px-3 py-3 tabular-nums font-black" title={`On-time submission: ${rate(p.total) === null ? "—" : `${rate(p.total)}%`} of resolved`}>{score === null ? "—" : `${score}%`}</td>
                      <td className={`text-center px-3 py-3 tabular-nums font-black ${ptsColor(pts)}`}>{fmtPts(pts)}</td>
                      {p.perMonth.map((b, i) => (
                        <td key={i} className="text-center px-2 py-2 tabular-nums"
                          title={b ? `${MONTHS[i]}: ${b.onTime} on time · ${b.failed} failed · ${pending(b)} pending` : undefined}>
                          {b ? (
                            <div className="leading-tight">
                              <div className={`font-bold ${ptsColor(points(b))}`}>{fmtPts(points(b))}</div>
                              <div className="text-[10px] text-zinc-500">{b.onTime}/{b.failed}</div>
                            </div>
                          ) : <span className="text-zinc-700">·</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* drill-down */}
        {detail && (
          <div className="bg-[#0f1115] border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-black text-base">{detail.plant} — graphics ({scopeLabel})</h2>
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
                  {detail.total.graphics.length} graphics · {detail.total.onTime} on time · {detail.total.failed} failed · {pending(detail.total)} pending · {detail.total.approvedOnTime} approved before AOQ
                </span>
              </div>
              <button onClick={() => setSelectedPlant(null)} className="px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-900 border border-zinc-700 rounded-lg">Close</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800/60 bg-zinc-900/40">
                    <th className="text-left px-5 py-3 font-black">Graphic</th>
                    <th className="text-left px-3 py-3 font-black">Season</th>
                    <th className="text-left px-3 py-3 font-black">Category</th>
                    <th className="text-left px-3 py-3 font-black">PPS day(s)</th>
                    <th className="text-left px-3 py-3 font-black">Result</th>
                    <th className="text-left px-3 py-3 font-black">AOQ verdict</th>
                    <th className="text-left px-3 py-3 font-black">Fail reason</th>
                  </tr>
                </thead>
                <tbody>
                  {[...detail.total.graphics]
                    .sort((a, b) => (a.dates[0] || "").localeCompare(b.dates[0] || "") || a.graphic.localeCompare(b.graphic))
                    .map((g, idx) => (
                      <tr key={`${g.key}-${idx}`} className="border-b border-zinc-800/40">
                        <td className="px-5 py-2.5 font-semibold text-zinc-100">{g.graphic}</td>
                        <td className="px-3 py-2.5 text-zinc-400">{g.season}</td>
                        <td className="px-3 py-2.5 text-zinc-400">{g.category}</td>
                        <td className="px-3 py-2.5 text-zinc-400 tabular-nums">{g.dates.map(fmtDay).join(", ")}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            g.outcome === "onTime" ? "bg-emerald-500/15 text-emerald-400"
                              : g.outcome === "failed" ? "bg-red-500/15 text-red-400"
                                : g.outcome === "overdue" ? "bg-amber-500/15 text-amber-400"
                                  : "bg-zinc-700/40 text-zinc-400"}`}>
                            {g.outcome === "onTime" ? `On time ${fmtPts(passPts)}` : g.outcome === "failed" ? `Failed ${fmtPts(-failPts)}` : g.outcome === "overdue" ? "Overdue — not updated" : "Upcoming"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            g.aoqVerdict === "onTime" ? "bg-teal-500/15 text-teal-400"
                              : g.aoqVerdict === "late" ? "bg-amber-500/15 text-amber-400"
                                : g.aoqVerdict === "rejected" ? "bg-red-500/15 text-red-400"
                                  : "bg-zinc-700/40 text-zinc-400"}`}>
                            {g.aoqVerdict === "onTime" ? "Approved before AOQ"
                              : g.aoqVerdict === "late" ? "Approved late"
                                : g.aoqVerdict === "rejected" ? "Rejected"
                                  : g.aoqVerdict === "pending" ? "Awaiting verdict"
                                    : g.aoqVerdict === "unscored" ? "No AOQ date"
                                      : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-zinc-500 text-xs">{g.reason}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
