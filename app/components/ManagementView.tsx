import React, { useMemo } from "react";
import { EmbellishmentRow } from "../lib/db";
import { parseDhlTrackingItems } from "./Table";

interface ManagementViewProps {
  rows: EmbellishmentRow[];
}

export default function ManagementView({ rows }: ManagementViewProps) {
  // 1. Status breakdown
  const statusCounts = useMemo(() => {
    const counts = { Active: 0, "In Progress": 0, Completed: 0 };
    rows.forEach((r) => {
      const status = r.col1 as keyof typeof counts;
      if (status in counts) {
        counts[status]++;
      } else {
        counts["Active"]++;
      }
    });
    return counts;
  }, [rows]);

  // 2. Bottlenecks Analysis
  const bottlenecks = useMemo(() => {
    return rows.filter((row) => {
      const hasDhl = !!row.col24;
      const isApproved = row.col20 === "Approved";
      const isCompleted = row.col1 === "Completed";
      // A bottleneck style is one that is NOT completed, but lacks DHL tracking OR is not approved
      return !isCompleted && (!hasDhl || !isApproved);
    });
  }, [rows]);

  // 3. Plant distribution
  const plantDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach((r) => {
      const plant = String(r.col11 || "Unassigned");
      counts[plant] = (counts[plant] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [rows]);

  // 4. Technique distribution
  const techniqueDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach((r) => {
      const tech = String(r.col9 || "Unassigned");
      counts[tech] = (counts[tech] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [rows]);

  // Total count
  const total = rows.length;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Visual Header */}
      <div className="bg-gradient-to-r from-zinc-900 to-zinc-800 dark:from-zinc-950 dark:to-zinc-900 text-white rounded-2xl p-6 shadow-sm border border-zinc-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Executive Management Dashboard</h2>
          <p className="text-xs text-zinc-400 mt-1 max-w-xl">
            Real-time insight into manufacturing progress, embellishment load distribution, and logistics bottleneck tracking.
          </p>
        </div>
        <div className="flex gap-4 bg-zinc-800/50 dark:bg-zinc-900/50 border border-zinc-700/30 rounded-xl px-4 py-2.5 text-center text-xs">
          <div>
            <p className="text-[10px] text-zinc-400 uppercase font-semibold">Total Styles</p>
            <p className="text-lg font-bold">{total}</p>
          </div>
          <div className="w-px bg-zinc-700/50 self-stretch" />
          <div>
            <p className="text-[10px] text-zinc-400 uppercase font-semibold">Unresolved Bottlenecks</p>
            <p className="text-lg font-bold text-rose-400">{bottlenecks.length}</p>
          </div>
        </div>
      </div>

      {/* Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Progress & Completion Status Card */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-5 shadow-sm">
          <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-200 mb-4">Overall Completion Progress</h3>
          <div className="space-y-5">
            {/* Completed */}
            <div>
              <div className="flex justify-between text-xs font-semibold mb-1.5 text-zinc-600 dark:text-zinc-400">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />Completed</span>
                <span>{statusCounts.Completed} ({total ? Math.round((statusCounts.Completed / total) * 100) : 0}%)</span>
              </div>
              <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2.5 rounded-full overflow-hidden">
                <div 
                  className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${total ? (statusCounts.Completed / total) * 100 : 0}%` }}
                />
              </div>
            </div>

            {/* In Progress */}
            <div>
              <div className="flex justify-between text-xs font-semibold mb-1.5 text-zinc-600 dark:text-zinc-400">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />In Progress</span>
                <span>{statusCounts["In Progress"]} ({total ? Math.round((statusCounts["In Progress"] / total) * 100) : 0}%)</span>
              </div>
              <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2.5 rounded-full overflow-hidden">
                <div 
                  className="bg-amber-500 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${total ? (statusCounts["In Progress"] / total) * 100 : 0}%` }}
                />
              </div>
            </div>

            {/* Active */}
            <div>
              <div className="flex justify-between text-xs font-semibold mb-1.5 text-zinc-600 dark:text-zinc-400">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-zinc-400" />Active</span>
                <span>{statusCounts.Active} ({total ? Math.round((statusCounts.Active / total) * 100) : 0}%)</span>
              </div>
              <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2.5 rounded-full overflow-hidden">
                <div 
                  className="bg-zinc-400 dark:bg-zinc-600 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${total ? (statusCounts.Active / total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Plant Distribution Card */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-5 shadow-sm">
          <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-200 mb-4">Plant Load Distribution</h3>
          <div className="space-y-4">
            {plantDistribution.map((item, idx) => {
              const maxVal = Math.max(...plantDistribution.map((p) => p.value));
              const widthPct = maxVal > 0 ? (item.value / maxVal) * 100 : 0;
              const colors = ["bg-blue-500", "bg-indigo-500", "bg-violet-500", "bg-sky-500", "bg-zinc-500"];
              const colorClass = colors[idx % colors.length];

              return (
                <div key={item.name} className="flex items-center gap-4 text-xs">
                  <span className="w-24 truncate font-medium text-zinc-600 dark:text-zinc-400">{item.name}</span>
                  <div className="flex-1 bg-zinc-100 dark:bg-zinc-800 h-4 rounded overflow-hidden">
                    <div 
                      className={`${colorClass} h-full rounded transition-all duration-500`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="w-6 text-right font-bold text-zinc-800 dark:text-zinc-200">{item.value}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Technique Distribution Card */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-5 shadow-sm">
          <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-200 mb-4">Techniques Count</h3>
          <div className="space-y-4">
            {techniqueDistribution.slice(0, 5).map((item, idx) => {
              const maxVal = Math.max(...techniqueDistribution.map((t) => t.value));
              const widthPct = maxVal > 0 ? (item.value / maxVal) * 100 : 0;
              const colors = ["bg-emerald-500", "bg-teal-500", "bg-cyan-500", "bg-rose-500", "bg-amber-500"];
              const colorClass = colors[idx % colors.length];

              return (
                <div key={item.name} className="flex items-center gap-4 text-xs">
                  <span className="w-24 truncate font-medium text-zinc-600 dark:text-zinc-400">{item.name}</span>
                  <div className="flex-1 bg-zinc-100 dark:bg-zinc-800 h-4 rounded overflow-hidden">
                    <div 
                      className={`${colorClass} h-full rounded transition-all duration-500`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="w-6 text-right font-bold text-zinc-800 dark:text-zinc-200">{item.value}</span>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* Bottlenecks / Action Required Section */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
          <div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              <span className="inline-flex w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
              Critical Logistics & Approval Bottlenecks
            </h3>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              These active styles have either missing DHL/Stickoff tracking numbers or pending approvals, blocking production start.
            </p>
          </div>
          <span className="px-3 py-1 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-950 rounded-xl text-xs font-semibold self-start sm:self-auto">
            Requires Attention: {bottlenecks.length} styles
          </span>
        </div>

        {bottlenecks.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-400 dark:text-zinc-500 text-xs">
            🎉 All active styles have valid tracking numbers and graphics approvals. No bottlenecks detected.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-zinc-200 dark:divide-zinc-800">
              <thead>
                <tr className="text-zinc-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="pb-3 pr-4">Style</th>
                  <th className="pb-3 px-4">Graphic Code</th>
                  <th className="pb-3 px-4">Plant</th>
                  <th className="pb-3 px-4">DHL Tracking</th>
                  <th className="pb-3 px-4">AOQ</th>
                  <th className="pb-3 pl-4 text-right">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-150 dark:divide-zinc-800 text-zinc-700 dark:text-zinc-300">
                {bottlenecks.map((row) => {
                  const hasDhl = !!row.col24;
                  const isApproved = row.col20 === "Approved";
                  
                  return (
                    <tr key={row.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30">
                      <td className="py-3 pr-4 font-bold text-zinc-900 dark:text-white font-mono">{row.col5 || "-"}</td>
                      <td className="py-3 px-4 truncate font-mono text-zinc-500 dark:text-zinc-400 max-w-[150px]">{row.col6 || "-"}</td>
                      <td className="py-3 px-4">{row.col11 || "-"}</td>
                      <td className="py-3 px-4">
                        {hasDhl ? (
                          <div className="flex flex-col gap-1 max-w-[260px]">
                            {parseDhlTrackingItems(String(String(String(String(row.col24 || ""))))).map((item, idx) => (
                              <span key={idx} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 text-[11px] font-medium font-mono whitespace-normal break-words">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                <span>{item}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-rose-500 font-semibold px-2 py-0.5 bg-rose-500/10 rounded border border-rose-500/20">Missing Tracking</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {isApproved ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">{row.col20}</span>
                        ) : (
                          <span className="text-amber-500 font-semibold px-2 py-0.5 bg-amber-500/10 rounded border border-amber-500/20">{row.col20 || "Active"}</span>
                        )}
                      </td>
                      <td className="py-3 pl-4 text-right">
                        <span className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium">
                          {!hasDhl && !isApproved ? "No DHL & Pending Approval" : !hasDhl ? "Logistics Hold" : "Approval Hold"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
