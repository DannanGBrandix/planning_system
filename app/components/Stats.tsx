import React from "react";
import { EmbellishmentRow } from "../lib/db";

interface StatsProps {
  rows: EmbellishmentRow[];
}

export default function Stats({ rows }: StatsProps) {
  // Calculations
  const totalOrders = rows.length;
  
  const totalPlanned = rows.reduce((sum, row) => {
    const qty = parseInt(String(row.col8 || "")) || 0; // col8 = Planned Qty
    return sum + qty;
  }, 0);

  const totalReceived = rows.reduce((sum, row) => {
    const qty = parseInt(String(row.col9 || "")) || 0; // col9 = Received Qty
    return sum + qty;
  }, 0);

  const completionRate = totalPlanned > 0 
    ? Math.round((totalReceived / totalPlanned) * 100) 
    : 0;

  // Let's count status breakdown
  const statusCounts = rows.reduce((acc, row) => {
    const status = String(row.col11 || "Active"); // col11 = Status
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const completedCount = statusCounts["Completed"] || 0;
  const inProgressCount = statusCounts["In Progress"] || 0;
  const pendingCount = statusCounts["Active"] || 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">
      {/* Total Orders Card */}
      <div className="relative overflow-hidden bg-white/70 dark:bg-zinc-900/70 backdrop-blur-md rounded-2xl p-6 border border-zinc-200/80 dark:border-zinc-800/80 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 duration-300">
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Total Items</p>
            <h3 className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-white mt-1">
              {totalOrders}
            </h3>
          </div>
          <div className="p-3 bg-blue-500/10 rounded-xl text-blue-600 dark:text-blue-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
          </div>
        </div>
        <div className="mt-4 flex items-center text-xs text-zinc-500 dark:text-zinc-400 gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> {completedCount} Done
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> {inProgressCount} In Prog.
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-zinc-400 inline-block" /> {pendingCount} Active
          </span>
        </div>
      </div>

      {/* Planned Qty Card */}
      <div className="relative overflow-hidden bg-white/70 dark:bg-zinc-900/70 backdrop-blur-md rounded-2xl p-6 border border-zinc-200/80 dark:border-zinc-800/80 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 duration-300">
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-violet-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Total Planned Qty</p>
            <h3 className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-white mt-1">
              {totalPlanned.toLocaleString()}
            </h3>
          </div>
          <div className="p-3 bg-violet-500/10 rounded-xl text-violet-600 dark:text-violet-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
        </div>
        <div className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          Target pieces scheduled for embellishment
        </div>
      </div>

      {/* Received Qty Card */}
      <div className="relative overflow-hidden bg-white/70 dark:bg-zinc-900/70 backdrop-blur-md rounded-2xl p-6 border border-zinc-200/80 dark:border-zinc-800/80 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 duration-300">
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Total Received Qty</p>
            <h3 className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-white mt-1">
              {totalReceived.toLocaleString()}
            </h3>
          </div>
          <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-600 dark:text-emerald-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
        <div className="mt-4 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
          {totalPlanned - totalReceived > 0 
            ? `${(totalPlanned - totalReceived).toLocaleString()} pieces remaining`
            : "All planned pieces received!"}
        </div>
      </div>

      {/* Completion Rate Card */}
      <div className="relative overflow-hidden bg-white/70 dark:bg-zinc-900/70 backdrop-blur-md rounded-2xl p-6 border border-zinc-200/80 dark:border-zinc-800/80 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 duration-300">
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Completion Rate</p>
            <h3 className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-white mt-1">
              {completionRate}%
            </h3>
          </div>
          <div className="p-3 bg-amber-500/10 rounded-xl text-amber-600 dark:text-amber-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.003 9.003 0 1020.945 13H11V3.055z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
            </svg>
          </div>
        </div>
        <div className="mt-4">
          <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-amber-500 h-1.5 rounded-full transition-all duration-500" 
              style={{ width: `${completionRate}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
