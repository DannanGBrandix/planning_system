import React, { useMemo, useState } from "react";
import { BUY_TYPES, BuyType, EmbellishmentRow } from "../lib/db";
import { BuyLineStatus, BuyRowUpdate, ParsedBuyFile, buildBuyPreview } from "../lib/buyImport";

interface BuyImportModalProps {
  fileName: string;
  parsed: ParsedBuyFile;
  rows: EmbellishmentRow[];
  isImporting: boolean;
  onClose: () => void;
  onConfirm: (type: BuyType, updates: BuyRowUpdate[]) => void;
}

const TYPE_HINT: Record<BuyType, string> = {
  Regional: "Regional buy",
  BABL: "Every Bangladesh buy",
};

const STATUS_VIEW: Record<BuyLineStatus, { label: string; className: string }> = {
  update: { label: "Will update", className: "text-emerald-300" },
  already: { label: "Already set", className: "text-zinc-500" },
  dropped: { label: "Dropped (skipped)", className: "text-amber-300" },
  "style-differs": { label: "Style differs (skipped)", className: "text-rose-300" },
  "not-found": { label: "Not found", className: "text-rose-300" },
};

export default function BuyImportModal({ fileName, parsed, rows, isImporting, onClose, onConfirm }: BuyImportModalProps) {
  const [type, setType] = useState<BuyType | null>(null);
  const entries = useMemo(() => (type ? buildBuyPreview(parsed.lines, rows, type) : []), [parsed.lines, rows, type]);

  // Two lines (one with a style, one without) can land on the same row.
  const updates = useMemo(() => {
    const byId = new Map<string, BuyRowUpdate>();
    entries.forEach((e) => e.updates.forEach((u) => byId.set(u.row.id, u)));
    return [...byId.values()];
  }, [entries]);

  const countOf = (s: BuyLineStatus) => entries.filter((e) => e.status === s).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-md">
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl">
        <div className="p-5 border-b border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-100">Import Buy Graphics</h2>
          <p className="text-xs text-zinc-400 mt-1">
            {fileName} · {parsed.lines.length} graphic{parsed.lines.length === 1 ? "" : "s"}
            {parsed.duplicates > 0 && <> · {parsed.duplicates} repeated line{parsed.duplicates === 1 ? "" : "s"} ignored</>}
            {parsed.hiddenSkipped > 0 && <> · {parsed.hiddenSkipped} row{parsed.hiddenSkipped === 1 ? "" : "s"} hidden by the Excel filter skipped</>}
          </p>

          <p className="text-xs font-semibold text-zinc-300 mt-4 mb-2">What type of buy is this file?</p>
          <div className="flex gap-2">
            {BUY_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`px-4 py-2 rounded-xl border text-left cursor-pointer transition-colors ${
                  type === t
                    ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300"
                    : "bg-zinc-950/40 border-zinc-800 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                <span className="block text-xs font-bold">{t}</span>
                <span className="block text-[10px] opacity-70">{TYPE_HINT[t]}</span>
              </button>
            ))}
          </div>

          {type && (
            <div className="flex flex-wrap gap-2 mt-3 text-xs">
              <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300">{countOf("update")} will update</span>
              <span className="px-2 py-1 rounded-lg bg-zinc-800 text-zinc-400">{countOf("already")} already set</span>
              <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300">{countOf("dropped")} dropped</span>
              <span className="px-2 py-1 rounded-lg bg-rose-500/10 text-rose-300">
                {countOf("not-found") + countOf("style-differs") + parsed.unreadable.length} not matched
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto min-h-32">
          {!type ? (
            <p className="p-8 text-center text-xs text-zinc-500">Choose Regional or BABL to see what will change.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-900 text-zinc-400 text-left">
                <tr>
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2">Excel row</th>
                  <th className="px-3 py-2">Plan rows</th>
                  <th className="px-3 py-2">Buy now</th>
                  <th className="px-3 py-2">Buy after</th>
                  <th className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.line.excelRow} className="border-t border-zinc-800 align-top">
                    <td className="px-3 py-2 font-mono text-zinc-200 whitespace-nowrap">{e.line.raw}</td>
                    <td className="px-3 py-2 text-zinc-500">{e.line.excelRow}</td>
                    <td className="px-3 py-2 text-zinc-300">{e.matched || "-"}</td>
                    <td className="px-3 py-2 text-zinc-400">{e.updates[0]?.oldLabel || "-"}</td>
                    <td className="px-3 py-2 text-emerald-300">{e.updates[0]?.newLabel || "-"}</td>
                    <td className="px-3 py-2">
                      <span className={STATUS_VIEW[e.status].className}>{STATUS_VIEW[e.status].label}</span>
                      {e.note && <span className="block text-[10px] text-zinc-500">{e.note}</span>}
                    </td>
                  </tr>
                ))}
                {parsed.unreadable.map((u) => (
                  <tr key={`u${u.excelRow}`} className="border-t border-zinc-800 align-top">
                    <td className="px-3 py-2 font-mono text-zinc-200">{u.raw}</td>
                    <td className="px-3 py-2 text-zinc-500">{u.excelRow}</td>
                    <td className="px-3 py-2 text-zinc-300">-</td>
                    <td className="px-3 py-2 text-zinc-400">-</td>
                    <td className="px-3 py-2 text-zinc-400">-</td>
                    <td className="px-3 py-2">
                      <span className="text-rose-300">Not found</span>
                      <span className="block text-[10px] text-zinc-500">No combo on this line</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t border-zinc-800 flex items-center justify-between gap-3">
          <p className="text-[11px] text-zinc-500">
            Only adds a buy to rows already in the plan. Planning events and other columns are not changed.
          </p>
          <div className="flex gap-2 shrink-0">
            <button onClick={onClose} disabled={isImporting} className="px-4 py-2 rounded-lg text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
              Cancel
            </button>
            <button
              onClick={() => type && onConfirm(type, updates)}
              disabled={isImporting || !type || updates.length === 0}
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
