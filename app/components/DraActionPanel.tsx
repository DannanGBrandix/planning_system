"use client";
// DRA action list (Advanced Analytics, under "Techniques In Season"). One line per DRA action —
// the rows a DRA line landed on (a CK graphic's ground rows, a combo's styles) collapse into one —
// with What / Who / When and where it stands (Overdue / Due in 7 days / Open / Done).
// Data comes from the "Import DRA" sidebar button (lib/draImport.ts, col80-col87 + col17).
import React, { useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { EmbellishmentRow, getRowStatus } from "../lib/db";
import { techniqueGroupOf } from "../lib/techniqueGroups";
import { DRA_COLUMNS, DRA_ACTION_LABELS, DraActionStatus, draActionStatus, draWhenIso, riskBucket } from "../lib/draImport";

interface DraActionPanelProps {
  rows: EmbellishmentRow[];
  // The chart's ALL / HIGH RISK / LOW RISK buttons drive this list too — one risk switch.
  risk: "all" | "high" | "low";
  // Technique group picked by clicking a bar in the chart above ("1. PRINT"); null = all.
  technique: string | null;
  onTechniqueChange: (technique: string | null) => void;
}

// Same label the chart above uses for a row's technique group ("1. PRINT").
function techniqueLabelOf(r: EmbellishmentRow): string {
  const raw = String(r.col18 || "").replace(/\s+/g, " ").trim();
  const detail = raw.replace(/^\d+\s*[.)\-:]?\s*/, "").trim() || raw;
  if (!detail) return "Unassigned";
  const g = techniqueGroupOf(detail.toUpperCase());
  return g.order < 99 ? `${g.order}. ${g.label}` : g.label;
}

interface ActionLine {
  key: string;
  graphic: string;
  combos: string[];
  styles: string[];
  category: string;
  season: string;
  technique: string;
  plants: string[];
  risk: "High" | "Low" | "Unrated";
  riskCategory: string;
  what: string;
  who: string;
  when: string;
  due: string | null;
  status: DraActionStatus;
  comment: string;
  rowCount: number;
}

const STATUS_ORDER: DraActionStatus[] = ["overdue", "dueSoon", "open", "done", "none"];
const STATUS_CLS: Record<DraActionStatus, string> = {
  overdue: "bg-red-500/15 text-red-300 border-red-500/40",
  dueSoon: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  open: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  done: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  none: "bg-zinc-700/30 text-zinc-400 border-zinc-600",
};
const fmtDay = (iso: string | null) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

export default function DraActionPanel({ rows, risk, technique, onTechniqueChange }: DraActionPanelProps) {
  const riskView = risk === "high" ? "High" : risk === "low" ? "Low" : "all";
  const [statusView, setStatusView] = useState<DraActionStatus | "all">("all");
  const [who, setWho] = useState<string>("");
  const [plant, setPlant] = useState<string>("");
  const [query, setQuery] = useState<string>("");

  // Every live row, grouped into one line per DRA action. Rows with no DRA action still show (as
  // "No action") so the list always matches the chart above — e.g. a row High in Risk Factor that
  // the DRA file didn't cover.
  const allLines = useMemo(() => {
    const map = new Map<string, ActionLine>();
    rows.forEach((r) => {
      if (getRowStatus(r) === "dropped") return;
      if (!String(r.col18 || "").trim()) return; // the chart above only counts rows with a Technique Category
      const what = String(r[DRA_COLUMNS.what] ?? "").trim();
      const whoV = String(r[DRA_COLUMNS.who] ?? "").trim();
      const when = String(r[DRA_COLUMNS.when] ?? "").trim();
      const graphic = String(r.col7 || "").trim();
      const key = [graphic, what, whoV, when, riskBucket(r)].join("|");
      const line = map.get(key) ?? {
        key, graphic, combos: [], styles: [], category: String(r.col3 || "").trim(),
        season: String(r.col4 || "").trim(), technique: techniqueLabelOf(r), plants: [],
        risk: riskBucket(r), riskCategory: String(r[DRA_COLUMNS.riskCategory] ?? "").trim(),
        what, who: whoV, when, due: draWhenIso(r), status: draActionStatus(r),
        comment: String(r[DRA_COLUMNS.comment] ?? "").trim(), rowCount: 0,
      };
      line.rowCount++;
      line.combos.push(String(r.col6 || "").trim());
      line.styles.push(String(r.col5 || "").trim());
      line.plants.push(String(r.col11 || "").trim());
      map.set(key, line);
    });
    return [...map.values()].map((l) => ({ ...l, combos: uniq(l.combos), styles: uniq(l.styles), plants: uniq(l.plants) }));
  }, [rows]);

  // Options + counts follow every OTHER filter in this panel.
  const base = useMemo(() => allLines.filter((l) =>
    (riskView === "all" || l.risk === riskView) &&
    (!technique || l.technique === technique),
  ), [allLines, riskView, technique]);

  const whoOptions = useMemo(() => uniq(base.flatMap((l) => l.who.split(/[/,&]+/).map((w) => w.trim()))).sort(), [base]);
  const plantOptions = useMemo(() => uniq(base.flatMap((l) => l.plants)).sort(), [base]);

  const lines = useMemo(() => {
    const q = query.trim().toUpperCase();
    return base
      .filter((l) => statusView === "all" || l.status === statusView)
      .filter((l) => !who || l.who.split(/[/,&]+/).map((w) => w.trim()).includes(who))
      .filter((l) => !plant || l.plants.includes(plant))
      .filter((l) => !q || [l.graphic, l.what, l.comment, ...l.combos, ...l.styles].some((v) => v.toUpperCase().includes(q)))
      .sort((a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
        || (a.due || "9999").localeCompare(b.due || "9999")
        || a.graphic.localeCompare(b.graphic));
  }, [base, statusView, who, plant, query]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: base.length };
    base.forEach((l) => { c[l.status] = (c[l.status] || 0) + 1; });
    return c;
  }, [base]);

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("DRA Actions");
    ws.columns = [
      { header: "STATUS", key: "status", width: 14 },
      { header: "GRAPHIC", key: "graphic", width: 16 },
      { header: "COMBO", key: "combo", width: 16 },
      { header: "STYLE", key: "style", width: 18 },
      { header: "CATEGORY", key: "category", width: 18 },
      { header: "SEASON", key: "season", width: 10 },
      { header: "TECHNIQUE", key: "technique", width: 22 },
      { header: "PLANT", key: "plant", width: 18 },
      { header: "RISK", key: "risk", width: 9 },
      { header: "RISK CATEGORY", key: "riskCategory", width: 14 },
      { header: "WHAT", key: "what", width: 60 },
      { header: "WHO", key: "who", width: 20 },
      { header: "WHEN", key: "when", width: 18 },
      { header: "DUE", key: "due", width: 12 },
      { header: "DRA COMMENT", key: "comment", width: 30 },
      { header: "PLAN ROWS", key: "rows", width: 10 },
    ];
    lines.forEach((l) => ws.addRow({
      status: DRA_ACTION_LABELS[l.status], graphic: l.graphic, combo: l.combos.join(", "), style: l.styles.join(", "),
      category: l.category, season: l.season, technique: l.technique, plant: l.plants.join(", "), risk: l.risk,
      riskCategory: l.riskCategory, what: l.what, who: l.who, when: l.when, due: fmtDay(l.due), comment: l.comment, rows: l.rowCount,
    }));
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    ws.eachRow((row, i) => { if (i > 1) row.alignment = { vertical: "top", wrapText: true }; });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: "A1", to: "P1" };
    const buf = await wb.xlsx.writeBuffer();
    const tag = riskView === "all" ? "All" : `${riskView}Risk`;
    saveAs(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `DRA_Actions_${tag}.xlsx`);
  };

  const pill = (active: boolean, cls: string) =>
    `px-2.5 py-1 rounded border text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
      active ? cls : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500"
    }`;
  const selectCls = "bg-zinc-900 border border-zinc-700 text-zinc-200 text-[11px] rounded px-2 py-1";

  return (
    <div className="bg-[#101b27] border border-zinc-800 p-4 rounded mb-12">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 mb-1">
        <h3 className="text-white font-bold text-sm tracking-widest uppercase">
          DRA Actions — What / Who / When
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2.5 py-1 rounded border text-[10px] font-bold uppercase tracking-wider ${
            riskView === "High" ? "border-red-500 text-red-300 bg-red-500/15"
              : riskView === "Low" ? "border-emerald-500 text-emerald-300 bg-emerald-500/15"
                : "border-zinc-500 text-white bg-zinc-700/40"
          }`}>
            {riskView === "all" ? "All risk" : `${riskView} Risk`}
          </span>
          <button
            type="button"
            onClick={exportExcel}
            disabled={lines.length === 0}
            className="ml-2 px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white"
          >
            Export Excel ({lines.length})
          </button>
        </div>
      </div>
      <p className="text-[10px] text-zinc-500 mb-3">
        From the last DRA import. Follows the sidebar filters and the chart&apos;s All / High Risk / Low Risk buttons; click a
        bar in the chart to narrow to one technique. Overdue = the latest date in &quot;When&quot; has passed and the action isn&apos;t marked Done.
      </p>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {(["all", ...STATUS_ORDER] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusView(s)}
            className={pill(statusView === s, s === "all" ? "border-zinc-500 text-white bg-zinc-700/40" : STATUS_CLS[s])}
          >
            {s === "all" ? "All" : DRA_ACTION_LABELS[s]} ({statusCounts[s] || 0})
          </button>
        ))}
        {technique && (
          <button
            type="button"
            onClick={() => onTechniqueChange(null)}
            className="px-2.5 py-1 rounded border border-sky-500/50 bg-sky-500/10 text-sky-300 text-[10px] font-bold"
            title="Clear the technique picked from the chart"
          >
            {technique} ✕
          </button>
        )}
        <select value={plant} onChange={(e) => setPlant(e.target.value)} className={selectCls}>
          <option value="">All plants</option>
          {plantOptions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={who} onChange={(e) => setWho(e.target.value)} className={selectCls}>
          <option value="">Everyone</option>
          {whoOptions.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search graphic / action…"
          className={`${selectCls} w-48`}
        />
      </div>

      {allLines.length === 0 ? (
        <div className="text-zinc-600 text-xs italic py-8 text-center">
          No graphics for this filter.
        </div>
      ) : lines.length === 0 ? (
        <div className="text-zinc-600 text-xs italic py-8 text-center">No DRA actions match these filters.</div>
      ) : (
        <div className="max-h-[560px] overflow-auto border border-zinc-800 rounded">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[#0c1520] text-zinc-400 text-left uppercase tracking-wider text-[9px]">
              <tr>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Graphic</th>
                <th className="px-2 py-2">Technique / Plant</th>
                <th className="px-2 py-2">Risk</th>
                <th className="px-2 py-2 w-[38%]">What</th>
                <th className="px-2 py-2">Who</th>
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">DRA Comment</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className="border-t border-zinc-800 align-top hover:bg-white/[0.02]">
                  <td className="px-2 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded border text-[9px] font-bold whitespace-nowrap ${STATUS_CLS[l.status]}`}>
                      {DRA_ACTION_LABELS[l.status]}
                    </span>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className="font-bold text-amber-300">{l.graphic}</span>
                    <span className="block text-[10px] text-zinc-500 max-w-[180px] truncate" title={l.combos.join(", ")}>{l.combos.join(", ")}</span>
                    <span className="block text-[10px] text-zinc-600 max-w-[180px] truncate" title={l.styles.join(", ")}>
                      {l.styles.join(", ")}{l.rowCount > 1 ? ` · ${l.rowCount} rows` : ""}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <span className="text-zinc-200">{l.technique}</span>
                    <span className="block text-[10px] text-zinc-500">{l.plants.join(", ") || "-"}</span>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className={l.risk === "High" ? "text-red-400 font-bold" : l.risk === "Low" ? "text-emerald-400 font-bold" : "text-zinc-500"}>{l.risk}</span>
                    {l.riskCategory && <span className="block text-[10px] text-zinc-500">{l.riskCategory}</span>}
                  </td>
                  <td className="px-2 py-2 text-zinc-300 whitespace-pre-line">{l.what || <span className="text-zinc-600">-</span>}</td>
                  <td className="px-2 py-2 text-zinc-300">{l.who || <span className="text-zinc-600">-</span>}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className={l.status === "overdue" ? "text-red-300 font-bold" : "text-zinc-200"}>{fmtDay(l.due) || "-"}</span>
                    {l.when && l.when !== l.due && (
                      <span className="block text-[10px] text-zinc-600 whitespace-pre-line">{l.when}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-zinc-400 whitespace-pre-line">{l.comment || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
