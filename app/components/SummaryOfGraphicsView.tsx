"use client";
import React, { useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { EmbellishmentRow, getRowStatus } from "../lib/db";
import { categorySheetName } from "../lib/reportCategories";
import { rowRefIso, readNycVerdict } from "../lib/nycVerdict";
import { formatDateDDMMYYYY } from "../lib/triggerUtils";
import { extractDateFromTrackingText, extractDropDateIso } from "../lib/trackingDates";

interface SummaryOfGraphicsViewProps {
  rows: EmbellishmentRow[];
  onUpdateRow: (row: EmbellishmentRow) => void | Promise<void>;
}

type RowStatus = ReturnType<typeof getRowStatus>;

function statusLabel(s: RowStatus): string {
  switch (s) {
    case "approved":
      return "Approved";
    case "c+p":
      return "C+P";
    case "resubmit":
      return "Resubmit";
    case "hold":
      return "Hold";
    case "dropped":
      return "Dropped";
    default:
      return "Pending";
  }
}

const STATUS_STYLES: Record<RowStatus, string> = {
  approved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  "c+p": "bg-amber-500/10 text-amber-300 border-amber-500/30",
  resubmit: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  hold: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  dropped: "bg-zinc-700/30 text-zinc-400 border-zinc-600/40",
  pending: "bg-zinc-800 text-zinc-400 border-zinc-700",
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// Matches the Dashboard's dropdown filter chrome (FilterControls.tsx) so this page's filters look
// and behave the same way — a single-select "All X (N)" dropdown, not a multi-select pill list.
function FilterDropdown({
  value,
  onChange,
  allLabel,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: string[];
}) {
  return (
    <div className="relative">
      <select
        suppressHydrationWarning
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none flex items-center gap-1.5 pl-3.5 pr-8 py-2 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-850 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-zinc-700 dark:text-zinc-300 cursor-pointer max-w-[220px] truncate"
      >
        <option value="" className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">
          {allLabel}
        </option>
        {options.map((opt) => (
          <option key={opt} value={opt} className="text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800">
            {opt}
          </option>
        ))}
      </select>
      <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-zinc-500 dark:text-zinc-400">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
}

export default function SummaryOfGraphicsView({ rows, onUpdateRow }: SummaryOfGraphicsViewProps) {
  const [selectedSeason, setSelectedSeason] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  // Row selection for the bulk AWR-date setter below — checkbox per row plus a page-level
  // "select all". AWR (col26) is a manual field: the planner picks a date here and applies it
  // across every selected graphic at once, rather than editing one row at a time.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAwrDate, setBulkAwrDate] = useState("");

  const allCategories = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => categorySheetName(String(r.col3 || ""), String(r.col2 || "")))))
        .sort(),
    [rows],
  );

  // Cascading: once a Category is picked, the Season list narrows to seasons that actually occur
  // within that category — picking VS-AE then no longer offers a season that only PINK ships.
  const categoryScopedRows = useMemo(
    () =>
      selectedCategory
        ? rows.filter((r) => categorySheetName(String(r.col3 || ""), String(r.col2 || "")) === selectedCategory)
        : rows,
    [rows, selectedCategory],
  );
  const availableSeasons = useMemo(
    () =>
      Array.from(new Set(categoryScopedRows.map((r) => String(r.col4 || "").trim()).filter(Boolean))).sort(),
    [categoryScopedRows],
  );

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value);
    // Drop a Season selection that no longer applies once the Category narrows the season list.
    if (selectedSeason) {
      const stillValid = value
        ? rows.some(
            (r) =>
              categorySheetName(String(r.col3 || ""), String(r.col2 || "")) === value &&
              String(r.col4 || "").trim() === selectedSeason,
          )
        : true;
      if (!stillValid) setSelectedSeason("");
    }
    setPage(0);
  };

  const summaryRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        const season = String(r.col4 || "").trim();
        if (selectedSeason && season !== selectedSeason) return false;
        const category = categorySheetName(String(r.col3 || ""), String(r.col2 || ""));
        if (selectedCategory && category !== selectedCategory) return false;
        if (q) {
          const hay = `${r.col7 || ""} ${r.col5 || ""} ${r.col6 || ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .map((r) => {
        const status = getRowStatus(r);
        const refIso = rowRefIso(r);
        const awb1Raw = String(r.awb1 || "").trim();
        const awb2Raw = String(r.awb2 || "").trim();
        // col39 ("Approve Date") is an explicit field but is almost never actually filled in —
        // the real approval verdict + date normally lives inside the same 1st/2nd Strike-Off
        // Comment text as the S/Off dates (e.g. "AD 9/2 - S/O DATED 7/16/26 APPROVED LAYOUT/
        // TECH/ EX"), read the same way the NYC-A/NYC-R verdict already is elsewhere in the app
        // (readNycVerdict / parseCommentVerdict in lib/nycVerdict.ts) — the date right after the
        // initials, NOT the later "S/O DATED" date. col39 wins when it's actually present.
        // Gated to status === "approved": parseCommentVerdict deliberately skips any line that
        // also mentions a drop ("drop -> handled by getRowStatus, not here" — see its own
        // comment), so a graphic that was approved and LATER dropped still parses an "A" from
        // its older approved line. Without this gate that inflated the Approved count above what
        // Advanced Analytics shows (confirmed: 2 rows with "...APPROVED LAYOUT/TECH/EX" followed
        // by a later "DROP" line were being double-counted as both Approved and Dropped).
        const verdict = readNycVerdict(r);
        const approvedRaw = String(r.col39 || "").trim();
        const approvedDateIso =
          approvedRaw || status !== "approved" ? null : verdict?.kind === "A" ? verdict.iso : null;
        // col16 ("Alternative Fabric") is only filled in when the graphic was sent using an
        // alternative fabric instead of the actual one — an empty col16 means it went out on
        // the actual fabric, same signal the Dashboard's own Alternative Fabric column uses.
        // That's the 1st submission's fabric decision only. A combo frequently goes out on
        // Alternative for the 1st submission and Actual for the 2nd (or vice versa), so the 2nd
        // submission gets its own field (col49, same blank=Actual/filled=Alternative convention)
        // instead of overwriting col16 — otherwise the 1st submission's fabric type would be
        // lost. The 2nd column only shows a value once a 2nd submission actually went out
        // (awb2Raw present); before that there's nothing to report yet.
        const alternativeFabricRaw = String(r.col16 || "").trim();
        const secondAlternativeFabricRaw = String(r.col49 || "").trim();
        return {
          row: r,
          status,
          graphic: String(r.col7 || "").trim(),
          style: String(r.col5 || "").trim(),
          combo: String(r.col6 || "").trim(),
          ground: String(r.col8 || "").trim(),
          category: categorySheetName(String(r.col3 || ""), String(r.col2 || "")),
          season: String(r.col4 || "").trim(),
          fabricType: alternativeFabricRaw ? "Alternative" : "Actual",
          alternativeFabricRaw,
          secondFabricType: awb2Raw ? (secondAlternativeFabricRaw ? "Alternative" : "Actual") : null,
          secondAlternativeFabricRaw,
          awrRaw: String(r.col26 || "").trim(),
          approvedRaw,
          approvedDateIso,
          awb1Raw,
          awb2Raw,
          // awb1Date/awb2Date/dropDate are resolved at import time (page.tsx) now, right next to
          // where awb1/awb2/col39 themselves get set, so a fresh import needs no page computation
          // at all. The live extraction here only remains as a fallback for rows imported before
          // that existed.
          awb1DateIso: String(r.awb1Date || "").trim() || extractDateFromTrackingText(awb1Raw, refIso),
          awb2DateIso: String(r.awb2Date || "").trim() || extractDateFromTrackingText(awb2Raw, refIso),
          dropDateIso:
            status === "dropped" ? String(r.dropDate || "").trim() || extractDropDateIso(r) : null,
        };
      });
  }, [rows, selectedSeason, selectedCategory, search]);

  const totalPages = Math.max(1, Math.ceil(summaryRows.length / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageRows = summaryRows.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize);

  const awrCount = summaryRows.filter((r) => r.awrRaw).length;
  const firstSentCount = summaryRows.filter((r) => r.awb1Raw).length;
  const secondSentCount = summaryRows.filter((r) => r.awb2Raw).length;
  // Matches Advanced Analytics' "Approved" stat definition (status === approved), so an explicit
  // Approve Date left over on a graphic that was later dropped doesn't inflate this count — the
  // Approved Date column can still show that date on the row itself, but the headline stat here
  // should agree with the rest of the app's notion of "currently approved".
  const approvedCount = summaryRows.filter(
    (r) => r.status === "approved" && (r.approvedRaw || r.approvedDateIso),
  ).length;
  const droppedCount = summaryRows.filter((r) => r.status === "dropped").length;

  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selectedIds.includes(r.row.id));
  const handleSelectAllOnPage = (checked: boolean) => {
    if (checked) {
      const pageIds = pageRows.map((r) => r.row.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    } else {
      const pageIds = new Set(pageRows.map((r) => r.row.id));
      setSelectedIds((prev) => prev.filter((id) => !pageIds.has(id)));
    }
  };
  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };
  const handleBulkSetAwrDate = () => {
    if (!bulkAwrDate || selectedIds.length === 0) return;
    rows.forEach((r) => {
      if (!selectedIds.includes(r.id)) return;
      onUpdateRow({ ...r, col26: bulkAwrDate });
    });
    setSelectedIds([]);
    setBulkAwrDate("");
  };

  // Persist the Approved Date derived above (from the Strike-Off Comment "APPROVED" verdict)
  // into col39 itself — a deliberate, user-triggered write (never automatic), same as "Sync
  // Approval Cols" on Advanced Analytics writes its derived col40/col41. Only rows currently
  // blank in col39 are touched, so a real explicit Approve Date already on the row is never
  // overwritten by a comment-derived guess. Scoped to the current Category/Season/search filter,
  // matching Advanced Analytics' sync (which honors whatever its own sidebar filters show).
  const [syncingApprovedDates, setSyncingApprovedDates] = useState(false);
  const approvedDateSyncPlan = useMemo(
    () => summaryRows.filter((sr) => !sr.approvedRaw && sr.approvedDateIso),
    [summaryRows],
  );
  const handleSyncApprovedDates = async () => {
    if (approvedDateSyncPlan.length === 0) return;
    setSyncingApprovedDates(true);
    try {
      for (const sr of approvedDateSyncPlan) {
        await onUpdateRow({ ...sr.row, col39: sr.approvedDateIso as string });
      }
      window.alert(
        `Set Approved Date on ${approvedDateSyncPlan.length} row(s) from their Strike-Off Comments.`,
      );
    } finally {
      setSyncingApprovedDates(false);
    }
  };

  // Export the currently filtered rows — the Category/Season picked above, plus any search text —
  // to Excel. The Category and Season are stamped into a merged, shaded title block spanning every
  // column (matching the planner's own TNA report layout) so the sheet is self-describing once it
  // leaves this page, and the column header row carries a real AutoFilter.
  const [exportingExcel, setExportingExcel] = useState(false);
  const COLUMN_HEADERS = [
    "Status",
    "Graphic",
    "Style",
    "Combo #",
    "Category",
    "Season",
    "1st S/Off Fabric",
    "2nd S/Off Fabric",
    "AWR Date",
    "1st S/Off Sent",
    "2nd S/Off Sent",
    "Approved Date",
    "Dropped",
  ];
  const handleExportExcel = async () => {
    setExportingExcel(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("TNA Report");
      const colCount = COLUMN_HEADERS.length;

      const TITLE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB8CCE4" } };
      const titleLines = [
        "TNA Report",
        "",
        `Category :- ${selectedCategory || "All Categories"}`,
        `Season :- ${selectedSeason || "All Seasons"}`,
        "",
      ];
      titleLines.forEach((line, i) => {
        const row = sheet.addRow([line]);
        sheet.mergeCells(row.number, 1, row.number, colCount);
        const cell = row.getCell(1);
        cell.font = { bold: true, size: i === 0 ? 16 : 12, color: { argb: "FF1F3864" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        row.eachCell({ includeEmpty: true }, (c) => {
          c.fill = TITLE_FILL;
        });
      });

      const headerRow = sheet.addRow(COLUMN_HEADERS);
      headerRow.font = { bold: true };
      headerRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      });
      sheet.autoFilter = {
        from: { row: headerRow.number, column: 1 },
        to: { row: headerRow.number, column: colCount },
      };

      summaryRows.forEach((sr) => {
        sheet.addRow([
          statusLabel(sr.status),
          sr.graphic,
          sr.style,
          sr.combo,
          sr.category,
          sr.season,
          sr.fabricType,
          sr.secondFabricType || "",
          sr.awrRaw ? formatDateDDMMYYYY(sr.awrRaw) || sr.awrRaw : "",
          sr.awb1DateIso ? formatDateDDMMYYYY(sr.awb1DateIso) : sr.awb1Raw,
          sr.awb2DateIso ? formatDateDDMMYYYY(sr.awb2DateIso) : sr.awb2Raw,
          sr.approvedRaw
            ? formatDateDDMMYYYY(sr.approvedRaw) || sr.approvedRaw
            : sr.approvedDateIso
              ? formatDateDDMMYYYY(sr.approvedDateIso)
              : "",
          sr.status === "dropped" ? (sr.dropDateIso ? formatDateDDMMYYYY(sr.dropDateIso) : "Unknown") : "",
        ]);
      });

      sheet.columns.forEach((col) => {
        col.width = 16;
      });
      sheet.getColumn(2).width = 22; // Graphic
      sheet.getColumn(4).width = 14; // Combo #

      const labelParts = [selectedCategory || "AllCategories", selectedSeason || "AllSeasons"].map((s) =>
        s.replace(/[^A-Za-z0-9]+/g, ""),
      );
      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `TNA_Report_${labelParts.join("_")}.xlsx`,
      );
    } finally {
      setExportingExcel(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xl mb-6">
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight mb-1">
          TNA Report
        </h1>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          AWR date, Approved date, the 1st and 2nd Strike-Off S/Off dates (shown separately since a
          graphic is sometimes sent twice), and when it was dropped — filterable by Category and
          Season. The S/Off dates come straight from the 1st/2nd Strike-Off AWB (Tracking Details)
          columns, not a merged/latest-only value. Approved date is read the same way — the
          &ldquo;APPROVED&rdquo; verdict + date inside those same 1st/2nd Strike-Off Comments — when
          there&apos;s no explicit Approve Date on the row.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <div className="bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">AWR Date Recorded</div>
          <div className="text-2xl font-black text-zinc-900 dark:text-white mt-1">{awrCount}</div>
        </div>
        <div className="bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">1st S/Off Sent</div>
          <div className="text-2xl font-black text-zinc-900 dark:text-white mt-1">{firstSentCount}</div>
        </div>
        <div className="bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">2nd S/Off Sent</div>
          <div className="text-2xl font-black text-zinc-900 dark:text-white mt-1">{secondSentCount}</div>
        </div>
        <div className="bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Approved</div>
          <div className="text-2xl font-black text-zinc-900 dark:text-white mt-1">{approvedCount}</div>
        </div>
        <div className="bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Dropped</div>
          <div className="text-2xl font-black text-zinc-900 dark:text-white mt-1">{droppedCount}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <FilterDropdown
          value={selectedCategory}
          onChange={handleCategoryChange}
          allLabel={`All Categories (${rows.length})`}
          options={allCategories}
        />
        <FilterDropdown
          value={selectedSeason}
          onChange={(v) => {
            setSelectedSeason(v);
            setPage(0);
          }}
          allLabel="All Seasons"
          options={availableSeasons}
        />
        {(selectedCategory || selectedSeason) && (
          <button
            onClick={() => {
              setSelectedCategory("");
              setSelectedSeason("");
              setPage(0);
            }}
            className="text-xs font-semibold text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-3.5 py-2 rounded-xl transition-all"
          >
            Clear Filters
          </button>
        )}
        {approvedDateSyncPlan.length > 0 && (
          <button
            onClick={handleSyncApprovedDates}
            disabled={syncingApprovedDates}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all border border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50 shadow-sm"
            title="Write the Approved Date derived from the Strike-Off Comments into col39 for rows that don't have one yet"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {syncingApprovedDates
              ? "Syncing…"
              : `Sync Approved Dates (${approvedDateSyncPlan.length})`}
          </button>
        )}
        <button
          onClick={handleExportExcel}
          disabled={exportingExcel || summaryRows.length === 0}
          className="ml-auto flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all border border-blue-500/30 bg-blue-500/15 text-blue-700 dark:text-blue-300 hover:bg-blue-500/25 disabled:opacity-50 shadow-sm"
          title="Export the current Category/Season/search selection to Excel"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H8a2 2 0 01-2-2V5a2 2 0 012-2h6l4 4v11a2 2 0 01-2 2z" />
          </svg>
          {exportingExcel ? "Exporting…" : `Export to Excel (${summaryRows.length})`}
        </button>
      </div>

      <div className="bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-zinc-200 dark:border-zinc-800">
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search Style or Graphic..."
            className="w-72 max-w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500"
          />
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>Show</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              className="px-2 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>rows</span>
          </div>
        </div>

        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-sky-50 dark:bg-sky-500/10">
            <span className="text-xs font-semibold text-sky-700 dark:text-sky-300">
              {selectedIds.length} selected
            </span>
            <input
              type="date"
              value={bulkAwrDate}
              onChange={(e) => setBulkAwrDate(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
              title="AWR date to apply"
            />
            <button
              onClick={handleBulkSetAwrDate}
              disabled={!bulkAwrDate}
              className="px-3 py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all"
              title="Set the AWR date on every selected graphic"
            >
              Set AWR Date ({selectedIds.length})
            </button>
            <button
              onClick={() => setSelectedIds([])}
              className="text-xs font-semibold text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 px-2 py-1.5"
            >
              Clear selection
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold text-zinc-500 uppercase tracking-wide bg-zinc-50 dark:bg-zinc-900/60">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={(e) => handleSelectAllOnPage(e.target.checked)}
                    aria-label="Select all rows on this page"
                  />
                </th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Graphic</th>
                <th className="px-4 py-3">Style</th>
                <th className="px-4 py-3">Combo #</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Season</th>
                <th className="px-4 py-3">1st S/Off Fabric</th>
                <th className="px-4 py-3">2nd S/Off Fabric</th>
                <th className="px-4 py-3">AWR Date</th>
                <th className="px-4 py-3">1st S/Off Sent</th>
                <th className="px-4 py-3">2nd S/Off Sent</th>
                <th className="px-4 py-3">Approved Date</th>
                <th className="px-4 py-3">Dropped</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((sr) => (
                <tr key={sr.row.id} className="border-t border-zinc-100 dark:border-zinc-800/70">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(sr.row.id)}
                      onChange={(e) => handleSelectRow(sr.row.id, e.target.checked)}
                      aria-label={`Select ${sr.graphic || sr.row.id}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border ${STATUS_STYLES[sr.status]}`}>
                      {statusLabel(sr.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100">{sr.graphic || "—"}</td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{sr.style || "—"}</td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{sr.combo || "—"}</td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{sr.category}</td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{sr.season || "—"}</td>
                  <td className="px-4 py-3" title={sr.alternativeFabricRaw || undefined}>
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                        sr.fabricType === "Alternative"
                          ? "bg-purple-500/10 text-purple-300 border-purple-500/30"
                          : "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                      }`}
                    >
                      {sr.fabricType}
                    </span>
                  </td>
                  <td className="px-4 py-3" title={sr.secondAlternativeFabricRaw || undefined}>
                    {sr.secondFabricType ? (
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                          sr.secondFabricType === "Alternative"
                            ? "bg-purple-500/10 text-purple-300 border-purple-500/30"
                            : "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                        }`}
                      >
                        {sr.secondFabricType}
                      </span>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                    {sr.awrRaw ? formatDateDDMMYYYY(sr.awrRaw) || sr.awrRaw : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300" title={sr.awb1Raw || undefined}>
                    {sr.awb1DateIso ? (
                      formatDateDDMMYYYY(sr.awb1DateIso)
                    ) : sr.awb1Raw ? (
                      <span className="text-xs text-zinc-500">{sr.awb1Raw}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300" title={sr.awb2Raw || undefined}>
                    {sr.awb2DateIso ? (
                      formatDateDDMMYYYY(sr.awb2DateIso)
                    ) : sr.awb2Raw ? (
                      <span className="text-xs text-zinc-500">{sr.awb2Raw}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                    {sr.approvedRaw
                      ? formatDateDDMMYYYY(sr.approvedRaw) || sr.approvedRaw
                      : sr.approvedDateIso
                        ? formatDateDDMMYYYY(sr.approvedDateIso)
                        : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                    {sr.status === "dropped" ? (sr.dropDateIso ? formatDateDDMMYYYY(sr.dropDateIso) : "Dropped (date unknown)") : "—"}
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-10 text-center text-zinc-500 text-sm">
                    No rows match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between p-4 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
          <span>
            Showing {summaryRows.length === 0 ? 0 : clampedPage * pageSize + 1}
            {"–"}
            {Math.min(summaryRows.length, clampedPage * pageSize + pageSize)} of {summaryRows.length} items
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
              className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 disabled:opacity-40 font-semibold"
            >
              Previous
            </button>
            <span className="font-semibold">
              {clampedPage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={clampedPage >= totalPages - 1}
              className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 disabled:opacity-40 font-semibold"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
