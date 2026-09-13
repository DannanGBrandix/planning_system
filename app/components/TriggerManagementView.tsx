import React, { useEffect, useMemo, useState } from "react";
import { EmbellishmentRow } from "../lib/db";
import { extractValidDate, formatDateDDMMYYYY, isValidTriggerValue } from "../lib/triggerUtils";

interface TriggerManagementViewProps {
  rows: EmbellishmentRow[]; // current-version rows only (same convention as AdvancedDashboard)
  onUpdateRow: (row: EmbellishmentRow) => void | Promise<void>;
  currentRole: string;
}

interface TriggerGroup {
  name: string; // exact col2 value, e.g. "4.7" and "4.7/4.28" are two DIFFERENT groups
  rows: EmbellishmentRow[];
  seasons: string[]; // distinct col4 values in use
  categories: string[]; // distinct col3 values in use
  aoqDateStr: string; // "Not Set" or a comma-joined DD/MM/YYYY list
  latestAoqIso: string | null; // first parsed ISO date, used to seed the edit input
}

export default function TriggerManagementView({
  rows,
  onUpdateRow,
  currentRole,
}: TriggerManagementViewProps) {
  const canManage = currentRole === "Planner" || currentRole === "Management";

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingAoqName, setEditingAoqName] = useState<string | null>(null);
  const [aoqDraft, setAoqDraft] = useState("");
  const [mergePanelOpen, setMergePanelOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string>("");
  const [mergeCustomName, setMergeCustomName] = useState("");

  // A delete/merge/AOQ-save saves one row at a time, in sequence (not fired all at once) — with
  // 100+ rows sharing one trigger, firing every save simultaneously with no way to tell whether
  // any of them actually finished let a page reload or navigation silently cut off whichever
  // hadn't completed yet, while the trigger still disappeared from THIS screen immediately
  // (confirmed as a real incident: deleting KNIT/SPORT/LOUNGE left the vast majority of their
  // rows unsaved server-side even though they'd already vanished from this list). Awaiting each
  // one in turn — and showing that it's still working — is what keeps the on-screen result
  // trustworthy, and the beforeunload guard below stops a reload from repeating the incident.
  const [busy, setBusy] = useState<{ label: string; done: number; total: number } | null>(null);

  useEffect(() => {
    if (!busy) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy]);

  const triggerGroups = useMemo(() => {
    const map = new Map<string, TriggerGroup>();
    rows.forEach((r) => {
      const raw = String(r.col2 || "").trim();
      if (!isValidTriggerValue(raw)) return;

      if (!map.has(raw)) {
        map.set(raw, { name: raw, rows: [], seasons: [], categories: [], aoqDateStr: "", latestAoqIso: null });
      }
      const group = map.get(raw)!;
      group.rows.push(r);

      const season = String(r.col4 || "").trim();
      if (season && !group.seasons.includes(season)) group.seasons.push(season);

      const category = String(r.col3 || "").trim();
      if (category && !group.categories.includes(category)) group.categories.push(category);
    });

    return Array.from(map.values())
      .map((group) => {
        const isoDates = Array.from(
          new Set(group.rows.map((r) => extractValidDate(r.col20)).filter((d): d is string => Boolean(d))),
        ).sort();
        const formatted = isoDates.map((d) => formatDateDDMMYYYY(d)).filter(Boolean);
        return {
          ...group,
          aoqDateStr: formatted.length > 0 ? formatted.join(", ") : "Not Set",
          latestAoqIso: isoDates[0] || null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [rows]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return triggerGroups;
    return triggerGroups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.seasons.some((s) => s.toLowerCase().includes(q)) ||
        g.categories.some((c) => c.toLowerCase().includes(q)),
    );
  }, [triggerGroups, search]);

  const selectedGroups = useMemo(
    () => triggerGroups.filter((g) => selected.has(g.name)),
    [triggerGroups, selected],
  );
  const totalSelectedRows = useMemo(
    () => selectedGroups.reduce((sum, g) => sum + g.rows.length, 0),
    [selectedGroups],
  );

  const toggleSelected = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleDelete = async (group: TriggerGroup) => {
    if (!canManage || busy) return;
    const ok = window.confirm(
      `Delete trigger "${group.name}"?\n\nThis clears the Trigger field on ${group.rows.length} row(s) (set to "N/A") — the rows and their planning data are NOT deleted, only the Trigger tag. This can't be undone automatically.`,
    );
    if (!ok) return;

    const targets = group.rows.filter((r) => String(r.col2 || "").trim() === group.name);
    setBusy({ label: `Deleting "${group.name}"`, done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      await onUpdateRow({ ...targets[i], col2: "N/A" });
      setBusy({ label: `Deleting "${group.name}"`, done: i + 1, total: targets.length });
    }
    setBusy(null);

    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(group.name);
      return next;
    });
  };

  const openMergePanel = () => {
    if (selectedGroups.length < 2) return;
    // Default the canonical name to whichever selected trigger covers the most rows — usually
    // the "more complete" spelling (e.g. "4.7/4.28" over "4.7").
    const best = [...selectedGroups].sort((a, b) => b.rows.length - a.rows.length)[0];
    setMergeTarget(best.name);
    setMergeCustomName("");
    setMergePanelOpen(true);
  };

  const confirmMerge = async () => {
    if (busy) return;
    const finalName = mergeCustomName.trim() || mergeTarget;
    if (!finalName) return;
    const ok = window.confirm(
      `Merge ${selectedGroups.length} triggers into "${finalName}"?\n\nThis retags ${totalSelectedRows} row(s) total.`,
    );
    if (!ok) return;

    const targets = selectedGroups.flatMap((group) =>
      group.rows.filter((r) => String(r.col2 || "").trim() !== finalName),
    );
    setBusy({ label: `Merging into "${finalName}"`, done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      await onUpdateRow({ ...targets[i], col2: finalName });
      setBusy({ label: `Merging into "${finalName}"`, done: i + 1, total: targets.length });
    }
    setBusy(null);

    setSelected(new Set());
    setMergePanelOpen(false);
    setMergeCustomName("");
  };

  const startEditingAoq = (group: TriggerGroup) => {
    if (!canManage) return;
    setEditingAoqName(group.name);
    setAoqDraft(group.latestAoqIso || "");
  };

  const saveAoq = async (group: TriggerGroup) => {
    if (!aoqDraft || busy) {
      setEditingAoqName(null);
      return;
    }
    setEditingAoqName(null);
    setBusy({ label: `Setting AOQ date for "${group.name}"`, done: 0, total: group.rows.length });
    for (let i = 0; i < group.rows.length; i++) {
      await onUpdateRow({ ...group.rows[i], col20: aoqDraft });
      setBusy({ label: `Setting AOQ date for "${group.name}"`, done: i + 1, total: group.rows.length });
    }
    setBusy(null);
  };

  return (
    <div className="flex-1 bg-[#09111c] p-6 pb-24 text-white min-h-screen font-sans overflow-y-auto custom-scrollbar">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-bold text-white">Trigger Manager</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {triggerGroups.length} distinct trigger{triggerGroups.length === 1 ? "" : "s"} across {rows.length} row
            {rows.length === 1 ? "" : "s"} (every status, including Dropped)
            {!canManage && " — read-only for your role"}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <svg
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search trigger or season..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
          />
        </div>
      </div>

      {busy && (
        <div className="sticky top-0 z-30 mb-4 px-4 py-3 bg-blue-500/10 border border-blue-500/30 rounded-xl">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-sm font-semibold text-blue-300 flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {busy.label}… please don&apos;t close or reload this tab until it finishes.
            </span>
            <span className="text-xs text-blue-300 tabular-nums shrink-0">
              {busy.done} / {busy.total}
            </span>
          </div>
          <div className="h-1.5 bg-blue-950 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-400 transition-all"
              style={{ width: `${busy.total > 0 ? (busy.done / busy.total) * 100 : 100}%` }}
            />
          </div>
        </div>
      )}

      {canManage && selected.size > 0 && (
        <div className="sticky top-0 z-20 mb-4 flex items-center justify-between gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
          <span className="text-sm font-semibold text-amber-300">
            {selected.size} trigger{selected.size === 1 ? "" : "s"} selected ({totalSelectedRows} row
            {totalSelectedRows === 1 ? "" : "s"})
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set())}
              disabled={!!busy}
              className="px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              Clear
            </button>
            <button
              onClick={openMergePanel}
              disabled={selected.size < 2 || !!busy}
              className="px-3 py-1.5 text-xs font-bold text-black bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
              title={selected.size < 2 ? "Select at least 2 triggers to merge" : "Merge the selected triggers into one"}
            >
              Merge Selected
            </button>
          </div>
        </div>
      )}

      {mergePanelOpen && (
        <div className="mb-5 p-4 bg-zinc-900 border border-amber-500/40 rounded-xl">
          <h3 className="text-sm font-bold text-white mb-1">
            Merge {selectedGroups.length} triggers into one
          </h3>
          <p className="text-xs text-zinc-500 mb-3">
            Every row currently tagged with any of the triggers below will be retagged to the name you pick. This
            affects {totalSelectedRows} row{totalSelectedRows === 1 ? "" : "s"} total.
          </p>
          <div className="flex flex-col gap-1.5 mb-3">
            {selectedGroups.map((g) => (
              <label
                key={g.name}
                className="flex items-center gap-2 px-3 py-2 bg-zinc-950/60 border border-zinc-800 rounded-lg cursor-pointer hover:border-zinc-700"
              >
                <input
                  type="radio"
                  name="mergeTarget"
                  checked={!mergeCustomName && mergeTarget === g.name}
                  onChange={() => {
                    setMergeTarget(g.name);
                    setMergeCustomName("");
                  }}
                />
                <span className="text-sm text-white font-semibold">{g.name}</span>
                <span className="text-xs text-zinc-500">
                  ({g.rows.length} row{g.rows.length === 1 ? "" : "s"})
                </span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-zinc-500 shrink-0">Or a new name:</span>
            <input
              type="text"
              value={mergeCustomName}
              onChange={(e) => setMergeCustomName(e.target.value)}
              placeholder="e.g. 4.7/4.28"
              className="flex-1 px-3 py-1.5 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setMergePanelOpen(false)}
              disabled={!!busy}
              className="px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmMerge}
              disabled={!!busy}
              className="px-4 py-1.5 text-xs font-bold text-black bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              Merge into &quot;{mergeCustomName.trim() || mergeTarget}&quot;
            </button>
          </div>
        </div>
      )}

      <div className="border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900/80 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                {canManage && <th className="p-3 w-8" />}
                <th className="p-3">Trigger</th>
                <th className="p-3">Category</th>
                <th className="p-3">Season(s)</th>
                <th className="p-3 text-right">Rows</th>
                <th className="p-3">AOQ Date</th>
                {canManage && <th className="p-3 w-10" />}
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map((group) => (
                <tr key={group.name} className="border-t border-zinc-800/60 hover:bg-zinc-900/40 transition-colors">
                  {canManage && (
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(group.name)}
                        onChange={() => toggleSelected(group.name)}
                        disabled={!!busy}
                      />
                    </td>
                  )}
                  <td className="p-3 font-semibold text-white">{group.name}</td>
                  <td className="p-3 text-zinc-400">{group.categories.join(", ") || "—"}</td>
                  <td className="p-3 text-zinc-400">{group.seasons.join(", ") || "—"}</td>
                  <td className="p-3 text-right text-zinc-300 tabular-nums">{group.rows.length}</td>
                  <td className="p-3">
                    {editingAoqName === group.name ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="date"
                          value={aoqDraft}
                          onChange={(e) => setAoqDraft(e.target.value)}
                          autoFocus
                          className="px-2 py-1 text-xs bg-zinc-950 border border-amber-500/50 rounded text-white focus:outline-none"
                        />
                        <button
                          onClick={() => saveAoq(group)}
                          disabled={!!busy}
                          className="px-2 py-1 text-[10px] font-bold text-black bg-emerald-400 hover:bg-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed rounded"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingAoqName(null)}
                          disabled={!!busy}
                          className="px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditingAoq(group)}
                        disabled={!canManage || !!busy}
                        className={`px-2 py-1 text-xs font-bold rounded border ${
                          group.aoqDateStr === "Not Set"
                            ? "text-zinc-500 border-zinc-700"
                            : "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                        } ${canManage ? "hover:brightness-110 cursor-pointer" : "cursor-default"}`}
                        title={canManage ? "Click to edit the AOQ date for every row using this trigger" : undefined}
                      >
                        {group.aoqDateStr}
                      </button>
                    )}
                  </td>
                  {canManage && (
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleDelete(group)}
                        disabled={!!busy}
                        className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors"
                        title="Delete this trigger (clears it from every row using it)"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {filteredGroups.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 7 : 5} className="p-8 text-center text-zinc-500 text-sm">
                    No triggers match &quot;{search}&quot;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
