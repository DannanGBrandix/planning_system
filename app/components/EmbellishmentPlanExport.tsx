"use client";
import React, { useState } from "react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { EmbellishmentRow, getRowStatus } from "../lib/db";
import { categorySheetName } from "../lib/reportCategories";
import { parseEventValue } from "../lib/eventCodes";
import { buildDays, localIso, type ExportDay } from "./DailyEventsExport";

interface EmbellishmentPlanExportProps {
  rows: EmbellishmentRow[];
}

// Cap so a fat-fingered date range can't build a huge workbook — same limit as Daily Events Export.
const MAX_DAYS = 45;

// Same 22 columns/order as the Fabric Dispatch export and Daily Events Export, so every sheet a
// planner sends out reads the same way. Unlike Fabric Dispatch, none of these are hidden here —
// the reference "Today Plan All Categories" workbook this button reproduces keeps Risk Factor /
// Technique Category / Graphic Type / AOQ / Technique Type fully visible on every sheet.
const EXPORT_COLUMNS = [
  { key: "col1", label: "STATUS" },
  { key: "col2", label: "TRIGGER" },
  { key: "col3", label: "CATEGORY" },
  { key: "col4", label: "SEASON" },
  { key: "col5", label: "STYLE" },
  { key: "col6", label: "GRAPHI-COMBO#" },
  { key: "col7", label: "GRAPHIC" },
  { key: "col8", label: "GROUND" },
  { key: "col9", label: "TECHNIQUE" },
  { key: "col10", label: "PROCESS" },
  { key: "col11", label: "PLANT" },
  { key: "col12", label: "PLANT FLOW" },
  { key: "col13", label: "FABRIC REFERENCE" },
  { key: "col14", label: "FABRIC IH DATE" },
  { key: "col15", label: "APPLICATION FORM" },
  { key: "col16", label: "ALTERNATIVE FABRIC" },
  { key: "col17", label: "RISK FACTOR" },
  { key: "col18", label: "TECHNIQUE CATEGORY" },
  { key: "col19", label: "GRAPHIC TYPE" },
  { key: "col20", label: "AOQ" },
  { key: "col21", label: "TECHNIQUE TYPE" },
  { key: "col22", label: "COMMENT" },
];

// Excel's built-in "Good/Bad" cell-style colors — same as Fabric Dispatch / Daily Events Export —
// used to color a day cell only when the event has actually passed or failed.
const EVENT_STATUS_STYLE = {
  pass: { fill: "FFC6EFCE", font: "FF006100" },
  fail: { fill: "FFFFC7CE", font: "FF9C0006" },
} as const;

// Any row that isn't Dropped or on Hold is fair game — matches the rule every other export in
// this app uses. The old `col1 === "active"` check silently dropped every CK Tracking Chart row,
// since CK imports stamp col1 as "Approved"/"Pending"/"C+P"/"Hold" (see getCkRowStatus in
// lib/db.ts), never the literal "Active". A held (CK "H" — CROSS DEVELOPMENT) row is paused, so
// it's excluded like a dropped one.
function isExportableRow(row: EmbellishmentRow): boolean {
  const s = getRowStatus(row);
  return s !== "dropped" && s !== "hold";
}

// Excel sheet names must be <=31 chars, unique, and free of : \ / ? * [ ] — same rule as every
// other per-tab export in this app.
function sanitizeSheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[:\\/?*[\]]/g, "").trim() || "Category").slice(0, 31);
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

// Every value scheduled for this row on this date, across the bare key AND any cross-dev
// "<date>_<leg>" keys — since this export keeps ONE row per planning entry (no per-leg fan-out
// like Daily Events Export), a split row's other leg still needs to show up somewhere on its one
// row instead of silently vanishing. A leg-suffixed value is tagged with its leg name so it isn't
// mistaken for the bare/primary schedule; exact duplicate values (a leg key mirroring the bare
// key) are only shown once.
function dayValue(row: EmbellishmentRow, iso: string): string[] {
  const re = new RegExp(`^${iso}(?:_(.+))?$`);
  const parts: string[] = [];
  Object.entries(row as unknown as Record<string, unknown>).forEach(([k, v]) => {
    const val = String(v ?? "").trim();
    if (!val) return;
    const m = k.match(re);
    if (!m) return;
    parts.push(m[1] ? `${val} (${m[1]})` : val);
  });
  return Array.from(new Set(parts));
}

export default function EmbellishmentPlanExport({ rows }: EmbellishmentPlanExportProps) {
  const todayIso = localIso(new Date());
  const weekEndIso = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 6);
    return localIso(d);
  })();
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [endDate, setEndDate] = useState<string>(weekEndIso);
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    const days: ExportDay[] = buildDays(startDate, endDate);
    if (days.length === 0) {
      window.alert(`Pick a valid date range (start on or before end, at most ${MAX_DAYS} days).`);
      return;
    }

    setBusy(true);
    try {
      // Only active rows that actually have a planning event somewhere in the selected window —
      // same "has events" bar as everywhere else in the app (derivePlanStatus), just scoped to
      // this date range instead of the row's whole history.
      const exportRows = rows.filter(
        (row) => isExportableRow(row) && days.some((d) => dayValue(row, d.iso).length > 0),
      );

      if (exportRows.length === 0) {
        window.alert("No active rows have a planning event in that date range.");
        return;
      }

      const byCategory = new Map<string, EmbellishmentRow[]>();
      exportRows.forEach((row) => {
        const name = categorySheetName(String(row.col3 || ""));
        const list = byCategory.get(name) || [];
        list.push(row);
        byCategory.set(name, list);
      });

      const workbook = new ExcelJS.Workbook();
      const columns = [
        ...EXPORT_COLUMNS.map((c) => ({ header: c.label, key: c.key, width: 16 })),
        ...days.map((d) => ({ header: d.iso, key: `d_${d.iso}`, width: 14 })),
      ];

      const usedNames = new Set<string>();
      [...byCategory.keys()].sort((a, b) => a.localeCompare(b)).forEach((category) => {
        const sheet = workbook.addWorksheet(sanitizeSheetName(category, usedNames));
        sheet.columns = columns;

        const headerRow = sheet.getRow(1);
        headerRow.eachCell((cell, colNumber) => {
          cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
          // Date-column headers in red bold, metadata headers in plain bold — matches the
          // reference workbook's look.
          cell.font =
            colNumber > EXPORT_COLUMNS.length
              ? { bold: true, color: { argb: "FF9C0006" } }
              : { bold: true, color: { argb: "FF000000" } };
        });
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
        // Freeze the header row + the identifying columns through GRAPHIC (7 columns) so those
        // stay in view while scrolling across the day grid.
        sheet.views = [{ state: "frozen", xSplit: 7, ySplit: 1 }];

        byCategory
          .get(category)!
          .sort(
            (a, b) =>
              String(a.col5 || "").localeCompare(String(b.col5 || "")) ||
              String(a.col7 || "").localeCompare(String(b.col7 || "")),
          )
          .forEach((row) => {
            const rowData: Record<string, string> = {};
            EXPORT_COLUMNS.forEach((c) => {
              rowData[c.key] = String((row as unknown as Record<string, unknown>)[c.key] || "");
            });
            days.forEach((d) => {
              rowData[`d_${d.iso}`] = dayValue(row, d.iso).join(" / ");
            });
            const addedRow = sheet.addRow(rowData);

            days.forEach((d) => {
              const values = dayValue(row, d.iso);
              const cell = addedRow.getCell(`d_${d.iso}`);
              cell.alignment = { vertical: "middle", horizontal: "center" };
              // Only color when exactly one value landed in the cell — a joined multi-leg cell
              // mixes codes, so pass/fail coloring would be misleading.
              const parsed = values.length === 1 ? parseEventValue(values[0]) : null;
              const style =
                parsed?.status === "pass" || parsed?.status === "fail"
                  ? EVENT_STATUS_STYLE[parsed.status]
                  : null;
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
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      saveAs(blob, `Embellishment_Plan_${startDate}_to_${endDate}.xlsx`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
        <span className="uppercase tracking-wide text-[10px] text-slate-400">From</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="bg-[#0b0f19] border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-100 shadow-xs"
          title="First day to export events for"
        />
        <span className="uppercase tracking-wide text-[10px] text-slate-400">To</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="bg-[#0b0f19] border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-100 shadow-xs"
          title="Last day to export events for (inclusive)"
        />
      </div>
      <button
        onClick={handleExport}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 rounded-xl transition-all shadow-md active:scale-[0.98]"
        title="Export the full plan for this date range — one worksheet per Category (CK NA-MEN, CK NA-WOMEN, CK OTHER-KNIT, CKP, PINK-KNIT, PINK-LOUNGE, PINK-SPORT, VS-AE, ...)"
      >
        {busy ? "Exporting…" : "Export Embellishment"}
      </button>
    </div>
  );
}
