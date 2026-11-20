import React, { useMemo, useState } from "react";
import { EmbellishmentRow } from "../lib/db";
import { DraLineStatus, DraRowUpdate, ParsedDraFile, buildDraPreview } from "../lib/draImport";

interface DraImportModalProps {
  fileName: string;
  parsed: ParsedDraFile;
  rows: EmbellishmentRow[];
  isImporting: boolean;
  onClose: () => void;
  onConfirm: (updates: DraRowUpdate[]) => void;
}

const STATUS_VIEW: Record<DraLineStatus, { label: string; className: string }> = {
  update: { label: "Will update", className: "text-emerald-300" },
  already: { label: "No change", className: "text-zinc-500" },
  superseded: { label: "Older line (skipped)", className: "text-zinc-500" },
  dropped: { label: "Dropped (skipped)", className: "text-amber-300" },
  "style-differs": { label: "Style differs (skipped)", className: "text-rose-300" },
  "not-found": { label: "Not found", className: "text-rose-300" },
};

const FILTERS: { key: "all" | DraLineStatus | "unmatched"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "update", label: "Will update" },
  { key: "unmatched", label: "Not matched" },
  { key: "dropped", label: "Dropped" },
  { key: "already", label: "No change" },
  { key: "superseded", label: "Older lines" },
];

export default function DraImportModal({ fileName, parsed, rows, isImporting, onClose, onConfirm }: DraImportModalProps) {
  const preview = useMemo(() => buildDraPreview(parsed.lines, rows), [parsed.lines, rows]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");

  const countOf = (s: DraLineStatus) => preview.entries.filter((e) => e.status === s).length;
  const unmatched = countOf("not-found") + countOf("style-differs");
  const highRisk = preview.updates.filter((u) => String(u.updated.col17 || "") === "High").length;
  const shown = preview.entries.filter((e) =>
    filter === "all" ? true
      : filter === "unmatched" ? e.status === "not-found" || e.status === "style-differs"
        : e.status === filter,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-md">
      <div className="w-full max-w-6xl max-h-[90vh] flex flex-col bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl">
        <div className="p-5 border-b border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-100">Import DRA</h2>
          <p className="text-xs text-zinc-400 mt-1">
            {fileName} · sheet &quot;{parsed.sheet}&quot; · {parsed.lines.length} line{parsed.lines.length === 1 ? "" : "s"}
            {parsed.skipped.length > 0 && <> · {parsed.skipped.length} without a graphic ignored</>}
          </p>
          <div className="flex flex-wrap gap-2 mt-3 text-xs">
            <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300">
              {countOf("update")} lines → {preview.updates.length} plan rows will update ({highRisk} High Risk)
            </span>
            <span className="px-2 py-1 rounded-lg bg-zinc-800 text-zinc-400">{countOf("already")} no change</span>
            <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300">{countOf("dropped")} dropped</span>
            <span className="px-2 py-1 rounded-lg bg-rose-500/10 text-rose-300">{unmatched} not matched</span>
            {countOf("superseded") > 0 && (
              <span className="px-2 py-1 rounded-lg bg-zinc-800 text-zinc-400">{countOf("superseded")} older duplicate lines</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                  filter === f.key ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto min-h-32">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-zinc-900 text-zinc-400 text-left">
              <tr>
                <th className="px-3 py-2">Row</th>
                <th className="px-3 py-2">Graphic</th>
                <th className="px-3 py-2">Style</th>
                <th className="px-3 py-2">Combo</th>
                <th className="px-3 py-2">Risk</th>
                <th className="px-3 py-2">What / Who / When</th>
                <th className="px-3 py-2">Plan rows</th>
                <th className="px-3 py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.line.excelRow} className="border-t border-zinc-800 align-top">
                  <td className="px-3 py-2 text-zinc-500">{e.line.excelRow}</td>
                  <td className="px-3 py-2 font-mono text-zinc-200 whitespace-nowrap">{e.line.graphic}</td>
                  <td className="px-3 py-2 text-zinc-400">{e.line.style || "-"}</td>
                  <td className="px-3 py-2 text-zinc-400">{e.line.comboRaw || "-"}</td>
                  <td className={`px-3 py-2 font-bold ${e.line.risk === "High" ? "text-red-400" : "text-emerald-400"}`}>
                    {e.line.risk || "-"}
                    {e.line.riskCategory && <span className="block text-[10px] font-normal text-zinc-500">{e.line.riskCategory}</span>}
                  </td>
                  <td className="px-3 py-2 text-zinc-300 max-w-md">
                    {e.line.what ? <span className="line-clamp-2 whitespace-pre-line">{e.line.what}</span> : <span className="text-zinc-600">-</span>}
                    {(e.line.who || e.line.when) && (
                      <span className="block text-[10px] text-zinc-500">
                        {e.line.who || "?"} · {e.line.when.replace(/\n/g, " → ") || "no date"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{e.matched || "-"}</td>
                  <td className="px-3 py-2">
                    <span className={STATUS_VIEW[e.status].className}>{STATUS_VIEW[e.status].label}</span>
                    {e.note && <span className="block text-[10px] text-zinc-500">{e.note}</span>}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-zinc-500">Nothing in this group</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-zinc-800 flex items-center justify-between gap-3">
          <p className="text-[11px] text-zinc-500">
            Writes Risk Factor (overwrites) and the DRA columns — What, Who, When, DRA Comment, Risk Category, DRA Date.
            Technique Category only where blank. Planning events are not changed. A backup is taken first.
          </p>
          <div className="flex gap-2 shrink-0">
            <button onClick={onClose} disabled={isImporting} className="px-4 py-2 rounded-lg text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
              Cancel
            </button>
            <button
              onClick={() => onConfirm(preview.updates)}
              disabled={isImporting || preview.updates.length === 0}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {isImporting ? "Saving…" : `Update ${preview.updates.length} row${preview.updates.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
