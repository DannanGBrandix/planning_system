import React, { useState } from "react";
import type { EmbellishmentRow } from "../lib/db";
import type { DevPackChange, DevPackItem } from "../lib/devPackImport";

export interface DevPackPreviewEntry {
  item: DevPackItem;
  row: EmbellishmentRow | null; // matched DB row (before changes); null = no match, skipped
  updated: EmbellishmentRow | null;
  changes: DevPackChange[];
}

interface DevPackImportModalProps {
  fileName: string;
  sheetsRead: string[];
  sheetsSkipped: string[];
  entries: DevPackPreviewEntry[];
  isImporting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const show = (v: string) => (v.trim() ? v : "(empty)");

export default function DevPackImportModal({
  fileName,
  sheetsRead,
  sheetsSkipped,
  entries,
  isImporting,
  onClose,
  onConfirm,
}: DevPackImportModalProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const updates = entries.filter((e) => e.row && e.changes.length);
  const unchanged = entries.filter((e) => e.row && !e.changes.length);
  const unmatched = entries.filter((e) => !e.row);
  const withDhl = entries.filter((e) => e.item.trackingText).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-md">
      <div className="w-full max-w-6xl max-h-[90vh] flex flex-col bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl">
        <div className="p-5 border-b border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-100">Dev Pack Tracker import</h2>
          <p className="text-xs text-zinc-400 mt-1">
            {fileName} · read <b className="text-zinc-200">{sheetsRead.join(", ") || "no sheet"}</b>
            {sheetsSkipped.length > 0 && <> · skipped {sheetsSkipped.join(", ")}</>}
          </p>
          <div className="flex flex-wrap gap-2 mt-3 text-xs">
            <span className="px-2 py-1 rounded-lg bg-zinc-800 text-zinc-200">{entries.length} tracker rows</span>
            <span className="px-2 py-1 rounded-lg bg-sky-500/10 text-sky-300">{withDhl} with DHL</span>
            <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300">{updates.length} to update</span>
            <span className="px-2 py-1 rounded-lg bg-zinc-800 text-zinc-400">{unchanged.length} unchanged</span>
            <span className="px-2 py-1 rounded-lg bg-rose-500/10 text-rose-300">{unmatched.length} not in plan (skipped)</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-zinc-900 text-zinc-400 text-left">
              <tr>
                <th className="px-3 py-2">Reference #</th>
                <th className="px-3 py-2">Combo</th>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">Plan plant</th>
                <th className="px-3 py-2">Tracking #</th>
                <th className="px-3 py-2">Concerns / Limitation</th>
                <th className="px-3 py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <React.Fragment key={i}>
                  <tr
                    className="border-t border-zinc-800 hover:bg-zinc-800/40 cursor-pointer align-top"
                    onClick={() => setExpanded(expanded === i ? null : i)}
                  >
                    <td className="px-3 py-2 font-mono text-zinc-200 whitespace-nowrap">{e.item.graphic}</td>
                    <td className="px-3 py-2 text-zinc-300">{e.item.combo}</td>
                    <td className="px-3 py-2 text-zinc-300">{e.item.fields.plant || "-"}</td>
                    <td className="px-3 py-2 text-zinc-400">{e.row ? String(e.row.col11 || "-") : "-"}</td>
                    <td className="px-3 py-2 text-sky-300 whitespace-pre-line">{e.item.trackingText || "-"}</td>
                    <td className="px-3 py-2 text-zinc-400 max-w-md">
                      <div className="line-clamp-2 whitespace-pre-line">{e.item.fields.concerns || "-"}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {!e.row ? (
                        <span className="text-rose-300">No match</span>
                      ) : e.changes.length ? (
                        <span className="text-emerald-300">
                          {e.changes.length} change{e.changes.length > 1 ? "s" : ""}
                          {e.item.dropped && " · Dropped"}
                        </span>
                      ) : (
                        <span className="text-zinc-500">Unchanged</span>
                      )}
                    </td>
                  </tr>
                  {expanded === i && e.changes.length > 0 && (
                    <tr className="bg-zinc-950/50">
                      <td colSpan={7} className="px-6 py-3">
                        {e.changes.map((c) => (
                          <div key={c.field} className="grid grid-cols-[14rem_1fr_1fr] gap-3 py-1 text-[11px]">
                            <span className="text-zinc-400">{c.label}</span>
                            <span className="text-rose-300/80 whitespace-pre-line line-through">{show(c.oldValue)}</span>
                            <span className="text-emerald-300 whitespace-pre-line">{show(c.newValue)}</span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-zinc-800 flex items-center justify-between gap-3">
          <p className="text-[11px] text-zinc-500">
            Only updates rows already in the plan (matched by Reference # + Combo). Plant is never changed; a DHL
            sent within 5 days of a planned NY marks that NY passed.
          </p>
          <div className="flex gap-2 shrink-0">
            <button onClick={onClose} disabled={isImporting} className="px-4 py-2 rounded-lg text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isImporting || updates.length === 0}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {isImporting ? "Saving…" : `Update ${updates.length} row${updates.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
