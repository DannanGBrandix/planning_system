import React, { useState, useEffect } from "react";
import { EmbellishmentRow, ColumnMapping, hasBuy } from "../lib/db";
import { parseDhlTrackingItems, getDisplayStatus } from "./Table";
import { PLANNING_FLOWS, detectMatchingFlow, autoScheduleEmbellishmentRow } from "../lib/planningFlows";
import { EVENT_CODES } from "../lib/eventCodes";
import { extractValidDate } from "../lib/triggerUtils";

interface RowDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  row: EmbellishmentRow | null;
  columns: ColumnMapping;
  onUpdateRow?: (updatedRow: EmbellishmentRow) => void;
}

export default function RowDetailsModal({ isOpen, onClose, row, columns, onUpdateRow }: RowDetailsModalProps) {
  const [prevRow, setPrevRow] = useState<EmbellishmentRow | null>(row);
  const [editForm, setEditForm] = useState<EmbellishmentRow | null>(row);
  const [isSaving, setIsSaving] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const getEarliestDateKey = (r: EmbellishmentRow | null): string => {
    if (!r) return new Date().toISOString().split("T")[0];
    const dateKeys = Object.keys(r)
      .filter((k) => k.match(/^\d{4}-\d{2}-\d{2}$/) && Boolean(r[k]))
      .sort();
    if (dateKeys.length > 0) return dateKeys[0];
    if (r.col14 && typeof r.col14 === "string" && r.col14.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return r.col14;
    }
    return new Date().toISOString().split("T")[0];
  };

  const [selectedFlowId, setSelectedFlowId] = useState<number>(() => (row ? detectMatchingFlow(row).id : PLANNING_FLOWS[0].id));
  const [startDateStr, setStartDateStr] = useState<string>(() => getEarliestDateKey(row));
  const [eventSuffix, setEventSuffix] = useState<"S" | "F" | "T">("S");
  const [isScheduleApplied, setIsScheduleApplied] = useState<boolean>(false);

  if (row !== prevRow) {
    setPrevRow(row);
    if (row) {
      const syncedRow = { ...row };
      const computedStatus = getDisplayStatus(row);
      if (syncedRow.col1 !== computedStatus) {
        syncedRow.col1 = computedStatus;
      }
      setEditForm(syncedRow);
      const flow = detectMatchingFlow(row);
      setSelectedFlowId(flow.id);
      setStartDateStr(getEarliestDateKey(row));
    } else {
      setEditForm(null);
    }
  }

  if (!isOpen || !row) return null;

  const handleApplyAutoSchedule = () => {
    if (!onUpdateRow || !editForm) return;
    const updated = autoScheduleEmbellishmentRow(editForm, selectedFlowId, startDateStr, eventSuffix);
    setEditForm(updated as EmbellishmentRow);
    setIsScheduleApplied(true);
    setTimeout(() => setIsScheduleApplied(false), 3000);
  };

  const handleSave = async () => {
    if (!onUpdateRow || !editForm) return;
    if (!changeReason.trim()) {
      alert("Please provide a reason for the change before saving.");
      return;
    }
    setIsSaving(true);
    // Simulate slight loading delay for UX feeling of DB save
    await new Promise(resolve => setTimeout(resolve, 600));
    // Save the row's data exactly as edited. The auto-scheduler is NOT re-run here — per the
    // planner, editing a field (Plant, Fabric, Process, …) must never silently shift an existing
    // plan's dates. If the planner wants a fresh schedule they click "⚡ Auto-Schedule" above
    // (handleApplyAutoSchedule), which writes the new dates straight into editForm and they get
    // saved along with everything else.
    const scheduledRow: EmbellishmentRow = { ...editForm, change_reason: changeReason.trim() };

    onUpdateRow(scheduledRow as EmbellishmentRow);
    setIsSaving(false);
    onClose();
  };

  // Sort keys logically based on the numeric part of "colX". col49 ("2nd Submission Fabric") is
  // pinned right after col16 ("Alternative Fabric") instead of its real, much-higher column
  // number — otherwise it'd land at the very bottom of the form, far from the 1st-submission
  // fabric field it's meant to sit beside, and the planner would never find it.
  // col50 ("Fabric Dispatch Comment") is likewise pinned right after col23 ("Dispach Deadline").
  const colSortRank = (key: string): number =>
    key === "col49" ? 16.5 : key === "col50" ? 23.5 : parseInt(key.replace("col", "")) || 0;
  const sortedColKeys = Object.keys(columns).sort((a, b) => colSortRank(a) - colSortRank(b));

  // Strike-Off status helpers
  const comment1 = String(editForm?.col22 || "").trim();
  const comment2 = String(editForm?.col34 || "").trim();
  const latestComment = comment2 || comment1;
  const commentLower = latestComment.toLowerCase();
  // Approval is checked against BOTH comment columns independently — unlike isRejected/isResubmit
  // below, which intentionally only look at the latest comment so a newer verdict can supersede
  // an older one, an approval recorded on the 1st Strike-Off Comment shouldn't get masked just
  // because a 2nd Strike-Off Comment later shows up for an unrelated reason.
  const isApproved =
    comment1.toLowerCase().includes("approved") || comment1.toLowerCase().includes("approve") ||
    comment2.toLowerCase().includes("approved") || comment2.toLowerCase().includes("approve");
  const isRejected = commentLower.includes("reject");
  const isResubmit = commentLower.includes("resubmit") || commentLower.includes("resub");
  const submissionRound = String(editForm?.col35 || "").trim();
  const dhlTracking = String(editForm?.col24 || "").trim();

  const commentBadge = !latestComment
    ? { bg: "bg-zinc-100 dark:bg-zinc-800", text: "text-zinc-400 dark:text-zinc-500", dot: "bg-zinc-400", label: "No Comment" }
    : isApproved
    ? { bg: "bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500", label: "Approved" }
    : isRejected
    ? { bg: "bg-rose-500/10", text: "text-rose-700 dark:text-rose-400", dot: "bg-rose-500 animate-pulse", label: "Rejected" }
    : isResubmit
    ? { bg: "bg-orange-500/10", text: "text-orange-700 dark:text-orange-400", dot: "bg-orange-500", label: "Resubmit Needed" }
    : { bg: "bg-amber-500/10", text: "text-amber-700 dark:text-amber-400", dot: "bg-amber-500", label: "Pending Review" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-150 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
          <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit Row: {editForm?.col5 || "N/A"}
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={isSaving || !changeReason.trim()}
              title={!changeReason.trim() ? "Reason for change is required" : ""}
              className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-lg shadow-sm transition-all disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Save Changes
                </>
              )}
            </button>
            <button
              onClick={onClose}
              disabled={isSaving}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 bg-white dark:bg-zinc-950">

          {/* Change Reason Input */}
          <div className="mb-6">
            <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider block mb-2">
              Reason for Change <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              placeholder="e.g. Updated fabric in date, changed technique..."
              className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm rounded-lg px-3 py-2 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              required
            />
          </div>

          {/* Auto-Scheduler Engine Panel */}
          {onUpdateRow && (
            <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/20">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">⚡</span>
                  <span className="text-xs font-black text-amber-600 dark:text-amber-400 uppercase tracking-wider">Auto-Scheduler (Lead-Time Engine)</span>
                </div>
                {isScheduleApplied && (
                  <span className="text-xs font-bold text-emerald-500 animate-pulse">✓ All event dates auto-populated!</span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Process Flow Pathway</label>
                  <select
                    value={selectedFlowId}
                    onChange={(e) => setSelectedFlowId(Number(e.target.value))}
                    className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-bold rounded-lg px-2.5 py-2 text-zinc-800 dark:text-zinc-200 cursor-pointer"
                    title="Select the embellishment process pathway for lead-time auto-scheduling"
                  >
                    {PLANNING_FLOWS.map((f) => (
                      <option key={f.id} value={f.id}>
                        Flow {f.id}: {f.title} ({f.totalLeadTimeDays}d)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Start Event Date</label>
                  <input
                    type="date"
                    value={startDateStr}
                    onChange={(e) => setStartDateStr(e.target.value)}
                    className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-bold rounded-lg px-2.5 py-2 text-zinc-800 dark:text-zinc-200"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1" title="Suffix added to event codes: -S = Sign-Off (Approval), -F = Final Sign-Off, -T = Trials">
                      Suffix ℹ️
                    </label>
                    <select
                      value={eventSuffix}
                      onChange={(e) => setEventSuffix(e.target.value as "S" | "F" | "T")}
                      className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-bold rounded-lg px-2 py-2 text-zinc-800 dark:text-zinc-200 cursor-pointer"
                      title={
                        eventSuffix === "S"
                          ? "-S: Sign-Off (Standard Approval)"
                          : eventSuffix === "F"
                          ? "-F: Final Color Sign-Off"
                          : "-T: Trial Run / Submission"
                      }
                    >
                      <option value="S" title="-S: Sign-off (Standard internal/external approval)">-S (Sign-Off)</option>
                      <option value="F" title="-F: Actual color final sign-off">-F (Final S/Off)</option>
                      <option value="T" title="-T: Production trial submission">-T (Trials)</option>
                    </select>
                  </div>
                  <button
                    onClick={handleApplyAutoSchedule}
                    className="px-3.5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-extrabold text-xs rounded-lg shadow-md hover:scale-105 active:scale-95 transition-all whitespace-nowrap"
                  >
                    ⚡ Auto-Schedule
                  </button>
                </div>
              </div>

              {/* Interactive Event Pathway Sequence Badges with Hover Meanings */}
              {(() => {
                const currentFlow = PLANNING_FLOWS.find((f) => f.id === selectedFlowId);
                if (!currentFlow) return null;
                return (
                  <div className="mt-3 pt-3 border-t border-amber-500/20">
                    <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider block mb-1.5">
                      Pathway Steps Sequence (Hover over any event abbreviation to view full meaning):
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {currentFlow.sequence.map((code, idx) => {
                        const baseCode = code.split('/')[0];
                        const def = EVENT_CODES.find((e) => e.code === code || e.code === baseCode);
                        const fullTitle = def ? `${code}: ${def.description}` : `${code} Event Step`;
                        return (
                          <React.Fragment key={idx}>
                            {idx > 0 && <span className="text-zinc-400 text-[10px]">→</span>}
                            <span
                              title={fullTitle}
                              className="px-2 py-0.5 rounded bg-amber-500/10 dark:bg-amber-400/10 text-amber-800 dark:text-amber-300 border border-amber-500/30 font-mono text-[11px] font-bold cursor-help hover:bg-amber-500 hover:text-black dark:hover:bg-amber-400 transition-all"
                            >
                              {code}
                            </span>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Strike-Off Status Card */}
          {(dhlTracking || latestComment || submissionRound) && (
            <div className="mb-6 p-4 rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
                </svg>
                <span className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">Strike-Off Submission Status</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Submission Round */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Submission Round</span>
                  {submissionRound ? (
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-lg w-fit ${
                      submissionRound === "2nd"
                        ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border border-orange-300 dark:border-orange-700"
                        : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-700"
                    }`}>
                      {submissionRound} Submission
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400 italic">Not set</span>
                  )}
                </div>
                {/* DHL Tracking */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">DHL Tracking #</span>
                  {dhlTracking ? (
                    <div className="flex flex-col gap-1.5 max-w-[320px]">
                      {parseDhlTrackingItems(dhlTracking).map((item, idx) => (
                        <div key={idx} className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 flex items-center gap-1.5 whitespace-normal break-words shadow-2xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-400 italic">No tracking number</span>
                  )}
                </div>
                {/* Comment / Status */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Strike-Off Decision</span>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg w-fit flex items-center gap-1.5 ${commentBadge.bg} ${commentBadge.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${commentBadge.dot}`} />
                    {commentBadge.label}
                  </span>
                </div>
              </div>
              {/* Full comment text */}
              {(comment1 || comment2) && (
                <div className="mt-4 pt-4 border-t border-blue-200 dark:border-blue-900/50 flex flex-col gap-2.5">
                  <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block mb-0.5">Full Comments</span>
                  {comment2 && (
                    <div className="flex items-start gap-2 bg-purple-50 dark:bg-purple-950/20 p-2.5 rounded-lg border border-purple-100 dark:border-purple-900/30">
                      <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/50 px-1.5 py-0.5 rounded shrink-0">2nd S/O</span>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">{comment2}</p>
                    </div>
                  )}
                  {comment1 && (
                    <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-950/20 p-2.5 rounded-lg border border-blue-100 dark:border-blue-900/30">
                      <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 px-1.5 py-0.5 rounded shrink-0">1st S/O</span>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">{comment1}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* All Fields Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            {sortedColKeys.map((key) => (
              <div key={key} className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                  {columns[key]}
                </span>
                {key === "col1" ? (
                  <select
                    value={editForm?.[key] == null ? "Pending" : String(editForm[key])}
                    onChange={(e) => setEditForm(prev => prev ? { ...prev, [key]: e.target.value } : null)}
                    className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm font-semibold rounded-lg px-3 py-2.5 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all shadow-sm cursor-pointer"
                  >
                    <option value="Active">Active</option>
                    <option value="Approved">Approved</option>
                    <option value="Dropped">Dropped</option>
                    <option value="Pending">Pending</option>
                    <option value="Resubmit Needed">Resubmit Needed</option>
                  </select>
                ) : key === "col37" ? (
                  <select
                    value={editForm?.[key] == null ? "" : String(editForm[key])}
                    onChange={(e) => setEditForm(prev => prev ? { ...prev, [key]: e.target.value } : null)}
                    className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm font-semibold rounded-lg px-3 py-2.5 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all shadow-sm cursor-pointer"
                  >
                    <option value="">—</option>
                    <option value="1">1st Submission</option>
                    <option value="2">2nd Submission</option>
                    <option value="3">3rd Submission</option>
                    <option value="4">4th Submission</option>
                    <option value="5">5th Submission</option>
                  </select>
                ) : key === "col40" || key === "col41" || key === "col42" ? (
                  <select
                    value={editForm?.[key] == null ? "" : String(editForm[key])}
                    onChange={(e) => setEditForm(prev => prev ? { ...prev, [key]: e.target.value } : null)}
                    className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm font-semibold rounded-lg px-3 py-2.5 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all shadow-sm cursor-pointer"
                  >
                    <option value="">Pending</option>
                    <option value="Y">✓ Approved</option>
                    <option value="N">✗ Not Approved</option>
                  </select>
                ) : key === "col48" ? (
                  <select
                    value={editForm && hasBuy(editForm as EmbellishmentRow) ? "Y" : "N"}
                    onChange={(e) => setEditForm(prev => prev ? { ...prev, [key]: e.target.value } : null)}
                    className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm font-semibold rounded-lg px-3 py-2.5 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all shadow-sm cursor-pointer"
                  >
                    <option value="N">✗ No Buy</option>
                    <option value="Y">✓ Has Buy</option>
                  </select>
                ) : (
                  <input
                    type={key.match(/col(14|20|23|36|38|39)$/) ? "date" : "text"}
                    value={
                      // col20 (AOQ) sometimes carries a status word instead of a date ("Approved",
                      // "Dropped", "C+P" — see triggerUtils.extractValidDate) — a native date input
                      // can't display that, so show it blank rather than an invalid/garbled value.
                      // Leaving it untouched (no onChange fired) keeps that original text on save;
                      // picking a date here overwrites it with a clean ISO date, same as the
                      // Dashboard table's own col20 cell editor already does.
                      key === "col20"
                        ? extractValidDate(editForm?.[key]) || ""
                        : editForm?.[key] == null ? "" : String(editForm[key])
                    }
                    onChange={(e) => setEditForm(prev => prev ? { ...prev, [key]: e.target.value } : null)}
                    className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm font-semibold rounded-lg px-3 py-2.5 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all shadow-sm"
                    placeholder={`Enter ${columns[key]}`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


