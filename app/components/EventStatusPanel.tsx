"use client";
import React, { useState, useRef, useEffect } from "react";
import {
  parseEventValue,
  encodeEventValue,
  getActiveReasonCodes,
  getReasonByCode,
  getGroupedReasonsForEvent,
  RESPONSIBLE_PARTIES,
  EVENT_CODES,
  type ParsedEvent,
} from "../lib/eventCodes";

interface EventStatusPanelProps {
  isOpen: boolean;
  onClose: () => void;
  rowId: string;
  dateKey: string;
  dateLabel: string;
  rawValue: string;
  plant: string;
  style?: string;
  graphic?: string;
  // For an empty cell: the flow's next milestone with no date yet, pre-selected so a planner
  // re-placing a just-deleted event only has to pick the day and hit Save.
  suggestedCode?: string;
  onSave: (rowId: string, dateKey: string, newValue: string) => void | Promise<void>;
  // Every planning pathway valid for this row's category (FABRICS has 4, etc.). Shown as a picker
  // so the planner can drop a whole flow starting on the clicked date instead of one event.
  applicableFlows?: { id: number; title: string; description: string; sequence: string[]; totalLeadTimeDays: number }[];
  onApplyFlow?: (rowId: string, dateKey: string, flowId: number) => void | Promise<void>;
}

export default function EventStatusPanel({
  isOpen,
  onClose,
  rowId,
  dateKey,
  dateLabel,
  rawValue,
  plant,
  style,
  graphic,
  suggestedCode,
  onSave,
  applicableFlows,
  onApplyFlow,
}: EventStatusPanelProps) {
  const parsed = parseEventValue(rawValue);
  const [flowPickerOpen, setFlowPickerOpen] = useState(false);
  // Only a plain "YYYY-MM-DD" cell can seed a whole flow; a per-plant leg cell
  // ("2026-09-01_LEEMA") is replanned from its own ⌫ control instead.
  const plainDate = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : "";
  const canApplyFlow = Boolean(onApplyFlow) && Boolean(plainDate) && (applicableFlows?.length ?? 0) > 0;

  const [eventCode, setEventCode] = useState(parsed?.code || suggestedCode || "");
  const [status, setStatus] = useState<"planned" | "pass" | "fail">(parsed?.status || "planned");
  const [reasonCode, setReasonCode] = useState(parsed?.reasonCode || "");
  const [reasonSearch, setReasonSearch] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [saving, setSaving] = useState(false);
  // Native <select> popups are OS-rendered chrome — no custom search box can ever appear inside
  // one, so a search input placed above it (the old approach) only pre-filters before you open
  // it, not while you're actually scrolling the open list. Replacing it with this custom
  // dropdown keeps the search box and the results in the same control.
  const [isReasonOpen, setIsReasonOpen] = useState(false);
  const reasonBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isReasonOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (reasonBoxRef.current && !reasonBoxRef.current.contains(e.target as Node)) {
        setIsReasonOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isReasonOpen]);

  // Sync state when panel opens or props change during render to prevent cascading renders
  const [prevSyncKey, setPrevSyncKey] = useState("");
  const currentSyncKey = `${isOpen ? "open" : "closed"}:${rowId}:${dateKey}:${rawValue}:${suggestedCode || ""}`;

  if (prevSyncKey !== currentSyncKey) {
    setPrevSyncKey(currentSyncKey);
    if (isOpen) {
      const p = parseEventValue(rawValue);
      setEventCode(p?.code || suggestedCode || "");
      setStatus(p?.status || "planned");
      setReasonCode(p?.reasonCode || "");
      setReasonSearch("");
      setReasonError(false);
      setFlowPickerOpen(false);
    }
  }

  const activeReasons = getActiveReasonCodes();
  const selectedReason = reasonCode ? getReasonByCode(reasonCode) : null;

  const handleSave = async () => {
    // Validate: red requires reason
    if (status === "fail" && !reasonCode) {
      setReasonError(true);
      return;
    }
    setSaving(true);
    // A planner placing a "planned" milestone by hand means "this event belongs on THIS day" —
    // lock it (|X) so the auto-scheduler / load-time heal can't shift it to another date on the
    // next reload. Pass/Fail verdicts are already immovable and don't need the marker.
    const encoded = encodeEventValue(eventCode, status, reasonCode, status === "planned");
    try {
      await onSave(rowId, dateKey, encoded);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
      onClose();
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await onSave(rowId, dateKey, "");
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
      onClose();
    }
  };

  const handleApplyFlow = async (flowId: number, flowTitle: string) => {
    if (!onApplyFlow || !plainDate) return;
    if (
      !window.confirm(
        `Schedule the "${flowTitle}" flow starting ${dateLabel}?\n\n` +
          `Events already planned before this date are kept — this only builds the plan from ${dateLabel} onward.`,
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      await onApplyFlow(rowId, plainDate, flowId);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
      onClose();
    }
  };

  if (!isOpen) return null;

  const statusConfig = {
    planned: {
      label: "Planned",
      bg: "bg-zinc-800",
      border: "border-zinc-600",
      text: "text-zinc-200",
      dot: "bg-zinc-400",
      ring: "ring-zinc-500",
    },
    pass: {
      label: "Pass ✓",
      bg: "bg-emerald-950",
      border: "border-emerald-500",
      text: "text-emerald-300",
      dot: "bg-emerald-400",
      ring: "ring-emerald-500",
    },
    fail: {
      label: "Fail ✗",
      bg: "bg-red-950",
      border: "border-red-500",
      text: "text-red-300",
      dot: "bg-red-500",
      ring: "ring-red-500",
    },
  };

  const cfg = statusConfig[status];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Side Panel */}
      <div className="fixed right-0 top-0 h-full w-[420px] bg-[#0f1115] border-l border-zinc-800 shadow-2xl z-50 flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className={`p-5 border-b border-zinc-800 ${cfg.bg} transition-colors duration-300`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot} shadow-lg`} />
              <span className={`text-xs font-black uppercase tracking-widest ${cfg.text}`}>
                Event Status
              </span>
            </div>
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-200 transition-colors p-1 rounded-lg hover:bg-zinc-800"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Context info */}
          <div className="flex flex-wrap gap-2 mt-1">
            <span className="px-2 py-0.5 rounded bg-zinc-900/80 border border-zinc-700 text-zinc-300 text-[11px] font-bold">
              📅 {dateLabel}
            </span>
            {plant && (
              <span className="px-2 py-0.5 rounded bg-zinc-900/80 border border-zinc-700 text-blue-300 text-[11px] font-bold">
                🏭 {plant}
              </span>
            )}
            {style && (
              <span className="px-2 py-0.5 rounded bg-zinc-900/80 border border-zinc-700 text-zinc-400 text-[10px]">
                {style}
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-6">

          {/* Apply a whole planning flow from this date */}
          {canApplyFlow && (
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/5">
              <button
                type="button"
                onClick={() => setFlowPickerOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3.5 py-2.5"
              >
                <span className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-sky-300">
                  <span>🗂</span> Apply a planning flow from {dateLabel}
                </span>
                <span className={`text-sky-400 text-xs transition-transform ${flowPickerOpen ? "rotate-180" : ""}`}>▾</span>
              </button>
              {flowPickerOpen && (
                <div className="px-3.5 pb-3.5 flex flex-col gap-2">
                  <p className="text-[10px] text-zinc-500 leading-relaxed">
                    Pick which pathway to schedule. It builds from {dateLabel} onward; anything
                    already planned before that date is kept.
                  </p>
                  {applicableFlows!.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      disabled={saving}
                      onClick={() => handleApplyFlow(f.id, f.title)}
                      className="text-left px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:border-sky-500/60 hover:bg-sky-500/10 transition-colors disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-zinc-200">{f.title}</span>
                        <span className="text-[10px] font-bold text-sky-300 shrink-0">{f.totalLeadTimeDays}d</span>
                      </div>
                      <div className="mt-1 text-[10px] text-zinc-500 font-mono truncate">
                        {f.sequence.join(" → ")}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Event Code Selector */}
          <div>
            <label className="block text-xs font-black text-zinc-400 uppercase tracking-widest mb-2">
              Event Code
            </label>
            <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-1">
              {EVENT_CODES.map(e => (
                <button
                  key={e.code}
                  onClick={() => setEventCode(e.code)}
                  title={e.description}
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-bold text-center transition-all border ${
                    eventCode === e.code
                      ? "bg-amber-500/20 border-amber-500 text-amber-300 shadow-lg shadow-amber-500/10"
                      : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {e.code}
                </button>
              ))}
            </div>
            {eventCode && (
              <div className="mt-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px]">
                {EVENT_CODES.find(e => e.code === eventCode)?.description || eventCode}
              </div>
            )}
          </div>

          {/* Status Selector — 3 big buttons */}
          <div>
            <label className="block text-xs font-black text-zinc-400 uppercase tracking-widest mb-2">
              Result
            </label>
            <div className="grid grid-cols-3 gap-3">
              {/* Planned */}
              <button
                onClick={() => { setStatus("planned"); setReasonCode(""); setReasonError(false); }}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  status === "planned"
                    ? "bg-zinc-800 border-zinc-400 shadow-lg"
                    : "bg-zinc-900/50 border-zinc-700 hover:border-zinc-500"
                }`}
              >
                <span className="text-2xl">⬜</span>
                <span className="text-[11px] font-black text-zinc-300">Planned</span>
                <span className="text-[9px] text-zinc-500">Not done yet</span>
              </button>

              {/* Pass */}
              <button
                onClick={() => { setStatus("pass"); setReasonCode(""); setReasonError(false); }}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  status === "pass"
                    ? "bg-emerald-950 border-emerald-400 shadow-lg shadow-emerald-500/20"
                    : "bg-zinc-900/50 border-zinc-700 hover:border-emerald-600"
                }`}
              >
                <span className="text-2xl">🟢</span>
                <span className="text-[11px] font-black text-emerald-300">Pass</span>
                <span className="text-[9px] text-zinc-500">Event succeeded</span>
              </button>

              {/* Fail */}
              <button
                onClick={() => { setStatus("fail"); setReasonError(false); }}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  status === "fail"
                    ? "bg-red-950 border-red-500 shadow-lg shadow-red-500/20"
                    : "bg-zinc-900/50 border-zinc-700 hover:border-red-600"
                }`}
              >
                <span className="text-2xl">🔴</span>
                <span className="text-[11px] font-black text-red-300">Fail</span>
                <span className="text-[9px] text-zinc-500">Must give reason</span>
              </button>
            </div>
          </div>

          {/* Reason Code — only shown when Fail */}
          {status === "fail" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-black uppercase tracking-widest text-red-400 flex items-center gap-2">
                  <span>Failure Reason</span>
                  <span className="text-red-500 font-black">* Required</span>
                </label>
                {eventCode && (
                  <span className="text-[10px] font-extrabold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">
                    Filtered for {eventCode}
                  </span>
                )}
              </div>

              {reasonError && (
                <div className="px-3 py-2 bg-red-900/50 border border-red-500/60 rounded-lg text-red-300 text-xs font-semibold">
                  ⚠️ You must select a reason before saving as Fail.
                </div>
              )}

              {/* Quick Select Chips for Recommended Reasons */}
              {(() => {
                const { recommended } = getGroupedReasonsForEvent(eventCode);
                const query = reasonSearch.trim().toLowerCase();
                const filteredRecommended = recommended.filter(
                  (r) =>
                    !query ||
                    r.code.toLowerCase().includes(query) ||
                    r.label.toLowerCase().includes(query) ||
                    r.responsible.toLowerCase().includes(query) ||
                    (r.notes && r.notes.toLowerCase().includes(query))
                );

                if (filteredRecommended.length === 0) return null;
                return (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                      ⭐ Recommended for {eventCode || "Event"}:
                    </p>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                      {filteredRecommended.map((r) => {
                        const isSelected = reasonCode === r.code;
                        return (
                          <button
                            key={r.code}
                            type="button"
                            onClick={() => {
                              setReasonCode(r.code);
                              setReasonError(false);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1 ${
                              isSelected
                                ? "bg-red-600 text-white border-red-400 shadow-sm shadow-red-500/30"
                                : "bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-zinc-700 hover:border-red-500/50"
                            }`}
                          >
                            <span>{r.code}:</span>
                            <span className="truncate max-w-[150px]">{r.label.split(":")[1] || r.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Searchable Reason Combobox — a native <select>'s open popup is OS-rendered
                  chrome that can never contain a custom search box, so this replaces it with a
                  custom text input + custom dropdown list, where typing filters the very list
                  you're looking at instead of only pre-filtering before you open it. */}
              <div className="relative" ref={reasonBoxRef}>
                <div
                  onClick={() => setIsReasonOpen(true)}
                  className={`w-full flex items-center gap-2 bg-zinc-900 border rounded-xl px-3 py-2.5 text-sm cursor-text focus-within:ring-2 transition-all ${
                    reasonError
                      ? "border-red-500 focus-within:ring-red-500/40"
                      : "border-zinc-700 focus-within:ring-red-500/40 focus-within:border-red-500"
                  }`}
                >
                  <span className="text-zinc-500 text-xs shrink-0">🔍</span>
                  <input
                    type="text"
                    value={isReasonOpen ? reasonSearch : selectedReason ? `${selectedReason.label} (${selectedReason.responsible})` : ""}
                    onFocus={() => { setIsReasonOpen(true); setReasonSearch(""); }}
                    onChange={(e) => {
                      setReasonSearch(e.target.value);
                      setIsReasonOpen(true);
                    }}
                    placeholder="— Select failure reason — (search by code, name, department)"
                    className="flex-1 min-w-0 bg-transparent outline-none text-zinc-200 placeholder:text-zinc-500"
                  />
                  {reasonCode && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setReasonCode("");
                        setReasonSearch("");
                      }}
                      className="text-zinc-500 hover:text-zinc-200 text-xs font-bold p-0.5 shrink-0"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {isReasonOpen && (
                  <div className="absolute z-10 mt-1.5 w-full max-h-72 overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-2 space-y-3">
                    {(() => {
                      const { recommended, other } = getGroupedReasonsForEvent(eventCode);
                      const query = reasonSearch.trim().toLowerCase();

                      const filterFn = (r: (typeof recommended)[0]) =>
                        !query ||
                        r.code.toLowerCase().includes(query) ||
                        r.label.toLowerCase().includes(query) ||
                        r.responsible.toLowerCase().includes(query) ||
                        (r.notes && r.notes.toLowerCase().includes(query));

                      const filteredRecommended = recommended.filter(filterFn);
                      const filteredOther = other.filter(filterFn);
                      const selectOption = (code: string) => {
                        setReasonCode(code);
                        setReasonError(false);
                        setIsReasonOpen(false);
                        setReasonSearch("");
                      };

                      if (filteredRecommended.length === 0 && filteredOther.length === 0) {
                        return (
                          <p className="text-xs text-zinc-500 text-center py-3">
                            No matching failure reasons.
                          </p>
                        );
                      }

                      const optionButton = (r: (typeof recommended)[0]) => (
                        <button
                          key={r.code}
                          type="button"
                          onClick={() => selectOption(r.code)}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                            reasonCode === r.code
                              ? "bg-red-600 text-white"
                              : "text-zinc-300 hover:bg-zinc-800"
                          }`}
                        >
                          <span className="font-bold">{r.code}:</span> {r.label.split(":")[1] || r.label}{" "}
                          <span className={reasonCode === r.code ? "text-red-100" : "text-zinc-500"}>
                            ({r.responsible})
                          </span>
                        </button>
                      );

                      return (
                        <>
                          {filteredRecommended.length > 0 && (
                            <div>
                              <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider px-1 mb-1">
                                ⭐ Recommended for {eventCode || "Selected Event"}
                              </p>
                              {filteredRecommended.map(optionButton)}
                            </div>
                          )}
                          {filteredOther.length > 0 && (
                            <div>
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider px-1 mb-1">
                                {filteredRecommended.length > 0 ? "All Other Failure Reasons" : "All Matching Reasons"}
                              </p>
                              {filteredOther.map(optionButton)}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Reason detail card */}
              {selectedReason && (
                <div className="mt-3 p-3 rounded-xl bg-red-950/40 border border-red-500/30">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <p className="text-red-300 text-xs font-bold">{selectedReason.label}</p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="text-[10px] text-zinc-500 font-medium">Responsible:</span>
                        <span className="text-[11px] font-black text-amber-300 px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 rounded-full">
                          {selectedReason.responsible}
                        </span>
                      </div>
                      {selectedReason.notes && (
                        <p className="mt-1 text-[10px] text-zinc-500 italic">{selectedReason.notes}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — action buttons */}
        <div className="p-5 border-t border-zinc-800 flex flex-col gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !eventCode}
            className={`w-full py-3 rounded-xl font-black text-sm transition-all shadow-lg flex items-center justify-center gap-2 ${
              saving || !eventCode
                ? "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                : status === "pass"
                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20"
                : status === "fail"
                ? "bg-red-600 hover:bg-red-500 text-white shadow-red-500/20"
                : "bg-slate-700 hover:bg-slate-600 text-white shadow-slate-700/20"
            }`}
          >
            {saving ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </>
            ) : (
              <>
                {status === "pass" && "✓ Save as Pass (Confirmed at Plant)"}
                {status === "fail" && "✗ Save as Fail (Auto-assigned to Next Day)"}
                {status === "planned" && "📋 Save as Planned (Default White)"}
              </>
            )}
          </button>

          <div className="flex gap-2">
            <button
              onClick={handleClear}
              className="flex-1 py-2 rounded-xl font-semibold text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 transition-all"
            >
              🗑 Clear Event
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-xl font-semibold text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
