import React, { useMemo } from "react";
import { getOverallSlaStats } from "../lib/slaUtils";

interface SlaWatchlistBarProps {
  rows: Record<string, unknown>[];
  activeFilter: "all" | "overdue" | "dueSoon" | "priority";
  onFilterChange: (filter: "all" | "overdue" | "dueSoon" | "priority") => void;
  onOpenDueTomorrowAlert?: () => void;
}

export default function SlaWatchlistBar({
  rows,
  activeFilter,
  onFilterChange,
  onOpenDueTomorrowAlert,
}: SlaWatchlistBarProps) {
  const stats = useMemo(() => getOverallSlaStats(rows), [rows]);

  return (
    <div className="bg-[#0f121a] border-b border-zinc-800/80 px-6 py-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Left: Section Title & 3-Day SLA Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-xl">
            <span className="text-amber-400 font-black text-sm">⏱️ 3-Day Plant S/OFF SLA Clock</span>
          </div>
          <span className="text-xs text-zinc-400 font-medium hidden md:inline">
            Fabric Received → Plant must issue S/OFF within <strong className="text-zinc-200">3 Days</strong>
          </span>
        </div>

        {/* Center: Stat Badges */}
        <div className="flex items-center gap-2">
          {/* Due Tomorrow Alert Box Trigger Button */}
          {onOpenDueTomorrowAlert && (
            <button
              suppressHydrationWarning
              onClick={onOpenDueTomorrowAlert}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs font-black bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 text-white border-amber-400/80 shadow-md hover:scale-105 active:scale-95 transition-all ring-2 ring-amber-500/30 animate-pulse"
            >
              <span>🔔 Open Tomorrow Alert Box</span>
              {stats.totalDueSoon > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-black/40 font-extrabold text-amber-200">
                  {stats.totalDueSoon}
                </span>
              )}
            </button>
          )}

          {/* Overdue Button / Badge */}
          <button
            suppressHydrationWarning
            onClick={() => onFilterChange(activeFilter === "overdue" ? "all" : "overdue")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
              activeFilter === "overdue"
                ? "bg-red-500 text-white border-red-400 ring-2 ring-red-500/40 shadow-lg shadow-red-500/20"
                : stats.totalOverdue > 0
                ? "bg-red-500/15 text-red-300 border-red-500/40 hover:bg-red-500/25"
                : "bg-zinc-800/60 text-zinc-400 border-zinc-700/60"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <span>🚨 Overdue (&gt;3d):</span>
            <span className="font-extrabold text-sm text-red-200">{stats.totalOverdue}</span>
          </button>

          {/* Due Soon Button / Badge */}
          <button
            suppressHydrationWarning
            onClick={() => onFilterChange(activeFilter === "dueSoon" ? "all" : "dueSoon")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
              activeFilter === "dueSoon"
                ? "bg-amber-500 text-black border-amber-400 ring-2 ring-amber-500/40 shadow-lg shadow-amber-500/20"
                : stats.totalDueSoon > 0
                ? "bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25"
                : "bg-zinc-800/60 text-zinc-400 border-zinc-700/60"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span>⚡ Due Soon (1-2d):</span>
            <span className="font-extrabold text-sm text-amber-200">{stats.totalDueSoon}</span>
          </button>

          {/* Priority Watchlist Filter Button */}
          <button
            suppressHydrationWarning
            onClick={() => onFilterChange(activeFilter === "priority" ? "all" : "priority")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs font-black transition-all ${
              activeFilter === "priority"
                ? "bg-gradient-to-r from-amber-500 to-red-500 text-white border-amber-400 shadow-md ring-2 ring-amber-500/40"
                : "bg-zinc-900 text-amber-300 border-amber-500/40 hover:bg-amber-500/10"
            }`}
          >
            <span>🔥 Priority Watchlist</span>
          </button>

          {activeFilter !== "all" && (
            <button
              suppressHydrationWarning
              onClick={() => onFilterChange("all")}
              className="text-xs text-zinc-400 hover:text-white underline px-2"
            >
              Clear Filter
            </button>
          )}
        </div>

        {/* Right: Plant Breakdown Chips */}
        {stats.plantBreakdown.length > 0 && (
          <div className="hidden lg:flex items-center gap-2 overflow-x-auto max-w-md">
            {stats.plantBreakdown.slice(0, 3).map(pb => (
              <span
                key={pb.plant}
                className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-zinc-800/80 border border-zinc-700/60 text-zinc-300 whitespace-nowrap"
              >
                {pb.plant}:{" "}
                {pb.overdue > 0 && <span className="text-red-400 font-bold mr-1">{pb.overdue} Overdue</span>}
                {pb.dueSoon > 0 && <span className="text-amber-400 font-bold">{pb.dueSoon} Due</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
