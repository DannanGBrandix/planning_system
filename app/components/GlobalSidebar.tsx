import React from 'react';

interface GlobalSidebarProps {
  currentView: "standard" | "advanced" | "actionCenter" | "plantSchedules" | "scoreCard" | "plantPerformance" | "fabricDispatch" | "triggers" | "reports" | "summaryOfGraphics";
  setViewMode: (mode: "standard" | "advanced" | "actionCenter" | "plantSchedules" | "scoreCard" | "plantPerformance" | "fabricDispatch" | "triggers" | "reports" | "summaryOfGraphics") => void;
  onImportJSON: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onImportExcel: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onImportPlanningSheet: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onImportCkTrackingChart: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onImportDevPack: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onImportBuyList: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenAuditLogs: () => void;
  auditLogsCount: number;
  currentRole?: string;
  pendingUpdatesCount?: number;
}

const PLANT_UPDATE_ROLES = ["Planner", "Admin", "Management"];

export default function GlobalSidebar({
  currentView,
  setViewMode,
  onImportJSON,
  onImportExcel,
  onImportPlanningSheet,
  onImportCkTrackingChart,
  onImportDevPack,
  onImportBuyList,
  onOpenAuditLogs,
  auditLogsCount,
  currentRole,
  pendingUpdatesCount = 0
}: GlobalSidebarProps) {

  const showPlantUpdates = !currentRole || PLANT_UPDATE_ROLES.includes(currentRole);

  const navItems = [
    {
      id: "standard",
      label: "Dashboard",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      )
    },
    {
      id: "advanced",
      label: "Advanced Analytics",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      )
    },
    {
      id: "actionCenter",
      label: "Action Center",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      )
    },
    {
      id: "plantSchedules",
      label: "Plant Schedules",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      )
    },
    {
      id: "scoreCard",
      label: "Score Card",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          <circle cx="17" cy="8" r="2" fill="currentColor" stroke="none" />
        </svg>
      )
    },
    {
      id: "plantPerformance",
      label: "Plant Performance",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      )
    },
    {
      id: "fabricDispatch",
      label: "Fabric Dispatch",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
        </svg>
      )
    },
    {
      id: "triggers",
      label: "Season AOQ Dates",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5.586a1 1 0 01.707.293l7.414 7.414a1 1 0 010 1.414l-7.586 7.586a1 1 0 01-1.414 0L4.293 12.293A1 1 0 014 11.586V5a2 2 0 012-2z" />
        </svg>
      )
    },
    {
      id: "reports",
      label: "Reports",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2a2 2 0 012-2h2a2 2 0 012 2v2m-8 0h8m-8 0a2 2 0 01-2-2V7a2 2 0 012-2h2.586a1 1 0 01.707.293l1.414 1.414a1 1 0 00.707.293H17a2 2 0 012 2v8a2 2 0 01-2 2m-8 0h8" />
        </svg>
      )
    },
    {
      id: "summaryOfGraphics",
      label: "TNA Report",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h7m6-3l3 3m0 0l-3 3m3-3H15" />
        </svg>
      )
    }
  ];

  return (
    <aside className="w-[72px] hover:w-[280px] overflow-hidden group transition-all duration-300 ease-in-out bg-[#121212] border-r border-zinc-800 flex flex-col h-full shrink-0 relative z-20">
      <div className="w-[280px] flex flex-col h-full">
        {/* Brand / Logo */}
        <div className="p-6 border-b border-zinc-800/50 flex items-center gap-3">
          <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20 text-black font-black text-lg">
            BX
          </div>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <h1 className="text-white font-bold text-sm tracking-wide">Brandix Studio</h1>
            <p className="text-zinc-500 text-[10px] uppercase tracking-wider font-semibold">Management</p>
          </div>
        </div>

        {/* Main Navigation */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-8">
          
          <div>
            <h2 className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-3 px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">Menu</h2>
            <div className="flex flex-col gap-1">
              {navItems.map((item) => {
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setViewMode(item.id as "standard" | "advanced" | "actionCenter" | "plantSchedules" | "scoreCard" | "plantPerformance" | "fabricDispatch" | "triggers" | "reports" | "summaryOfGraphics")}
                    suppressHydrationWarning
                    className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold transition-all w-full text-left ${
                      isActive 
                        ? 'bg-amber-400/10 text-amber-400' 
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                    }`}
                  >
                    <div className={`shrink-0 ${isActive ? 'text-amber-400' : 'text-zinc-500'}`}>
                      {item.icon}
                    </div>
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                      {item.label}
                    </span>
                  </button>
                );
              })}

              {showPlantUpdates && (
                <a
                  href="/plant-updates"
                  className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold transition-all w-full text-left text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                >
                  <div className="shrink-0 text-zinc-500 relative">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {pendingUpdatesCount > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-amber-500 text-[9px] font-black text-black shadow-lg shadow-amber-500/40">
                        {pendingUpdatesCount > 99 ? "99+" : pendingUpdatesCount}
                      </span>
                    )}
                  </div>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap flex items-center gap-2">
                    Plant Updates
                    {pendingUpdatesCount > 0 && (
                      <span className="rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold px-1.5 py-0.5">
                        {pendingUpdatesCount}
                      </span>
                    )}
                  </span>
                </a>
              )}
            </div>
          </div>

          {/* Quick Actions Placeholder */}
          <div>
            <h2 className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-3 px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">Data Operations</h2>
            <div className="flex flex-col gap-2 px-2">
              
              <div className="relative overflow-hidden group/btn">
                <input
                  type="file"
                  accept=".xlsx, .xls, .xlsm, .csv"
                  onChange={onImportExcel}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  title="Import Excel"
                />
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-center justify-between group-hover/btn:border-amber-500/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 shrink-0 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                    </div>
                    <div className="flex flex-col text-left opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                      <span className="text-zinc-200 text-xs font-bold">Import Excel</span>
                      <span className="text-zinc-500 text-[10px]">Upload tracking chart</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative overflow-hidden group/btn">
                <input
                  type="file"
                  accept=".xlsx, .xls, .xlsm, .csv"
                  onChange={onImportPlanningSheet}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  title="Import Planning Sheet"
                />
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-center justify-between group-hover/btn:border-amber-500/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 shrink-0 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="flex flex-col text-left opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                      <span className="text-zinc-200 text-xs font-bold">Import Planning Sheet</span>
                      <span className="text-zinc-500 text-[10px]">Fill dates on existing items only</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative overflow-hidden group/btn">
                <input
                  type="file"
                  accept=".xlsx, .xls, .xlsm, .csv"
                  onChange={onImportCkTrackingChart}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  title="Import CK Tracking Chart"
                />
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-center justify-between group-hover/btn:border-amber-500/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 shrink-0 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="flex flex-col text-left opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                      <span className="text-zinc-200 text-xs font-bold">CK Tracking Chart</span>
                      <span className="text-zinc-500 text-[10px]">Upload CK tracking data</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative overflow-hidden group/btn">
                <input
                  type="file"
                  accept=".xlsx, .xls, .xlsm"
                  onChange={onImportBuyList}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  title="Import Buy Graphics"
                />
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-center justify-between group-hover/btn:border-amber-500/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 shrink-0 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <div className="flex flex-col text-left opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                      <span className="text-zinc-200 text-xs font-bold">Import Buy Graphics</span>
                      <span className="text-zinc-500 text-[10px]">Regional or BABL buy list</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative overflow-hidden group/btn">
                <input
                  type="file"
                  accept=".xlsx, .xls, .xlsm"
                  onChange={onImportDevPack}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  title="Import Dev Pack Tracker"
                />
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-center justify-between group-hover/btn:border-amber-500/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 shrink-0 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                    <div className="flex flex-col text-left opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                      <span className="text-zinc-200 text-xs font-bold">Dev Pack Tracker</span>
                      <span className="text-zinc-500 text-[10px]">DHL + concerns for DEV graphics</span>
                    </div>
                  </div>
                </div>
              </div>

              <button onClick={onOpenAuditLogs} suppressHydrationWarning className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-center justify-between hover:border-amber-500/50 transition-colors text-left w-full relative">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 shrink-0 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center relative">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {auditLogsCount > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-rose-500 text-[8px] font-bold text-white shadow-lg shadow-rose-500/40">
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col text-left opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                    <span className="text-zinc-200 text-xs font-bold">Audit Logs</span>
                    <span className="text-zinc-500 text-[10px]">Track historical changes</span>
                  </div>
                </div>
              </button>
              
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
