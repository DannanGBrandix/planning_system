import React, { useState } from "react";
import { ColumnMapping, DEFAULT_COLUMNS } from "../lib/db";

interface ColumnConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  columns: ColumnMapping;
  onSave: (updatedCols: ColumnMapping) => void;
}

export default function ColumnConfigModal({
  isOpen,
  onClose,
  columns,
  onSave,
}: ColumnConfigModalProps) {
  const [localCols, setLocalCols] = useState<ColumnMapping>({ ...columns });

  if (!isOpen) return null;

  const handleColumnChange = (key: string, value: string) => {
    setLocalCols((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(localCols);
    onClose();
  };

  const handleReset = () => {
    if (window.confirm("Are you sure you want to reset all column headers to their default apparel planning names?")) {
      setLocalCols({ ...DEFAULT_COLUMNS });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-3xl max-h-[85vh] flex flex-col bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Rename Column Headers</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Customize the names of the {Object.keys(DEFAULT_COLUMNS).length} columns in your embellishment planning sheet.</p>
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

        {/* Content */}
        <form onSubmit={handleSave} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              {Object.keys(DEFAULT_COLUMNS).map((key, idx) => {
                const labelNumber = idx + 1;
                return (
                  <div key={key} className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] text-zinc-500 font-mono">
                        {labelNumber}
                      </span>
                      {key === "col1" ? "Status Column" : `Column ${labelNumber}`}
                      {key === "col1" && (
                        <span className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded font-normal">
                          Primary Column
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={localCols[key] || ""}
                      onChange={(e) => handleColumnChange(key, e.target.value)}
                      required
                      placeholder={`Column ${labelNumber} name`}
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 transition-all"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2 text-sm font-medium text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/20 rounded-xl transition-all"
            >
              Reset to Defaults
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-850 rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm hover:shadow-md transition-all active:scale-[0.98]"
              >
                Save Changes
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
