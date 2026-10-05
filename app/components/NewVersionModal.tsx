import React, { useState } from "react";
import { EmbellishmentRow } from "../lib/db";

// "New Version" — a graphic that was already planned & submitted is being re-developed with a
// different Application Form / Fabric / Plant. The current row is archived AS-IS (its planning
// events, plant and submission history stay intact and keep counting in Plant Performance), and a
// new version row starts from these fields with a fresh plan from the chosen start date.
export interface NewVersionInput {
  col15: string; // Application Form
  col27: string; // S-Off Requirement
  col13: string; // Fabric Reference
  col11: string; // Plant
  col12: string; // Plant Flow
  startDate: string; // YYYY-MM-DD
  reason: string;
  clearTracking: boolean;
}

interface Props {
  row: EmbellishmentRow;
  onCancel: () => void;
  onConfirm: (input: NewVersionInput) => void | Promise<void>;
}

const FIELDS: { key: keyof NewVersionInput; label: string }[] = [
  { key: "col15", label: "Application Form" },
  { key: "col27", label: "S-Off Requirement" },
  { key: "col13", label: "Fabric Reference" },
  { key: "col11", label: "Plant" },
  { key: "col12", label: "Plant Flow" },
];

export default function NewVersionModal({ row, onCancel, onConfirm }: Props) {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [form, setForm] = useState<NewVersionInput>({
    col15: String(row.col15 ?? ""),
    col27: String(row.col27 ?? ""),
    col13: String(row.col13 ?? ""),
    col11: String(row.col11 ?? ""),
    col12: String(row.col12 ?? ""),
    startDate: todayIso,
    reason: "",
    clearTracking: true,
  });
  const [saving, setSaving] = useState(false);
  const version = Number(row.version_number) || 1;

  const submit = async () => {
    if (!form.reason.trim()) {
      alert("Please give a reason for the new version (e.g. \"Application form changed to GARMENT FORM\").");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startDate)) {
      alert("Please pick a start date for the new plan.");
      return;
    }
    setSaving(true);
    try {
      await onConfirm(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900">
          <h2 className="text-lg font-bold text-zinc-100">
            New Version — {row.col7 || "-"} {row.col6 ? `(${row.col6})` : ""} · {row.col5 || "-"}
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Version {version} is kept as-is (its planning events stay, and still count for its plant in Plant
            Performance). Version {version + 1} starts a fresh plan from the start date below.
          </p>
        </div>

        <div className="p-6 overflow-y-auto flex flex-col gap-3">
          {FIELDS.map(({ key, label }) => {
            const oldVal = String(row[key as string] ?? "");
            const changed = String(form[key]).trim() !== oldVal.trim();
            return (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  {label}
                  {changed && <span className="ml-2 text-amber-400 normal-case">was: {oldVal || "empty"}</span>}
                </span>
                <input
                  value={String(form[key])}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className={`px-3 py-2 rounded-lg bg-zinc-900 border text-sm text-zinc-100 outline-none focus:border-blue-500 ${
                    changed ? "border-amber-500/60" : "border-zinc-800"
                  }`}
                />
              </label>
            );
          })}

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">New plan starts on</span>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 outline-none focus:border-blue-500"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Reason</span>
            <input
              value={form.reason}
              placeholder="e.g. Application form changed — re-development"
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 outline-none focus:border-blue-500"
            />
          </label>

          <label className="flex items-start gap-2 text-xs text-zinc-300 mt-1">
            <input
              type="checkbox"
              checked={form.clearTracking}
              onChange={(e) => setForm((f) => ({ ...f, clearTracking: e.target.checked }))}
              className="mt-0.5"
            />
            <span>
              Start the new version&apos;s submission tracking fresh (clear DHL / AWB, strike-off comments, submission #
              and approval verdicts). The old version keeps all of them.
            </span>
          </label>
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold"
          >
            {saving ? "Creating…" : `Create Version ${version + 1}`}
          </button>
        </div>
      </div>
    </div>
  );
}
