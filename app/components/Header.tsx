import React from "react";
import { createSupabaseClient } from "../utils/supabase/client";
import DailyPlanMailButton from "./DailyPlanMailButton";

interface HeaderProps {
  currentRole: string;
  userEmail?: string;
  title: string;
  subtitle?: string;
  onOpenBackups?: () => void;
  pendingUpdatesCount?: number;
  ckSyncSlot?: React.ReactNode;
}

const PLANT_UPDATE_ROLES = ["Planner", "Admin", "Management"];

export default function Header({
  currentRole,
  userEmail,
  title,
  subtitle,
  onOpenBackups,
  pendingUpdatesCount = 0,
  ckSyncSlot,
}: HeaderProps) {
  const showPlantUpdates = !currentRole || PLANT_UPDATE_ROLES.includes(currentRole);
  return (
    <header className="bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 w-screen shrink-0 relative z-50 sticky top-0 left-0">
      <div className="px-8 py-5 flex items-center justify-between">
        
        {/* Page Title */}
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm font-medium text-amber-500 mt-1">
              {subtitle}
            </p>
          )}
        </div>

        {/* Right side Profile */}
        <div className="flex items-center gap-4">

          <DailyPlanMailButton />

          {ckSyncSlot}

          {showPlantUpdates && (
            <a
              href="/plant-updates"
              className="relative flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-amber-500/60 hover:text-amber-500 transition-all"
              title="Review event results submitted from plant sheets"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Plant Updates
              {pendingUpdatesCount > 0 && (
                <span className="ml-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-amber-500 text-[10px] font-black text-black">
                  {pendingUpdatesCount > 99 ? "99+" : pendingUpdatesCount}
                </span>
              )}
            </a>
          )}

          <div className="flex flex-col text-right">
            <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{userEmail || "User"}</span>
            <span className="text-[10px] uppercase tracking-wider font-bold text-amber-500">{currentRole || "Loading..."}</span>
          </div>

          <div className="w-10 h-10 rounded-full bg-amber-400 text-black font-black flex items-center justify-center text-lg shadow-lg shadow-amber-400/20">
            {userEmail ? userEmail.charAt(0).toUpperCase() : "U"}
          </div>

          {onOpenBackups && (
            <button
              onClick={onOpenBackups}
              className="p-2 text-zinc-400 hover:text-amber-500 hover:bg-amber-500/10 rounded-xl transition-all"
              title="Backup History — restore data from before an import or database clear"
              suppressHydrationWarning
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10c0 1.657 4.03 3 9 3s9-1.343 9-3V7M3 7c0 1.657 4.03 3 9 3s9-1.343 9-3M3 7c0-1.657 4.03-3 9-3s9 1.343 9 3m0 5c0 1.657-4.03 3-9 3s-9-1.343-9-3" />
              </svg>
            </button>
          )}

          <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-800 mx-2"></div>

          <button
            onClick={async () => {
              const supabase = createSupabaseClient();
              await supabase.auth.signOut();
              window.location.href = "/login";
            }}
            className="p-2 text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-all"
            title="Sign Out"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>

      </div>
    </header>
  );
}
