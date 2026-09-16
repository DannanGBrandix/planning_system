"use client";
import React, { useEffect, useMemo, useState } from "react";
import {
  EmbellishmentRow, getRowStatus, getSeasonAoqConfig, SeasonAoqMap,
  getPlantAliasConfig, savePlantAliasConfig, PlantAliasConfig,
} from "../lib/db";
import { parseEventValue } from "../lib/eventCodes";
import { extractPlants, applyPlantAliasConfig } from "../lib/plantUtils";
import { extractValidDate, formatDateDDMMYYYY, seasonAoqKey } from "../lib/triggerUtils";
import {
  parseTriggerMD, nearestYearIso, rowRefIso, readNycVerdict, deriveNycVerdict, markNycVerdict,
} from "../lib/nycVerdict";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Line, ComposedChart,
} from "recharts";

interface PlantPerformanceDashboardProps {
  rows: EmbellishmentRow[];
  onUpdateRow: (row: EmbellishmentRow) => void | Promise<void>;
  currentRole?: string;
}

// ── palette ────────────────────────────────────────────────────────────────
const C_ONTIME = "#10b981";
const C_LATE = "#f59e0b";
const C_REJECT = "#ef4444";
const C_PENDING = "#64748b";
const C_SCORE = "#38bdf8";

// ── small date helpers ─────────────────────────────────────────────────────
const isoRe = /^\d{4}-\d{2}-\d{2}$/;

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// whole days from `a` to `b` (b - a). Positive => b is later.
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00") - Date.parse(a + "T00:00:00")) / 86400000);
}

// Base season token ("SP27" from "SP27 ICON SHOP" / "FA27\n…").
function seasonBase(v: unknown): string {
  return String(v ?? "").replace(/["'\r\n]+/g, " ").trim().toUpperCase().split(/\s+/)[0];
}

// Base event code, hyphen-marker & pipe stripped ("PPS" from "PPS-S" / "PPS|P").
function baseCode(v: unknown): string {
  return String(v ?? "").split("|")[0].trim().toUpperCase().split("-")[0];
}
// Full event code, keeping the -A / -R verdict suffix but dropping "-S" / "|P" etc.
function fullCode(raw: string): string {
  const p = parseEventValue(raw);
  return (p?.code || "").toUpperCase();
}

// Every "<date>" / "<date>_<leg>" cell on a row (flattened keys + schedule JSON).
function dateEntriesOf(row: EmbellishmentRow): [string, string][] {
  const out: [string, string][] = [];
  const push = (k: string, v: unknown) => {
    if (typeof v === "string" && v.trim() && /^\d{4}-\d{2}-\d{2}/.test(k)) out.push([k.slice(0, 10), v.trim()]);
  };
  Object.entries(row).forEach(([k, v]) => push(k, v));
  if (row.schedule && typeof row.schedule === "object") {
    Object.entries(row.schedule as Record<string, unknown>).forEach(([k, v]) => push(k, v));
  }
  return out;
}

// AOQ deadline for a row: a real date in col20, else the trigger's own month/day code
// (parseTriggerMD + year resolved from the row's own events, nearestYearIso — both in
// app/lib/nycVerdict.ts), else the row's Category+Season AOQ date set on the Trigger Manager
// page (a Trigger like "KNIT" / "COMPLETE" / "RECEIVE" names a process stage, not a deadline, so
// it never parses as an M.D code — PINK/VS/CK each still need a season deadline to score
// against). Multiple dates on one trigger -> the latest.
function getRowAoqIso(row: EmbellishmentRow, seasonAoqMap: SeasonAoqMap): string | null {
  const col20 = extractValidDate(row.col20);
  if (col20) return col20;
  const mds = parseTriggerMD(String(row.col2 || ""));
  if (mds.length) {
    const ref = rowRefIso(row as unknown as Record<string, unknown>);
    const isos = mds.map(([m, d]) => nearestYearIso(m, d, ref)).filter(Boolean).sort();
    if (isos.length) return isos[isos.length - 1];
  }
  const seasonDate = seasonAoqMap[seasonAoqKey(row.col3, seasonBase(row.col4))];
  return seasonDate ? extractValidDate(seasonDate) : null;
}

type Verdict = "onTime" | "late" | "rejected" | "pending" | "unscored";
const VERDICT_LABEL: Record<Verdict, string> = {
  onTime: "Approved on time",
  late: "Approved late",
  rejected: "Rejected (NYC-R)",
  pending: "Awaiting verdict",
  unscored: "No AOQ date",
};

interface GraphicPerf {
  graphic: string;
  season: string;
  category: string;
  trigger: string;
  aoqIso: string | null;
  plants: string[];
  dispatched: boolean;
  approvalIso: string | null;
  rejectedIso: string | null;
  verdict: Verdict;
  daysVsAoq: number | null; // (aoq + grace) - approval; >= 0 == on time
  estimated: boolean; // verdict parsed live from a comment (not materialised), or a dateless approval
  status: ReturnType<typeof getRowStatus>;
  rowCount: number;
}

interface PlantAgg {
  key: string;
  plant: string;
  category: string | null;
  allocated: number;
  dispatched: number;
  onTime: number;
  late: number;
  rejected: number;
  pending: number;
  unscored: number;
  scorePct: number;
  netScore: number;
  graphics: GraphicPerf[];
}

export default function PlantPerformanceDashboard({ rows, onUpdateRow, currentRole }: PlantPerformanceDashboardProps) {
  const canManagePlants = currentRole === "Planner" || currentRole === "Management";
  const [season, setSeason] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [graceDays, setGraceDays] = useState(1);
  const [sortBy, setSortBy] = useState<"score" | "allocated" | "onTime" | "problems">("score");
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null);
  // NYC-A / NYC-R that are parsed live from a strike-off comment but not yet materialised
  // (no "AD M/D" line-date to place them on) still count when this is on — flagged "≈".
  const [useFallback, setUseFallback] = useState(true);
  const [busy, setBusy] = useState<{ label: string; done: number; total: number } | null>(null);
  const [verdictDate, setVerdictDate] = useState<Record<string, string>>({});
  // Category+Season AOQ fallback (set on the Trigger Manager page) — used only when a row's own
  // Trigger carries no date (col20 blank and the trigger text isn't an M.D code).
  const [seasonAoqMap, setSeasonAoqMap] = useState<SeasonAoqMap>({});

  useEffect(() => {
    getSeasonAoqConfig().then(setSeasonAoqMap).catch(() => {});
  }, []);

  // Plant aliases (merge two plant spellings) / exclusions (hide a bogus plant) — applied as a
  // normalization layer in plantUtils so extractPlants() picks them up everywhere, without ever
  // touching the raw col11/col12 text on a row. `aliasVersion` exists only to force `analysis`
  // to recompute after a save, since applyPlantAliasConfig mutates module-level state that
  // useMemo can't see in its dependency array on its own.
  const [plantAliasConfig, setPlantAliasConfig] = useState<PlantAliasConfig>({ aliases: {}, excluded: [] });
  const [aliasVersion, setAliasVersion] = useState(0);
  const [selectedPlants, setSelectedPlants] = useState<Set<string>>(new Set());
  const [plantMergePanelOpen, setPlantMergePanelOpen] = useState(false);
  const [plantMergeTarget, setPlantMergeTarget] = useState<string>("");
  const [plantMergeCustomName, setPlantMergeCustomName] = useState("");
  const [plantBusy, setPlantBusy] = useState(false);

  useEffect(() => {
    getPlantAliasConfig().then((cfg) => {
      applyPlantAliasConfig(cfg);
      setPlantAliasConfig(cfg);
      setAliasVersion((v) => v + 1);
    }).catch(() => {});
  }, []);

  const togglePlantSelected = (plant: string) => {
    setSelectedPlants((prev) => {
      const next = new Set(prev);
      if (next.has(plant)) next.delete(plant);
      else next.add(plant);
      return next;
    });
  };

  const handleDeletePlant = async (plant: string) => {
    if (!canManagePlants || plantBusy || plant === "(unassigned)") return;
    const ok = window.confirm(
      `Hide plant "${plant}"?\n\nIt will no longer appear anywhere plants are grouped (Plant Performance, Plant Schedules, Fabric Dispatch). Row data (col11/col12) is untouched — this can be undone from here later.`,
    );
    if (!ok) return;
    setPlantBusy(true);
    try {
      const next: PlantAliasConfig = {
        aliases: plantAliasConfig.aliases,
        excluded: Array.from(new Set([...plantAliasConfig.excluded, plant])),
      };
      await savePlantAliasConfig(next);
      applyPlantAliasConfig(next);
      setPlantAliasConfig(next);
      setAliasVersion((v) => v + 1);
      setSelectedPlants((prev) => {
        const s = new Set(prev);
        s.delete(plant);
        return s;
      });
      if (selectedPlant === plant) setSelectedPlant(null);
    } finally {
      setPlantBusy(false);
    }
  };

  const openPlantMergePanel = () => {
    if (selectedPlants.size < 2) return;
    setPlantMergeTarget(Array.from(selectedPlants).sort()[0]);
    setPlantMergeCustomName("");
    setPlantMergePanelOpen(true);
  };

  const confirmPlantMerge = async () => {
    if (plantBusy) return;
    const finalName = (plantMergeCustomName.trim() || plantMergeTarget).toUpperCase();
    if (!finalName) return;
    const sources = Array.from(selectedPlants).filter((p) => p.toUpperCase() !== finalName);
    if (sources.length === 0) {
      setPlantMergePanelOpen(false);
      return;
    }
    const ok = window.confirm(
      `Merge ${selectedPlants.size} plants into "${finalName}"?\n\nEverywhere plants are grouped will show these as one plant from now on. Row data (col11/col12) is untouched.`,
    );
    if (!ok) return;
    setPlantBusy(true);
    try {
      const aliases = { ...plantAliasConfig.aliases };
      sources.forEach((p) => { aliases[p] = finalName; });
      const next: PlantAliasConfig = { aliases, excluded: plantAliasConfig.excluded };
      await savePlantAliasConfig(next);
      applyPlantAliasConfig(next);
      setPlantAliasConfig(next);
      setAliasVersion((v) => v + 1);
      setSelectedPlants(new Set());
      setPlantMergePanelOpen(false);
      setPlantMergeCustomName("");
    } finally {
      setPlantBusy(false);
    }
  };

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

  // ── core: per-graphic performance ────────────────────────────────────────
  const analysis = useMemo(() => {
    const inSeason = rows.filter((r) => {
      if (season !== "all" && seasonBase(r.col4) !== season) return false;
      if (category !== "all" && String(r.col3 || "").trim() !== category) return false;
      return true;
    });

    // "Came to the season" — every distinct graphic, any status.
    const cameSet = new Set<string>();
    inSeason.forEach((r) => {
      const g = String(r.col7 || r.col6 || r.col5 || "").trim();
      if (g) cameSet.add(g);
    });

    // Score only live rows (Dropped / Hold are out of the running).
    const liveRows = inSeason.filter((r) => {
      const st = getRowStatus(r);
      return st !== "dropped" && st !== "hold";
    });

    // group live rows by graphic
    const byGraphic = new Map<string, EmbellishmentRow[]>();
    liveRows.forEach((r) => {
      const g = String(r.col7 || r.col6 || r.col5 || "").trim();
      if (!g) return;
      const list = byGraphic.get(g) || [];
      list.push(r);
      byGraphic.set(g, list);
    });

    const triggerAoq = new Map<string, Set<string>>(); // trigger -> AOQ iso set (for the trigger table)
    const graphics: GraphicPerf[] = [];

    byGraphic.forEach((gRows, graphic) => {
      const plantSet = new Set<string>();
      const catCount = new Map<string, number>();
      const trigCount = new Map<string, number>();
      let aoqIso: string | null = null;
      let nyPass = false;
      let approvalIso: string | null = null;
      let rejectedIso: string | null = null;
      let anyEstimated = false; // verdict came from a live comment parse, not a materialised nycv:/cell
      let lastNycIso: string | null = null; // latest NYC / NY event — last-resort approval date
      let anyApprovedStatus = false;
      let anyResubmitStatus = false;

      gRows.forEach((r) => {
        extractPlants(r.col11 as string | null | undefined).forEach((p) => plantSet.add(p));
        extractPlants(r.col12 as string | null | undefined).forEach((p) => plantSet.add(p));
        const c = String(r.col3 || "").trim();
        if (c) catCount.set(c, (catCount.get(c) || 0) + 1);
        const t = String(r.col2 || "").trim();
        if (t && t.toUpperCase() !== "N/A" && t !== "-") trigCount.set(t, (trigCount.get(t) || 0) + 1);
        const st = getRowStatus(r);
        if (st === "approved") anyApprovedStatus = true;
        if (st === "resubmit") anyResubmitStatus = true;

        const rowAoq = getRowAoqIso(r, seasonAoqMap);
        if (rowAoq && (!aoqIso || rowAoq > aoqIso)) aoqIso = rowAoq; // latest wins = lenient

        dateEntriesOf(r).forEach(([iso, val]) => {
          if (!isoRe.test(iso)) return;
          const p = parseEventValue(val);
          if (!p) return;
          const bc = baseCode(val);
          const fc = fullCode(val);
          if (p.status === "pass" && bc === "NY" && fc === "NY") nyPass = true;
          if ((bc === "NYC" || (bc === "NY" && fc === "NY")) && (!lastNycIso || iso > lastNycIso)) lastNycIso = iso;
        });

        // NY approval verdict: real NYC-A/NYC-R cell -> manual "nycv:" -> derived "nycv:" ->
        // parse the strike-off comment on the fly. See app/lib/nycVerdict.ts.
        const rv = readNycVerdict(r as unknown as Record<string, unknown>);
        if (rv) {
          if (rv.source === "comment") anyEstimated = true;
          if (rv.kind === "A") {
            if (!approvalIso || rv.iso < approvalIso) approvalIso = rv.iso;
          } else if (!rejectedIso || rv.iso > rejectedIso) {
            rejectedIso = rv.iso;
          }
        }
      });

      const trigger = [...trigCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      const cat = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
      if (trigger) {
        const set = triggerAoq.get(trigger) || new Set<string>();
        if (aoqIso) set.add(aoqIso);
        triggerAoq.set(trigger, set);
      }

      // Verdict from readNycVerdict above; last-resort fallback for a row that is Approved /
      // Resubmit by getRowStatus but whose comment carries no parseable "AD M/D" line-date.
      let verdict: Verdict;
      let daysVsAoq: number | null = null;
      let estimated = anyEstimated;
      let effApprovalIso: string | null = approvalIso;
      let effRejected = Boolean(rejectedIso && (!approvalIso || rejectedIso > approvalIso));

      if (!approvalIso && !rejectedIso && useFallback && (anyApprovedStatus || anyResubmitStatus)) {
        estimated = true;
        if (anyApprovedStatus) effApprovalIso = lastNycIso; // may be null -> "unscored"
        else effRejected = true;
      }

      if (effApprovalIso && !effRejected) {
        if (!aoqIso) {
          verdict = "unscored";
        } else {
          daysVsAoq = dayDiff(effApprovalIso, addDays(aoqIso, graceDays)); // deadline - approval
          verdict = daysVsAoq >= 0 ? "onTime" : "late";
        }
      } else if (effRejected) {
        verdict = "rejected";
      } else if (anyApprovedStatus && !effApprovalIso) {
        // approved, but no date anywhere to place it — count it as approved, timing unknown
        verdict = "unscored";
      } else {
        verdict = "pending";
      }

      graphics.push({
        graphic,
        season: seasonBase(gRows[0].col4),
        category: cat,
        trigger,
        aoqIso,
        plants: [...plantSet].sort(),
        dispatched: nyPass,
        approvalIso: effApprovalIso,
        rejectedIso: effRejected ? (rejectedIso || null) : null,
        verdict,
        daysVsAoq,
        estimated,
        status: getRowStatus(gRows[0]),
        rowCount: gRows.length,
      });
    });

    // ── roll up to plants (× category when toggled) ────────────────────────
    const aggMap = new Map<string, PlantAgg>();
    const bump = (plant: string, cat: string | null, g: GraphicPerf) => {
      const key = cat === null ? plant : `${plant}|||${cat}`;
      let a = aggMap.get(key);
      if (!a) {
        a = {
          key, plant, category: cat, allocated: 0, dispatched: 0,
          onTime: 0, late: 0, rejected: 0, pending: 0, unscored: 0,
          scorePct: 0, netScore: 0, graphics: [],
        };
        aggMap.set(key, a);
      }
      a.allocated++;
      if (g.dispatched) a.dispatched++;
      a[g.verdict]++;
      a.graphics.push(g);
    };
    graphics.forEach((g) => {
      const plants = g.plants.length ? g.plants : ["(unassigned)"];
      plants.forEach((p) => bump(p, groupByCategory ? g.category : null, g));
    });

    const plantAggs = [...aggMap.values()];
    plantAggs.forEach((a) => {
      a.scorePct = a.allocated > 0 ? Math.round((a.onTime / a.allocated) * 100) : 0;
      a.netScore = a.onTime * 40 - (a.late + a.rejected) * 60;
    });

    // ── season-level totals ───────────────────────────────────────────────
    const totals = {
      came: cameSet.size,
      scoredGraphics: graphics.length,
      allocated: graphics.filter((g) => g.plants.length).length,
      dispatched: graphics.filter((g) => g.dispatched).length,
      onTime: graphics.filter((g) => g.verdict === "onTime").length,
      late: graphics.filter((g) => g.verdict === "late").length,
      rejected: graphics.filter((g) => g.verdict === "rejected").length,
      pending: graphics.filter((g) => g.verdict === "pending").length,
      unscored: graphics.filter((g) => g.verdict === "unscored").length,
      estimated: graphics.filter((g) => g.estimated).length,
    };
    const overallRate = totals.allocated > 0 ? Math.round((totals.onTime / totals.allocated) * 100) : 0;

    // ── trigger / AOQ table ───────────────────────────────────────────────
    const triggerRows = [...triggerAoq.entries()]
      .map(([trigger, set]) => {
        const gs = graphics.filter((g) => g.trigger === trigger);
        return {
          trigger,
          aoqStr: [...set].sort().map((d) => formatDateDDMMYYYY(d)).filter(Boolean).join(", ") || "Not set",
          graphics: gs.length,
          onTime: gs.filter((g) => g.verdict === "onTime").length,
          late: gs.filter((g) => g.verdict === "late").length,
          rejected: gs.filter((g) => g.verdict === "rejected").length,
          pending: gs.filter((g) => g.verdict === "pending").length,
        };
      })
      .sort((a, b) => b.graphics - a.graphics);

    return { graphics, plantAggs, totals, overallRate, triggerRows };
    // aliasVersion isn't read directly — it just forces a recompute after a plant merge/hide,
    // since extractPlants() reads RUNTIME_PLANT_ALIASES from module state useMemo can't see.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, season, category, groupByCategory, graceDays, useFallback, seasonAoqMap, aliasVersion]);

  // Materialise every row's NY verdict (nycv: keys) from its strike-off comments in one pass.
  const handleRecompute = async () => {
    if (busy) return;
    const changed: EmbellishmentRow[] = [];
    rows.forEach((r) => {
      const d = deriveNycVerdict(r as unknown as Record<string, unknown>);
      const keys = new Set(
        [...Object.keys(r), ...Object.keys(d)].filter((k) => k.startsWith("nycv:")),
      );
      let diff = false;
      keys.forEach((k) => {
        if (String((r as Record<string, unknown>)[k] ?? "") !== String(d[k] ?? "")) diff = true;
      });
      if (diff) changed.push(d as unknown as EmbellishmentRow);
    });
    if (changed.length === 0) {
      setBusy({ label: "NY approvals already up to date", done: 1, total: 1 });
      setTimeout(() => setBusy(null), 1800);
      return;
    }
    setBusy({ label: "Saving NY approvals", done: 0, total: changed.length });
    for (let i = 0; i < changed.length; i++) {
      await onUpdateRow({ ...changed[i], change_reason: "NY approval verdict recomputed" });
      setBusy({ label: "Saving NY approvals", done: i + 1, total: changed.length });
    }
    setBusy(null);
  };

  const setGraphicVerdict = async (g: GraphicPerf, kind: "A" | "R" | null, iso: string) => {
    if (busy) return;
    const targets = rows.filter(
      (r) => String(r.col7 || r.col6 || r.col5 || "").trim() === g.graphic,
    );
    if (targets.length === 0) return;
    setBusy({ label: `Setting verdict for ${g.graphic}`, done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      const base = targets[i] as unknown as Record<string, unknown>;
      const next =
        kind === null
          ? Object.fromEntries(
              Object.keys(base)
                .filter((k) => k.startsWith("nycv:") && String(base[k] ?? "").trim())
                .map((k) => [k, ""]),
            )
          : markNycVerdict(base, kind, iso);
      await onUpdateRow({ ...targets[i], ...next, change_reason: "NY verdict set from Plant Performance" } as EmbellishmentRow);
      setBusy({ label: `Setting verdict for ${g.graphic}`, done: i + 1, total: targets.length });
    }
    setBusy(null);
  };

  const sortedAggs = useMemo(() => {
    const copy = [...analysis.plantAggs];
    copy.sort((a, b) => {
      if (sortBy === "score") return b.scorePct - a.scorePct || b.allocated - a.allocated;
      if (sortBy === "allocated") return b.allocated - a.allocated;
      if (sortBy === "onTime") return b.onTime - a.onTime;
      return (b.late + b.rejected + b.pending) - (a.late + a.rejected + a.pending);
    });
    return copy;
  }, [analysis.plantAggs, sortBy]);

  const chartData = useMemo(
    () =>
      sortedAggs.map((a) => ({
        name: a.category ? `${a.plant} · ${a.category}` : a.plant,
        plant: a.plant,
        onTime: a.onTime,
        late: a.late,
        rejected: a.rejected,
        pending: a.pending,
        score: a.scorePct,
      })),
    [sortedAggs],
  );

  const selectedGraphics = useMemo(() => {
    if (!selectedPlant) return [];
    const seen = new Set<string>();
    const list: GraphicPerf[] = [];
    analysis.plantAggs
      .filter((a) => a.plant === selectedPlant)
      .forEach((a) => a.graphics.forEach((g) => {
        const k = g.graphic + "|" + (a.category || "");
        if (seen.has(k)) return;
        seen.add(k);
        list.push(g);
      }));
    return list.sort((a, b) => {
      const order: Verdict[] = ["rejected", "late", "pending", "unscored", "onTime"];
      return order.indexOf(a.verdict) - order.indexOf(b.verdict) || a.graphic.localeCompare(b.graphic);
    });
  }, [selectedPlant, analysis.plantAggs]);

  const scoreColor = (n: number) => (n >= 80 ? "text-emerald-400" : n >= 55 ? "text-amber-400" : "text-red-400");
  const scoreBar = (n: number) => (n >= 80 ? "bg-emerald-500" : n >= 55 ? "bg-amber-500" : "bg-red-500");

  // ── PDF ────────────────────────────────────────────────────────────────
  const downloadPdf = () => {
    const t = analysis.totals;
    const head = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <h1>🏭 Plant AOQ-Approval Performance</h1>
          <div class="meta">Generated ${new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}
          &nbsp;·&nbsp; Season: <b>${season === "all" ? "All" : season}</b>
          &nbsp;·&nbsp; Category: <b>${category === "all" ? "All" : category}</b>
          &nbsp;·&nbsp; AOQ grace: <b>${graceDays} day(s)</b></div>
        </div>
        <div style="font-size:11px;color:#6b7280">Brandix Embellishment Plan</div>
      </div>`;
    const kpis = `
      <div class="grid">
        <div class="card"><div class="l">Graphics in season</div><div class="v">${t.came}</div></div>
        <div class="card"><div class="l">Allocated to a plant</div><div class="v">${t.allocated}</div></div>
        <div class="card"><div class="l">Dispatched (PPS+NY)</div><div class="v">${t.dispatched}</div></div>
        <div class="card"><div class="l">Approved on time</div><div class="v" style="color:#059669">${t.onTime}</div>
          <div class="s">${analysis.overallRate}% of allocated</div></div>
      </div>`;
    const plantRows = sortedAggs.map((a, i) => `
      <tr style="background:${i % 2 ? "#fff" : "#f9fafb"}">
        <td style="font-weight:700">${a.plant}${a.category ? ` · ${a.category}` : ""}</td>
        <td class="c">${a.allocated}</td><td class="c">${a.dispatched}</td>
        <td class="c" style="color:#059669;font-weight:700">${a.onTime}</td>
        <td class="c" style="color:#d97706">${a.late}</td>
        <td class="c" style="color:#dc2626">${a.rejected}</td>
        <td class="c">${a.pending}</td><td class="c">${a.unscored}</td>
        <td class="c" style="font-weight:900;color:${a.scorePct >= 80 ? "#059669" : a.scorePct >= 55 ? "#d97706" : "#dc2626"}">${a.scorePct}%</td>
        <td class="c">${a.netScore}</td>
      </tr>`).join("");
    const trigRows = analysis.triggerRows.map((r, i) => `
      <tr style="background:${i % 2 ? "#fff" : "#f9fafb"}">
        <td style="font-weight:700">${r.trigger}</td><td>${r.aoqStr}</td>
        <td class="c">${r.graphics}</td><td class="c" style="color:#059669">${r.onTime}</td>
        <td class="c" style="color:#d97706">${r.late}</td><td class="c" style="color:#dc2626">${r.rejected}</td>
        <td class="c">${r.pending}</td>
      </tr>`).join("");
    const gRows = analysis.graphics
      .slice()
      .sort((a, b) => a.plants[0]?.localeCompare(b.plants[0] || "") || a.graphic.localeCompare(b.graphic))
      .map((g, i) => `
      <tr style="background:${i % 2 ? "#fff" : "#f9fafb"}">
        <td style="font-family:monospace">${g.graphic}</td>
        <td>${g.plants.join(", ") || "—"}</td><td>${g.category}</td><td>${g.trigger || "—"}</td>
        <td>${g.aoqIso ? formatDateDDMMYYYY(g.aoqIso) : "—"}</td>
        <td>${g.dispatched ? "✓" : "—"}</td>
        <td>${g.approvalIso ? formatDateDDMMYYYY(g.approvalIso) : g.rejectedIso ? "R " + formatDateDDMMYYYY(g.rejectedIso) : "—"}</td>
        <td style="color:${g.verdict === "onTime" ? "#059669" : g.verdict === "late" ? "#d97706" : g.verdict === "rejected" ? "#dc2626" : "#6b7280"};font-weight:700">${VERDICT_LABEL[g.verdict]}</td>
        <td class="c">${g.daysVsAoq === null ? "—" : g.daysVsAoq >= 0 ? "+" + g.daysVsAoq : g.daysVsAoq}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Plant AOQ-Approval Performance</title><style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Segoe UI',Arial,sans-serif;color:#111;padding:30px;font-size:12px}
      h1{font-size:22px;font-weight:900;color:#1e293b}
      h2{font-size:13px;font-weight:800;margin:22px 0 8px;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #e5e7eb;padding-bottom:5px}
      .meta{font-size:11px;color:#6b7280;margin-top:3px}
      .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0 6px}
      .card{border:1.5px solid #e5e7eb;border-radius:9px;padding:11px 14px;background:#f8fafc}
      .card .l{font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;font-weight:700}
      .card .v{font-size:21px;font-weight:900;margin-top:3px}
      .card .s{font-size:10px;color:#6b7280;margin-top:2px}
      table{width:100%;border-collapse:collapse;margin-bottom:6px}
      thead tr{background:#1e293b;color:#fff}
      th{padding:7px 9px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
      td{padding:6px 9px;border-bottom:1px solid #eee}
      td.c{text-align:center}
      @media print{body{padding:14px}}
    </style></head><body>
      ${head}${kpis}
      <h2>Plant breakdown</h2>
      <table><thead><tr><th>Plant</th><th class="c">Allocated</th><th class="c">Dispatched</th><th class="c">On time</th>
        <th class="c">Late</th><th class="c">Rejected</th><th class="c">Pending</th><th class="c">No AOQ</th>
        <th class="c">Score</th><th class="c">Net</th></tr></thead><tbody>${plantRows || `<tr><td colspan="10" style="text-align:center;padding:14px;color:#6b7280">No data</td></tr>`}</tbody></table>
      <h2>Triggers &amp; AOQ dates</h2>
      <table><thead><tr><th>Trigger</th><th>AOQ date(s)</th><th class="c">Graphics</th><th class="c">On time</th>
        <th class="c">Late</th><th class="c">Rejected</th><th class="c">Pending</th></tr></thead>
        <tbody>${trigRows || `<tr><td colspan="7" style="text-align:center;padding:14px;color:#6b7280">No triggers</td></tr>`}</tbody></table>
      <h2>Every graphic</h2>
      <table><thead><tr><th>Graphic</th><th>Plant(s)</th><th>Category</th><th>Trigger</th><th>AOQ</th><th>Disp.</th>
        <th>NYC-A / R date</th><th>Verdict</th><th class="c">Days vs AOQ</th></tr></thead>
        <tbody>${gRows || `<tr><td colspan="9" style="text-align:center;padding:14px;color:#6b7280">No graphics</td></tr>`}</tbody></table>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { alert("Allow pop-ups to download the PDF."); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  const t = analysis.totals;

  return (
    <div className="min-h-screen bg-[#0a0d14] text-white">
      {/* header */}
      <div className="px-6 pt-8 pb-4 border-b border-zinc-800/60">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-black tracking-tight">🏭 Plant Performance — AOQ Approval</h1>
            <p className="text-zinc-400 text-sm mt-1 font-medium">
              How many graphics reached each plant and got NY-approved (NYC-A) before the season&apos;s AOQ deadline.
              {season !== "all" ? ` · ${season}` : " · all seasons"}
              {" · "}{analysis.plantAggs.length} plants · {t.scoredGraphics} live graphics
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              suppressHydrationWarning
              onClick={downloadPdf}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-lg shadow-rose-500/20"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download PDF
            </button>
            <button
              suppressHydrationWarning
              onClick={handleRecompute}
              disabled={!!busy}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-all"
              title="Read every graphic's strike-off comments and materialise NYC-A / NYC-R on the grid (leaves manual verdicts alone)"
            >
              🔄 Recompute NY approvals
            </button>
            <select value={season} onChange={(e) => { setSeason(e.target.value); setCategory("all"); }}
              className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/40">
              <option value="all">🗓️ All Seasons</option>
              {seasonOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/40">
              <option value="all">All Categories</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2">
              <input type="checkbox" checked={groupByCategory} onChange={(e) => setGroupByCategory(e.target.checked)} />
              Split by category
            </label>
            <label className="flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2"
              title="Count a graphic whose comment says 'approved' but carries no parseable 'AD M/D' date — dated from its NYC event, marked ≈ estimated. Turn off for firm dated verdicts only.">
              <input type="checkbox" checked={useFallback} onChange={(e) => setUseFallback(e.target.checked)} />
              Include undated approvals
            </label>
            <label className="flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-2" title="Days added to the AOQ date before an approval counts as late">
              AOQ grace
              <input type="number" min={0} max={30} value={graceDays}
                onChange={(e) => setGraceDays(Math.max(0, Math.min(30, parseInt(e.target.value || "0", 10))))}
                className="w-12 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-center" />
            </label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/40">
              <option value="score">Sort: Score %</option>
              <option value="allocated">Sort: Allocated</option>
              <option value="onTime">Sort: On-time count</option>
              <option value="problems">Sort: Problems</option>
            </select>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">
        {busy && (
          <div className="px-4 py-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl">
            <div className="flex items-center justify-between gap-3 mb-2 text-sm font-semibold text-indigo-300">
              <span>{busy.label}… don&apos;t leave this page until it finishes.</span>
              <span className="tabular-nums shrink-0">{busy.done} / {busy.total}</span>
            </div>
            <div className="h-1.5 bg-indigo-950 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-400 transition-all"
                style={{ width: `${busy.total > 0 ? (busy.done / busy.total) * 100 : 100}%` }} />
            </div>
          </div>
        )}

        {season === "all" && (
          <div className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-2.5">
            Pick a season to line graphics up against that season&apos;s AOQ deadline. &quot;All seasons&quot; mixes deadlines together.
          </div>
        )}

        {/* season KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Graphics in season", value: t.came, sub: "any status", color: "text-zinc-100" },
            { label: "Allocated to a plant", value: t.allocated, sub: `${t.scoredGraphics} live`, color: "text-blue-300" },
            { label: "Dispatched", value: t.dispatched, sub: "NY passed (NY|P)", color: "text-cyan-300" },
            { label: "Approved on time", value: t.onTime, sub: `${analysis.overallRate}% of allocated`, color: "text-emerald-400" },
            { label: "Late / Rejected", value: t.late + t.rejected, sub: `${t.late} late · ${t.rejected} rej`, color: "text-amber-400" },
            { label: "Awaiting verdict", value: t.pending, sub: `${t.unscored} no AOQ · ${t.estimated} ≈est.`, color: "text-zinc-300" },
          ].map((c) => (
            <div key={c.label} className="bg-[#0f1115] border border-zinc-800 rounded-2xl p-4">
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{c.label}</p>
              <p className={`text-2xl font-black mt-1 ${c.color}`}>{c.value}</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* bar chart */}
        <div className="bg-[#0f1115] border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800">
            <h2 className="font-black text-base">Approval performance by plant</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5">Bars = graphic verdicts · line = on-time approval rate %</p>
          </div>
          <div className="p-4">
            {chartData.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-zinc-600 text-sm">No graphics for this filter</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(280, chartData.length * 34)}>
                <ComposedChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#0f1115", border: "1px solid #27272a", borderRadius: 8 }} labelStyle={{ color: "#e4e4e7" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="onTime" stackId="v" fill={C_ONTIME} name="On time" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="late" stackId="v" fill={C_LATE} name="Late" />
                  <Bar dataKey="rejected" stackId="v" fill={C_REJECT} name="Rejected" />
                  <Bar dataKey="pending" stackId="v" fill={C_PENDING} name="Pending" />
                  <Line dataKey="score" stroke={C_SCORE} strokeWidth={2} dot={{ r: 3 }} name="Score %" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* plant table */}
        <div className="bg-[#0f1115] border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-black text-base">Plant breakdown</h2>
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Click a plant for its graphics</span>
            </div>
            {canManagePlants && selectedPlants.size > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                <span className="text-xs font-semibold text-amber-300">{selectedPlants.size} plant{selectedPlants.size === 1 ? "" : "s"} selected</span>
                <button
                  onClick={() => setSelectedPlants(new Set())}
                  disabled={plantBusy}
                  className="px-2 py-1 text-[11px] font-semibold text-zinc-300 hover:text-white disabled:opacity-40 rounded-lg"
                >
                  Clear
                </button>
                <button
                  onClick={openPlantMergePanel}
                  disabled={selectedPlants.size < 2 || plantBusy}
                  className="px-3 py-1 text-[11px] font-bold text-black bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg"
                  title={selectedPlants.size < 2 ? "Select at least 2 plants to merge" : "Merge the selected plants into one"}
                >
                  Merge Selected
                </button>
              </div>
            )}
          </div>

          {canManagePlants && plantMergePanelOpen && (
            <div className="m-4 p-4 bg-zinc-950 border border-amber-500/40 rounded-xl">
              <h3 className="text-sm font-bold text-white mb-1">Merge {selectedPlants.size} plants into one</h3>
              <p className="text-xs text-zinc-500 mb-3">
                Every graphic currently grouped under any of the plants below will show up under the name you pick,
                everywhere plants are grouped (Plant Performance, Plant Schedules, Fabric Dispatch). Row data
                (col11/col12) is left exactly as-is.
              </p>
              <div className="flex flex-col gap-1.5 mb-3">
                {Array.from(selectedPlants).sort().map((p) => (
                  <label key={p} className="flex items-center gap-2 px-3 py-2 bg-zinc-900/60 border border-zinc-800 rounded-lg cursor-pointer hover:border-zinc-700">
                    <input
                      type="radio"
                      name="plantMergeTarget"
                      checked={!plantMergeCustomName && plantMergeTarget === p}
                      onChange={() => { setPlantMergeTarget(p); setPlantMergeCustomName(""); }}
                    />
                    <span className="text-sm text-white font-semibold">{p}</span>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs text-zinc-500 shrink-0">Or a new name:</span>
                <input
                  type="text"
                  value={plantMergeCustomName}
                  onChange={(e) => setPlantMergeCustomName(e.target.value)}
                  placeholder="e.g. ANTLER"
                  className="flex-1 px-3 py-1.5 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setPlantMergePanelOpen(false)} disabled={plantBusy}
                  className="px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white disabled:opacity-40 rounded-lg">
                  Cancel
                </button>
                <button onClick={confirmPlantMerge} disabled={plantBusy}
                  className="px-4 py-1.5 text-xs font-bold text-black bg-amber-400 hover:bg-amber-300 disabled:opacity-40 rounded-lg">
                  {plantBusy ? "Merging…" : `Merge into "${plantMergeCustomName.trim() || plantMergeTarget}"`}
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800/60 bg-zinc-900/40">
                  {canManagePlants && <th className="w-8 px-3 py-3" />}
                  <th className="text-left px-5 py-3 font-black">Plant</th>
                  {groupByCategory && <th className="text-left px-3 py-3 font-black">Category</th>}
                  <th className="text-center px-3 py-3 font-black">Allocated</th>
                  <th className="text-center px-3 py-3 font-black">Dispatched</th>
                  <th className="text-center px-3 py-3 font-black text-emerald-500">On time</th>
                  <th className="text-center px-3 py-3 font-black text-amber-500">Late</th>
                  <th className="text-center px-3 py-3 font-black text-red-500">Rejected</th>
                  <th className="text-center px-3 py-3 font-black">Pending</th>
                  <th className="text-center px-3 py-3 font-black">No AOQ</th>
                  <th className="text-center px-3 py-3 font-black">Score %</th>
                  <th className="text-center px-3 py-3 font-black" title="on-time × 40 − (late + rejected) × 60">Net</th>
                  {canManagePlants && <th className="w-10 px-3 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {sortedAggs.length === 0 ? (
                  <tr><td colSpan={groupByCategory ? 11 : 10} className="px-5 py-10 text-center text-zinc-500">No graphics match this filter.</td></tr>
                ) : sortedAggs.map((a) => {
                  const isRealPlant = a.plant !== "(unassigned)";
                  return (
                  <tr key={a.key}
                    onClick={() => setSelectedPlant(selectedPlant === a.plant ? null : a.plant)}
                    className={`cursor-pointer transition-all hover:bg-zinc-800/40 ${selectedPlant === a.plant ? "bg-amber-950/30 border-l-2 border-l-amber-500" : ""}`}>
                    {canManagePlants && (
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        {isRealPlant && (
                          <input
                            type="checkbox"
                            checked={selectedPlants.has(a.plant)}
                            onChange={() => togglePlantSelected(a.plant)}
                            disabled={plantBusy}
                          />
                        )}
                      </td>
                    )}
                    <td className="px-5 py-3 font-bold text-zinc-100 text-xs">{a.plant}</td>
                    {groupByCategory && <td className="px-3 py-3 text-zinc-400 text-xs">{a.category}</td>}
                    <td className="px-3 py-3 text-center text-zinc-200 font-bold text-xs">{a.allocated}</td>
                    <td className="px-3 py-3 text-center text-cyan-300 text-xs">{a.dispatched}</td>
                    <td className="px-3 py-3 text-center text-emerald-400 font-bold text-xs">{a.onTime}</td>
                    <td className="px-3 py-3 text-center text-amber-400 text-xs">{a.late}</td>
                    <td className="px-3 py-3 text-center text-red-400 text-xs">{a.rejected}</td>
                    <td className="px-3 py-3 text-center text-zinc-400 text-xs">{a.pending}</td>
                    <td className="px-3 py-3 text-center text-zinc-500 text-xs">{a.unscored}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-center gap-1">
                        <span className={`text-sm font-black ${scoreColor(a.scorePct)}`}>{a.scorePct}%</span>
                        <div className="w-16 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${scoreBar(a.scorePct)}`} style={{ width: `${a.scorePct}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className={`px-3 py-3 text-center font-bold text-xs ${a.netScore >= 0 ? "text-emerald-400" : "text-red-400"}`}>{a.netScore}</td>
                    {canManagePlants && (
                      <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {isRealPlant && (
                          <button
                            onClick={() => handleDeletePlant(a.plant)}
                            disabled={plantBusy}
                            className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 disabled:opacity-40 rounded-md transition-colors"
                            title="Hide this plant (excludes it from every plant grouping; row data untouched)"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canManagePlants && Object.keys(plantAliasConfig.aliases).length > 0 && (
            <div className="px-5 py-3 border-t border-zinc-800 flex items-center flex-wrap gap-2">
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Merged plants:</span>
              {Object.entries(plantAliasConfig.aliases).map(([from, to]) => (
                <button
                  key={from}
                  disabled={plantBusy}
                  onClick={async () => {
                    setPlantBusy(true);
                    try {
                      const aliases = { ...plantAliasConfig.aliases };
                      delete aliases[from];
                      const next: PlantAliasConfig = { aliases, excluded: plantAliasConfig.excluded };
                      await savePlantAliasConfig(next);
                      applyPlantAliasConfig(next);
                      setPlantAliasConfig(next);
                      setAliasVersion((v) => v + 1);
                    } finally {
                      setPlantBusy(false);
                    }
                  }}
                  className="px-2 py-1 text-[11px] font-semibold text-zinc-400 bg-zinc-900 border border-zinc-700 rounded-lg hover:text-white hover:border-zinc-500 disabled:opacity-40"
                  title="Click to undo this merge"
                >
                  {from} → {to} ↺
                </button>
              ))}
            </div>
          )}

          {canManagePlants && plantAliasConfig.excluded.length > 0 && (
            <div className="px-5 py-3 border-t border-zinc-800 flex items-center flex-wrap gap-2">
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Hidden plants:</span>
              {plantAliasConfig.excluded.map((p) => (
                <button
                  key={p}
                  disabled={plantBusy}
                  onClick={async () => {
                    setPlantBusy(true);
                    try {
                      const next: PlantAliasConfig = {
                        aliases: plantAliasConfig.aliases,
                        excluded: plantAliasConfig.excluded.filter((x) => x !== p),
                      };
                      await savePlantAliasConfig(next);
                      applyPlantAliasConfig(next);
                      setPlantAliasConfig(next);
                      setAliasVersion((v) => v + 1);
                    } finally {
                      setPlantBusy(false);
                    }
                  }}
                  className="px-2 py-1 text-[11px] font-semibold text-zinc-400 bg-zinc-900 border border-zinc-700 rounded-lg hover:text-white hover:border-zinc-500 disabled:opacity-40"
                  title="Click to restore this plant"
                >
                  {p} ↺
                </button>
              ))}
            </div>
          )}
        </div>

        {/* trigger / AOQ table */}
        <div className="bg-[#0f1115] border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800">
            <h2 className="font-black text-base">Triggers &amp; AOQ dates</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5">The deadline each graphic is scored against (col20 date, else the trigger&apos;s own M.D code, else the Category+Season AOQ date set on Trigger Manager)</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800/60 bg-zinc-900/40">
                  <th className="text-left px-5 py-3 font-black">Trigger</th>
                  <th className="text-left px-3 py-3 font-black">AOQ date(s)</th>
                  <th className="text-center px-3 py-3 font-black">Graphics</th>
                  <th className="text-center px-3 py-3 font-black text-emerald-500">On time</th>
                  <th className="text-center px-3 py-3 font-black text-amber-500">Late</th>
                  <th className="text-center px-3 py-3 font-black text-red-500">Rejected</th>
                  <th className="text-center px-3 py-3 font-black">Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {analysis.triggerRows.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-zinc-500">No triggers in this season.</td></tr>
                ) : analysis.triggerRows.map((r) => (
                  <tr key={r.trigger}>
                    <td className="px-5 py-3 font-bold text-zinc-100 text-xs">{r.trigger}</td>
                    <td className={`px-3 py-3 text-xs ${r.aoqStr === "Not set" ? "text-zinc-600" : "text-emerald-300"}`}>{r.aoqStr}</td>
                    <td className="px-3 py-3 text-center text-zinc-200 text-xs">{r.graphics}</td>
                    <td className="px-3 py-3 text-center text-emerald-400 text-xs">{r.onTime}</td>
                    <td className="px-3 py-3 text-center text-amber-400 text-xs">{r.late}</td>
                    <td className="px-3 py-3 text-center text-red-400 text-xs">{r.rejected}</td>
                    <td className="px-3 py-3 text-center text-zinc-400 text-xs">{r.pending}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* drill-down */}
        {selectedPlant && (
          <div className="bg-[#0f1115] border border-amber-800/40 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="font-black text-base">{selectedPlant} — {selectedGraphics.length} graphic{selectedGraphics.length === 1 ? "" : "s"}</h2>
              <button onClick={() => setSelectedPlant(null)} className="text-zinc-500 hover:text-zinc-200">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800/60 bg-zinc-900/40">
                    <th className="text-left px-5 py-3 font-black">Graphic</th>
                    <th className="text-left px-3 py-3 font-black">Category</th>
                    <th className="text-left px-3 py-3 font-black">Trigger</th>
                    <th className="text-left px-3 py-3 font-black">AOQ</th>
                    <th className="text-center px-3 py-3 font-black">Disp.</th>
                    <th className="text-left px-3 py-3 font-black">NYC-A / R</th>
                    <th className="text-left px-3 py-3 font-black">Verdict</th>
                    <th className="text-center px-3 py-3 font-black">Days vs AOQ</th>
                    <th className="text-left px-3 py-3 font-black">Set (CK)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {selectedGraphics.map((g) => {
                    const dISO = verdictDate[g.graphic] ?? g.approvalIso ?? g.rejectedIso ?? g.aoqIso ?? new Date().toISOString().slice(0, 10);
                    return (
                    <tr key={g.graphic + g.category}>
                      <td className="px-5 py-2.5 font-mono text-xs text-blue-300">{g.graphic}</td>
                      <td className="px-3 py-2.5 text-xs text-zinc-400">{g.category}</td>
                      <td className="px-3 py-2.5 text-xs text-zinc-300">{g.trigger || "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-zinc-300">{g.aoqIso ? formatDateDDMMYYYY(g.aoqIso) : "—"}</td>
                      <td className="px-3 py-2.5 text-center text-xs">{g.dispatched ? <span className="text-cyan-300">✓</span> : <span className="text-zinc-600">—</span>}</td>
                      <td className="px-3 py-2.5 text-xs text-zinc-300">
                        {g.approvalIso ? formatDateDDMMYYYY(g.approvalIso)
                          : g.rejectedIso ? <span className="text-red-400">R {formatDateDDMMYYYY(g.rejectedIso)}</span>
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-bold" style={{
                        color: g.verdict === "onTime" ? C_ONTIME : g.verdict === "late" ? C_LATE
                          : g.verdict === "rejected" ? C_REJECT : "#a1a1aa",
                      }}>
                        {g.estimated && <span className="text-zinc-500 font-normal" title="Estimated — comment has an approval word but no dated line">≈ </span>}
                        {VERDICT_LABEL[g.verdict]}
                      </td>
                      <td className={`px-3 py-2.5 text-center text-xs font-bold ${
                        g.daysVsAoq === null ? "text-zinc-600" : g.daysVsAoq >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}>{g.daysVsAoq === null ? "—" : g.daysVsAoq >= 0 ? `+${g.daysVsAoq}` : g.daysVsAoq}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <input type="date" value={dISO}
                            onChange={(e) => setVerdictDate((p) => ({ ...p, [g.graphic]: e.target.value }))}
                            className="bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-200" />
                          <button disabled={!!busy} onClick={() => setGraphicVerdict(g, "A", dISO)}
                            title="Mark NY approved on this date" className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[11px] font-bold disabled:opacity-40">✓</button>
                          <button disabled={!!busy} onClick={() => setGraphicVerdict(g, "R", dISO)}
                            title="Mark NY rejected on this date" className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 text-[11px] font-bold disabled:opacity-40">✗</button>
                          <button disabled={!!busy} onClick={() => setGraphicVerdict(g, null, dISO)}
                            title="Clear manual verdict" className="px-1.5 py-0.5 rounded bg-zinc-700/40 text-zinc-400 text-[11px] disabled:opacity-40">×</button>
                        </div>
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
