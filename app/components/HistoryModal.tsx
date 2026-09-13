import React, { useMemo } from "react";
import { EmbellishmentRow, ColumnMapping } from "../lib/db";

interface HistoryModalProps {
  sharedId: string;
  onClose: () => void;
  allRows: EmbellishmentRow[];
  columns: ColumnMapping;
}

export default function HistoryModal({ sharedId, onClose, allRows, columns }: HistoryModalProps) {
  // Find all rows matching the sharedId and sort by version ascending for diffing
  const history = useMemo(() => {
    return allRows
      .filter((r) => r.shared_id === sharedId || r.id === sharedId)
      .sort((a, b) => (a.version_number || 1) - (b.version_number || 1));
  }, [allRows, sharedId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-150 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
          <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Revision History: {history[history.length - 1]?.col5 || "N/A"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content (Timeline) */}
        <div className="p-6 overflow-y-auto flex-1 bg-white dark:bg-zinc-950">
          {history.length === 0 ? (
            <div className="text-center text-zinc-500 py-10">No history found.</div>
          ) : (
            <div className="relative border-l border-zinc-200 dark:border-zinc-800 ml-3 space-y-8">
              {[...history].reverse().map((row, index, arr) => {
                const isLatest = index === 0;
                // Find the previous version to compare (since it's reversed, next in array is previous version)
                const prevVersion = arr[index + 1];
                
                // Calculate diffs
                const changes: { label: string; oldVal: string; newVal: string }[] = [];
                if (prevVersion) {
                  const allKeys = Array.from(new Set([...Object.keys(prevVersion), ...Object.keys(row)]));
                  for (const key of allKeys) {
                    if (["id", "shared_id", "version_number", "is_current", "change_reason", "changed_date", "created_at"].includes(key)) continue;
                    
                    const oldVal = String(String(String(String(String(prevVersion[key] || "")))));
                    const newVal = String(String(String(String(String(row[key] || "")))));
                    
                    if (oldVal !== newVal) {
                      let label = key;
                      if (columns[key]) label = columns[key];
                      else if (key.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        label = new Date(key).toLocaleDateString("en-US", { day: "numeric", month: "short" });
                      }
                      changes.push({ label, oldVal, newVal });
                    }
                  }
                }

                return (
                  <div key={row.id} className="relative pl-6">
                    {/* Timeline dot */}
                    <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-white dark:ring-zinc-950 ${
                      isLatest ? "bg-blue-500" : "bg-zinc-300 dark:bg-zinc-700"
                    }`} />
                    
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-zinc-900 dark:text-white">
                          Version {row.version_number || 1}
                        </span>
                        {isLatest && (
                          <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                            Current
                          </span>
                        )}
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {row.changed_date ? new Date(row.changed_date).toLocaleString() : "Original"}
                        </span>
                      </div>
                      
                      {row.change_reason && (
                        <p className="text-sm text-zinc-700 dark:text-zinc-300 italic">
                          "{row.change_reason}"
                        </p>
                      )}

                      {/* Display field changes */}
                      {changes.length > 0 && (
                        <div className="mt-2 p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-100 dark:border-zinc-800">
                          <p className="text-[10px] uppercase font-bold text-zinc-400 mb-2">Changed Fields</p>
                          <div className="flex flex-col gap-2">
                            {changes.map((c, i) => (
                              <div key={i} className="text-xs flex items-start gap-2">
                                <span className="font-semibold text-zinc-700 dark:text-zinc-300 w-32 shrink-0">{c.label}:</span>
                                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 flex-1 min-w-0">
                                  <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 line-through truncate max-w-full" title={c.oldVal || "Empty"}>
                                    {c.oldVal || "Empty"}
                                  </span>
                                  <span className="hidden sm:inline text-zinc-400">→</span>
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 truncate max-w-full" title={c.newVal || "Empty"}>
                                    {c.newVal || "Empty"}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
