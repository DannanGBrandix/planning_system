import React, { useMemo, useState } from "react";
import { EmbellishmentRow, getRowStatus, isRowSent, groupRowsByCombo, getGroupStatus } from "../lib/db";
import ComboListModal from "./ComboListModal";

interface DashboardStatsProps {
  rows: EmbellishmentRow[];
}

export default function DashboardStats({ rows }: DashboardStatsProps) {
  // 1. Total imported styles in plan (pre-drop — matches Advanced Analytics "Total Items")
  const totalStyles = rows.length;

  const droppedRows = rows.filter((row) => getRowStatus(row) === "dropped").length;
  // Held items (CK "H" — CROSS DEVELOPMENT) are paused, not a live submission — exclude them from
  // "active" and from "Submission Pending" the same way dropped items are excluded.
  const holdRows = rows.filter((row) => getRowStatus(row) === "hold").length;
  const activeRows = Math.max(0, rows.length - droppedRows - holdRows);

  // 2. Fabric In House (Fabric ready to send to plant)
  const fabricInHouse = rows.filter((row) => {
    return (!!row.col14 && String(String(String(String(row.col14 || "")))).trim() !== "" && row.col14 !== "N/A" && row.col14 !== "PENDING") ||
           (typeof row.col32 === "string" && String(String(String(String(row.col32 || "")))).trim().toUpperCase() === "IH");
  }).length;

  // 3. S/OFF Completed by Plant (3-Day SLA Target met)
  const soffCompleted = rows.filter((row) => {
    return (!!row.col28 && String(String(String(String(row.col28 || "")))).trim() !== "") || (!!row.col23 && String(String(String(String(row.col23 || "")))).trim() !== "");
  }).length;

  // 4. Dispatched to USA via DHL — shares isRowSent()/getRowStatus() with Advanced Analytics
  //    and the Table Status column so this number never drifts from what those show.
  const dhlDispatched = rows.filter((row) => isRowSent(row)).length;

  // 5. Submission Pending — active combos whose strike-off has NOT gone to NY yet.
  //    Grouped into combos (Style|Graphic|Combo|Ground) and classified with the
  //    shared getGroupStatus so this equals the Advanced Analytics "Submission
  //    Pending" tile for the same Category/Season filter (Advanced drops col19 =
  //    "branding" rows — logo/care-label brandings, not graphic developments — so
  //    match that here). VS/PINK: a combo counts only while it has no DHL number
  //    and both Strike-Off Comment columns are blank; once sent (but not yet
  //    signed off) it moves to Comments Pending. CK: straight from its SP code.
  const submissionPendingCombos = useMemo(
    () =>
      groupRowsByCombo(
        rows.filter((r) => !String(r.col19 || "").toLowerCase().includes("branding")),
      ).filter((g) => getGroupStatus(g) === "pending"),
    [rows],
  );
  const submissionPending = submissionPendingCombos.length;

  // Submission-pending drill-down: one representative row per submission-pending combo —
  // VS/PINK (no DHL number, both Strike-Off Comment columns blank) AND CK-family combos
  // still on their SP code. Surfaced by the "View list" button on the Submission Pending card.
  const [showPendingList, setShowPendingList] = useState(false);
  const pendingListRows = useMemo(
    () =>
      submissionPendingCombos
        .map((g) => g[0])
        .sort((a, b) => {
          const ga = String(a.col7 || ""), gb = String(b.col7 || "");
          return ga !== gb
            ? ga.localeCompare(gb)
            : String(a.col6 || "").localeCompare(String(b.col6 || ""));
        }),
    [submissionPendingCombos],
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
      {/* 1. Total Styles */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden group">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Total Styles</span>
          <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </span>
        </div>
        <div className="mt-3">
          <h3 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{totalStyles}</h3>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            Step 1: Graphics & Plan Imported
          </p>
        </div>
      </div>

      {/* 2. Fabric In House (Ready for Plant) */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden group">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Fabric In House (IH)</span>
          <span className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </span>
        </div>
        <div className="mt-3">
          <h3 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{fabricInHouse}</h3>
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
            Step 2: Dispatch Fabric to Plant
          </p>
        </div>
      </div>

      {/* 3. S/OFF Completed */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden group">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Plant S/OFF Done</span>
          <span className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
        </div>
        <div className="mt-3">
          <h3 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{soffCompleted}</h3>
          <p className="text-[11px] text-purple-600 dark:text-purple-400 mt-1 flex items-center gap-1 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            Step 4: Plant S/OFF Done & Sent to HQ
          </p>
        </div>
      </div>

      {/* 4. Sent to USA via DHL */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden group">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">HQ Dispatched to USA</span>
          <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </span>
        </div>
        <div className="mt-3">
          <h3 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{dhlDispatched}</h3>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Step 5: Sent by HQ via NY Tracking
          </p>
        </div>
      </div>

      {/* 5. Submission Pending (active combos with no approval verdict yet) */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden group">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Submission Pending</span>
          <span className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
        </div>
        <div className="mt-3">
          <h3 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{submissionPending}</h3>
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Strike-off not yet sent to NY ({activeRows} active rows, excl. {droppedRows} dropped{holdRows > 0 ? `, ${holdRows} hold` : ""})
          </p>
          <button
            type="button"
            onClick={() => setShowPendingList(true)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800/60 rounded-lg px-2 py-1 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
            </svg>
            View list ({pendingListRows.length})
          </button>
        </div>
      </div>

      {showPendingList && (
        <ComboListModal
          title={"Submission Pending"}
          subtitle={`${pendingListRows.length} combo${pendingListRows.length === 1 ? "" : "s"} not yet sent to NY — VS & PINK (no DHL number, no strike-off comment) plus CK-family still on their SP code`}
          rows={pendingListRows}
          onClose={() => setShowPendingList(false)}
        />
      )}
    </div>
  );
}
