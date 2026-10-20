"use client";
import React, { useMemo, useState } from "react";
import { EmbellishmentRow, getRowStatus } from "../lib/db";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import EventStatusPanel from "./EventStatusPanel";
import { parseEventValue } from "../lib/eventCodes";
import { parseCrossDevGroups, normalizeSinglePlant, leadingDyePlant } from "../lib/plantUtils";
import { getPlanningCategory } from "../lib/planningFlows";

interface FabricDispatchViewProps {
  rows: EmbellishmentRow[];
  onUpdateRow?: (row: EmbellishmentRow) => void;
}

// A row assigned to a plant, carrying the fabric ref / ground color it was grouped under
// (an item can appear under multiple plants when a style is cross-developed).
// __eventValue is the event actually scheduled for this plant leg on the selected date — resolved
// leg-aware (bare "2026-09-01" key OR the leg-suffixed "2026-09-01_AV" key) at grouping time, so
// downstream readers (the on-screen list AND the Excel export) don't each have to re-resolve it and
// silently fall back to the empty bare key for a split row's non-primary leg.
type DispatchItem = EmbellishmentRow & { __fabric: string; __ground: string; __eventValue: string };

// The source "Fabric Reference" field is free text and often names more than one fabric on a
// single row — a body fabric plus an applique/accent fabric, written in all sorts of ways
// ("FB # 22418 22693", "BODY-FB #17755/APP-FB # 19920", "Ground - FB 19859\nApplique - FB 19920").
// Pull every distinct fabric number out of it so each one gets its own group instead of the
// whole combined string being treated as one fabric.
function parseFabricRefs(raw: string): { code: string; label: string }[] {
  const text = String(raw || "").trim();
  if (!text) return [{ code: "NO FABRIC REF", label: "NO FABRIC REF" }];

  const prefixByCode = new Map<string, string>();
  let lastPrefix = "FB";
  // The digit run must end the token (not be a slice of a longer code like "FB # 211BA").
  const prefixedRe = /(FB|LC)\s*#?\s*-?\s*(\d{3,7})(?![A-Za-z\d])/gi;
  let m: RegExpExecArray | null;
  while ((m = prefixedRe.exec(text))) {
    const prefix = m[1].toUpperCase();
    prefixByCode.set(m[2], prefix);
    lastPrefix = prefix;
  }

  // Bare digit runs not already captured above — e.g. the trailing "22693" in "FB # 22418 22693",
  // which shares the prefix of the number right before it. The number must stand on its own —
  // NOT be a slice of a longer alphanumeric fabric code like "SJCS211BA" or "SSO68178" (CK
  // Tracking Chart references). Without the letter/digit guards on both sides, "SJCS211BA" was
  // parsed as the number "211" and the whole cell rewritten to "FB # 211" on export, silently
  // destroying the real reference. Same guard as mergeFabricRefs in page.tsx.
  (text.match(/(?<![A-Za-z\d])\d{3,7}(?![A-Za-z\d])/g) || []).forEach((code) => {
    if (!prefixByCode.has(code)) prefixByCode.set(code, lastPrefix);
  });

  if (prefixByCode.size === 0) {
    return [{ code: text.toUpperCase(), label: text }];
  }

  // Only one fabric number named on the row — keep the ENTIRE original text as the label
  // instead of rebuilding a bare "FB # <code>" from just the matched number. The reconstruction
  // below exists to split a cell naming SEVERAL distinct fabrics into separate labels; with only
  // one, there's nothing to split, and rebuilding was silently dropping whatever else the
  // planner wrote alongside the number — e.g. "FB22693(APPLIQUE:SOCO SATEEN T2454)" exported as
  // just "FB # 22693", losing the applique detail entirely.
  if (prefixByCode.size === 1) {
    const [code] = prefixByCode.keys();
    return [{ code, label: text }];
  }

  return Array.from(prefixByCode.entries()).map(([code, prefix]) => ({
    code,
    label: `${prefix} # ${code}`,
  }));
}

// Sorts a plant's items so rows sharing the same Fabric Ref sit next to each other, and marks
// where each fabric group starts/how many rows it spans — so the table can merge the Fabric Ref
// cell down the group instead of repeating it on every row.
function withFabricGroups(items: DispatchItem[]) {
  const sorted = [...items].sort((a, b) => {
    const f = a.__fabric.localeCompare(b.__fabric);
    return f !== 0 ? f : a.__ground.localeCompare(b.__ground);
  });
  const result: { item: DispatchItem; fabricSpan: number; isGroupStart: boolean; fabricCount: number }[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].__fabric === sorted[i].__fabric) j++;
    const span = j - i;
    for (let k = i; k < j; k++) {
      result.push({ item: sorted[k], fabricSpan: k === i ? span : 0, isGroupStart: k === i, fabricCount: span });
    }
    i = j;
  }
  return result;
}

// Columns needed for the export and view matching the reference dispatch sheet ("Event_Summary").
// col17-col21 are kept in the workbook but marked hidden — same as the reference file, which
// carries them as collapsed columns (Q-U) rather than dropping them outright.
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
  { key: "col17", label: "RISK FACTOR", hidden: true },
  { key: "col18", label: "TECHNIQUE CATEGORY", hidden: true },
  { key: "col19", label: "GRAPHIC TYPE", hidden: true },
  { key: "col20", label: "AOQ", hidden: true },
  { key: "col21", label: "TECHNIQUE TYPE", hidden: true },
  { key: "col22", label: "COMMENT" },
  { key: "col50", label: "FABRIC DISPATCH COMMENT", width: 30 },
];

// Excel's built-in "Good/Bad" cell-style colors — used to color the date column green/red
// when an event has actually passed or failed. A merely planned/submitted event (e.g. "FS-S",
// or a bare code with no suffix) gets no fill at all — left blank/white instead of yellow.
const EVENT_STATUS_STYLE = {
  pass: { fill: "FFC6EFCE", font: "FF006100" },
  fail: { fill: "FFFFC7CE", font: "FF9C0006" },
} as const;

export default function FabricDispatchView({ rows, onUpdateRow }: FabricDispatchViewProps) {
  // Default to today
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0],
  );
  const [searchQuery, setSearchQuery] = useState("");

  const [activePanel, setActivePanel] = useState<{
    rowId: string;
    dateKey: string;
    dateLabel: string;
    rawValue: string;
    plant: string;
    style?: string;
    graphic?: string;
  } | null>(null);

  // Filter to rows still in play — anything not Dropped and not on Hold. The old `col1 === "active"`
  // check silently excluded every CK Tracking Chart row, since CK imports stamp col1 as
  // "Approved"/"Pending"/"C+P"/"Hold" (see getCkRowStatus in lib/db.ts), never the literal "Active".
  // A held (CK "H" — CROSS DEVELOPMENT) row is paused, so it's excluded like a dropped one — same
  // fix applied to the Action Center and Daily Events export.
  const activeRows = useMemo(() => {
    return rows.filter((r) => {
      const s = getRowStatus(r);
      return s !== "dropped" && s !== "hold";
    });
  }, [rows]);

  // Group by Plant only — each plant gets one table listing everything assigned to it
  // (fabric ref and ground color are carried per-item since they vary within a plant).
  const { groupedFabricData, groupedSampleSewingData } = useMemo(() => {
    type GroupMap = Map<string, { plant: string; items: DispatchItem[] }>;
    const fabricGroups: GroupMap = new Map();
    const sampleSewingGroups: GroupMap = new Map();

    // Events shown in the "Sample, Sewing & Mock-up" section: first sample, cut-panel
    // requests, sew-in / sew-start, mock-up and garment sends. "fr" (fabric received) drives
    // the other section; anything else (PPS, RDPS, NY, ...) still isn't shown on this page.
    const SAMPLE_SEWING_EVENTS = ["fs", "csrf", "cps", "sewin", "sews", "moc", "gmt", "gsd", "awr"];

    const addRowToGroup = (groups: GroupMap, row: EmbellishmentRow, parsedPlants: { name: string; isCrossDev: boolean }[], parsedFabrics: { code: string; label: string }[], ground: string, resolvedEvent: string) => {
      // The Fabric Reference is kept WHOLE — one dispatch line per plant, with every fabric this
      // item names ("FB # 22693, LC # 09947") in the single cell. It used to split into one line
      // per fabric number, which produced otherwise-identical body-fabric + applique-fabric rows
      // for the same plant (reported against 10356707 / GVS27-178). The Daily Events export
      // already keeps col13 whole; this now matches it.
      const fabricLabel = parsedFabrics.map((f) => f.label).join(", ") || String(row.col13 || "");
      parsedPlants.forEach((p) => {
        // Collapse plant aliases so every "CKT" / "HI-EMB" / "H Embellishments" line lands in
        // ONE group, likewise "AV1" / "AV2" / "BFFAV" / "BRANDIXEMB". The per-leg schedule-key
        // lookups above stay on the raw name (they must match what's stored on the row); only
        // the grouping + the exported PLANT cell use the canonical name.
        // When the PLANT FLOW starts at a dye plant ("BFL>>EXPO / Antler"), the fabric's first stop
        // is the dye plant, not the print plant — so each leg reads "BFL >> EXPO" / "BFL >> ANTLER"
        // and gets its own group, apart from that plant's plain (non-dye) lines.
        const plantName = normalizeSinglePlant(p.name) || p.name;
        const dyePlant = leadingDyePlant(String(row.col12 || ""));
        const canonicalName =
          dyePlant && normalizeSinglePlant(dyePlant) !== plantName ? `${dyePlant} >> ${plantName}` : plantName;
        const groupKey = canonicalName;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, { plant: canonicalName, items: [] });
        }
        const rowCopy = { ...row, col11: canonicalName, col13: fabricLabel, __fabric: fabricLabel, __ground: ground, __eventValue: resolvedEvent } as DispatchItem;
        // Stamp the resolved value onto the bare date key too, so any reader that still keys off
        // row[selectedDate] (the Excel export's writeDataRow, older call paths) sees the leg's real
        // event instead of a blank.
        (rowCopy as Record<string, string>)[selectedDate] = resolvedEvent;
        if (p.isCrossDev) {
          rowCopy.col22 = "CROSS DEVELOPMENT";
        }
        groups.get(groupKey)!.items.push(rowCopy);
      });
    };

    activeRows.forEach((row) => {
      // Plant parsing logic. Keep col11's ORIGINAL casing — the per-leg schedule keys the grid
      // writes ("2026-09-08_Antler + Leema") use exactly the casing col11 had, so uppercasing
      // here made the leg-key lookup below miss and the leg silently fell back to the (empty)
      // bare key. Only collapse newlines/repeat spaces so "Antler + Leema / \r\nRich color + MRC"
      // splits cleanly. normalizeSinglePlant (used for grouping) uppercases internally, so the
      // canonical PLANT cell is unaffected.
      const rawPlants = String(row.col11 || "").replace(/\s+/g, " ").trim();
      let parsedPlants: { name: string; isCrossDev: boolean }[] = [];

      if (rawPlants) {
        parsedPlants = parseCrossDevGroups(rawPlants);
      }

      // Fallback to col12 if col11 is empty
      if (parsedPlants.length === 0 && row.col12) {
        parsedPlants = parseCrossDevGroups(
          String(row.col12 || "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim(),
        );
      }

      if (parsedPlants.length === 0) {
        parsedPlants = [{ name: "UNKNOWN PLANT", isCrossDev: false }];
      }

      const parsedFabrics = parseFabricRefs(String(row.col13 || ""));
      const ground = String(row.col8 || "NO GROUND").trim();
      const bareEvent = String((row as Record<string, string>)[selectedDate] || "");
      const rowKeys = Object.keys(row);

      // Resolve the event PER cross-dev leg, not once for the whole row. A "/"-split row keeps a
      // separate schedule for each plant: the first-listed leg (and every non-split row) uses the
      // plain date keys ("2026-09-02"), while any other leg whose start date was set independently
      // keeps its own "<date>_<PLANT>" keys (see handleSetPlanStartDate in page.tsx). Reading only
      // the plain key made a leg's own dates invisible here — and if the plain key for that date
      // was blank (because that leg's shared schedule starts later), the WHOLE row was skipped,
      // silently dropping the other leg's dispatch line. Confirmed against real data: 47K676G /
      // CKNAW064's AV leg has FS on 2026-09-01 under "2026-09-01_AV", but the bare "2026-09-01"
      // key is empty, so AV never appeared on the 1st's dispatch sheet.
      parsedPlants.forEach((p) => {
        // Case-insensitive: some earlier data has leg keys stored with a slightly different
        // casing than col11 reads today.
        const legSuffix = p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const legRe = new RegExp(`^\\d{4}-\\d{2}-\\d{2}_${legSuffix}$`, "i");
        const legMarker = rowKeys.find((k) =>
          new RegExp(`^_leg_${legSuffix}$`, "i").test(k),
        );
        const legHasOwnSchedule =
          (legMarker && String((row as Record<string, string>)[legMarker] || "").trim() !== "") ||
          rowKeys.some(
            (k) => legRe.test(k) && String((row as Record<string, string>)[k] || "").trim(),
          );
        const legDateKey = rowKeys.find((k) =>
          new RegExp(`^${selectedDate}_${legSuffix}$`, "i").test(k),
        );
        // A leg that keeps its own schedule reads ONLY its own key for this date (blank if it
        // has nothing today) — it must NOT fall back to the shared/bare plan, which belongs to
        // the first leg. A leg still mirroring the shared plan uses the bare key.
        const eventVal = legHasOwnSchedule
          ? legDateKey
            ? String((row as Record<string, string>)[legDateKey] || "")
            : ""
          : bareEvent;
        if (!eventVal) return;

        const eventLower = eventVal.toLowerCase();
        const isSampleSewing = SAMPLE_SEWING_EVENTS.some((evt) => eventLower.includes(evt));
        const isFabricDispatch = !isSampleSewing && eventLower.includes("fr");
        if (!isSampleSewing && !isFabricDispatch) return;

        // A "+"-joined location (e.g. "RC+MRC") is ONE combined place — ship the fabric to the
        // first-listed plant only, not both. A genuine "/" cross-dev split keeps its flag.
        const destPlant = { name: p.name.split("+")[0].trim(), isCrossDev: p.isCrossDev };
        addRowToGroup(
          isSampleSewing ? sampleSewingGroups : fabricGroups,
          row,
          [destPlant],
          parsedFabrics,
          ground,
          eventVal,
        );
      });
      // Print/dye/approval events (PPS, PPSDS, PPSES, RDPS, NY, ...) are intentionally not shown here.
    });

    const sortAndFilter = (groupsMap: GroupMap) => {
      let result = Array.from(groupsMap.values());
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        result = result
          .map((g) => ({
            ...g,
            items: g.items.filter(
              (i) =>
                g.plant.toLowerCase().includes(q) ||
                i.__fabric.toLowerCase().includes(q) ||
                i.__ground.toLowerCase().includes(q) ||
                (String(String(String(String(i.col5 || ""))))).toLowerCase().includes(q) ||
                (String(String(String(String(i.col7 || ""))))).toLowerCase().includes(q),
            ),
          }))
          .filter((g) => g.items.length > 0);
      }
      return result.sort((a, b) => a.plant.localeCompare(b.plant));
    };

    return {
      groupedFabricData: sortAndFilter(fabricGroups),
      groupedSampleSewingData: sortAndFilter(sampleSewingGroups)
    };
  }, [activeRows, searchQuery, selectedDate]);

  const handleExport = async () => {
    const workbook = new ExcelJS.Workbook();

    // Pool every item scheduled for the selected date, across every plant, from both the
    // Fabric Dispatch and Sample & Sewing groupings — nothing gets filtered out here (FR, FS,
    // GMT, MOC, PPS, ... all included).
    const allItems: DispatchItem[] = [];
    const collect = (groups: { plant: string; items: DispatchItem[] }[]) => {
      groups.forEach((group) => allItems.push(...group.items));
    };
    collect(groupedFabricData);
    collect(groupedSampleSewingData);

    // Split into two pools using the category the row is actually PLANNED as
    // (getPlanningCategory = APPLICATION FORM / S-Off Requirement, with the BABL/AV-as-fabric rule
    // applied) — the field that says what KIND of item this is, independent of which specific
    // event is scheduled on this particular date:
    //  - GARMENTS / MOCK-UPS / CUT PANELS -> get their own tab PER PLANT (garmentMockupItems)
    //  - everything else (fabric, fit functionals, ...) -> ONE combined sheet
    //    (fabricItems), matching the reference "Event_Summary" layout.
    // Routing on the RAW Application Form put BABL/AV garment/mock-up rows on a per-plant GARMENT tab
    // even though they are planned the fabric way (FS -> FR -> ...), splitting their FS lines off
    // the Fabric Dispatch sheet where the rest of the fabric plan lives.
    const garmentMockupItems: DispatchItem[] = [];
    const fabricItems: DispatchItem[] = [];
    allItems.forEach((row) => {
      const category = getPlanningCategory(row);
      if (category === "GARMENTS" || category === "MOCK-UPS" || category === "CUT PANELS") {
        garmentMockupItems.push(row);
      } else {
        fabricItems.push(row);
      }
    });

    const exportColumns = [
      ...EXPORT_COLUMNS.map((c) => ({
        header: c.label,
        key: c.label,
        width: "width" in c ? c.width : 16,
        hidden: "hidden" in c ? c.hidden : false,
      })),
      { header: selectedDate, key: "targetDate", width: 15 },
    ];

    const setupSheet = (worksheet: ExcelJS.Worksheet) => {
      worksheet.columns = exportColumns;
      // Plain bold header (no fill) with autofilter dropdowns + a frozen top row, matching the
      // reference sheet's look instead of a solid-color header band.
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FF000000" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: exportColumns.length },
      };
      worksheet.views = [{ state: "frozen", ySplit: 1 }];
    };

    const writeDataRow = (worksheet: ExcelJS.Worksheet, row: DispatchItem) => {
      const rowData: Record<string, string> = {};
      EXPORT_COLUMNS.forEach((c) => {
        rowData[c.label] = (row[c.key as keyof EmbellishmentRow] as string) || "";
      });
      // Leg-aware value resolved at grouping time — falls back to the bare date key for any item
      // that predates the __eventValue stamp.
      const targetValue = row.__eventValue || (row as Record<string, string>)[selectedDate] || "";
      rowData["targetDate"] = targetValue;
      const addedRow = worksheet.addRow(rowData);

      // Color the date cell green/red only when the event has actually passed or failed.
      // A planned/submitted event (status "planned", e.g. "FS-S" or a bare code) gets no
      // fill — left plain instead of the old yellow.
      const parsed = parseEventValue(targetValue);
      const dateCell = addedRow.getCell("targetDate");
      const style = parsed?.status === "pass" || parsed?.status === "fail" ? EVENT_STATUS_STYLE[parsed.status] : null;
      if (style) {
        dateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: style.fill } };
        dateCell.font = { bold: true, color: { argb: style.font } };
      } else {
        dateCell.font = { bold: true };
      }
      dateCell.alignment = { vertical: "middle", horizontal: "center" };
    };

    // --- Sheet 1: Fabric Dispatch — everything that isn't Garment/Mock-up/Cut Panel, ALL plants
    // together on one sheet, sorted by Plant then Fabric Ref. ---
    const fabricSheet = workbook.addWorksheet("Fabric Dispatch");
    setupSheet(fabricSheet);
    fabricItems
      .sort((a, b) => {
        const p = String(a.col11 || "").localeCompare(String(b.col11 || ""));
        return p !== 0 ? p : a.__fabric.localeCompare(b.__fabric);
      })
      .forEach((row) => writeDataRow(fabricSheet, row));

    // --- One sheet PER PLANT for Garment + Mock-up + Cut Panel items. Excel sheet names must be
    // <=31 chars, unique, and free of : \ / ? * [ ] ---
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

    const gmPlantNames = Array.from(new Set(garmentMockupItems.map((r) => String(r.col11 || "")))).sort((a, b) =>
      a.localeCompare(b),
    );

    gmPlantNames.forEach((plant) => {
      const worksheet = workbook.addWorksheet(sanitizeSheetName(plant));
      setupSheet(worksheet);

      const plantItems = garmentMockupItems.filter((r) => String(r.col11 || "") === plant);
      const sections = (
        [
          ["GARMENTS", "GARMENT"],
          ["MOCK-UPS", "MOCK-UP"],
          ["CUT PANELS", "CUT PANEL"],
        ] as const
      )
        .map(([category, label]) => ({
          label,
          rows: plantItems
            .filter((r) => getPlanningCategory(r) === category)
            .sort((a, b) => a.__fabric.localeCompare(b.__fabric)),
        }))
        .filter((section) => section.rows.length > 0);

      // Only insert dividers when this plant tab actually has 2+ kinds on this date.
      const needsDivider = sections.length > 1;
      const writeSectionHeader = (label: string) => {
        if (worksheet.rowCount > 1) worksheet.addRow({}); // blank spacer before the divider
        const row = worksheet.addRow({});
        const cell = row.getCell(1);
        cell.value = label;
        worksheet.mergeCells(row.number, 1, row.number, exportColumns.length);
        cell.font = { bold: true, italic: true, color: { argb: "FF52525B" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
        cell.alignment = { vertical: "middle", horizontal: "left" };
      };

      sections.forEach((section) => {
        if (needsDivider) writeSectionHeader(section.label);
        section.rows.forEach((row) => writeDataRow(worksheet, row));
      });
    });

    // Generate Excel file — Fabric Dispatch on one combined sheet, Garment/Mock-up/Cut Panel split
    // into one tab per plant.
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    saveAs(blob, `Dispatch_${selectedDate}.xlsx`);
  };

  return (
    <div className="max-w-[100vw] mx-auto px-6 py-8 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4 bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xl">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-blue-500/10 border-2 border-blue-500/40 flex items-center justify-center text-blue-500">
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
              Fabric Dispatch
            </h1>
          </div>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Grouped view of all active fabric requirements. Export to Excel,
            send to the dispatcher, and import their updates.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative">
            <input
              type="date"
              className="bg-zinc-50 dark:bg-slate-800/50 border border-zinc-300 dark:border-slate-700 text-zinc-900 dark:text-slate-200 dark:[color-scheme:dark] rounded-lg pl-3 pr-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-semibold text-sm"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              title="Select Schedule Date"
            />
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 px-6 rounded-lg transition-all shadow-md shadow-blue-500/20 whitespace-nowrap"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            Export to Excel
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search Plant, Fabric, or Style..."
          className="w-full md:w-96 bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-sm"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Schedule Sections */}
      <div className="pb-20">
        {[
          { title: "Fabric Dispatch Schedule", data: groupedFabricData, icon: "📦" },
          { title: "Sample, Sewing & Mock-up Schedule", data: groupedSampleSewingData, icon: "✂️" }
        ].map((section, idx) => (
          <div key={idx} className="mb-12">
            <div className="flex items-center gap-3 mb-4 px-2">
              <span className="text-2xl">{section.icon}</span>
              <h2 className="text-xl font-black text-zinc-900 dark:text-white">{section.title}</h2>
            </div>
            <div className="space-y-4">
              {section.data.length === 0 ? (
                <div className="bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-xl p-12 text-center shadow-sm">
                  <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
                    No Events Found
                  </h3>
                  <p className="text-zinc-500 text-sm mt-1">
                    There are currently no rows matching your criteria for this schedule.
                  </p>
                </div>
              ) : (
                section.data.map((group) => (
                  <div
                    key={group.plant}
                    className="bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-xl hover:shadow-2xl transition-shadow"
                  >
                    {/* Table Header: Plant */}
                    <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#14161a] flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                          🏭
                        </span>
                        <div>
                          <span className="text-[10px] uppercase font-black text-zinc-500 tracking-widest block">
                            Plant
                          </span>
                          <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {group.plant}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400 font-black text-xs px-3 py-1.5 rounded-lg border border-blue-500/20">
                        {group.items.length} Item{group.items.length !== 1 ? "s" : ""}
                      </div>
                    </div>

                    {/* All items assigned to this plant */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse min-w-[820px]">
                        <thead>
                          <tr className="bg-zinc-50 dark:bg-[#0f1115] text-[9px] uppercase font-bold text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                            <th className="px-4 py-2.5">Fabric Ref</th>
                            <th className="px-4 py-2.5">Ground Color</th>
                            <th className="px-4 py-2.5">Style</th>
                            <th className="px-4 py-2.5">Graphic</th>
                            <th className="px-4 py-2.5">Category</th>
                            <th className="px-4 py-2.5">Season</th>
                            <th className="px-4 py-2.5">Dispatch Comment</th>
                            <th className="px-4 py-2.5 text-right">Status on {selectedDate}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 bg-[#0a0d14]">
                          {withFabricGroups(group.items).map(({ item, fabricSpan, isGroupStart, fabricCount }, idx) => {
                            const eventLabel = item.__eventValue || String((item as Record<string, string>)[selectedDate] || "");
                            return (
                              <tr
                                key={`${item.id}-${item.__fabric}`}
                                className={`hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors ${
                                  isGroupStart && idx > 0 ? "border-t-2 border-t-purple-500/25" : ""
                                }`}
                              >
                                {fabricSpan > 0 && (
                                  <td
                                    rowSpan={fabricSpan}
                                    className="px-4 py-3 text-xs font-mono text-purple-600 dark:text-purple-400 font-bold whitespace-nowrap align-top bg-purple-500/[0.04] border-r border-zinc-200 dark:border-zinc-800"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span>{item.__fabric || "-"}</span>
                                      {fabricCount > 1 && (
                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-purple-500/15 text-purple-400">
                                          {fabricCount}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                )}
                                <td className="px-4 py-3 text-xs text-emerald-600 dark:text-emerald-400 font-bold whitespace-nowrap">
                                  {item.__ground || "-"}
                                </td>
                                <td className="px-4 py-3 text-xs font-mono text-zinc-900 dark:text-zinc-300 font-bold whitespace-nowrap">
                                  {item.col5 || "-"}
                                </td>
                                <td className="px-4 py-3 text-xs font-mono text-blue-600 dark:text-blue-400 font-bold whitespace-nowrap">
                                  {item.col7 || "-"}
                                </td>
                                <td className="px-4 py-3 text-xs text-zinc-700 dark:text-zinc-400 font-bold whitespace-nowrap">
                                  {item.col3 || "-"}
                                </td>
                                <td className="px-4 py-3 text-xs text-zinc-700 dark:text-zinc-400 whitespace-nowrap">
                                  {item.col4 || "-"}
                                </td>
                                <td className="px-4 py-3 text-xs text-amber-600 dark:text-amber-400 font-semibold max-w-[260px] whitespace-pre-wrap">
                                  {String(item.col50 || "").trim() || "-"}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  {eventLabel ? (
                                    <button
                                      onClick={() => {
                                        setActivePanel({
                                          rowId: item.id,
                                          dateKey: selectedDate,
                                          dateLabel: selectedDate,
                                          rawValue: eventLabel,
                                          plant: String(item.col11 || ""),
                                          style: item.col5 != null ? String(item.col5) : undefined,
                                          graphic: item.col7 != null ? String(item.col7) : undefined,
                                        });
                                      }}
                                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-black border shadow-sm transition-colors ${
                                        (() => {
                                          const parsed = parseEventValue(eventLabel);
                                          if (parsed?.status === "pass") return "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30";
                                          if (parsed?.status === "fail") return "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/30";
                                          return "bg-zinc-800 text-zinc-200 border-zinc-600 hover:bg-zinc-700";
                                        })()
                                      }`}
                                    >
                                      {eventLabel}
                                    </button>
                                  ) : (
                                    <span className="text-xs font-bold text-zinc-400 dark:text-zinc-600">
                                      No Event Scheduled
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
      
      {activePanel && (
        <EventStatusPanel
          isOpen={true}
          onClose={() => setActivePanel(null)}
          rowId={activePanel.rowId}
          dateKey={activePanel.dateKey}
          dateLabel={activePanel.dateLabel}
          rawValue={activePanel.rawValue}
          plant={activePanel.plant}
          style={activePanel.style}
          graphic={activePanel.graphic}
          onSave={(rowId, dateKey, newValue) => {
            if (onUpdateRow) {
              const itemToUpdate = rows.find(r => r.id === rowId);
              if (itemToUpdate) {
                const updatedRow = { ...itemToUpdate };
                if (newValue) {
                  updatedRow[dateKey as keyof EmbellishmentRow] = newValue as EmbellishmentRow[keyof EmbellishmentRow];
                } else {
                  // Set to "" rather than deleting the key: page.tsx's handleUpdateRow spreads
                  // the original row THEN this one on top for an in-place update, so a merely
                  // deleted (i.e. absent) key here would never even override the original's old
                  // value in the object that actually gets saved — let alone survive the server's
                  // schedule merge (see server/db.js), which treats an absent key as "leave
                  // whatever's already saved alone", not "clear it".
                  updatedRow[dateKey as keyof EmbellishmentRow] = "" as EmbellishmentRow[keyof EmbellishmentRow];
                }
                updatedRow.change_reason = "Updated via Fabric Dispatch Panel";
                onUpdateRow(updatedRow);
              }
            }
          }}
        />
      )}
    </div>
  );
}
