import React, { useEffect, useMemo, useState } from "react";
import {
  EmbellishmentRow,
  getSeasonAoqConfig,
  saveSeasonAoqConfig,
  SeasonAoqMap,
  getTriggerCatalog,
  saveTriggerCatalog,
  TriggerCatalogEntry,
} from "../lib/db";
import { formatDateDDMMYYYY, seasonAoqKey } from "../lib/triggerUtils";

interface TriggerManagementViewProps {
  rows: EmbellishmentRow[]; // current-version rows only (same convention as AdvancedDashboard)
  onUpdateRow: (row: EmbellishmentRow) => void | Promise<void>;
  currentRole: string;
}

export default function TriggerManagementView({
  rows,
  currentRole,
}: TriggerManagementViewProps) {
  const canManage = currentRole === "Planner" || currentRole === "Management";

  // Season AOQ dates — the fallback deadline Plant Performance uses when a row's own Trigger
  // carries no date (col20 blank, and the trigger text isn't an M.D code like "4.7"). Every
  // season needs its own AOQ per category — PINK's SU27 date isn't VS's SU27 date, and CK runs
  // its own calendar entirely — so this is keyed on Category+Season, not on Season alone.
  const [seasonAoq, setSeasonAoq] = useState<SeasonAoqMap>({});
  const [seasonAoqLoaded, setSeasonAoqLoaded] = useState(false);
  const [seasonSearch, setSeasonSearch] = useState("");
  const [editingSeasonKey, setEditingSeasonKey] = useState<string | null>(null);
  const [seasonAoqDraft, setSeasonAoqDraft] = useState("");
  const [seasonAoqSaving, setSeasonAoqSaving] = useState<string | null>(null);

  // "Add Season" — lets a planner declare a Category+Season combo (and optionally its AOQ date)
  // before any row using it has been imported yet, instead of waiting for the list to pick it up
  // from row data. Declared seasons are just a season_aoq key with a possibly-empty date, unioned
  // into seasonAoqRows below alongside whatever rows already contributed.
  const [newSeasonCategory, setNewSeasonCategory] = useState("");
  const [newSeasonName, setNewSeasonName] = useState("");
  const [newSeasonAoqDate, setNewSeasonAoqDate] = useState("");
  const [addingSeason, setAddingSeason] = useState(false);

  useEffect(() => {
    getSeasonAoqConfig()
      .then((m) => setSeasonAoq(m))
      .finally(() => setSeasonAoqLoaded(true));
  }, []);

  interface SeasonAoqRow {
    key: string;
    category: string;
    season: string;
    rowCount: number;
    aoqIso: string | null;
  }

  const seasonAoqRows = useMemo(() => {
    const map = new Map<string, { category: string; season: string; rowCount: number }>();
    rows.forEach((r) => {
      const category = String(r.col3 || "").trim();
      const season = String(r.col4 || "").trim();
      if (!category || !season) return;
      const key = seasonAoqKey(category, season);
      const entry = map.get(key) || { category, season, rowCount: 0 };
      entry.rowCount++;
      map.set(key, entry);
    });
    // Union in any Category+Season declared via "Add Season" below that no row uses yet —
    // otherwise a pre-declared season (with 0 rows so far) would never show up in the list.
    Object.keys(seasonAoq).forEach((key) => {
      if (map.has(key)) return;
      const [category, season] = key.split("|||");
      if (!category || !season) return;
      map.set(key, { category, season, rowCount: 0 });
    });
    return Array.from(map.entries())
      .map(([key, v]): SeasonAoqRow => ({ ...v, key, aoqIso: seasonAoq[key] || null }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.season.localeCompare(b.season));
  }, [rows, seasonAoq]);

  const filteredSeasonAoqRows = useMemo(() => {
    const q = seasonSearch.trim().toLowerCase();
    if (!q) return seasonAoqRows;
    return seasonAoqRows.filter(
      (r) => r.category.toLowerCase().includes(q) || r.season.toLowerCase().includes(q),
    );
  }, [seasonAoqRows, seasonSearch]);

  const knownCategories = useMemo(
    () => Array.from(new Set(seasonAoqRows.map((r) => r.category))).sort(),
    [seasonAoqRows],
  );
  const knownSeasons = useMemo(
    () => Array.from(new Set(seasonAoqRows.map((r) => r.season))).sort(),
    [seasonAoqRows],
  );

  const startEditingSeasonAoq = (r: SeasonAoqRow) => {
    if (!canManage) return;
    setEditingSeasonKey(r.key);
    setSeasonAoqDraft(r.aoqIso || "");
  };

  const saveSeasonAoqRow = async (r: SeasonAoqRow) => {
    setEditingSeasonKey(null);
    if (!seasonAoqDraft) return;
    setSeasonAoqSaving(r.key);
    try {
      const next = { ...seasonAoq, [r.key]: seasonAoqDraft };
      await saveSeasonAoqConfig(next);
      setSeasonAoq(next);
    } finally {
      setSeasonAoqSaving(null);
    }
  };

  const clearSeasonAoqRow = async (r: SeasonAoqRow) => {
    if (!canManage || !r.aoqIso) return;
    setSeasonAoqSaving(r.key);
    try {
      const next = { ...seasonAoq };
      delete next[r.key];
      await saveSeasonAoqConfig(next);
      setSeasonAoq(next);
    } finally {
      setSeasonAoqSaving(null);
    }
  };

  const handleAddSeason = async () => {
    if (!canManage || !newSeasonCategory.trim() || !newSeasonName.trim()) return;
    const key = seasonAoqKey(newSeasonCategory, newSeasonName);
    setAddingSeason(true);
    try {
      const next = { ...seasonAoq };
      // Keep any existing date on this key if it already exists and no new date was typed;
      // otherwise set (or clear) it to whatever was entered here.
      next[key] = newSeasonAoqDate || seasonAoq[key] || "";
      await saveSeasonAoqConfig(next);
      setSeasonAoq(next);
      setNewSeasonCategory("");
      setNewSeasonName("");
      setNewSeasonAoqDate("");
    } finally {
      setAddingSeason(false);
    }
  };

  // Trigger catalog — planner-defined Triggers, each with its own AOQ date and the Category +
  // Season it belongs to. Backs the col2 "Trigger" autocomplete on the Dashboard table
  // (Table.tsx): typing/picking a known Trigger there auto-fills col20 (AOQ) from here.
  const [triggerCatalog, setTriggerCatalog] = useState<TriggerCatalogEntry[]>([]);
  const [triggerCatalogLoaded, setTriggerCatalogLoaded] = useState(false);
  const [triggerSearch, setTriggerSearch] = useState("");
  const [triggerSaving, setTriggerSaving] = useState(false);
  const [editingTriggerId, setEditingTriggerId] = useState<string | null>(null);
  const [editTriggerAoqDraft, setEditTriggerAoqDraft] = useState("");

  const [newTriggerName, setNewTriggerName] = useState("");
  const [newTriggerCategory, setNewTriggerCategory] = useState("");
  const [newTriggerSeason, setNewTriggerSeason] = useState("");
  const [newTriggerAoqDate, setNewTriggerAoqDate] = useState("");

  useEffect(() => {
    getTriggerCatalog()
      .then(setTriggerCatalog)
      .finally(() => setTriggerCatalogLoaded(true));
  }, []);

  const filteredTriggerCatalog = useMemo(() => {
    const q = triggerSearch.trim().toLowerCase();
    const sorted = [...triggerCatalog].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return sorted;
    return sorted.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.season.toLowerCase().includes(q),
    );
  }, [triggerCatalog, triggerSearch]);

  const handleAddTrigger = async () => {
    if (!canManage || !newTriggerName.trim()) return;
    const entry: TriggerCatalogEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: newTriggerName.trim(),
      category: newTriggerCategory.trim(),
      season: newTriggerSeason.trim(),
      aoqIso: newTriggerAoqDate,
    };
    const next = [...triggerCatalog, entry];
    setTriggerSaving(true);
    try {
      await saveTriggerCatalog(next);
      setTriggerCatalog(next);
      setNewTriggerName("");
      setNewTriggerCategory("");
      setNewTriggerSeason("");
      setNewTriggerAoqDate("");
    } finally {
      setTriggerSaving(false);
    }
  };

  const startEditingTriggerAoq = (t: TriggerCatalogEntry) => {
    if (!canManage) return;
    setEditingTriggerId(t.id);
    setEditTriggerAoqDraft(t.aoqIso || "");
  };

  const saveTriggerAoq = async (t: TriggerCatalogEntry) => {
    setEditingTriggerId(null);
    const next = triggerCatalog.map((x) => (x.id === t.id ? { ...x, aoqIso: editTriggerAoqDraft } : x));
    setTriggerSaving(true);
    try {
      await saveTriggerCatalog(next);
      setTriggerCatalog(next);
    } finally {
      setTriggerSaving(false);
    }
  };

  const handleDeleteTrigger = async (t: TriggerCatalogEntry) => {
    if (!canManage) return;
    if (!window.confirm(`Delete trigger "${t.name}" from the catalog? Rows already using it as their Trigger are untouched.`)) return;
    const next = triggerCatalog.filter((x) => x.id !== t.id);
    setTriggerSaving(true);
    try {
      await saveTriggerCatalog(next);
      setTriggerCatalog(next);
    } finally {
      setTriggerSaving(false);
    }
  };

  return (
    <div className="flex-1 bg-[#09111c] p-6 pb-24 text-white min-h-screen font-sans overflow-y-auto custom-scrollbar">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-bold text-white">Season AOQ Dates</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Fallback deadline Plant Performance uses when a row&apos;s Trigger has no date of
            its own (e.g. &quot;KNIT&quot;, &quot;COMPLETE&quot;). One date per Category +
            Season — PINK, VS and CK each run their own AOQ calendar even within the same
            season.
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
            value={seasonSearch}
            onChange={(e) => setSeasonSearch(e.target.value)}
            placeholder="Search category or season..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
          />
        </div>
      </div>

      {canManage && (
        <div className="mb-4 flex flex-wrap items-end gap-2 p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Category</label>
            <input
              type="text"
              list="known-categories-datalist"
              value={newSeasonCategory}
              onChange={(e) => setNewSeasonCategory(e.target.value)}
              placeholder="e.g. VS-AE"
              className="w-40 px-2.5 py-1.5 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Season</label>
            <input
              type="text"
              list="known-seasons-datalist"
              value={newSeasonName}
              onChange={(e) => setNewSeasonName(e.target.value)}
              placeholder="e.g. SP28"
              className="w-32 px-2.5 py-1.5 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">AOQ Date (optional)</label>
            <input
              type="date"
              value={newSeasonAoqDate}
              onChange={(e) => setNewSeasonAoqDate(e.target.value)}
              className="px-2.5 py-1.5 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-white focus:outline-none focus:border-amber-500/50"
            />
          </div>
          <button
            onClick={handleAddSeason}
            disabled={addingSeason || !newSeasonCategory.trim() || !newSeasonName.trim()}
            className="px-3 py-1.5 text-xs font-bold text-black bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {addingSeason ? "Adding…" : "Add Season"}
          </button>
          <datalist id="known-categories-datalist">
            {knownCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <datalist id="known-seasons-datalist">
            {knownSeasons.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      )}

      <div className="border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900/80 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="p-3">Category</th>
                <th className="p-3">Season</th>
                <th className="p-3 text-right">Rows</th>
                <th className="p-3">AOQ Date</th>
                {canManage && <th className="p-3 w-10" />}
              </tr>
            </thead>
            <tbody>
              {!seasonAoqLoaded ? (
                <tr>
                  <td colSpan={canManage ? 5 : 4} className="p-8 text-center text-zinc-500 text-sm">
                    Loading…
                  </td>
                </tr>
              ) : filteredSeasonAoqRows.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 5 : 4} className="p-8 text-center text-zinc-500 text-sm">
                    No Category/Season combinations match &quot;{seasonSearch}&quot;.
                  </td>
                </tr>
              ) : (
                filteredSeasonAoqRows.map((r) => (
                  <tr key={r.key} className="border-t border-zinc-800/60 hover:bg-zinc-900/40 transition-colors">
                    <td className="p-3 font-semibold text-white">{r.category}</td>
                    <td className="p-3 text-zinc-300">{r.season}</td>
                    <td className="p-3 text-right text-zinc-300 tabular-nums">{r.rowCount}</td>
                    <td className="p-3">
                      {editingSeasonKey === r.key ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="date"
                            value={seasonAoqDraft}
                            onChange={(e) => setSeasonAoqDraft(e.target.value)}
                            autoFocus
                            className="px-2 py-1 text-xs bg-zinc-950 border border-amber-500/50 rounded text-white focus:outline-none"
                          />
                          <button
                            onClick={() => saveSeasonAoqRow(r)}
                            disabled={seasonAoqSaving === r.key}
                            className="px-2 py-1 text-[10px] font-bold text-black bg-emerald-400 hover:bg-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed rounded"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingSeasonKey(null)}
                            disabled={seasonAoqSaving === r.key}
                            className="px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditingSeasonAoq(r)}
                          disabled={!canManage || seasonAoqSaving === r.key}
                          className={`px-2 py-1 text-xs font-bold rounded border ${
                            r.aoqIso
                              ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                              : "text-zinc-500 border-zinc-700"
                          } ${canManage ? "hover:brightness-110 cursor-pointer" : "cursor-default"}`}
                          title={canManage ? "Click to edit this Category+Season's AOQ date" : undefined}
                        >
                          {seasonAoqSaving === r.key ? "Saving…" : r.aoqIso ? formatDateDDMMYYYY(r.aoqIso) : "Not Set"}
                        </button>
                      )}
                    </td>
                    {canManage && (
                      <td className="p-3 text-right">
                        {r.aoqIso && (
                          <button
                            onClick={() => clearSeasonAoqRow(r)}
                            disabled={seasonAoqSaving === r.key}
                            className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors"
                            title="Clear this AOQ date"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Trigger catalog — planner-defined Triggers with their own AOQ date + Category/Season.
          Feeds the col2 "Trigger" autocomplete on the Dashboard table. */}
      <div className="mt-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-bold text-white">Triggers</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Named Triggers a planner can pick when typing col2 (Trigger) on the Dashboard
              table — picking one there auto-fills its AOQ date below onto that row.
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
              value={triggerSearch}
              onChange={(e) => setTriggerSearch(e.target.value)}
              placeholder="Search trigger, category or season..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
            />
          </div>
        </div>

        {canManage && (
          <div className="mb-4 flex flex-wrap items-end gap-2 p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Trigger Name</label>
              <input
                type="text"
                value={newTriggerName}
                onChange={(e) => setNewTriggerName(e.target.value)}
                placeholder="e.g. 4.7/4.28"
                className="w-40 px-2.5 py-1.5 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Category</label>
              <input
                type="text"
                list="known-categories-datalist"
                value={newTriggerCategory}
                onChange={(e) => setNewTriggerCategory(e.target.value)}
                placeholder="e.g. VS-AE"
                className="w-32 px-2.5 py-1.5 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Season</label>
              <input
                type="text"
                list="known-seasons-datalist"
                value={newTriggerSeason}
                onChange={(e) => setNewTriggerSeason(e.target.value)}
                placeholder="e.g. SU27"
                className="w-28 px-2.5 py-1.5 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">AOQ Date</label>
              <input
                type="date"
                value={newTriggerAoqDate}
                onChange={(e) => setNewTriggerAoqDate(e.target.value)}
                className="px-2.5 py-1.5 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-white focus:outline-none focus:border-amber-500/50"
              />
            </div>
            <button
              onClick={handleAddTrigger}
              disabled={triggerSaving || !newTriggerName.trim()}
              className="px-3 py-1.5 text-xs font-bold text-black bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {triggerSaving ? "Adding…" : "Add Trigger"}
            </button>
          </div>
        )}

        <div className="border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-900/80 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                  <th className="p-3">Trigger</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Season</th>
                  <th className="p-3">AOQ Date</th>
                  {canManage && <th className="p-3 w-10" />}
                </tr>
              </thead>
              <tbody>
                {!triggerCatalogLoaded ? (
                  <tr>
                    <td colSpan={canManage ? 5 : 4} className="p-8 text-center text-zinc-500 text-sm">
                      Loading…
                    </td>
                  </tr>
                ) : filteredTriggerCatalog.length === 0 ? (
                  <tr>
                    <td colSpan={canManage ? 5 : 4} className="p-8 text-center text-zinc-500 text-sm">
                      {triggerCatalog.length === 0
                        ? "No triggers defined yet — add one above."
                        : `No triggers match "${triggerSearch}".`}
                    </td>
                  </tr>
                ) : (
                  filteredTriggerCatalog.map((t) => (
                    <tr key={t.id} className="border-t border-zinc-800/60 hover:bg-zinc-900/40 transition-colors">
                      <td className="p-3 font-semibold text-white">{t.name}</td>
                      <td className="p-3 text-zinc-400">{t.category || "—"}</td>
                      <td className="p-3 text-zinc-400">{t.season || "—"}</td>
                      <td className="p-3">
                        {editingTriggerId === t.id ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="date"
                              value={editTriggerAoqDraft}
                              onChange={(e) => setEditTriggerAoqDraft(e.target.value)}
                              autoFocus
                              className="px-2 py-1 text-xs bg-zinc-950 border border-amber-500/50 rounded text-white focus:outline-none"
                            />
                            <button
                              onClick={() => saveTriggerAoq(t)}
                              disabled={triggerSaving}
                              className="px-2 py-1 text-[10px] font-bold text-black bg-emerald-400 hover:bg-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed rounded"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingTriggerId(null)}
                              disabled={triggerSaving}
                              className="px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEditingTriggerAoq(t)}
                            disabled={!canManage || triggerSaving}
                            className={`px-2 py-1 text-xs font-bold rounded border ${
                              t.aoqIso
                                ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                                : "text-zinc-500 border-zinc-700"
                            } ${canManage ? "hover:brightness-110 cursor-pointer" : "cursor-default"}`}
                            title={canManage ? "Click to edit this trigger's AOQ date" : undefined}
                          >
                            {t.aoqIso ? formatDateDDMMYYYY(t.aoqIso) : "Not Set"}
                          </button>
                        )}
                      </td>
                      {canManage && (
                        <td className="p-3 text-right">
                          <button
                            onClick={() => handleDeleteTrigger(t)}
                            disabled={triggerSaving}
                            className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors"
                            title="Delete this trigger from the catalog (rows already using it are untouched)"
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
