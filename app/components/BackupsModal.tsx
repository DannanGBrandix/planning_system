import React, { useEffect, useState } from "react";
import { BackupMeta, listBackups, restoreBackup } from "../lib/db";

interface BackupsModalProps {
  onClose: () => void;
  onRestored: () => Promise<void> | void;
}

const REASON_LABELS: Record<string, string> = {
  import: "Before Excel import",
  clear: "Before Clear Database",
  manual: "Manual",
};

export default function BackupsModal({ onClose, onRestored }: BackupsModalProps) {
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      const data = await listBackups();
      setBackups(data);
      setIsLoading(false);
    })();
  }, []);

  const handleRestore = async (backup: BackupMeta) => {
    const confirmed = window.confirm(
      `Restore "${backup.label}" (${backup.row_count} rows, saved ${new Date(backup.created_at).toLocaleString()})?\n\n` +
        `This will REPLACE all data currently in the database with this backup. Anything saved after this backup was taken will be lost unless it's in a newer backup.`
    );
    if (!confirmed) return;

    try {
      setRestoringId(backup.id);
      await restoreBackup(backup.id);
      await onRestored();
      alert(`Restored ${backup.row_count} rows from "${backup.label}".`);
      onClose();
    } catch (err) {
      console.error("Restore failed:", err);
      alert("Failed to restore backup. Please try again.");
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-150 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-zinc-900 dark:text-white">Backup History</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              A snapshot is saved automatically before every Excel import and every database clear. Restore any of them to undo.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="text-center text-zinc-400 py-10 text-sm">Loading backups...</div>
          ) : backups.length === 0 ? (
            <div className="text-center text-zinc-400 py-10 text-sm">
              No backups yet — one will be created automatically the next time you import an Excel file.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {backups.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">{b.label}</span>
                      <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 shrink-0">
                        {REASON_LABELS[b.reason] || b.reason}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {new Date(b.created_at).toLocaleString()} &middot; {b.row_count} rows
                    </div>
                  </div>
                  <button
                    onClick={() => handleRestore(b)}
                    disabled={restoringId !== null}
                    className="shrink-0 px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 dark:bg-amber-500 dark:hover:bg-amber-400 rounded-lg transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    {restoringId === b.id ? "Restoring..." : "Restore"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
