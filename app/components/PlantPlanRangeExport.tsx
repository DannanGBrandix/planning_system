"use client";
import React, { useState } from "react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { EmbellishmentRow, getRowStatus } from "../lib/db";
import { parseEventValue } from "../lib/eventCodes";
import { getPlantAliasRuntimeConfig, resolvePlantDateTargets } from "../lib/plantUtils";
import { buildDays, localIso, type ExportDay } from "./DailyEventsExport";

interface PlantPlanRangeExportProps {
  rows: EmbellishmentRow[];
}

// Identifying columns kept on every plant sheet (same keys/labels as the other plan exports),
// followed by one column per day of the range showing that plant's own events for the graphic.
const ID_COLUMNS = [
  { key: "col1", label: "STATUS" },
  { key: "col2", label: "TRIGGER" },
  { key: "col3", label: "CATEGORY" },
  { key: "col4", label: "SEASON" },
  { key: "col5", label: "STYLE" },
  { key: "col6", label: "GRAPHI-COMBO#" },
  { key: "col7", label: "GRAPHIC" },
  { key: "col8", label: "GROUND" },
  { key: "col9", label: "TECHNIQUE" },
  { key: "col11", label: "PLANT" },
  { key: "col12", label: "PLANT FLOW" },
  { key: "col20", label: "AOQ" },
];

// Excel's built-in "Good/Bad" cell colors — same as every other plan export.
const EVENT_STATUS_STYLE = {
  pass: { fill: "FFC6EFCE", font: "FF006100" },
  fail: { fill: "FFFFC7CE", font: "FF9C0006" },
} as const;

// "newFr" = only graphics newly planned in the range, i.e. that have an FR (fabric/panel received
// at the plant) event on one of the days — every other event of theirs in the range is then listed
// alongside it (FS, PPS, NY ...). "all" = every planned event; "pps" = PPS events only.
type EventScope = "newFr" | "all" | "pps";
const SCOPE_LABEL: Record<EventScope, string> = {
  newFr: "newly planned graphics (FR in range)",
  all: "all planned events",
  pps: "PPS only",
};

function sanitizeSheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[:\\/?*[\]]/g, "").trim() || "Plant").slice(0, 31);
  let unique = base;
  let i = 2;
  while (used.has(unique.toUpperCase())) {
    const suffix = `_${i}`;
    unique = base.slice(0, 31 - suffix.length) + suffix;
    i++;
  }
  used.add(unique.toUpperCase());
  return unique;
}

const seasonBase = (v: unknown) =>
  String(v ?? "").replace(/["'\r\n]+/g, " ").trim().toUpperCase().split(/\s+/)[0];

interface PlantRowEntry {
  row: EmbellishmentRow;
  cells: Map<string, { text: string; status: "planned" | "pass" | "fail" }[]>; // iso -> events
}

interface PlantAgg {
  rows: Map<string, PlantRowEntry>; // row id -> entry
  graphics: Set<string>;
  events: number;
  pps: Map<string, { pass: boolean; fail: boolean }>; // graphic key -> PPS verdicts
}

export default function PlantPlanRangeExport({ rows }: PlantPlanRangeExportProps) {
  const todayIso = localIso(new Date());
  const weekEndIso = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 6);
    return localIso(d);
  })();
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [endDate, setEndDate] = useState<string>(weekEndIso);
  const [scope, setScope] = useState<EventScope>("newFr");
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    const days: ExportDay[] = buildDays(startDate, endDate);
    if (days.length === 0) {
      window.alert("Pick a valid date range (start on or before end, at most 45 days).");
      return;
    }

    setBusy(true);
    try {
      const excluded = new Set(getPlantAliasRuntimeConfig().excluded.map((p) => p.toUpperCase()));
      const plants = new Map<string, PlantAgg>();

      rows.forEach((row) => {
        const st = getRowStatus(row);
        if (st === "dropped" || st === "hold") return;
        const rec = row as unknown as Record<string, unknown>;
        const graphic = String(row.col7 || row.col6 || row.col5 || "").trim();
        const gKey = `${seasonBase(row.col4)}|${graphic}`;

        // Every plant-scoped event of this row inside the range (verdicts included).
        const targets = days.flatMap((d) =>
          resolvePlantDateTargets(rec, d.iso, { includeVerdicts: true }).map((t) => ({ d, t })),
        );

        // New-plan mode: a row/leg counts only when it has an FR in the range. Legs are matched by
        // label so a diverged cross-dev leg qualifies on its own FR; a "" label (single plant or a
        // "+" combo) covers every plant of the row, so the second plant of "Antler + Leema" — whose
        // only in-range event may be PPS — still lists a graphic that was planned via the first plant's FR.
        const frLegs = new Set(targets.filter(({ t }) => t.code === "FR").map(({ t }) => t.legLabel));
        const qualifies = (leg: string) => scope !== "newFr" || frLegs.has("") || frLegs.has(leg);

        targets.forEach(({ d, t }) => {
          if (scope === "pps" && t.code !== "PPS") return;
          if (!qualifies(t.legLabel)) return;
          const parsed = parseEventValue(t.rawValue);
          if (!parsed) return;
          const plant = t.plant.toUpperCase();
          if (excluded.has(plant)) return;

          const agg = plants.get(plant) ?? { rows: new Map(), graphics: new Set(), events: 0, pps: new Map() };
          plants.set(plant, agg);
          const entry = agg.rows.get(row.id) ?? { row, cells: new Map() };
          agg.rows.set(row.id, entry);

          const text = parsed.code + (parsed.status === "fail" && parsed.reasonCode ? ` (${parsed.reasonCode})` : "");
          const list: { text: string; status: "planned" | "pass" | "fail" }[] = entry.cells.get(d.iso) ?? [];
          if (!list.some((e) => e.text === text)) list.push({ text, status: parsed.status });
          entry.cells.set(d.iso, list);

          agg.events++;
          if (graphic) {
            agg.graphics.add(gKey);
            if (t.code === "PPS") {
              const p = agg.pps.get(gKey) ?? { pass: false, fail: false };
              if (parsed.status === "pass") p.pass = true;
              if (parsed.status === "fail") p.fail = true;
              agg.pps.set(gKey, p);
            }
          }
        });
      });

      if (plants.size === 0) {
        window.alert(scope === "newFr" ? "No graphic has an FR event in that date range." : "No plant has a planned event in that date range.");
        return;
      }

      const workbook = new ExcelJS.Workbook();
      const plantNames = [...plants.keys()].sort((a, b) => a.localeCompare(b));

      // ── Summary sheet ────────────────────────────────────────────────────
      const summary = workbook.addWorksheet("Summary");
      summary.columns = [
        { header: "PLANT", key: "plant", width: 24 },
        { header: "ROWS PLANNED", key: "rows", width: 15 },
        { header: "GRAPHICS", key: "graphics", width: 12 },
        { header: "EVENTS", key: "events", width: 10 },
        { header: "PPS GRAPHICS", key: "pps", width: 14 },
        { header: "PPS ON TIME (GREEN)", key: "pass", width: 20 },
        { header: "PPS FAILED (RED)", key: "fail", width: 18 },
        { header: "PPS PENDING", key: "pending", width: 14 },
      ];
      summary.getRow(1).eachCell((c) => {
        c.font = { bold: true };
        c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
      plantNames.forEach((plant) => {
        const a = plants.get(plant)!;
        let pass = 0;
        let fail = 0;
        a.pps.forEach((v) => {
          if (v.fail) fail++;
          else if (v.pass) pass++;
        });
        summary.addRow({
          plant, rows: a.rows.size, graphics: a.graphics.size, events: a.events,
          pps: a.pps.size, pass, fail, pending: a.pps.size - pass - fail,
        });
      });
      summary.addRow([]);
      summary.addRow([`Date range: ${startDate} to ${endDate}`, "", "", "", `Events: ${SCOPE_LABEL[scope]}`]);
      summary.views = [{ state: "frozen", ySplit: 1 }];

      // ── one sheet per plant ─────────────────────────────────────────────
      const columns = [
        ...ID_COLUMNS.map((c) => ({ header: c.label, key: c.key, width: 16 })),
        ...days.map((d) => ({ header: d.iso, key: `d_${d.iso}`, width: 14 })),
      ];
      const usedNames = new Set<string>(["SUMMARY"]);

      plantNames.forEach((plant) => {
        const sheet = workbook.addWorksheet(sanitizeSheetName(plant, usedNames));
        sheet.columns = columns;
        sheet.getRow(1).eachCell((cell, colNumber) => {
          cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
          cell.font = colNumber > ID_COLUMNS.length
            ? { bold: true, color: { argb: "FF9C0006" } }
            : { bold: true, color: { argb: "FF000000" } };
        });
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
        sheet.views = [{ state: "frozen", xSplit: 7, ySplit: 1 }];

        [...plants.get(plant)!.rows.values()]
          .sort((a, b) =>
            String(a.row.col3 || "").localeCompare(String(b.row.col3 || "")) ||
            String(a.row.col5 || "").localeCompare(String(b.row.col5 || "")) ||
            String(a.row.col7 || "").localeCompare(String(b.row.col7 || "")))
          .forEach(({ row, cells }) => {
            const data: Record<string, string> = {};
            ID_COLUMNS.forEach((c) => { data[c.key] = String((row as unknown as Record<string, unknown>)[c.key] || ""); });
            days.forEach((d) => { data[`d_${d.iso}`] = (cells.get(d.iso) ?? []).map((e) => e.text).join(" / "); });
            const added = sheet.addRow(data);
            days.forEach((d) => {
              const evs = cells.get(d.iso) ?? [];
              const cell = added.getCell(`d_${d.iso}`);
              cell.alignment = { vertical: "middle", horizontal: "center" };
              const only = evs.length === 1 ? evs[0] : null; // a mixed cell would make colouring misleading
              const style = only && (only.status === "pass" || only.status === "fail") ? EVENT_STATUS_STYLE[only.status] : null;
              if (style) {
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: style.fill } };
                cell.font = { bold: true, color: { argb: style.font } };
              } else {
                cell.font = { bold: true };
              }
            });
          });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `Plant_Plan_${startDate}_to_${endDate}.xlsx`,
      );
    } finally {
      setBusy(false);
    }
  };

  const inputCls = "bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs font-semibold text-zinc-100 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/50";
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="uppercase tracking-wide text-[10px] text-zinc-400 font-bold">From</span>
      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} title="First planned day to include" />
      <span className="uppercase tracking-wide text-[10px] text-zinc-400 font-bold">To</span>
      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} title="Last planned day to include (inclusive)" />
      <select value={scope} onChange={(e) => setScope(e.target.value as EventScope)} className={inputCls} title="New plans = only graphics that have an FR event in the range (newly planned), with all their events in the range. All planned events = everything planned in the range. PPS only = PPS events.">
        <option value="newFr">New plans (FR in range)</option>
        <option value="all">All planned events</option>
        <option value="pps">PPS only</option>
      </select>
      <button
        onClick={handleExport}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 rounded-xl transition-all shadow-md active:scale-[0.98]"
        title="One worksheet per plant listing the graphics planned in this date range (by default only newly planned ones, i.e. with an FR event in the range; all categories and seasons — the page filters don't apply), plus a Summary sheet. Green/red cells = PPS/event passed/failed."
      >
        {busy ? "Exporting…" : "Export planned graphics by plant"}
      </button>
    </div>
  );
}
