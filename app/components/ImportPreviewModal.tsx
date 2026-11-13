import React, { useState, useMemo } from "react";
import { EmbellishmentRow } from "../lib/db";

export interface FieldDiff {
  key: string;
  label: string;
  oldVal: string;
  newVal: string;
}

export interface ParsedImportItem {
  mergedRow: EmbellishmentRow;
  // "skipped" = a row that matched nothing in the database and was NOT created because the
  // import ran in "Only update existing rows" mode. Shown in the preview (so the planner can
  // see exactly what was left out) but never written.
  matchType: "tracking" | "style" | "new" | "unchanged" | "skipped";
  // Set when a row is skipped for a reason other than update-only mode — e.g. the chart says
  // it was shifted to another chart / vendor ("PLEASE SHIFT TO ICON SHOP CHART").
  skipReason?: string;
  trackingNo?: string;
  styleCode?: string;
  graphic?: string;
  combo?: string;
}

// Parses the JSON list of field-level changes attached to a merged row during
// import matching (see handleImportExcel in app/page.tsx) so we can render
// every PATCH-worthy change, not just a single raw diff string.
function getFieldDiffs(row: EmbellishmentRow): FieldDiff[] {
  const raw = (row as Record<string, unknown>).__diffsJson;
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FieldDiff[]) : [];
  } catch {
    return [];
  }
}

function formatDiffValue(v: string): string {
  const trimmed = (v || "").trim();
  return trimmed === "" ? "(empty)" : trimmed;
}

interface ImportPreviewModalProps {
  isOpen: boolean;
  fileName: string;
  parsedItems: ParsedImportItem[];
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isImporting: boolean;
}

export default function ImportPreviewModal({
  isOpen,
  fileName,
  parsedItems,
  onClose,
  onConfirm,
  isImporting,
}: ImportPreviewModalProps) {
  const [activeTab, setActiveTab] = useState<"all" | "updates" | "new" | "unchanged" | "skipped">("all");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  // Large legacy-file imports can carry thousands of parsed rows. Rendering all of them into
  // the DOM at once (previously: filteredItems.map(...) with no limit) froze the tab before the
  // Confirm button ever became reachable. Paginate the preview the same way the main dashboard
  // table already does — this only affects what's ON SCREEN; Confirm & Sync still writes every
  // parsed item, not just the current page.
  const PAGE_SIZE = 100;
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState(false);

  const toggleExpanded = (idx: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const summary = useMemo(() => {
    let trackingMatches = 0;
    let styleMatches = 0;
    let newItems = 0;
    let unchangedMatches = 0;
    let skippedCount = 0;
    let shiftedOutCount = 0;
    let dhlCount = 0;
    let droppedCount = 0;
    let strikeOffCount = 0;

    parsedItems.forEach((item) => {
      if (item.matchType === "tracking") trackingMatches++;
      else if (item.matchType === "style") styleMatches++;
      else if (item.matchType === "unchanged") unchangedMatches++;
      else if (item.matchType === "skipped") {
        skippedCount++;
        if (item.skipReason) shiftedOutCount++;
      }
      else newItems++;

      const r = item.mergedRow;
      if (r.col24 && String(r.col24).trim() !== "") {
        dhlCount++;
      }
      
      const c1 = (String(String(String(String(r.col1 || ""))))).trim().toUpperCase();
      if (c1 === 'D' || c1 === 'DROPPED' || c1.includes('DROPPED') || c1.includes('REALLOCATED')) {
        droppedCount++;
      }

      const comment1 = (String(String(String(String(r.col34 || ""))))).trim();
      const comment2 = (String(String(String(String(r.col22 || ""))))).trim();
      if (comment1 !== "" || comment2 !== "") {
        strikeOffCount++;
      }
    });

    return {
      total: parsedItems.length,
      trackingMatches,
      styleMatches,
      unchangedMatches,
      skippedCount,
      shiftedOutCount,
      writable: parsedItems.length - skippedCount,
      totalUpdates: trackingMatches + styleMatches,
      newItems,
      dhlCount,
      droppedCount,
      activeCount: parsedItems.length - droppedCount,
      strikeOffCount
    };
  }, [parsedItems]);

  const filteredItems = useMemo(() => {
    if (activeTab === "updates") {
      return parsedItems.filter((i) => i.matchType === "tracking" || i.matchType === "style");
    }
    if (activeTab === "new") {
      return parsedItems.filter((i) => i.matchType === "new");
    }
    if (activeTab === "unchanged") {
      return parsedItems.filter((i) => i.matchType === "unchanged");
    }
    if (activeTab === "skipped") {
      return parsedItems.filter((i) => i.matchType === "skipped");
    }
    return parsedItems;
  }, [parsedItems, activeTab]);

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  // Clamp instead of storing directly — switching tabs can leave `page` past the end of a
  // smaller filtered list without needing a separate effect to reset it.
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pagedItems = filteredItems.slice(pageStart, pageStart + PAGE_SIZE);

  const changeTab = (tab: "all" | "updates" | "new" | "unchanged" | "skipped") => {
    setActiveTab(tab);
    setPage(1);
  };

  // Copy the currently-shown tab (every row in it, not just the visible page) as TSV so it
  // can be pasted straight into Excel / an email — e.g. "New Records" tab = the exact list of
  // items this import will create, with their colour, style, plant, combo and technique.
  const copyList = async () => {
    const header = ["Style", "Graphic", "Combo", "Color / Ground", "Plant", "Technique", "Status"];
    const statusLabel: Record<string, string> = {
      tracking: "Matched (tracking #)",
      style: "Update existing",
      new: "NEW — will be created",
      unchanged: "Unchanged",
      skipped: "SKIPPED — not in database (update-only mode)",
    };
    const lines = filteredItems.map((item) => {
      const r = item.mergedRow;
      return [
        item.styleCode || r.col5 || "",
        item.graphic || r.col7 || "",
        item.combo || r.col6 || "",
        String(r.col8 || "").replace(/\s+/g, " ").trim(),
        String(r.col11 || "").replace(/\s+/g, " ").trim(),
        String(r.col9 || "").replace(/\s+/g, " ").trim(),
        statusLabel[item.matchType] || item.matchType,
      ].join("\t");
    });
    try {
      await navigator.clipboard.writeText([header.join("\t"), ...lines].join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-6xl max-h-[90vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-zinc-150 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                CSV Data Import Analysis
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-mono">
                  {fileName}
                </span>
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Review data matching results and tracking column alignments before syncing with the database.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isImporting}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Summary Badges */}
        <div className="px-6 py-4 border-b border-zinc-150 dark:border-zinc-800 bg-zinc-100/50 dark:bg-zinc-950/40 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 text-xs">
          <div className="bg-white dark:bg-zinc-900 p-2.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
            <span className="text-zinc-500 dark:text-zinc-400 font-medium">Total Rows</span>
            <span className="text-lg font-black text-zinc-900 dark:text-white mt-1 font-mono">{summary.total}</span>
          </div>

          <div className="bg-emerald-50 dark:bg-emerald-950/20 p-2.5 rounded-xl border border-emerald-200/60 dark:border-emerald-800/40 shadow-sm flex flex-col justify-between">
            <span className="text-emerald-700 dark:text-emerald-400 font-medium leading-tight">Matched Tracking</span>
            <span className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
              {summary.trackingMatches}
            </span>
          </div>

          <div className="bg-amber-50 dark:bg-amber-950/20 p-2.5 rounded-xl border border-amber-200/60 dark:border-amber-800/40 shadow-sm flex flex-col justify-between">
            <span className="text-amber-700 dark:text-amber-400 font-medium leading-tight">Matched Style</span>
            <span className="text-lg font-black text-amber-600 dark:text-amber-400 mt-1 font-mono">
              {summary.styleMatches}
            </span>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/20 p-2.5 rounded-xl border border-blue-200/60 dark:border-blue-800/40 shadow-sm flex flex-col justify-between">
            <span className="text-blue-700 dark:text-blue-400 font-medium leading-tight">New Items</span>
            <span className="text-lg font-black text-blue-600 dark:text-blue-400 mt-1 font-mono">
              {summary.newItems}
            </span>
          </div>

          <div className="bg-indigo-50 dark:bg-indigo-950/20 p-2.5 rounded-xl border border-indigo-200/60 dark:border-indigo-800/40 shadow-sm flex flex-col justify-between">
            <span className="text-indigo-700 dark:text-indigo-400 font-medium leading-tight">DHL Coming</span>
            <span className="text-lg font-black text-indigo-600 dark:text-indigo-400 mt-1 font-mono">
              {summary.dhlCount}
            </span>
          </div>

          <div className="bg-emerald-50 dark:bg-emerald-950/20 p-2.5 rounded-xl border border-emerald-200/60 dark:border-emerald-800/40 shadow-sm flex flex-col justify-between">
            <span className="text-emerald-700 dark:text-emerald-400 font-medium leading-tight">Active</span>
            <span className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
              {summary.activeCount}
            </span>
          </div>

          <div className="bg-rose-50 dark:bg-rose-950/20 p-2.5 rounded-xl border border-rose-200/60 dark:border-rose-800/40 shadow-sm flex flex-col justify-between">
            <span className="text-rose-700 dark:text-rose-400 font-medium leading-tight">Dropped</span>
            <span className="text-lg font-black text-rose-600 dark:text-rose-400 mt-1 font-mono">
              {summary.droppedCount}
            </span>
          </div>

          <div className="bg-purple-50 dark:bg-purple-950/20 p-2.5 rounded-xl border border-purple-200/60 dark:border-purple-800/40 shadow-sm flex flex-col justify-between">
            <span className="text-purple-700 dark:text-purple-400 font-medium leading-tight">Strike Comments</span>
            <span className="text-lg font-black text-purple-600 dark:text-purple-400 mt-1 font-mono">
              {summary.strikeOffCount}
            </span>
          </div>

          {summary.skippedCount > 0 && (
            <div className="bg-orange-50 dark:bg-orange-950/20 p-2.5 rounded-xl border border-orange-300/70 dark:border-orange-700/50 shadow-sm flex flex-col justify-between">
              <span className="text-orange-700 dark:text-orange-400 font-medium leading-tight">Skipped</span>
              <span className="text-lg font-black text-orange-600 dark:text-orange-400 mt-1 font-mono">
                {summary.skippedCount}
              </span>
            </div>
          )}
        </div>

        {summary.shiftedOutCount > 0 && (
          <div className="mx-6 mt-3 px-3.5 py-2.5 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-300/70 dark:border-orange-700/50 text-[11px] text-orange-800 dark:text-orange-300 leading-snug">
            <strong>{summary.shiftedOutCount} row{summary.shiftedOutCount === 1 ? "" : "s"}</strong> are
            marked in the chart as shifted to another chart / vendor (e.g. &ldquo;PLEASE SHIFT TO ICON SHOP
            CHART&rdquo;, &ldquo;MOVE TO HANSOLL&rdquo;) and were <strong>ignored</strong> — not created, not updated.
          </div>
        )}
        {summary.skippedCount - summary.shiftedOutCount > 0 && (
          <div className="mx-6 mt-3 px-3.5 py-2.5 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-300/70 dark:border-orange-700/50 text-[11px] text-orange-800 dark:text-orange-300 leading-snug">
            <strong>{summary.skippedCount - summary.shiftedOutCount} row{summary.skippedCount - summary.shiftedOutCount === 1 ? "" : "s"}</strong> in
            this file don&apos;t match any existing item and were <strong>not created</strong>{" "}
            because this import is running in <em>&ldquo;Only update existing rows&rdquo;</em> mode.
            See the <strong>Skipped</strong> tab for the list. To create them, re-import through
            the <strong>Import Excel</strong> button with that option unchecked.
          </div>
        )}

        {/* Filter Tabs */}
        <div className="px-6 pt-3 flex items-center gap-2 border-b border-zinc-150 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="flex items-center gap-2 flex-1">
          <button
            onClick={() => changeTab("all")}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "all"
                ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            All Items ({parsedItems.length})
          </button>
          <button
            onClick={() => changeTab("updates")}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "updates"
                ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            Updates / Merges ({summary.totalUpdates})
          </button>
          <button
            onClick={() => changeTab("new")}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "new"
                ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            New Records ({summary.newItems})
          </button>
          <button
            onClick={() => changeTab("unchanged")}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "unchanged"
                ? "border-zinc-500 text-zinc-600 dark:text-zinc-400"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            Unchanged ({summary.unchangedMatches})
          </button>
          {summary.skippedCount > 0 && (
            <button
              onClick={() => changeTab("skipped")}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === "skipped"
                  ? "border-orange-500 text-orange-600 dark:text-orange-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              Skipped ({summary.skippedCount})
            </button>
          )}
          </div>
          <button
            onClick={copyList}
            disabled={filteredItems.length === 0}
            title="Copy this list (Style, Graphic, Combo, Color, Plant, Technique) as a table you can paste into Excel or an email"
            className="shrink-0 mb-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {copied ? "Copied ✓" : `Copy ${activeTab === "new" ? "new items" : "list"}`}
          </button>
        </div>

        {/* Parsed Rows Table */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-x-auto shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">Style</th>
                  <th className="py-2.5 px-3">Graphic</th>
                  <th className="py-2.5 px-3">Combo</th>
                  <th className="py-2.5 px-3">Color / Ground</th>
                  <th className="py-2.5 px-3">Plant</th>
                  <th className="py-2.5 px-3">Technique</th>
                  <th className="py-2.5 px-3">Action Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-mono">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-zinc-400 dark:text-zinc-500 font-sans">
                      No records match the selected tab.
                    </td>
                  </tr>
                ) : (
                  pagedItems.map((item, i) => {
                    const idx = pageStart + i;
                    const row = item.mergedRow;
                    const style = item.styleCode || row.col5 || "-";
                    const graphic = item.graphic || row.col7 || "-";
                    const combo = item.combo || row.col6 || "-";
                    const ground = String(row.col8 || "").trim() || "-";
                    const plant = String(row.col11 || "").trim() || "-";
                    const technique = String(row.col9 || "").trim() || "-";
                    const diffs = getFieldDiffs(row);
                    const isExpanded = expandedRows.has(idx);

                    return (
                      <React.Fragment key={idx}>
                        <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors align-top">
                          <td className="py-2 px-3 text-zinc-400 text-[11px] font-sans">{idx + 1}</td>
                          <td className="py-2 px-3 font-bold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                            {style}
                          </td>
                          <td className="py-2 px-3 text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                            {graphic}
                          </td>
                          <td className="py-2 px-3 text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                            {combo}
                          </td>
                          <td className="py-2 px-3 text-zinc-600 dark:text-zinc-300 max-w-[160px] break-words" title={ground}>
                            {ground}
                          </td>
                          <td className="py-2 px-3 text-zinc-600 dark:text-zinc-300 max-w-[120px] break-words" title={plant}>
                            {plant}
                          </td>
                          <td className="py-2 px-3 text-zinc-500 dark:text-zinc-400 max-w-[180px] break-words" title={technique}>
                            {technique}
                          </td>
                          <td className="py-2 px-3 font-sans">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {item.matchType === "tracking" && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  Matched by Tracking #
                                </span>
                              )}
                              {item.matchType === "style" && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                  {diffs.length > 0 ? "Will Update (PATCH)" : "Updates Existing Record"}
                                </span>
                              )}
                              {item.matchType === "new" && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/30">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                  New Record (POST)
                                </span>
                              )}
                              {item.matchType === "unchanged" && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/30">
                                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                                  Unchanged (Skipped)
                                </span>
                              )}
                              {item.matchType === "skipped" && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-orange-500/10 text-orange-700 dark:text-orange-400 border border-orange-500/40">
                                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                                  {item.skipReason ? `Shifted out — ${item.skipReason}` : "Not in DB — not created"}
                                </span>
                              )}

                              {diffs.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(idx)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
                                >
                                  {diffs.length} field{diffs.length === 1 ? "" : "s"} changing
                                  <svg
                                    className={`w-2.5 h-2.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={3}
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && diffs.length > 0 && (
                          <tr className="bg-red-50/40 dark:bg-red-950/10">
                            <td colSpan={8} className="px-3 pb-3 pt-0 font-sans">
                              <div className="ml-8 border border-red-200/70 dark:border-red-900/40 rounded-lg overflow-hidden">
                                <table className="w-full text-[11px]">
                                  <thead className="bg-red-100/60 dark:bg-red-950/30 text-red-700 dark:text-red-400 uppercase text-[9px] tracking-wide">
                                    <tr>
                                      <th className="text-left py-1.5 px-2.5 font-bold">Field</th>
                                      <th className="text-left py-1.5 px-2.5 font-bold">Current Value</th>
                                      <th className="text-left py-1.5 px-2.5 font-bold">New Value</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-red-200/50 dark:divide-red-900/30">
                                    {diffs.map((d) => (
                                      <tr key={d.key}>
                                        <td className="py-1.5 px-2.5 font-semibold text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                                          {d.label}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-zinc-500 dark:text-zinc-400 line-through decoration-red-400/60 break-words">
                                          {formatDiffValue(d.oldVal)}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-emerald-700 dark:text-emerald-400 font-semibold break-words">
                                          {formatDiffValue(d.newVal)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {filteredItems.length > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-3 px-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span>
                Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filteredItems.length)} of {filteredItems.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="px-3 py-1.5 font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                  Page {safePage} of {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={safePage >= pageCount}
                  className="px-3 py-1.5 font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-zinc-150 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center justify-between">
          <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
            <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>Auto-backup of current database will be saved before importing.</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={isImporting}
              className="px-4 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-350 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-xl transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isImporting}
              className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400 rounded-xl shadow-lg shadow-emerald-500/20 transition-all active:scale-[0.98] flex items-center gap-2 disabled:opacity-50"
            >
              {isImporting ? (
                <>
                  <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Importing Data...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Confirm & Sync {summary.writable} Rows
                  {summary.skippedCount > 0 && (
                    <span className="font-semibold opacity-80"> ({summary.skippedCount} skipped)</span>
                  )}
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
