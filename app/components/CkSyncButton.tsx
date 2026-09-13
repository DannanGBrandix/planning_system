import React, { useMemo, useState } from "react";
import {
  CkChartStatus,
  CkDedupePlan,
  getCkDedupePlan,
  applyCkDedupe,
  fetchCkChartsFromSharePoint,
} from "../lib/db";

interface CkSyncState {
  running: boolean;
  done: boolean;
  files: { key: string; label: string; category: string }[];
  index: number;
  log: string[];
}

interface Props {
  status: CkChartStatus | null;
  sync: CkSyncState | null;
  onRunSync: () => void;
  onRefreshStatus: () => void | Promise<void>;
  onReloadRows: () => Promise<void> | void;
}

export default function CkSyncButton({ status, sync, onRunSync, onRefreshStatus, onReloadRows }: Props) {
  const [open, setOpen] = useState(false);
  const [dedupePlan, setDedupePlan] = useState<CkDedupePlan | null>(null);
  const [dedupeBusy, setDedupeBusy] = useState(false);
  const [dedupeMsg, setDedupeMsg] = useState<string>("");
  const [pullBusy, setPullBusy] = useState(false);
  const [pullLog, setPullLog] = useState<string[]>([]);
  const [pullMsg, setPullMsg] = useState<string>("");

  // One click: pull the live workbooks from SharePoint into server memory, then
  // run the normal import over them. Nothing is written to disk.
  const syncFromSharePoint = async () => {
    setPullBusy(true);
    setPullMsg("");
    setPullLog([]);
    try {
      const r = await fetchCkChartsFromSharePoint();
      setPullLog(r.logs || []);
      if (r.needAuth) {
        setPullMsg(
          r.reason ||
            "Not signed in — run `npm run ck:login` once in the project terminal, then try again.",
        );
        return;
      }
      const parts: string[] = [];
      if (r.failed.length)
        parts.push(`failed ${r.failed.length} (${r.failed.map((f) => f.name).join(", ")})`);
      if (r.unclassified?.length)
        parts.push(`skipped ${r.unclassified.length} unrecognised file(s)`);
      if (r.fetched.length === 0) {
        setPullMsg("Nothing pulled" + (parts.length ? " — " + parts.join("; ") : "") + ".");
        return;
      }
      setPullMsg(
        `Got ${r.fetched.length} chart(s) from SharePoint${parts.length ? " — " + parts.join("; ") : ""}. Importing…`,
      );
      await onRefreshStatus();
      onRunSync();
    } catch (e) {
      setPullMsg("SharePoint sync failed: " + String(e));
    } finally {
      setPullBusy(false);
    }
  };

  const changedCount = useMemo(
    () => (status?.charts || []).filter((c) => c.present && c.changed).length,
    [status],
  );
  const alert = changedCount > 0 && !sync?.running;

  const loadPlan = async () => {
    setDedupeBusy(true);
    setDedupeMsg("");
    try {
      setDedupePlan(await getCkDedupePlan());
    } catch (e) {
      setDedupeMsg("Could not compute cleanup plan: " + String(e));
    } finally {
      setDedupeBusy(false);
    }
  };

  const runDedupe = async () => {
    if (!dedupePlan) return;
    if (
      !window.confirm(
        `Delete ${dedupePlan.toDelete.length} duplicate row(s) and merge ${dedupePlan.toUpdate.length} survivor(s)?\n\n` +
          `Rows that have a planning event are never touched. A full backup is saved first (restore from Backup History).`,
      )
    )
      return;
    setDedupeBusy(true);
    setDedupeMsg("");
    try {
      const r = await applyCkDedupe();
      setDedupeMsg(
        `Done — deleted ${r.deleted}, merged ${r.updated}. Backup: ${r.backupId || "(none)"}`,
      );
      setDedupePlan(null);
      await onReloadRows();
    } catch (e) {
      setDedupeMsg("Cleanup failed: " + String(e));
    } finally {
      setDedupeBusy(false);
    }
  };

  return (
    <>
      <button
        suppressHydrationWarning
        onClick={() => {
          setOpen(true);
          onRefreshStatus();
        }}
        title="Sync the CK tracking charts from SharePoint"
        className="relative flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-emerald-500/60 hover:text-emerald-500 transition-all"
      >
        <svg className={`w-4 h-4 ${sync?.running ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Sync CK Charts
        {alert && (
          <span className="ml-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-emerald-500 text-[10px] font-black text-black">
            {changedCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h2 className="text-lg font-black text-zinc-900 dark:text-white">Sync CK Charts</h2>
              <button onClick={() => setOpen(false)} className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Primary: pull the live workbooks from SharePoint into memory and import them. */}
              <div className="space-y-2">
                <button
                  onClick={syncFromSharePoint}
                  disabled={pullBusy || sync?.running}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm transition-colors"
                >
                  {pullBusy
                    ? "Reading from SharePoint…"
                    : sync?.running
                      ? "Importing…"
                      : "Sync from SharePoint"}
                </button>
                <p className="text-[11px] text-zinc-500">
                  Reads the current workbooks straight from the shared OneDrive folder and imports
                  them — no files saved. One-time setup: run <code>npm run ck:login</code> in the
                  project terminal and sign in.
                </p>
                {pullLog.length > 0 && (
                  <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 max-h-40 overflow-y-auto font-mono text-[11px] text-zinc-600 dark:text-zinc-300 space-y-0.5">
                    {pullLog.map((l, i) => (
                      <div key={i}>{l}</div>
                    ))}
                  </div>
                )}
                {pullMsg && <div className="text-[11px] text-amber-600 dark:text-amber-400">{pullMsg}</div>}
              </div>

              {!status ? (
                <p className="text-sm text-zinc-500">Loading chart status…</p>
              ) : (
                <>
                  <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg divide-y divide-zinc-200 dark:divide-zinc-800">
                    {status.charts.map((c) => (
                      <div key={c.key} className="px-3 py-2 flex items-center justify-between text-sm">
                        <div>
                          <span className="font-bold text-zinc-800 dark:text-zinc-100">{c.label}</span>
                          <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">{c.category}</span>
                          {c.source === "sharepoint" && (
                            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold">SharePoint</span>
                          )}
                          {c.source === "folder" && (
                            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-500 font-bold">folder</span>
                          )}
                        </div>
                        <div className="text-[11px]">
                          {!c.present ? (
                            <span className="text-rose-500">not available</span>
                          ) : c.changed ? (
                            <span className="text-emerald-500 font-bold">changed — will import</span>
                          ) : (
                            <span className="text-zinc-400">up to date</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {sync && (
                    <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 max-h-40 overflow-y-auto font-mono text-[11px] text-zinc-600 dark:text-zinc-300 space-y-0.5">
                      {sync.log.map((l, i) => (
                        <div key={i}>{l}</div>
                      ))}
                    </div>
                  )}

                  {/* Fallback: import the .xlsx files sitting in CK_SYNC_DIR (used when there's
                      no SharePoint session yet). */}
                  {status.dirOk && status.charts.some((c) => c.source === "folder") && (
                    <button
                      onClick={onRunSync}
                      disabled={sync?.running || pullBusy}
                      className="w-full py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:border-emerald-500/60 disabled:opacity-50 transition-colors"
                    >
                      {sync?.running ? "Importing…" : "Import from folder instead"}
                    </button>
                  )}
                  <div className="text-[10px] text-zinc-400 break-all">Folder fallback: {status.dir}</div>
                </>
              )}

              {/* Duplicate cleanup */}
              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
                <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">Duplicate cleanup</h3>
                <p className="text-[11px] text-zinc-500">
                  Merges duplicate CK rows (same category + season + graphic + ground + line + dispatch).
                  Rows that already have a planning event are never touched.
                </p>
                {!dedupePlan ? (
                  <button
                    onClick={loadPlan}
                    disabled={dedupeBusy}
                    className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm font-bold text-zinc-700 dark:text-zinc-200 hover:border-emerald-500/60 disabled:opacity-50"
                  >
                    {dedupeBusy ? "Checking…" : "Check for duplicates"}
                  </button>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="text-zinc-700 dark:text-zinc-200">
                      {dedupePlan.duplicateGroups} duplicate group(s) · delete{" "}
                      <b>{dedupePlan.toDelete.length}</b> row(s) · merge <b>{dedupePlan.toUpdate.length}</b> survivor(s)
                    </div>
                    {dedupePlan.duplicateGroups === 0 ? (
                      <div className="text-emerald-600 text-xs">No duplicates — nothing to do.</div>
                    ) : (
                      <button
                        onClick={runDedupe}
                        disabled={dedupeBusy}
                        className="px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold disabled:opacity-50"
                      >
                        {dedupeBusy ? "Cleaning…" : `Clean ${dedupePlan.toDelete.length} duplicate(s)`}
                      </button>
                    )}
                  </div>
                )}
                {dedupeMsg && <div className="text-[11px] text-zinc-500">{dedupeMsg}</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
