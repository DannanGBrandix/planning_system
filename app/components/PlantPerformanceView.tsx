"use client";
import React, { useEffect, useMemo, useState } from "react";
import { EmbellishmentRow, getRowStatus, getPlantAliasConfig } from "../lib/db";
import { parseEventValue, getReasonByCode } from "../lib/eventCodes";
import { applyPlantAliasConfig, getPlantAliasRuntimeConfig, resolvePlantDateTargets } from "../lib/plantUtils";
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
}

interface Bucket {
  onTime: number;
  failed: number;
  overdue: number;
  upcoming: number;
  graphics: GraphicResult[];
}

const emptyBucket = (): Bucket => ({ onTime: 0, failed: 0, overdue: 0, upcoming: 0, graphics: [] });

function seasonBase(v: unknown): string {
  return String(v ?? "").replace(/["'\r\n]+/g, " ").trim().toUpperCase().split(/\s+/)[0];
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d} ${MONTHS[Number(m) - 1]}`;
}

export default function PlantPerformanceView({ rows }: PlantPerformanceViewProps) {
  const [yearPick, setYearPick] = useState<string>(""); // "" = newest year with PPS data
  const [month, setMonth] = useState<string>("all"); // "all" | "01".."12"
  const [season, setSeason] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [passPts, setPassPts] = useState(1);
  const [failPts, setFailPts] = useState(1);
  const [overdueAsFailed, setOverdueAsFailed] = useState(false);
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null);

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

  // ── core: per plant × month × graphic ─────────────────────────────────────
  const data = useMemo(() => {
    void aliasVersion; // recompute after the alias config lands (module-level state, invisible to useMemo)
    const excluded = new Set(getPlantAliasRuntimeConfig().excluded.map((p) => p.toUpperCase()));
    const today = todayIso();

    // plant -> month("YYYY-MM") -> graphicKey -> accumulating state
    type Acc = { graphic: string; season: string; category: string; pass: boolean; fail: boolean; overdue: boolean; dates: Set<string>; reason: string };
    const acc = new Map<string, Map<string, Map<string, Acc>>>();

    rows.forEach((r) => {
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
          b.graphics.push({
            key, graphic: a.graphic, season: a.season, category: a.category, outcome,
            dates: Array.from(a.dates).sort(), reason: a.reason,
          });
        });
        monthBuckets.set(monthKey, b);
      });
      plants.set(plant, monthBuckets);
    });
    return { plants, years: Array.from(years).sort() };
  }, [rows, season, category, overdueAsFailed, aliasVersion]);

  const year = data.years.includes(yearPick) ? yearPick : data.years[data.years.length - 1] ?? "";

  const points = (b: { onTime: number; failed: number }) => b.onTime * passPts - b.failed * failPts;

  // sum a plant's buckets across the selected year (+ month filter)
  const plantRows = useMemo(() => {
    const out: {
      plant: string; total: Bucket; perMonth: (Bucket | null)[];
    }[] = [];
    data.plants.forEach((monthBuckets, plant) => {
      const perMonth: (Bucket | null)[] = MONTHS.map((_, i) => monthBuckets.get(`${year}-${String(i + 1).padStart(2, "0")}`) ?? null);
      const total = emptyBucket();
      perMonth.forEach((b, i) => {
        if (!b) return;
        if (month !== "all" && month !== String(i + 1).padStart(2, "0")) return;
        total.onTime += b.onTime; total.failed += b.failed; total.overdue += b.overdue; total.upcoming += b.upcoming;
        total.graphics.push(...b.graphics.map((g) => ({ ...g })));
      });
      if (perMonth.every((b) => !b)) return;
      out.push({ plant, total, perMonth });
    });
    return out
      .filter((p) => p.total.graphics.length > 0 || month === "all")
      .sort((a, b) => points(b.total) - points(a.total) || b.total.graphics.length - a.total.graphics.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, year, month, passPts, failPts]);

  const grand = useMemo(() => {
    const g = emptyBucket();
    plantRows.forEach((p) => {
      g.onTime += p.total.onTime; g.failed += p.total.failed;
      g.overdue += p.total.overdue; g.upcoming += p.total.upcoming;
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
  const allocated = (b: Bucket) => b.onTime + b.failed + b.overdue + b.upcoming;
  const rate = (b: Bucket) => (b.onTime + b.failed > 0 ? Math.round((b.onTime / (b.onTime + b.failed)) * 100) : null);
  const ptsColor = (n: number) => (n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-zinc-400");
  const fmtPts = (n: number) => (n > 0 ? `+${n}` : String(n));
  const scopeLabel = `${year || "—"}${month !== "all" ? ` · ${MONTHS[Number(month) - 1]}` : ""}`;

  const selectCls = "bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/40";

  return (
    <div className="min-h-screen bg-[#0a0d14] text-white">
      {/* header */}
      <div className="px-6 pt-8 pb-4 border-b border-zinc-800/60">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-black tracking-tight">🏭 Plant Performance — PPS by Month</h1>
            <p className="text-zinc-400 text-sm mt-1 font-medium max-w-3xl">
              Each plant is scored on its PPS day: green (PPS pass) earns points, red (PPS fail) loses points.
              Graphics are counted once per plant per month. · {scopeLabel} · {plantRows.length} plants
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={year} onChange={(e) => setYearPick(e.target.value)} className={selectCls}>
              {data.years.length === 0 && <option value="">No PPS data</option>}
              {data.years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectCls}>
              <option value="all">All months</option>
              {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>)}
            </select>
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
            <label className="flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2"
              title="A PPS whose day has passed but that the plant never marked green or red. Off = shown as Pending, no points. On = counted as a failure.">
              <input type="checkbox" checked={overdueAsFailed} onChange={(e) => setOverdueAsFailed(e.target.checked)} />
              Count un-updated overdue PPS as failed
            </label>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: "Graphics allocated", value: allocated(grand), sub: "with a PPS this period", color: "text-blue-300" },
            { label: "On time (PPS green)", value: grand.onTime, sub: rate(grand) === null ? "no verdicts yet" : `${rate(grand)}% of resolved`, color: "text-emerald-400" },
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
              Totals follow the month filter · month cells show net points (on time / failed) · click a plant for its graphics
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
                  <th className="text-center px-3 py-3 font-black">On-time %</th>
                  <th className="text-center px-3 py-3 font-black text-sky-400">Points</th>
                  {MONTHS.map((m, i) => (
                    <th key={m}
                      className={`text-center px-2 py-3 font-black cursor-pointer hover:text-white ${month === String(i + 1).padStart(2, "0") ? "text-amber-400" : ""}`}
                      onClick={() => setMonth(month === String(i + 1).padStart(2, "0") ? "all" : String(i + 1).padStart(2, "0"))}
                      title="Click to filter the totals to this month">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plantRows.length === 0 && (
                  <tr><td colSpan={7 + MONTHS.length} className="px-5 py-10 text-center text-zinc-600">No PPS events for this filter</td></tr>
                )}
                {plantRows.map((p) => {
                  const pts = points(p.total);
                  const pct = rate(p.total);
                  return (
                    <tr key={p.plant}
                      onClick={() => setSelectedPlant(selectedPlant === p.plant ? null : p.plant)}
                      className={`border-b border-zinc-800/40 cursor-pointer hover:bg-zinc-900/60 ${selectedPlant === p.plant ? "bg-zinc-900/80" : ""}`}>
                      <td className="px-5 py-3 font-bold text-zinc-100">{p.plant}</td>
                      <td className="text-center px-3 py-3 tabular-nums">{allocated(p.total)}</td>
                      <td className="text-center px-3 py-3 tabular-nums text-emerald-400 font-semibold">{p.total.onTime}</td>
                      <td className="text-center px-3 py-3 tabular-nums text-red-400 font-semibold">{p.total.failed}</td>
                      <td className="text-center px-3 py-3 tabular-nums text-zinc-400" title={`${p.total.overdue} overdue · ${p.total.upcoming} upcoming`}>{pending(p.total)}</td>
                      <td className="text-center px-3 py-3 tabular-nums">{pct === null ? "—" : `${pct}%`}</td>
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
                  {detail.total.graphics.length} graphics · {detail.total.onTime} on time · {detail.total.failed} failed · {pending(detail.total)} pending
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
