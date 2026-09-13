import React, { useState, useMemo } from 'react';

function getMondayOfCurrentWeek(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}
import { EmbellishmentRow } from '../lib/db';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { parseEventValue, isPlantFault, REASON_CODES } from '../lib/eventCodes';
import { getAllUniquePlantsFromRows, rowInvolvesPlant } from '../lib/plantUtils';

interface PlantSchedulesViewProps {
  rows: EmbellishmentRow[];
}

const COLUMNS = [
  { key: 'col1', label: 'STATUS' },
  { key: 'col2', label: 'TRIGGER' },
  { key: 'col3', label: 'CATEGORY' },
  { key: 'col4', label: 'SEASON' },
  { key: 'col5', label: 'STYLE' },
  { key: 'col6', label: 'GRAPHI-COM' },
  { key: 'col7', label: 'GRAPHIC' },
  { key: 'col8', label: 'GROUND' },
  { key: 'col9', label: 'TECHNIQUE' },
  { key: 'col10', label: 'PROCESS' },
  { key: 'col11', label: 'PLANT' },
  { key: 'col12', label: 'PLANT FLOW' },
  { key: 'col13', label: 'FABRIC REF' },
  { key: 'col23', label: '1ST S/OFF & SEND TARGET' },
  { key: 'col21', label: 'TECHNIQUE' },
  { key: 'col22', label: 'COMMENT' },
];

export default function PlantSchedulesView({ rows }: PlantSchedulesViewProps) {
  const allPlants = useMemo(() => {
    return getAllUniquePlantsFromRows(rows);
  }, [rows]);

  const [selectedPlant, setSelectedPlant] = useState<string>(String(String(String(String(allPlants[0] || "")))));

  const plantRows = useMemo(() => {
    if (!selectedPlant) return [];
    return rows.filter(r => rowInvolvesPlant(r, selectedPlant));
  }, [rows, selectedPlant]);

  const [startDateStr, setStartDateStr] = useState<string>(getMondayOfCurrentWeek());

  const planningDates = useMemo(() => {
    const dates = [];
    const start = new Date(startDateStr); 
    for (let i = 0; i < 14; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const formatted = `${yyyy}-${mm}-${dd}`;
      const label = d.toLocaleDateString("en-US", { day: "numeric", month: "short" }).toUpperCase();
      const dayOfWeek = d.getDay();
      const dayName = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isSaturday = dayOfWeek === 6;
      const isSunday = dayOfWeek === 0;
      dates.push({ key: formatted, label, dayName, dayOfWeek, isWeekend, isSaturday, isSunday });
    }
    return dates;
  }, [startDateStr]);

  const handleExportCSV = async () => {
    if (!selectedPlant) return;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`${selectedPlant}_Schedule`);

    // Define columns
    const excelColumns = [
      ...COLUMNS.map(c => ({ header: c.label, key: c.label, width: 20 })),
      ...planningDates.map(d => ({ header: d.label, key: d.label, width: 12 }))
    ];
    worksheet.columns = excelColumns;

    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      
      // First 22 columns are blue, rest are purple (matching screenshot)
      if (colNumber <= COLUMNS.length) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF0070C0' } // Blue
        };
      } else {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF7030A0' } // Purple
        };
      }
    });

    // Add rows and format event cells with colors
    plantRows.forEach((row) => {
      const rowValues: Record<string, string> = {};

      COLUMNS.forEach((c) => {
        rowValues[c.label] = (row[c.key] as string) || "";
      });

      const excelRow = worksheet.addRow(rowValues);

      planningDates.forEach((date, dateIdx) => {
        const plantFlows = row.col12
          ? String(row.col12)
              .replace(/\(.*?\)/g, "")
              .split(/>>|>|\+|\//)
              .map((p: string) => p.trim().toUpperCase())
          : [];
        const isMultiple = plantFlows.filter((p: string) => p).length > 1;
        let value = "";
        if (isMultiple) {
          value = (row[`${date.key}_${selectedPlant}`] as string) || "";
        } else {
          value =
            (row[`${date.key}_${selectedPlant}`] as string) ||
            (row[date.key] as string) ||
            "";
        }

        const colIndex = COLUMNS.length + dateIdx + 1;
        const cell = excelRow.getCell(colIndex);

        if (!value) {
          cell.value = "";
          return;
        }

        const parsed = parseEventValue(value);
        if (!parsed) {
          cell.value = value;
          return;
        }

        cell.value = parsed.code; // Clean display text e.g. "FS-S"
        cell.alignment = { vertical: "middle", horizontal: "center" };

        if (parsed.status === "pass") {
          // Green fill for Pass
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF22C55E" },
          };
          cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
        } else if (parsed.status === "fail") {
          // Red fill for Fail
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFEF4444" },
          };
          cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
          const reason = parsed.reasonCode
            ? REASON_CODES.find((r) => r.code === parsed.reasonCode)
            : null;
          if (reason) {
            cell.note = `FAIL: ${parsed.code}\nReason: ${reason.label}\nResponsible: ${reason.responsible}`;
          }
        } else {
          // Slate fill for Planned
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF475569" },
          };
          cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
        }
      });
    });

    // Generate Excel file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `${selectedPlant}_Schedule.xlsx`);
  };

  // Calculate plant performance for selected plant
  const performanceStats = useMemo(() => {
    let pass = 0;
    let fail = 0;
    let ownFault = 0;
    
    plantRows.forEach(row => {
      Object.entries(row).forEach(([key, val]) => {
        if (!key.startsWith("20") || !val || typeof val !== "string") return;
        
        // Handle plant flow logic in date cells if multiple plants
        const plantFlows = row.col12 ? String(String(String(String(row.col12 || "")))).replace(/\(.*?\)/g, '').split(/>>|>|\+|\//).map((p: string) => p.trim().toUpperCase()) : [];
        if (plantFlows.length > 1 && !key.endsWith(`_${selectedPlant}`)) return;
        
        const parsed = parseEventValue(val);
        if (!parsed || parsed.status === "planned") return;
        
        if (parsed.status === "pass") {
          pass++;
        } else if (parsed.status === "fail") {
          fail++;
          if (parsed.reasonCode) {
            const reason = REASON_CODES.find(r => r.code === parsed.reasonCode);
            if (reason && isPlantFault(reason.responsible)) {
              ownFault++;
            }
          }
        }
      });
    });
    
    const total = pass + fail;
    const rate = total > 0 ? Math.round((pass / total) * 100) : 0;
    
    return { pass, fail, ownFault, total, rate };
  }, [plantRows, selectedPlant]);

  return (
    <div className="max-w-[100vw] mx-auto px-6 py-8 overflow-hidden">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight mb-2">Plant Schedules</h1>
          <p className="text-sm font-semibold text-zinc-400">View and export schedule for a specific embellishment plant.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <input 
            type="date" 
            className="bg-zinc-900 border border-zinc-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            value={startDateStr}
            onChange={(e) => setStartDateStr(e.target.value)}
            title="Select start date for export"
          />
          <select 
            className="bg-zinc-900 border border-zinc-800 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none w-64"
            value={selectedPlant}
            onChange={(e) => setSelectedPlant(e.target.value)}
          >
            <option value="" disabled>Select Plant</option>
            {allPlants.map(plant => (
              <option key={plant} value={plant}>{plant}</option>
            ))}
          </select>
          
          <button 
            onClick={handleExportCSV}
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-6 rounded-lg transition-colors shadow-lg shadow-blue-500/20 whitespace-nowrap"
          >
            Export Standard Format
          </button>

          <button
            suppressHydrationWarning
            onClick={() => {
              if (!selectedPlant) return;
              const rowsHtml = plantRows.map((row, i) => {
                const status = (String(String(String(String(row.col1 || ""))))).trim();
                const bgColor = i % 2 === 0 ? "#f9fafb" : "#ffffff";
                return `<tr style="background:${bgColor}">
                  <td style="padding:7px 10px;font-size:11px;color:#374151">${status}</td>
                  <td style="padding:7px 10px;font-family:monospace;font-size:11px;color:#1d4ed8">${row.col5 || "—"}</td>
                  <td style="padding:7px 10px;font-family:monospace;font-size:11px;color:#047857;font-weight:700">${row.col7 || "—"}</td>
                  <td style="padding:7px 10px;font-size:11px">${row.col6 || "—"}</td>
                  <td style="padding:7px 10px;font-size:11px">${row.col3 || "—"}</td>
                  <td style="padding:7px 10px;font-size:11px">${row.col4 || "—"}</td>
                  <td style="padding:7px 10px;font-size:11px">${row.col8 || "—"}</td>
                  <td style="padding:7px 10px;font-size:11px">${row.col9 || "—"}</td>
                  <td style="padding:7px 10px;font-size:11px">${row.col11 || row.col12 || "—"}</td>
                  <td style="padding:7px 10px;font-size:11px">${row.col23 || "—"}</td>
                  <td style="padding:7px 10px;font-size:11px">${row.col22 || "—"}</td>
                </tr>`;
              }).join("");

              const rateColor = performanceStats.rate >= 80 ? "#059669" : performanceStats.rate >= 60 ? "#d97706" : "#dc2626";

              const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>${selectedPlant} Schedule</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;color:#111;background:#fff;padding:28px;font-size:13px}
  h1{font-size:22px;font-weight:900;color:#1e293b;margin-bottom:3px}
  h2{font-size:13px;font-weight:800;color:#1e293b;margin:20px 0 8px;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #e5e7eb;padding-bottom:4px}
  .meta{font-size:12px;color:#6b7280;margin-bottom:16px}
  .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
  .kpi{border:1.5px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#f8fafc}
  .kpi .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;font-weight:700}
  .kpi .val{font-size:20px;font-weight:900;margin-top:3px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  thead tr{background:#1e293b;color:#fff}
  thead th{padding:8px 10px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
  @media print{body{padding:16px}}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
  <div>
    <h1>🏭 ${selectedPlant} — Plant Schedule</h1>
    <div class="meta">Generated: ${new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })} &nbsp;·&nbsp; ${plantRows.length} rows</div>
  </div>
  <div style="font-size:11px;color:#6b7280">Brandix Embellishment Plan</div>
</div>
<div class="kpi-row">
  <div class="kpi"><div class="lbl">Pass Rate</div><div class="val" style="color:${rateColor}">${performanceStats.total > 0 ? performanceStats.rate + "%" : "—"}</div></div>
  <div class="kpi"><div class="lbl">Total Events</div><div class="val">${performanceStats.total}</div></div>
  <div class="kpi"><div class="lbl">Passes</div><div class="val" style="color:#059669">${performanceStats.pass}</div></div>
  <div class="kpi"><div class="lbl">Failures</div><div class="val" style="color:#dc2626">${performanceStats.fail}</div></div>
</div>
<h2>Scheduled Rows (${plantRows.length})</h2>
<table><thead><tr>
  <th>Status</th><th>Style</th><th>Graphic</th><th>Combo</th><th>Category</th>
  <th>Season</th><th>Ground</th><th>Technique</th><th>Plant</th><th>1st S/OFF Target</th><th>Comment</th>
</tr></thead>
<tbody>${rowsHtml || "<tr><td colspan=11 style='padding:12px;color:#6b7280;text-align:center'>No rows for this plant</td></tr>"}</tbody>
</table>
</body></html>`;

              const win = window.open("", "_blank");
              if (!win) { alert("Allow pop-ups to download the PDF."); return; }
              win.document.write(html);
              win.document.close();
              win.focus();
              setTimeout(() => win.print(), 600);
            }}
            disabled={!selectedPlant}
            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2 px-5 rounded-lg transition-colors shadow-lg shadow-rose-500/20 whitespace-nowrap"
            title="Download plant schedule as PDF"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download PDF
          </button>
        </div>
      </div>
      <div className="flex flex-col md:flex-row gap-6 mb-6">
        {/* Summary Card */}
        <div className="bg-gradient-to-br from-[#121827] to-[#0c101a] border border-blue-900/30 rounded-xl p-5 flex items-center justify-between shadow-xl flex-1">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-blue-500/20 border-2 border-blue-500/40 flex items-center justify-center">
              <span className="text-xl">🏭</span>
            </div>
            <div>
              <h2 className="text-xl font-black text-white">{selectedPlant || "Select a Plant"}</h2>
              <p className="text-xs font-semibold text-blue-400 mt-0.5">{plantRows.length} Scheduled Rows</p>
            </div>
          </div>
          
          {selectedPlant && (
            <div className="flex gap-8">
              <div className="text-center">
                <span className="text-[10px] uppercase font-black text-zinc-500 tracking-widest block mb-1">Pass Rate</span>
                <span className={`text-2xl font-black ${performanceStats.rate >= 80 ? 'text-emerald-400' : performanceStats.rate >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                  {performanceStats.total > 0 ? `${performanceStats.rate}%` : '—'}
                </span>
              </div>
              <div className="w-px h-10 bg-zinc-800 self-center"></div>
              <div className="text-center">
                <span className="text-[10px] uppercase font-black text-zinc-500 tracking-widest block mb-1">Pass</span>
                <span className="text-xl font-black text-emerald-400">{performanceStats.pass}</span>
              </div>
              <div className="text-center">
                <span className="text-[10px] uppercase font-black text-zinc-500 tracking-widest block mb-1">Fail</span>
                <span className="text-xl font-black text-red-400">{performanceStats.fail}</span>
              </div>
              <div className="text-center">
                <span className="text-[10px] uppercase font-black text-zinc-500 tracking-widest block mb-1">Own Fault</span>
                <span className="text-xl font-black text-red-500">{performanceStats.ownFault}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#0f1115] rounded-xl border border-zinc-800 shadow-xl overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase bg-[#14161a] text-zinc-400 border-b border-zinc-800 sticky top-0 z-10">
              <tr>
                {COLUMNS.map((c, idx) => (
                  <th
                    key={c.key}
                    className={`px-4 py-3 font-bold tracking-wider min-w-[150px] whitespace-nowrap ${
                      idx === 0
                        ? "sticky left-0 z-20 bg-[#14161a] border-r border-zinc-800 shadow-[6px_0_16px_-4px_rgba(0,0,0,0.5)] text-zinc-100 font-extrabold"
                        : ""
                    }`}
                  >
                    {c.label}
                  </th>
                ))}
                {planningDates.map(date => (
                  <th
                    key={date.key}
                    className={`px-3 py-2.5 font-bold tracking-wider min-w-[90px] text-center whitespace-nowrap border-b border-zinc-800 transition-colors ${
                      date.isSaturday
                        ? "bg-[#2d1e12] text-amber-300 border-x border-x-amber-500/40"
                        : date.isSunday
                        ? "bg-[#2e181d] text-rose-300 border-x border-x-rose-500/40"
                        : "text-blue-400"
                    }`}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                        date.isSaturday
                          ? "bg-amber-500/30 text-amber-200 border border-amber-500/50"
                          : date.isSunday
                          ? "bg-rose-500/30 text-rose-200 border border-rose-500/50"
                          : "text-zinc-500 font-semibold"
                      }`}>
                        {date.isSaturday ? "SAT 🏖️" : date.isSunday ? "SUN 🏖️" : date.dayName}
                      </span>
                      <span className="font-mono text-xs font-black text-white">{date.label}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {plantRows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + planningDates.length} className="px-4 py-12 text-center text-zinc-500">
                    No rows assigned to {selectedPlant}
                  </td>
                </tr>
              ) : (
                plantRows.map((row, i) => {
                  const plantFlows = row.col12 ? String(String(String(String(row.col12 || "")))).replace(/\(.*?\)/g, '').split(/>>|>|\+|\//).map((p: string) => p.trim().toUpperCase()) : [];
                  const isMultiple = plantFlows.filter((p: string) => p).length > 1;

                  return (
                    <tr key={row.id || i} className="hover:bg-zinc-800/20 transition-colors">
                      {COLUMNS.map((c, idx) => (
                        <td
                          key={c.key}
                          className={`px-4 py-3 text-zinc-300 whitespace-nowrap truncate max-w-[200px] ${
                            idx === 0
                              ? "sticky left-0 z-10 bg-[#0f1115] border-r border-zinc-800 shadow-[6px_0_16px_-4px_rgba(0,0,0,0.5)] font-bold text-zinc-100"
                              : ""
                          }`}
                          title={String(row[c.key] || "")}
                        >
                          {String(row[c.key] || "")}
                        </td>
                      ))}
                      {planningDates.map(date => {
                        let val = "";
                        if (isMultiple) {
                            val = (row[`${date.key}_${selectedPlant}`] as string) || "";
                        } else {
                            val = (row[`${date.key}_${selectedPlant}`] as string) || (row[date.key] as string) || "";
                        }
                        
                        return (
                          <td key={date.key} className={`px-4 py-3 text-center border-l border-zinc-800/30 ${
                            date.isSaturday
                              ? "bg-amber-950/20"
                              : date.isSunday
                              ? "bg-rose-950/20"
                              : ""
                          }`}>
                            {(() => {
                              if (!val) return <span className="text-zinc-700">-</span>;
                              const parsed = parseEventValue(val);
                              if (!parsed) return <span className="text-zinc-700">-</span>;

                              if (parsed.status === "pass") {
                                return (
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 text-xs rounded-md font-extrabold shadow-xs"
                                    title={`PASS: ${parsed.code}`}
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    <span>{parsed.code}</span>
                                  </span>
                                );
                              }

                              if (parsed.status === "fail") {
                                const reason = parsed.reasonCode ? REASON_CODES.find((r) => r.code === parsed.reasonCode) : null;
                                return (
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-rose-950/90 text-rose-300 border border-rose-500/50 text-xs rounded-md font-extrabold shadow-xs"
                                    title={`FAIL: ${parsed.code}${reason ? ` — ${reason.label}` : ""}`}
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                    <span>{parsed.code}</span>
                                  </span>
                                );
                              }

                              return (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800/90 text-slate-200 border border-slate-600/70 text-xs rounded-md font-bold shadow-xs"
                                  title={`PLANNED: ${parsed.code}`}
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-white" />
                                  <span>{parsed.code}</span>
                                </span>
                              );
                            })()}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
