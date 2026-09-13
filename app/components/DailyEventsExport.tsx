"use client";
import React, { useRef, useState } from "react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { EmbellishmentRow, getRowStatus } from "../lib/db";
import { parseEventValue, encodeEventValue, getActiveReasonCodes, REASON_CODES } from "../lib/eventCodes";
import { resolvePlantDateTargets } from "../lib/plantUtils";

interface DailyEventsExportProps {
  rows: EmbellishmentRow[];
  onUpdateRow: (row: EmbellishmentRow) => void;
}

// Same columns/order as the Fabric Dispatch export, so the file looks like the sheets planners
// already send out — plus a Trigger/Category-first layout matching the legacy "Plan" tab.
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
  { key: "col13", label: "FABRIC REFERENCE" },
  { key: "col22", label: "COMMENT" },
];

// Hidden housekeeping columns used only to match an imported row back to the exact system row +
// cross-dev leg it came from. The per-day schedule field key is rebuilt on import from the day
// column's date + this leg, so a diverged cross-dev leg's own "<date>_<leg>" key is preserved.
const ROW_ID_KEY = "__rowId";
const LEG_KEY = "__leg";
// Legacy single-day exports carried this instead — still importable.
const LEGACY_FIELD_KEY = "FIELD KEY";

// Cap so a fat-fingered date range can't build a 300-column workbook.
const MAX_DAYS = 45;

// Any row that isn't Dropped or on Hold is fair game for a plant confirmation sheet — matches the
// rule the Action Center / Notification Center and the Google Sheet integration use. The old
// `col1 === "active"` check silently dropped every CK Tracking Chart row, since CK imports stamp
// col1 as "Approved"/"Pending"/"C+P"/"Hold" (see getCkRowStatus in lib/db.ts), never the literal
// "Active". A held (CK "H" — CROSS DEVELOPMENT) row is paused, so it's excluded like a dropped one.
function isExportableRow(row: EmbellishmentRow): boolean {
  const s = getRowStatus(row);
  return s !== "dropped" && s !== "hold";
}

// Loosely classify a fill color as pass (green) or fail (red) by comparing channels, rather than
// requiring an exact hex match — plants may use any shade of green/red from Excel's fill picker.
function classifyFillArgb(argb: string | undefined): "pass" | "fail" | null {
  if (!argb || argb.length < 6) return null;
  const hex = argb.slice(-6);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  // Ignore near-white/near-black/near-gray fills (not a deliberate color choice).
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 20) return null;
  if (g - r > 15 && g - b > 15) return "pass";
  if (r - g > 15 && r - b > 15) return "fail";
  return null;
}

// Match a Reason column cell's text back to one of our system's reason codes — accepts either
// the full label ("28: Merchant delay (7) - Communication") or just the leading code ("28").
function matchReasonCode(text: string): string | null {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const exact = REASON_CODES.find((r) => r.label.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact.code;
  const codePrefix = trimmed.match(/^(\d{1,2}[a-z]?)\b/i)?.[1];
  if (codePrefix) {
    const byCode = REASON_CODES.find((r) => r.code.toLowerCase() === codePrefix.toLowerCase());
    if (byCode) return byCode.code;
  }
  return null;
}

// Pull an ARGB fill color off an ExcelJS cell, if it has a solid pattern fill.
function cellFillArgb(cell: ExcelJS.Cell): string | undefined {
  const fill = cell.fill;
  return fill && fill.type === "pattern" && fill.fgColor && "argb" in fill.fgColor
    ? fill.fgColor.argb
    : undefined;
}

type ImportSummary = {
  pass: number;
  fail: number;
  skippedNoColor: number;
  skippedNoReason: number;
  notFound: number;
};

export type ExportDay = { iso: string; label: string };

// Local-component ISO (yyyy-mm-dd), matching how Table.tsx builds its schedule keys — NOT
// toISOString(), which shifts the date in any non-UTC timezone. Exported so other date-range
// exports (e.g. EmbellishmentPlanExport) build the same day list instead of re-deriving it.
export function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "2026-08-31" .. "2026-09-06" -> [{ iso, label:"Mon 31 Aug" }, ...]; [] if the range is invalid
// or wider than MAX_DAYS.
export function buildDays(startIso: string, endIso: string): ExportDay[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso) || !/^\d{4}-\d{2}-\d{2}$/.test(endIso)) return [];
  const start = new Date(startIso + "T00:00:00");
  const end = new Date(endIso + "T00:00:00");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const out: ExportDay[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    out.push({
      iso: localIso(cur),
      label: cur.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }),
    });
    cur.setDate(cur.getDate() + 1);
    if (out.length > MAX_DAYS) return [];
  }
  return out;
}

// The event-column header carries both a human label and the ISO date, so import can find the
// column by date without depending on locale formatting. The Reason column mirrors it + " Reason".
// Plain ASCII only — the file gets emailed around and opened in many Excel builds/locales.
function dayHeader(d: ExportDay): string {
  return `${d.label} (${d.iso})`;
}

export default function DailyEventsExport({ rows, onUpdateRow }: DailyEventsExportProps) {
  const todayIso = localIso(new Date());
  const weekEndIso = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 6);
    return localIso(d);
  })();
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [endDate, setEndDate] = useState<string>(weekEndIso);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // One grid row per (plant, system row, cross-dev leg) that has at least one planned event in the
  // window. resolvePlantDateTargets fans a "/"-split cross-dev row out to every leg, and a
  // "+"-combined leg ("Antler+Leema") out to each individual plant — same rule as the Google Sheet.
  type GridRecord = {
    plant: string;
    legLabel: string;
    row: EmbellishmentRow;
    events: Record<string, { fieldKey: string; code: string }>; // by iso date
  };

  const collectGridRecords = (days: ExportDay[]): GridRecord[] => {
    const byKey = new Map<string, GridRecord>();
    rows.forEach((row) => {
      if (!isExportableRow(row)) return;
      days.forEach((d) => {
        resolvePlantDateTargets(row as unknown as Record<string, unknown>, d.iso).forEach((t) => {
          const key = `${t.plant}|${row.id}|${t.legLabel}`;
          let rec = byKey.get(key);
          if (!rec) {
            rec = { plant: t.plant, legLabel: t.legLabel, row, events: {} };
            byKey.set(key, rec);
          }
          rec.events[d.iso] = { fieldKey: t.fieldKey, code: t.code };
        });
      });
    });
    return [...byKey.values()].filter((r) => Object.keys(r.events).length > 0);
  };

  const handleExport = async () => {
    const days = buildDays(startDate, endDate);
    if (days.length === 0) {
      window.alert(
        `Pick a valid date range (start on or before end, at most ${MAX_DAYS} days).`,
      );
      return;
    }

    setBusy("export");
    try {
      const records = collectGridRecords(days);
      if (records.length === 0) {
        window.alert("No pending events to export in that date range.");
        return;
      }

      const workbook = new ExcelJS.Workbook();
      const activeReasons = getActiveReasonCodes();

      const columns = [
        { header: "PLANT", key: "plant", width: 16 },
        ...EXPORT_COLUMNS.map((c) => ({ header: c.label, key: c.key, width: 16 })),
        ...days.flatMap((d) => [
          { header: dayHeader(d), key: `d_${d.iso}`, width: 13 },
          { header: `${dayHeader(d)} Reason`, key: `r_${d.iso}`, width: 30 },
        ]),
        { header: "ROW ID", key: ROW_ID_KEY, width: 10, hidden: true },
        { header: "LEG", key: LEG_KEY, width: 14, hidden: true },
      ];

      // Write one grid to a worksheet: header styling, freeze panes, filter, and the plant's rows.
      const writeGridSheet = (sheet: ExcelJS.Worksheet, plantRecords: GridRecord[]) => {
        sheet.columns = columns;

        const headerRow = sheet.getRow(1);
        headerRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: "FF000000" } };
          cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        });
        // Filter across the visible columns only (exclude the 2 hidden trailing ones).
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length - 2 } };
        // Freeze the header row + the context columns through GRAPHIC so the day grid scrolls under.
        sheet.views = [{ state: "frozen", xSplit: 8, ySplit: 1 }];

        plantRecords
          .sort(
            (a, b) =>
              String(a.row.col5 || "").localeCompare(String(b.row.col5 || "")) ||
              String(a.row.col7 || "").localeCompare(String(b.row.col7 || "")) ||
              a.legLabel.localeCompare(b.legLabel),
          )
          .forEach((rec) => {
            const rowData: Record<string, string> = { plant: rec.plant };
            EXPORT_COLUMNS.forEach((c) => {
              rowData[c.key] = String((rec.row as unknown as Record<string, unknown>)[c.key] || "");
            });
            days.forEach((d) => {
              rowData[`d_${d.iso}`] = rec.events[d.iso]?.code || "";
              rowData[`r_${d.iso}`] = "";
            });
            rowData[ROW_ID_KEY] = rec.row.id;
            rowData[LEG_KEY] = rec.legLabel;
            const addedRow = sheet.addRow(rowData);

            days.forEach((d) => {
              const eventCell = addedRow.getCell(`d_${d.iso}`);
              eventCell.alignment = { vertical: "middle", horizontal: "center" };
              eventCell.font = { bold: true };
              addedRow.getCell(`r_${d.iso}`).dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: [`Reasons!$A$1:$A$${activeReasons.length}`],
              };
            });
          });
      };

      // One worksheet PER PLANT. Excel sheet names must be <=31 chars, unique, and free of
      // : \ / ? * [ ] (same rule as FabricDispatchView's per-plant tabs).
      const usedNames = new Set<string>();
      const sanitizeSheetName = (name: string) => {
        const base = (name.replace(/[:\\/?*[\]]/g, "").trim() || "Plant").slice(0, 31);
        let unique = base;
        let i = 2;
        while (usedNames.has(unique.toUpperCase())) {
          const suffix = `_${i}`;
          unique = base.slice(0, 31 - suffix.length) + suffix;
          i++;
        }
        usedNames.add(unique.toUpperCase());
        return unique;
      };

      const byPlant = new Map<string, GridRecord[]>();
      records.forEach((rec) => {
        const list = byPlant.get(rec.plant) || [];
        list.push(rec);
        byPlant.set(rec.plant, list);
      });

      [...byPlant.keys()]
        .sort((a, b) => a.localeCompare(b))
        .forEach((plant) => {
          writeGridSheet(workbook.addWorksheet(sanitizeSheetName(plant)), byPlant.get(plant)!);
        });

      // Hidden helper sheet holding the reason list, referenced by every Reason column's dropdown —
      // an inline list would blow past Excel's 255-char limit for 50+ reasons. Added LAST so it
      // isn't the first tab the plant sees.
      const reasonSheet = workbook.addWorksheet("Reasons");
      reasonSheet.state = "veryHidden";
      activeReasons.forEach((r, i) => {
        reasonSheet.getCell(`A${i + 1}`).value = r.label;
      });

      const blob = await workbook.xlsx.writeBuffer();
      saveAs(
        new Blob([blob], { type: "application/octet-stream" }),
        `Daily_Events_${startDate}_to_${endDate}.xlsx`,
      );
    } finally {
      setBusy(null);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBusy("import");
    setSummary(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      if (workbook.worksheets.length === 0) {
        window.alert("Couldn't find a sheet in that file.");
        return;
      }

      const result: ImportSummary = {
        pass: 0,
        fail: 0,
        skippedNoColor: 0,
        skippedNoReason: 0,
        notFound: 0,
      };
      const changesByRowId = new Map<string, Record<string, string>>();

      const noteChange = (rowId: string, fieldKey: string, value: string) => {
        const existing = changesByRowId.get(rowId) || {};
        existing[fieldKey] = value;
        changesByRowId.set(rowId, existing);
      };

      // Parse one worksheet (legacy single-day OR weekly grid). Returns false only for a sheet
      // that carries no recognizable columns at all — the caller uses that to detect a bad file.
      const parseSheet = (sheet: ExcelJS.Worksheet): boolean => {
        let rowIdCol = 0;
        let legCol = 0;
        let legacyFieldKeyCol = 0;
        let legacyReasonCol = 0;
        const eventColByIso: Record<string, number> = {};
        const reasonColByIso: Record<string, number> = {};

        sheet.getRow(1).eachCell((cell, colNumber) => {
          const h = String(cell.value || "").trim();
          if (h === "ROW ID") return void (rowIdCol = colNumber);
          if (h === "LEG") return void (legCol = colNumber);
          if (h === LEGACY_FIELD_KEY) return void (legacyFieldKeyCol = colNumber);
          if (h.toUpperCase() === "REASON") return void (legacyReasonCol = colNumber);
          const iso = h.match(/\d{4}-\d{2}-\d{2}/)?.[0];
          if (!iso) return;
          if (/reason/i.test(h)) reasonColByIso[iso] = colNumber;
          else eventColByIso[iso] = colNumber;
        });

        // ---- Legacy single-day file (one dated event column + FIELD KEY hidden column) ---------
        if (legacyFieldKeyCol && rowIdCol) {
          const legacyIso = Object.keys(eventColByIso)[0];
          const eventCol = legacyIso ? eventColByIso[legacyIso] : 0;
          if (!eventCol || !legacyReasonCol) return false;
          sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const rowId = String(row.getCell(rowIdCol).value || "").trim();
            const fieldKey = String(row.getCell(legacyFieldKeyCol).value || "").trim();
            if (!rowId || !fieldKey) return;
            const eventCell = row.getCell(eventCol);
            const parsed = parseEventValue(String(eventCell.value || ""));
            if (!parsed) return;
            const classification = classifyFillArgb(cellFillArgb(eventCell));
            if (!classification) return void result.skippedNoColor++;
            if (classification === "pass") {
              noteChange(rowId, fieldKey, encodeEventValue(parsed.code, "pass"));
              result.pass++;
            } else {
              const reasonCode = matchReasonCode(String(row.getCell(legacyReasonCol).value || ""));
              if (!reasonCode) return void result.skippedNoReason++;
              noteChange(rowId, fieldKey, encodeEventValue(parsed.code, "fail", reasonCode));
              result.fail++;
            }
          });
          return true;
        }

        // ---- Weekly grid sheet (one column per day, + a "<day> Reason" column) -----------------
        if (!rowIdCol || Object.keys(eventColByIso).length === 0) return false;
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const rowId = String(row.getCell(rowIdCol).value || "").trim();
          if (!rowId) return;
          const leg = legCol ? String(row.getCell(legCol).value || "").trim() : "";

          // Classify every event cell in this row first — so an un-colored cell only counts as
          // "skipped" when the plant actually worked this row (colored at least one other day),
          // not for every still-pending event across a 7-day sheet.
          const cells = Object.entries(eventColByIso)
            .map(([iso, colNum]) => {
              const eventCell = row.getCell(colNum);
              const parsed = parseEventValue(String(eventCell.value || ""));
              if (!parsed) return null; // blank day / no planned event
              return {
                iso,
                parsed,
                classification: classifyFillArgb(cellFillArgb(eventCell)),
              };
            })
            .filter((c): c is NonNullable<typeof c> => c !== null);
          if (!cells.some((c) => c.classification)) return; // nothing marked on this row

          cells.forEach(({ iso, parsed, classification }) => {
            if (!classification) return void result.skippedNoColor++;
            const fieldKey = leg ? `${iso}_${leg}` : iso;
            // NYC (NY comments) is where the CK approval verdict is recorded: green -> NY
            // approved, red -> NY rejected. Written as a manual "nycv:" key (not NYC|P/|F) so
            // the auto comment-parser leaves it alone. See app/lib/nycVerdict.ts.
            if (parsed.code === "NYC") {
              noteChange(rowId, `nycv:${iso}`, classification === "pass" ? "NYC-A*" : "NYC-R*");
              if (classification === "pass") result.pass++;
              else result.fail++;
              return;
            }
            if (classification === "pass") {
              noteChange(rowId, fieldKey, encodeEventValue(parsed.code, "pass"));
              result.pass++;
            } else {
              const reasonCol = reasonColByIso[iso];
              const reasonCode = reasonCol
                ? matchReasonCode(String(row.getCell(reasonCol).value || ""))
                : null;
              if (!reasonCode) return void result.skippedNoReason++;
              noteChange(rowId, fieldKey, encodeEventValue(parsed.code, "fail", reasonCode));
              result.fail++;
            }
          });
        });
        return true;
      };

      // Every visible worksheet is a plant tab (or the single sheet of an older file). Skip the
      // hidden "Reasons" helper.
      const dataSheets = workbook.worksheets.filter(
        (s) => s.name !== "Reasons" && s.state !== "veryHidden" && s.state !== "hidden",
      );
      const anyRecognized = dataSheets.map(parseSheet).some(Boolean);
      if (!anyRecognized) {
        window.alert(
          "This file doesn't look like a Daily Events export (no sheet has a ROW ID column and dated event columns). Re-export and try again.",
        );
        return;
      }

      // Sequential, not parallel — writing the same underlying dataset concurrently from a
      // forEach has caused lost/overwritten updates before in this app.
      for (const [rowId, changes] of changesByRowId) {
        const currentRow = rows.find((r) => r.id === rowId);
        if (!currentRow) {
          result.notFound++;
          continue;
        }
        await onUpdateRow({ ...currentRow, ...changes });
      }

      setSummary(result);
    } catch (err) {
      console.error("Error importing daily events file:", err);
      window.alert("Failed to read that file. Make sure it's the .xlsx exported from this page.");
    } finally {
      setBusy(null);
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
        disabled={busy !== null}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl transition-all shadow-md active:scale-[0.98]"
        title="Export this date range's pending events to send to plants — one worksheet tab per plant, cross-dev split into separate rows"
      >
        {busy === "export" ? "Exporting…" : "Export Day's Events"}
      </button>
      <button
        onClick={handleImportClick}
        disabled={busy !== null}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-xl transition-all shadow-md active:scale-[0.98]"
        title="Import a plant's completed Daily Events file"
      >
        {busy === "import" ? "Importing…" : "Import Results"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        onChange={handleFileSelected}
        className="hidden"
      />

      {summary && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 rounded-lg border border-slate-700">
          <span>
            Imported: <b className="text-emerald-400">{summary.pass} pass</b>,{" "}
            <b className="text-rose-400">{summary.fail} fail</b>
            {summary.skippedNoColor > 0 && <>, {summary.skippedNoColor} uncolored (skipped)</>}
            {summary.skippedNoReason > 0 && (
              <>, {summary.skippedNoReason} red with no reason selected (skipped)</>
            )}
            {summary.notFound > 0 && <>, {summary.notFound} rows no longer found</>}
          </span>
          <button onClick={() => setSummary(null)} className="text-slate-400 hover:text-white font-bold">
            &times;
          </button>
        </div>
      )}
    </div>
  );
}
