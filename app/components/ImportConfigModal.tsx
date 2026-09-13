import React, { useState, useEffect } from "react";

interface ImportConfigModalProps {
  isOpen: boolean;
  fileName: string;
  defaultCategory: string;
  defaultSeason: string;
  availableSheets: string[];
  defaultSheets: string[];
  previewHeaders?: string[];
  // True for uploads made through the dedicated "Import Planning Sheet" button — that button
  // always runs update-only (never creates new items), so the checkbox below is shown locked
  // on rather than editable, to make that plain rather than implying it's optional here.
  isPlanningSheetImport?: boolean;
  // True for uploads made through the dedicated "CK Tracking Chart" button — that button always
  // forces Category on every row regardless of what's picked below, so the Force Override
  // Category control is hidden rather than shown-but-ineffective.
  isCkImport?: boolean;
  // The specific CK category resolved from the file name ("CKNA Men's" / "CKNA Women's" / "CKP" /
  // "Other Knit", or bare "CK" when unrecognised). Shown in the locked-category notice.
  ckCategory?: string;
  onCancel: () => void;
  onConfirm: (
    category: string,
    season: string,
    selectedSheets: string[],
    skipNewRows: boolean,
    skipAutoSchedule: boolean,
    planStartDate: string,
  ) => void;
}

export default function ImportConfigModal({
  isOpen,
  fileName,
  defaultSeason,
  availableSheets,
  defaultSheets,
  previewHeaders = [],
  isPlanningSheetImport = false,
  isCkImport = false,
  ckCategory = "CK",
  onCancel,
  onConfirm,
}: ImportConfigModalProps) {
  // Category / Season overrides start BLANK, never pre-filled from the dashboard filter.
  // When set, they're applied to every row BEFORE the import's row-matching identity is
  // computed (see processImportFile in app/page.tsx) — so picking "VS AE" here lets a chart
  // that labels the same items "ANGEL ESSENTIALS" match the existing database rows. A blank
  // override stays out of matching entirely, which is what stops a re-import under a
  // different dashboard filter from creating duplicate rows.
  const [category, setCategory] = useState("");
  const [season, setSeason] = useState("");
  const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set(defaultSheets));
  const [skipNewRows, setSkipNewRows] = useState(isPlanningSheetImport);
  const [skipAutoSchedule, setSkipAutoSchedule] = useState(false);
  // Blank = auto-schedule (re)planned items from the next working day, the existing default.
  const [planStartDate, setPlanStartDate] = useState("");

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  // Sync state when modal opens during render (avoids cascading renders)
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setCategory("");
      setSeason("");
      setSelectedSheets(new Set(defaultSheets));
      setSkipNewRows(isPlanningSheetImport);
      setSkipAutoSchedule(false);
      setPlanStartDate("");
    }
  }

  if (!isOpen) return null;

  const toggleSheet = (sheet: string) => {
    const next = new Set(selectedSheets);
    if (next.has(sheet)) {
      next.delete(sheet);
    } else {
      next.add(sheet);
    }
    setSelectedSheets(next);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-zinc-150 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">
            {isPlanningSheetImport
              ? "Import Planning Sheet"
              : isCkImport
              ? "Import CK Tracking Chart"
              : "Import Configuration"}
          </h2>
        </div>
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You are importing <strong>{fileName}</strong>. 
          </p>

          {previewHeaders.length > 0 && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Detected Column Headers
              </label>
              <div className="flex flex-wrap gap-1.5 p-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg max-h-32 overflow-y-auto text-[10px] font-mono text-zinc-600 dark:text-zinc-400">
                {previewHeaders.map((header, i) => (
                  <span key={i} className="px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-800 rounded">
                    {header}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Select Sheets to Import
            </label>
            <div className="flex flex-col gap-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 max-h-32 overflow-y-auto">
              {availableSheets.map(sheet => (
                <label key={sheet} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSheets.has(sheet)}
                    onChange={() => toggleSheet(sheet)}
                    className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500"
                  />
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">{sheet}</span>
                </label>
              ))}
              {availableSheets.length === 0 && (
                <p className="text-sm text-zinc-500">No sheets found.</p>
              )}
            </div>
          </div>

          {isCkImport ? (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/40 rounded-lg">
              <span className="block text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                Category is locked to {ckCategory}
              </span>
              <span className="block text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                Every row from this file is stamped Category = {ckCategory} (resolved from the file
                name) &mdash; on new rows and on matched existing ones. That&apos;s what routes CK
                rows onto the S/off Status (A/D/SP/CP/H) status logic instead of the standard
                tracking chart&apos;s logic.
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Force Override Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-emerald-500/50 outline-none transition-all"
              >
                <option value="">-- Do not override --</option>
                <option value="VS-SLEEP">VS-SLEEP</option>
                <option value="VS AE">VS AE</option>
                <option value="VS-VERY SEXY">VS-VERY SEXY</option>
                <option value="PINK">PINK</option>
                <option value="CK">CK</option>
                <option value="CKNA Men's">CKNA Men&apos;s</option>
                <option value="CKNA Women's">CKNA Women&apos;s</option>
                <option value="CKP">CKP</option>
                <option value="Other Knit">Other Knit</option>
              </select>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">
                Overwrites Category on every row <strong>and</strong> uses it to match existing
                database rows. Set this when the file&apos;s Category differs from what&apos;s
                stored &mdash; e.g. the chart says &quot;ANGEL ESSENTIALS&quot; but the rows are
                saved as &quot;VS AE&quot;. Leave blank to match on the file&apos;s own values.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Force Override Season
            </label>
            <input
              type="text"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder={defaultSeason ? `Leave blank to use Excel values (filter: ${defaultSeason})` : "Leave blank to use Excel values..."}
              className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-emerald-500/50 outline-none transition-all uppercase"
            />
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">
              If provided, this overwrites the Season on every row <strong>and</strong> is used to
              match existing database rows. Leave blank to match on the file&apos;s own values.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Plan new / updated items from
            </label>
            <input
              type="date"
              value={planStartDate}
              onChange={(e) => setPlanStartDate(e.target.value)}
              className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-emerald-500/50 outline-none transition-all"
            />
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">
              Any item this import auto-schedules (or re-schedules) starts its planning events
              from this date. Leave blank to start from the next working day, as usual.
            </p>
          </div>

          <label
            className={`flex items-start gap-2.5 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 rounded-lg ${
              isPlanningSheetImport ? "cursor-default opacity-90" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={skipNewRows}
              disabled={isPlanningSheetImport}
              onChange={(e) => setSkipNewRows(e.target.checked)}
              className="w-4 h-4 mt-0.5 rounded text-amber-500 focus:ring-amber-500 disabled:opacity-70"
            />
            <span>
              <span className="block text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                Only update existing rows
                {isPlanningSheetImport && (
                  <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                    Always on for Planning Sheet
                  </span>
                )}
              </span>
              <span className="block text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                {isPlanningSheetImport
                  ? "This upload only fills in dates and other blanks on items your tracking chart already established — it will never create a new database row, no matter what this file contains."
                  : "Skip creating new database rows for anything this file doesn't already match — use this when a file (like a historical planning sheet) should only fill in dates and other blanks on items your tracking chart already established."}
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-800/40 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={skipAutoSchedule}
              onChange={(e) => setSkipAutoSchedule(e.target.checked)}
              className="w-4 h-4 mt-0.5 rounded text-blue-500 focus:ring-blue-500"
            />
            <span>
              <span className="block text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                Historical data — don&apos;t auto-generate planning dates
              </span>
              <span className="block text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                Any planning dates already in the file are always imported as-is. This only stops
                the system from inventing a fresh schedule for rows that have no dates at all —
                use it for a one-time bulk import of old records into a new database, so items
                that were already finished (or tracked outside this system) don&apos;t suddenly
                get a brand-new auto-planned schedule. Leave this unchecked for normal day-to-day
                tracking-chart uploads, where auto-scheduling new items is exactly what you want.
              </span>
            </span>
          </label>
        </div>

        <div className="px-6 py-4 border-t border-zinc-150 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onConfirm(
                category,
                season.toUpperCase().trim(),
                Array.from(selectedSheets),
                skipNewRows,
                skipAutoSchedule,
                planStartDate,
              )
            }
            disabled={selectedSheets.size === 0}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-colors"
          >
            Continue Import
          </button>
        </div>
      </div>
    </div>
  );
}
