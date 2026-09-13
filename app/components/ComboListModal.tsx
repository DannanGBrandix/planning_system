import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  EmbellishmentRow,
  getRowStatus,
  hasBuy,
  hasColorApproval,
  hasPlacementApproval,
} from "../lib/db";
import { isCkFamilyCategory } from "../lib/ckCategories";
import { extractValidDate, formatDateDDMMYYYY } from "../lib/triggerUtils";

// A drill-down of the combos behind a dashboard metric — one representative row per combo,
// shown as a detail card so every relevant field for that graphic is visible at a glance
// (identity, season/category/plant/technique, the three approval gates, key dates and the
// latest strike-off comment). Shared by AdvancedDashboard's approval-gap drill-downs and the
// standard Dashboard's "Submission Pending" card so both look and behave identically.

const STATUS_META: Record<
  string,
  { label: string; cls: string }
> = {
  approved: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" },
  "c+p": { label: "C+P", cls: "bg-sky-500/15 text-sky-300 border-sky-500/40" },
  // CK-family "CP" S/off code = "Comments Pending" (NY reviewed, returned comments). CK has no
  // "C+P" step, so a CK row that classifies as 'c+p' is shown with this label instead.
  "ck-comments-pending": { label: "Comments Pending", cls: "bg-teal-500/15 text-teal-300 border-teal-500/40" },
  resubmit: { label: "Resubmission Needed", cls: "bg-orange-500/15 text-orange-300 border-orange-500/40" },
  hold: { label: "Hold", cls: "bg-purple-500/15 text-purple-300 border-purple-500/40" },
  dropped: { label: "Dropped", cls: "bg-zinc-700/40 text-zinc-400 border-zinc-600/50" },
  pending: { label: "Submission Pending", cls: "bg-red-500/15 text-red-300 border-red-500/40" },
};

function ApprovalChip({ label, state }: { label: string; state: "yes" | "no" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold ${
        state === "yes"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-rose-500/40 bg-rose-500/10 text-rose-300"
      }`}
    >
      <span className="text-xs leading-none">{state === "yes" ? "✓" : "✗"}</span>
      {label}
    </span>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div
        className={`text-xs text-zinc-200 truncate ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {value || "—"}
      </div>
    </div>
  );
}

function BuyChip({
  r,
  onUpdateRow,
}: {
  r: EmbellishmentRow;
  onUpdateRow?: (r: EmbellishmentRow) => void | Promise<void>;
}) {
  // Optimistic local value so the chip flips instantly; the parent re-feeds `rows`
  // once handleUpdateRow has saved, and this resets to follow it.
  const [override, setOverride] = useState<"Y" | "N" | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = hasBuy(r) ? "Y" : "N";
  const value = override ?? saved;
  const editable = Boolean(onUpdateRow);

  const toggle = async () => {
    if (!onUpdateRow || busy) return;
    const next = value === "Y" ? "N" : "Y";
    setOverride(next);
    setBusy(true);
    try {
      await onUpdateRow({ ...r, col48: next, change_reason: "Buy status updated" });
    } catch {
      setOverride(null); // roll back on failure
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!editable || busy}
      title={
        editable
          ? `Buy status — click to mark as ${value === "Y" ? "No Buy" : "Has Buy"}`
          : `Buy status: ${value === "Y" ? "Has Buy" : "No Buy"}`
      }
      className={`shrink-0 rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors ${
        value === "Y"
          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
          : "border-rose-500/40 bg-rose-500/15 text-rose-300"
      } ${editable ? "cursor-pointer hover:brightness-125" : "cursor-default"} ${
        busy ? "opacity-60" : ""
      }`}
    >
      {value === "Y" ? "Has Buy" : "No Buy"}
    </button>
  );
}

function ComboCard({
  r,
  onUpdateRow,
}: {
  r: EmbellishmentRow;
  onUpdateRow?: (r: EmbellishmentRow) => void | Promise<void>;
}) {
  const status = getRowStatus(r);
  const isCk = isCkFamilyCategory(String(r.col3 || ""));
  const metaKey = status === "c+p" && isCk ? "ck-comments-pending" : status;
  const meta = STATUS_META[metaKey] ?? STATUS_META.pending;

  const style = String(r.col5 || "").trim();
  const graphic = String(r.col7 || "").trim();
  const combo = String(r.col6 || "").trim();
  const ground = String(r.col8 || "").trim();

  const techLayoutOk = status === "approved";
  const colorOk = hasColorApproval(r);
  const placementOk = hasPlacementApproval(r);

  const comment = String(r.col34 || r.col22 || "").trim();
  const dhl = String(r.col24 || "").trim();
  const firstSoff =
    formatDateDDMMYYYY(extractValidDate(r.col23)) ||
    formatDateDDMMYYYY(extractValidDate(r.col28)) ||
    "";
  const approveDate = formatDateDDMMYYYY(extractValidDate(r.col39)) || "";

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#0f1a26] p-3.5">
      {/* identity */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-amber-300">
              {graphic || "—"}
            </span>
            {combo && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
                {combo}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            <span className="font-mono text-zinc-300">{style || "—"}</span>
            {ground && <span className="text-zinc-500"> · {ground}</span>}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${meta.cls}`}
        >
          {meta.label}
        </span>
      </div>

      {/* detail grid */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-zinc-800/70 pt-3 sm:grid-cols-3">
        <Field label="Season" value={String(r.col4 || "")} />
        <Field label="Category" value={String(r.col3 || "")} />
        <Field label="Plant" value={String(r.col11 || r.col12 || "")} />
        <Field label="Technique" value={String(r.col9 || "")} />
        <Field label="Trigger" value={String(r.col2 || "")} />
        <Field label="S-Off Req." value={String(r.col27 || "")} />
        {firstSoff && <Field label="1st S/Off Sent" value={firstSoff} />}
        {approveDate && <Field label="Approve Date" value={approveDate} />}
        {dhl && <Field label="DHL / Tracking" value={dhl} mono />}
      </div>

      {/* approval gates */}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-800/70 pt-3">
        <ApprovalChip label="Tech & Layout" state={techLayoutOk ? "yes" : "no"} />
        <ApprovalChip label="Color" state={colorOk ? "yes" : "no"} />
        <ApprovalChip label="Placement" state={placementOk ? "yes" : "no"} />
      </div>

      {/* latest comment */}
      {comment && (
        <div className="mt-3 rounded-md bg-zinc-900/60 p-2.5 text-xs leading-relaxed text-zinc-300">
          <span className="mr-1 select-none">💬</span>
          <span className="whitespace-pre-wrap break-words">{comment}</span>
        </div>
      )}

      {/* buy status — bottom-right */}
      <div className="mt-3 flex justify-end">
        <BuyChip r={r} onUpdateRow={onUpdateRow} />
      </div>
    </div>
  );
}

export default function ComboListModal({
  title,
  subtitle,
  rows,
  onClose,
  onUpdateRow,
}: {
  title: string;
  subtitle?: string;
  rows: EmbellishmentRow[];
  onClose: () => void;
  onUpdateRow?: (r: EmbellishmentRow) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");

  // Portal to <body> so the fixed overlay is always positioned against the viewport — the
  // standard Dashboard renders this from deep inside a very wide, horizontally-scrolled
  // `w-max` <main>, where a transformed/overflow ancestor would otherwise clip it or shove
  // it off-screen. SSR guard: document only exists in the browser.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.col5, r.col7, r.col6, r.col8, r.col4, r.col3, r.col11, r.col9, r.col2, r.col34, r.col22]
        .map((v) => String(v || "").toLowerCase())
        .some((v) => v.includes(q)),
    );
  }, [rows, query]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-zinc-700 bg-[#0c141f] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white">{title}</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {subtitle ??
                `${rows.length} active combo${rows.length === 1 ? "" : "s"} still waiting on this`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 px-1 text-xl leading-none text-zinc-500 hover:text-white"
            title="Close"
          >
            ✕
          </button>
        </div>

        {rows.length > 0 && (
          <div className="border-b border-zinc-800 px-5 py-2.5">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by graphic, style, ground, plant, technique, comment…"
              className="w-full rounded-md border border-zinc-700 bg-[#0f1a26] px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </div>
        )}

        <div className="custom-scrollbar flex-1 space-y-2.5 overflow-y-auto p-4">
          {rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-500">
              Nothing to show here. 🎉
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-500">
              No combos match “{query}”.
            </div>
          ) : (
            filtered.map((r, i) => (
              <ComboCard key={`${r.id}_${i}`} r={r} onUpdateRow={onUpdateRow} />
            ))
          )}
        </div>

        {rows.length > 0 && (
          <div className="border-t border-zinc-800 px-5 py-2 text-right text-[11px] text-zinc-500">
            {query ? `${filtered.length} of ${rows.length}` : `${rows.length}`} shown
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
