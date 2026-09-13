"use client";
import React from "react";
import { useIsSaving } from "../lib/saveIndicator";

// Full-screen blocking overlay shown while a write (add / edit / delete / replan /
// import) is still on its way to the database. Mounted once at the page root; it
// renders nothing until a save has actually been slow (see useIsSaving's debounce).
export default function SaveIndicatorOverlay() {
  const saving = useIsSaving();
  if (!saving) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-[2px] cursor-wait"
      role="alertdialog"
      aria-busy="true"
      aria-live="assertive"
      aria-label="Saving to database"
    >
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 px-10 py-8 shadow-2xl">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-center">
          <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
            Saving to database…
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Please wait — don&apos;t close or refresh the page.
          </p>
        </div>
      </div>
    </div>
  );
}
