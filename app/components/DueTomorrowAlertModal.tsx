"use client";
import React, { useMemo, useState } from "react";
import { calculateSoffSlaStatus, SoffSlaResult } from "../lib/slaUtils";

interface DueTomorrowAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  rows: Record<string, unknown>[];
}

interface AlertItem {
  id: string;
  style: string;
  graphic: string;
  plant: string;
  fabricRef: string;
  technique: string;
  applyParts: string;
  sla: SoffSlaResult;
}

export default function DueTomorrowAlertModal({
  isOpen,
  onClose,
  rows,
}: DueTomorrowAlertModalProps) {
  const [selectedPlantFilter, setSelectedPlantFilter] = useState<string>("ALL");
  const [copiedPlant, setCopiedPlant] = useState<string | null>(null);

  // Compute all styles with S/OFF due tomorrow (daysRemaining <= 1 and NOT complete)
  const dueTomorrowItems: AlertItem[] = useMemo(() => {
    const items: AlertItem[] = [];

    rows.forEach((r, idx) => {
      // Exclude dropped or finished styles
      const statusLower = String(String(String(String(String(r.col1 || ""))))).trim().toLowerCase();
      if (statusLower.startsWith("d") || statusLower.includes("drop") || statusLower.includes("done")) {
        return;
      }

      const sla = calculateSoffSlaStatus(r);
      // S/OFF due tomorrow (daysRemaining <= 1 or DUE_SOON) and not yet completed
      if (!sla.isSoffComplete && sla.fabricReceivedDate && (sla.daysRemaining === 1 || sla.daysRemaining === 0 || sla.status === "DUE_SOON" || sla.status === "OVERDUE")) {
        items.push({
          id: String(r.id || `row-${idx}`),
          style: String(r.col5 || "N/A"),
          graphic: String(r.col7 || r.col6 || "N/A"),
          plant: sla.plantName || String(r.col11 || "Unassigned"),
          fabricRef: String(r.col13 || "N/A"),
          technique: String(r.col9 || r.col21 || "N/A"),
          applyParts: String(r.col25 || r.col15 || "N/A"),
          sla,
        });
      }
    });

    // Sort by urgency: Overdue first, then 0 days, then 1 day
    return items.sort((a, b) => a.sla.daysRemaining - b.sla.daysRemaining);
  }, [rows]);

  // Group by plant name for quick chips & follow-up summaries
  const plantGroups = useMemo(() => {
    const map: Record<string, AlertItem[]> = {};
    dueTomorrowItems.forEach((item) => {
      if (!map[item.plant]) map[item.plant] = [];
      map[item.plant].push(item);
    });
    return map;
  }, [dueTomorrowItems]);

  const uniquePlants = Object.keys(plantGroups).sort();

  // Filtered items based on selected plant tab
  const displayedItems = useMemo(() => {
    if (selectedPlantFilter === "ALL") return dueTomorrowItems;
    return dueTomorrowItems.filter((item) => item.plant === selectedPlantFilter);
  }, [dueTomorrowItems, selectedPlantFilter]);

  // Copy plant follow-up summary text to clipboard
  const handleCopyPlantSummary = (plantName: string) => {
    const items = plantGroups[plantName] || [];
    if (items.length === 0) return;

    let text = `🚨 *URGENT FOLLOW-UP: S/OFF DUE TOMORROW* 🚨\n`;
    text += `Plant: *${plantName}*\n`;
    text += `Total Items Due: ${items.length}\n\n`;

    items.forEach((it, i) => {
      text += `${i + 1}. Style: ${it.style} | Graphic: ${it.graphic}\n`;
      text += `   Fabric Rec'd: ${it.sla.fabricReceivedDateFormatted} | Target S/OFF: ${it.sla.soffTargetDateFormatted || "Tomorrow"}\n`;
      text += `   Technique: ${it.technique} (${it.applyParts})\n\n`;
    });

    text += `Please expedite production & confirm S/OFF submission!`;

    navigator.clipboard.writeText(text);
    setCopiedPlant(plantName);
    setTimeout(() => setCopiedPlant(null), 3000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[#0f131d] border border-amber-500/40 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header Bar */}
        <div className="px-6 py-5 bg-gradient-to-r from-amber-950/90 via-orange-950/80 to-red-950/90 border-b border-amber-500/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-400 text-xl shadow-inner animate-pulse">
              🔔
            </div>
            <div>
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                S/OFF Samples Due Tomorrow Alert Box
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 border border-amber-400/50 text-amber-300">
                  {dueTomorrowItems.length} Urgent Items
                </span>
              </h2>
              <p className="text-xs text-amber-200/80 font-medium mt-0.5">
                The following strike-off samples reach their 3-Day Plant SLA deadline tomorrow. Follow up with plants immediately!
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center font-bold text-sm transition-all"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 custom-scrollbar">
          
          {/* Plant Filter Chips & Copy Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-900/90 p-3 rounded-2xl border border-zinc-800">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setSelectedPlantFilter("ALL")}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all ${
                  selectedPlantFilter === "ALL"
                    ? "bg-amber-500 text-black shadow-md"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                All Plants ({dueTomorrowItems.length})
              </button>

              {uniquePlants.map((pName) => {
                const count = plantGroups[pName].length;
                return (
                  <button
                    key={pName}
                    onClick={() => setSelectedPlantFilter(pName)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                      selectedPlantFilter === pName
                        ? "bg-amber-500 text-black shadow-md"
                        : "bg-zinc-800/80 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20"
                    }`}
                  >
                    <span>{pName}</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/40 font-black">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedPlantFilter !== "ALL" && (
              <button
                onClick={() => handleCopyPlantSummary(selectedPlantFilter)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white flex items-center gap-1.5 shadow-md active:scale-95 transition-all"
              >
                {copiedPlant === selectedPlantFilter ? "✓ Copied to Clipboard!" : `📋 Copy ${selectedPlantFilter} Follow-up Text`}
              </button>
            )}
          </div>

          {/* List / Table of Due Tomorrow Items */}
          {displayedItems.length === 0 ? (
            <div className="py-12 text-center text-zinc-500 space-y-2">
              <span className="text-3xl">🎉</span>
              <p className="text-sm font-semibold">No S/OFF samples due tomorrow for this plant selection!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {displayedItems.map((item) => {
                const isOverdue = item.sla.daysRemaining < 0;
                const isDueToday = item.sla.daysRemaining === 0;

                return (
                  <div
                    key={item.id}
                    className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 hover:border-amber-500/50 transition-all flex flex-wrap items-center justify-between gap-4 shadow-sm group"
                  >
                    {/* Left: Plant & Style Info */}
                    <div className="flex items-center gap-4 min-w-[240px]">
                      <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-black text-xs text-center min-w-[90px]">
                        {item.plant}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-white">{item.style}</span>
                          <span className="text-xs font-bold text-amber-300 px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/30">
                            {item.graphic}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {item.technique} • <span className="text-zinc-300">{item.applyParts}</span>
                        </p>
                      </div>
                    </div>

                    {/* Center: Dates & SLA Status */}
                    <div className="flex items-center gap-6 text-xs">
                      <div>
                        <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Fabric Received</span>
                        <span className="text-zinc-200 font-bold">{item.sla.fabricReceivedDateFormatted || "N/A"}</span>
                      </div>

                      <div className="text-right">
                        <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Target S/OFF Date</span>
                        <span className="text-amber-300 font-black">{item.sla.soffTargetDateFormatted || "Tomorrow"}</span>
                      </div>

                      {/* Status Tag */}
                      <div>
                        {isOverdue ? (
                          <span className="px-2.5 py-1 rounded-xl font-black text-[11px] bg-red-500/20 text-red-300 border border-red-500/50 animate-pulse">
                            🚨 Overdue ({Math.abs(item.sla.daysRemaining)}d)
                          </span>
                        ) : isDueToday ? (
                          <span className="px-2.5 py-1 rounded-xl font-black text-[11px] bg-red-500/20 text-red-300 border border-red-500/50">
                            ⚡ Due Today!
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-xl font-black text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/50">
                            ⏱️ Due Tomorrow (1d left)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Bar */}
        <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-800/80 flex items-center justify-between">
          <span className="text-xs text-zinc-400 font-medium">
            Proactive Plant Alerting • 3-Day S/OFF SLA Management
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-zinc-800 hover:bg-zinc-700 text-white transition-all"
          >
            Close Alert Box
          </button>
        </div>

      </div>
    </div>
  );
}
