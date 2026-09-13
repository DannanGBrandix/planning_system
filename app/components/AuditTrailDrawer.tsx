import React, { useState } from "react";
import { AuditLog } from "../lib/db";

interface AuditTrailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  logs: AuditLog[];
  onClearLogs: () => void;
}

export default function AuditTrailDrawer({
  isOpen,
  onClose,
  logs,
  onClearLogs,
}: AuditTrailDrawerProps) {
  const [filterQuery, setFilterQuery] = useState("");

  if (!isOpen) return null;

  const filteredLogs = logs.filter((log) => {
    const q = filterQuery.toLowerCase();
    return (
      log.styleCode.toLowerCase().includes(q) ||
      log.field.toLowerCase().includes(q) ||
      log.userRole.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/40 backdrop-blur-sm animate-fade-in">
      {/* Click outside container to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Sliding Drawer Body */}
      <div className="relative w-full max-w-lg h-full bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col z-10 animate-slide-in">
        
        {/* Drawer Header */}
        <div className="p-6 border-b border-zinc-150 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              System Audit Trails
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              History of all cells, parameters, and schedules modified.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-850 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search controls */}
        <div className="px-6 py-4 border-b border-zinc-150 dark:border-zinc-800 flex items-center justify-between gap-4">
          <input
            type="text"
            placeholder="Search by Style, Field, or Role..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="flex-1 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 transition-all"
          />
          {logs.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm("Are you sure you want to clear all audit logs permanently?")) {
                  onClearLogs();
                }
              }}
              className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 bg-rose-500/5 hover:bg-rose-500/10 px-2.5 py-1.5 rounded-lg border border-rose-500/10 transition-colors shrink-0"
            >
              Clear Logs
            </button>
          )}
        </div>

        {/* Logs Timeline */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-16 text-zinc-400 dark:text-zinc-500 text-xs border border-dashed border-zinc-100 dark:border-zinc-850 rounded-xl">
              No audit activities recorded.
            </div>
          ) : (
            <div className="relative border-l border-zinc-150 dark:border-zinc-800 pl-4 space-y-6">
              {filteredLogs.map((log) => {
                const dateObj = new Date(log.timestamp);
                const timeString = dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                const dateString = dateObj.toLocaleDateString([], { month: "short", day: "numeric" });

                // Format Role Badge
                const getRoleBadgeColor = (role: string) => {
                  if (role === "Planner") return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
                  if (role.includes("Team 1")) return "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20";
                  if (role.includes("Team 2")) return "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20";
                  if (role.includes("Team 3")) return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
                  return "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/25";
                };

                return (
                  <div key={log.id} className="relative text-xs">
                    {/* Node Dot */}
                    <div className="absolute w-2 h-2 rounded-full bg-indigo-500 -left-[21px] top-1 border-2 border-white dark:border-zinc-900" />
                    
                    {/* Metadata line */}
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded-full border text-[9px] font-semibold ${getRoleBadgeColor(log.userRole)}`}>
                          {log.userRole}
                        </span>
                        <span className="font-bold text-zinc-800 dark:text-zinc-200">
                          {log.styleCode ? `Style: ${log.styleCode}` : "System Config"}
                        </span>
                      </div>
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                        {dateString}, {timeString}
                      </span>
                    </div>

                    {/* Change Details */}
                    <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-150 dark:border-zinc-800/80 rounded-xl p-3 space-y-1 mt-1.5 font-sans shadow-sm">
                      <p className="text-zinc-500 dark:text-zinc-400 text-[11px]">
                        Modified field: <span className="font-semibold text-zinc-700 dark:text-zinc-300">{log.field}</span>
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px]">
                        <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/10 line-through">
                          {log.oldValue || "(empty)"}
                        </span>
                        <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/10 font-semibold">
                          {log.newValue || "(empty)"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-zinc-150 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-zinc-900 dark:bg-zinc-800 hover:bg-zinc-850 dark:hover:bg-zinc-700 text-white rounded-xl font-semibold text-xs transition-colors"
          >
            Close Panel
          </button>
        </div>

      </div>
    </div>
  );
}
