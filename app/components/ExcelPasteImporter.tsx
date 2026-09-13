import React, { useState, useMemo } from "react";
import { EmbellishmentRow } from "../lib/db";

interface ExcelPasteImporterProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (importedRows: Partial<EmbellishmentRow>[]) => void;
  existingRows: EmbellishmentRow[];
}

const EXCEL_COLUMNS_MAPPING = [
  { key: "col2", label: "Trigger" },
  { key: "col3", label: "Category" },
  { key: "col4", label: "Season" },
  { key: "col5", label: "Style" },
  { key: "col6", label: "Graphi-Combo" },
  { key: "col7", label: "Graphic" },
  { key: "col8", label: "Ground" },
  { key: "col9", label: "Technique(s)" },
  { key: "col10", label: "Process" },
  { key: "col11", label: "Plant" },
  { key: "col12", label: "Plant Flow" },
  { key: "col13", label: "Fabric Reference" },
  { key: "col25", label: "Embellishment Apply Parts" },
  { key: "col15", label: "Application Form" },
  { key: "col26", label: "AWR" },
  { key: "col17", label: "Risk Factor" },
  { key: "col18", label: "Technique Category" },
  { key: "col21", label: "Technique Type" },
  { key: "col27", label: "S-Off Requirement" },
  { key: "col28", label: "Ready Date (Advance Plan)" },
  { key: "col29", label: "Placement Sample" },
  { key: "col30", label: "Dev Trial Requirement" },
  { key: "col31", label: "TC3010/LTD-92 Required" },
  { key: "col32", label: "Fabric IH" }
];

export default function ExcelPasteImporter({
  isOpen,
  onClose,
  onImport,
  existingRows
}: ExcelPasteImporterProps) {
  const [pasteData, setPasteData] = useState("");
  const [hasHeader, setHasHeader] = useState(true);

  // Process and parse pasted text
  const parsedItems = useMemo(() => {
    if (!pasteData.trim()) return [];

    const lines = pasteData.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return [];

    const results: Partial<EmbellishmentRow>[] = [];
    let dynamicColMap: string[] | null = null;

    const HEADER_LOOKUP: Record<string, string> = {
      STATUS: "col1",
      TRIGGER: "col2",
      CATEGORY: "col3",
      SEASON: "col4",
      STYLE: "col5",
      "GRAPHI-COMBO": "col6",
      GRAPHICCOMBO: "col6",
      COMBO: "col6",
      GRAPHIC: "col7",
      GROUND: "col8",
      TECHNIQUE: "col9",
      TECHNIQUES: "col9",
      PROCESS: "col10",
      PLANT: "col11",
      PLANTFLOW: "col12",
      "PLANT FLOW": "col12",
      FABRICREFERENCE: "col13",
      FABRICREF: "col13",
      FABRIC: "col13",
      EMBELLISHMENTAPPLYPARTS: "col25",
      APPLYPARTS: "col25",
      PARTS: "col25",
      APPLICATIONFORM: "col15",
      APPFORM: "col15",
      AWR: "col26",
      RISKFACTOR: "col17",
      RISKCATEGORIE: "col17",
      RISKCATEGORY: "col17",
      TECHNIQUECATEGORY: "col18",
      TECHNIQUETYPE: "col21",
      SOFFREQUIREMENT: "col27",
      READYDATE: "col28",
      PLACEMENTSAMPLE: "col29",
      DEVTRIAL: "col30",
      TC3010: "col31",
      FABRICIH: "col32",
    };

    lines.forEach((line, index) => {
      const cells = line.split("\t").map((cell) => cell.trim());
      if (cells.length === 0) return;

      // Detect header row
      if (index === 0 && hasHeader) {
        const isHeaderLine = cells.some((cell) => {
          const norm = cell.replace(/[^A-Z0-9]/ig, "").toUpperCase();
          return ["TRIGGER", "CATEGORY", "SEASON", "STYLE", "GRAPHIC", "TECHNIQUE", "PROCESS", "PLANT"].includes(norm);
        });

        if (isHeaderLine) {
          // Build dynamic column map for this paste session
          dynamicColMap = cells.map((cell) => {
            const clean = cell.replace(/[^A-Z0-9]/ig, "").toUpperCase();
            if (HEADER_LOOKUP[clean]) return HEADER_LOOKUP[clean];
            const foundKey = Object.keys(HEADER_LOOKUP).find((k) => clean.includes(k) || k.includes(clean));
            return foundKey ? HEADER_LOOKUP[foundKey] : "";
          });
          return; // skip header line itself
        }
      }

      const item: Record<string, string> = {};

      if (dynamicColMap) {
        // Map according to dynamic header positions
        dynamicColMap.forEach((colKey, cIdx) => {
          if (colKey && cells[cIdx] !== undefined) {
            item[colKey] = cells[cIdx];
          }
        });
      } else {
        // Fallback positional mapping
        // If col 0 looks like Status (or line has 25+ columns), shift mapping to include col1 (Status) at index 0
        const startsWithStatus = cells.length >= 25 || ["active", "completed", "draft", "status", "pending"].includes(cells[0].toLowerCase());
        
        if (startsWithStatus) {
          const POSITIONAL_25 = [
            "col1", "col2", "col3", "col4", "col5", "col6", "col7", "col8", "col9",
            "col10", "col11", "col12", "col13", "col25", "col15", "col26", "col17",
            "col18", "col21", "col27", "col28", "col29", "col30", "col31", "col32"
          ];
          POSITIONAL_25.forEach((colKey, idx) => {
            item[colKey] = cells[idx] || "";
          });
        } else {
          EXCEL_COLUMNS_MAPPING.forEach((col, idx) => {
            item[col.key] = cells[idx] || "";
          });
        }
      }

      if (item.col6) {
        item.col6 = String(String(String(String(item.col6 || "")))).trim().replace(/^CO/i, "C").replace(/^C0+(\d)/i, "C$1");
      }

      // Simple validation: must have a Style number or Graphic to be imported
      if (item.col5 || item.col7) {
        results.push(item as Partial<EmbellishmentRow>);
      }
    });

    return results;
  }, [pasteData, hasHeader]);

  // Determine merge vs new
  const importSummary = useMemo(() => {
    let updateCount = 0;
    let newCount = 0;

    const normCombo = (s: string) =>
      (String(String(String(s || "")))).trim().toLowerCase().replace(/\s+/g, "").replace(/^co(\d+)/, "c$1").replace(/^c0(\d+)/, "c$1");
    const norm = (s: unknown) => (String(String(String(s || "")))).trim().toLowerCase();

    parsedItems.forEach((item) => {
      // A style exists if we match: DHL Tracking (col24) OR Style + Graphic + Combo (Normalized) OR Style + Graphic + Ground
      const exists = existingRows.some(
        (r) =>
          (item.col24 && r.col24 && norm(r.col24) === norm(item.col24)) ||
          (norm(r.col5) === norm(String(item.col5 || "")) &&
            norm(r.col7) === norm(String(item.col7 || "")) &&
            normCombo(String(r.col6 || "")) === normCombo(String(item.col6 || "")) &&
            norm(r.col8) === norm(String(item.col8 || "")) &&
            norm(r.col9) === norm(String(item.col9 || "")))
      );
      if (exists) {
        updateCount++;
      } else {
        newCount++;
      }
    });

    return { total: parsedItems.length, newCount, updateCount };
  }, [parsedItems, existingRows]);

  const handleImportClick = () => {
    if (parsedItems.length === 0) return;
    onImport(parsedItems);
    setPasteData("");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-4xl max-h-[85vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-150 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m-9 1V4a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
              Standard Format Excel Importer
            </h3>
            <p className="text-xs text-zinc-550 dark:text-zinc-400 mt-0.5">
              Copy rows from the standard spreadsheet format (columns 14-37) and paste them here to synchronize details.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-850 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col lg:flex-row gap-6">
          {/* Paste zone */}
          <div className="flex-1 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                1. Paste Clipboard Data
              </label>
              <label className="flex items-center gap-1.5 text-xs text-zinc-550 dark:text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasHeader}
                  onChange={(e) => setHasHeader(e.target.checked)}
                  className="rounded text-blue-600 border-zinc-300 focus:ring-blue-500/20"
                />
                First row contains headers
              </label>
            </div>
            
            <textarea
              value={pasteData}
              onChange={(e) => setPasteData(e.target.value)}
              placeholder="Select rows in your Excel file (Columns: Trigger, Category, Season, Style, Combo, Graphic, Ground, Technique, Process, Plant, Plant Flow, Fabric, Parts, App Form, AWR, Risk, Tech Cat, Tech Type, S-Off, Ready Date, Placement, Dev, TC, Fabric IH), copy (Ctrl+C), and paste (Ctrl+V) here..."
              className="flex-1 min-h-[180px] p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-850 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 text-xs font-mono placeholder-zinc-400 dark:placeholder-zinc-600 leading-relaxed resize-none transition-all"
            />
          </div>

          {/* Preview panel */}
          <div className="w-full lg:w-96 flex flex-col gap-4">
            <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
              2. Parsed Import Preview
            </span>
            
            <div className="flex-1 min-h-[220px] bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-850 rounded-xl p-4 flex flex-col justify-between shadow-inner">
              {parsedItems.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center text-zinc-400 dark:text-zinc-650 text-xs gap-2">
                  <svg className="w-8 h-8 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <span>Clipboard is empty.<br />Paste Excel rows to inspect details.</span>
                </div>
              ) : (
                <div className="flex flex-col flex-1 overflow-hidden">
                  {/* Preview list */}
                  <div className="flex-1 overflow-y-auto space-y-2.5 max-h-[180px] pr-1">
                    {parsedItems.map((item, idx) => {
                      const matches = existingRows.some(
                        (r) =>
                          (item.col24 && r.col24 && String(String(String(String(r.col24 || "")))).trim().toLowerCase() === String(String(String(String(item.col24 || "")))).trim().toLowerCase()) ||
                          (
                            (String(r.col5 || "").trim().toLowerCase() === String(item.col5 || "").trim().toLowerCase()) &&
                            (String(r.col7 || "").trim().toLowerCase() === String(item.col7 || "").trim().toLowerCase()) &&
                            (String(r.col6 || "").trim().toLowerCase().replace(/\s+/g, "").replace(/^co(\d+)/, "c$1").replace(/^c0(\d+)/, "c$1") === String(item.col6 || "").trim().toLowerCase().replace(/\s+/g, "").replace(/^co(\d+)/, "c$1").replace(/^c0(\d+)/, "c$1")) &&
                            (String(r.col8 || "").trim().toLowerCase() === String(item.col8 || "").trim().toLowerCase()) &&
                            (String(r.col9 || "").trim().toLowerCase() === String(item.col9 || "").trim().toLowerCase())
                          )
                      );

                      return (
                        <div
                          key={idx}
                          className="bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800/80 rounded-lg p-2.5 text-[11px] flex items-center justify-between gap-3 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 transition-all"
                        >
                          <div className="truncate flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-zinc-900 dark:text-white font-mono">{item.col5}</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-mono">{item.col6}</span>
                            </div>
                            <p className="text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                              Graphic: <span className="text-zinc-650 dark:text-zinc-350 font-medium font-mono">{item.col7 || "-"}</span> | Technique: <span className="text-zinc-650 dark:text-zinc-350 font-medium">{item.col9 || "-"}</span>
                            </p>
                          </div>
                          <span className={`shrink-0 px-2 py-0.5 text-[9px] font-bold rounded-full ${
                            matches 
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20" 
                              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"
                          }`}>
                            {matches ? "Merge Update" : "New Style"}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Summary badges */}
                  <div className="border-t border-zinc-200 dark:border-zinc-850 pt-3 mt-3 grid grid-cols-3 gap-2 text-center text-[10px]">
                    <div className="bg-zinc-100 dark:bg-zinc-900 p-2 rounded-lg border border-zinc-200/50 dark:border-zinc-800">
                      <p className="text-zinc-400 font-medium uppercase tracking-wider">Total Rows</p>
                      <p className="text-base font-bold text-zinc-900 dark:text-white mt-0.5">{importSummary.total}</p>
                    </div>
                    <div className="bg-emerald-500/5 p-2 rounded-lg border border-emerald-500/10">
                      <p className="text-emerald-600 dark:text-emerald-400 font-medium uppercase tracking-wider">New Styles</p>
                      <p className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{importSummary.newCount}</p>
                    </div>
                    <div className="bg-amber-500/5 p-2 rounded-lg border border-amber-500/10">
                      <p className="text-amber-600 dark:text-amber-400 font-medium uppercase tracking-wider">Updates</p>
                      <p className="text-base font-bold text-amber-600 dark:text-amber-400 mt-0.5">{importSummary.updateCount}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-150 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex items-center justify-between">
          <div className="text-[11px] text-zinc-450 dark:text-zinc-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            Automatic consolidation flow to master sheet
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                setPasteData("");
                onClose();
              }}
              className="px-4 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-350 hover:bg-zinc-150 dark:hover:bg-zinc-800 rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleImportClick}
              disabled={parsedItems.length === 0}
              className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 rounded-xl shadow-sm hover:shadow-md transition-all active:scale-[0.98]"
            >
              Consolidate & Import
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
