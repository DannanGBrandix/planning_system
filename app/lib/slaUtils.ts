import { parseEventValue } from "./eventCodes";

export interface SoffSlaResult {
  fabricReceivedDate: string | null;      // e.g. "2026-07-20"
  fabricReceivedDateFormatted: string | null; // e.g. "20 Jul"
  soffTargetDate: string | null;          // Fabric received + 3 days e.g. "2026-07-23"
  soffTargetDateFormatted: string | null;     // e.g. "23 Jul"
  soffCompletedDate: string | null;       // e.g. "2026-07-22"
  isSoffComplete: boolean;
  daysElapsed: number;                    // Days since fabric arrived
  daysRemaining: number;                  // Days until 3-day SLA target date
  status: "NOT_STARTED" | "COMPLETED" | "DUE_SOON" | "OVERDUE" | "HISTORICAL";
  priorityScore: number;                  // Higher = more urgent
  plantName: string;                      // Plant assigned
}

/**
 * Scans a row for Fabric Received (FR / CPS = Green/Pass) and S/OFF (FS / PPS = Green/Pass),
 * and computes the exact 3-Day Plant S/OFF SLA status.
 * @param row The row object
 * @param maxActiveDays Cutoff threshold (default 14 days / 2 weeks). Fabric received before this threshold is treated as historical archive and won't trigger SLA alarms.
 */
export function calculateSoffSlaStatus(row: Record<string, unknown>, maxActiveDays = 14): SoffSlaResult {
  // Ignore dropped or completed styles from SLA alarms
  const rowStatusLower = String(String(String(String(String(row.col1 || ""))))).trim().toLowerCase();
  const isDroppedOrDone = rowStatusLower.startsWith("d") || rowStatusLower.includes("drop") || rowStatusLower.includes("done") || rowStatusLower.includes("approve");

  let fabricDateStr: string | null = null;
  let soffDateStr: string | null = null;

  // 1. Check direct columns first (col14 = Fabric In Date, col32 = Fabric IH status, col23/col28 = S/OFF)
  if (row.col14 && typeof row.col14 === "string" && String(String(String(String(row.col14 || "")))).trim() && row.col14 !== "N/A" && row.col14 !== "PENDING") {
    fabricDateStr = String(String(String(String(row.col14 || "")))).trim();
  } else if (row.col32 && typeof row.col32 === "string" && String(String(String(String(row.col32 || "")))).trim().toUpperCase() === "IH") {
    fabricDateStr = "IH";
  }
  if (row.col28 && typeof row.col28 === "string" && String(String(String(String(row.col28 || "")))).trim()) {
    soffDateStr = String(String(String(String(row.col28 || "")))).trim();
  } else if (row.col23 && typeof row.col23 === "string" && String(String(String(String(row.col23 || "")))).trim()) {
    soffDateStr = String(String(String(String(row.col23 || "")))).trim();
  }

  // 2. Gather all date entries from direct keys (keys starting with "20") AND schedule JSON object
  const dateEntries: [string, string][] = [];
  Object.entries(row).forEach(([k, v]) => {
    if (k.startsWith("20") && typeof v === "string" && v.trim()) {
      dateEntries.push([k, v]);
    }
  });
  if (row.schedule && typeof row.schedule === "object") {
    Object.entries(row.schedule as Record<string, unknown>).forEach(([k, v]) => {
      if (k.startsWith("20") && typeof v === "string" && v.trim()) {
        dateEntries.push([k, v as string]);
      }
    });
  }

  // Sort date entries chronologically
  dateEntries.sort((a, b) => a[0].localeCompare(b[0]));

  dateEntries.forEach(([dateKey, cellVal]) => {
    const parsed = parseEventValue(cellVal);
    if (!parsed) return;

    // Check if event is Fabric Arrival (FR, CPS, SEWIN, SEWS) with Pass status
    const codeUpper = (parsed.code || "").toUpperCase();
    if (parsed.status === "pass") {
      if (["FR", "CPS", "FABRIC", "IH", "SEWIN"].includes(codeUpper)) {
        if (!fabricDateStr) fabricDateStr = dateKey;
      }
      // Check if event is S/OFF Completed (FS, PPS, SOFF, S/OFF, MAST, REAP)
      if (["FS", "PPS", "SOFF", "S/OFF", "MAST", "REAP"].includes(codeUpper)) {
        if (!soffDateStr) soffDateStr = dateKey;
      }
    }
  });

  const plantName = String(row.col11 || row.col12 || "Unassigned").trim();

  // If fabric is not yet marked received
  if (!fabricDateStr) {
    return {
      fabricReceivedDate: null,
      fabricReceivedDateFormatted: null,
      soffTargetDate: null,
      soffTargetDateFormatted: null,
      soffCompletedDate: soffDateStr,
      isSoffComplete: !!soffDateStr,
      daysElapsed: 0,
      daysRemaining: 99,
      status: "NOT_STARTED",
      priorityScore: 0,
      plantName,
    };
  }

  // Parse Fabric Received Date
  let fabricDateObj: Date | null = null;
  const dayMonthMatch = fabricDateStr.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})(?:[-/\s](\d{2,4}))?$/i);
  if (dayMonthMatch) {
    const day = parseInt(dayMonthMatch[1], 10);
    const monthStr = dayMonthMatch[2];
    const yearStr = dayMonthMatch[3] || new Date().getFullYear().toString();
    const year = yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10);
    const monthIndex = new Date(`${monthStr} 1, 2000`).getMonth();
    if (!isNaN(monthIndex)) fabricDateObj = new Date(year, monthIndex, day);
  }
  if (!fabricDateObj || isNaN(fabricDateObj.getTime())) {
    const p = new Date(fabricDateStr);
    if (!isNaN(p.getTime())) fabricDateObj = p;
  }

  if (!fabricDateObj || isNaN(fabricDateObj.getTime())) {
    return {
      fabricReceivedDate: fabricDateStr,
      fabricReceivedDateFormatted: fabricDateStr,
      soffTargetDate: null,
      soffTargetDateFormatted: null,
      soffCompletedDate: soffDateStr,
      isSoffComplete: !!soffDateStr,
      daysElapsed: 0,
      daysRemaining: 99,
      status: "NOT_STARTED",
      priorityScore: 0,
      plantName,
    };
  }

  // Calculate S/OFF Target Date = Fabric Arrival + 3 Calendar Days
  const targetDateObj = new Date(fabricDateObj);
  targetDateObj.setDate(fabricDateObj.getDate() + 3);

  const fabricReceivedISO = fabricDateObj.toISOString().split("T")[0];
  const soffTargetISO = targetDateObj.toISOString().split("T")[0];

  const formatDDMMYYYY = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const fabricReceivedDateFormatted = formatDDMMYYYY(fabricDateObj);
  const soffTargetDateFormatted = formatDDMMYYYY(targetDateObj);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const elapsedMs = today.getTime() - fabricDateObj.getTime();
  const daysElapsed = Math.max(0, Math.floor(elapsedMs / (1000 * 60 * 60 * 24)));

  const remainingMs = targetDateObj.getTime() - today.getTime();
  const daysRemaining = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));

  const isSoffComplete = !!soffDateStr;

  let status: "NOT_STARTED" | "COMPLETED" | "DUE_SOON" | "OVERDUE" | "HISTORICAL" = "NOT_STARTED";
  let priorityScore = 0;

  if (isSoffComplete) {
    status = "COMPLETED";
    priorityScore = 1;
  } else if (isDroppedOrDone) {
    status = "NOT_STARTED";
    priorityScore = 0;
  } else if (daysElapsed > maxActiveDays) {
    // Fabric was received more than 14 days (2 weeks) ago — old historical data, ignore SLA alarm
    status = "HISTORICAL";
    priorityScore = 0;
  } else if (daysRemaining < 0) {
    status = "OVERDUE";
    priorityScore = 100 + Math.abs(daysRemaining); // Higher overdue days = higher score
  } else if (daysRemaining <= 2) {
    status = "DUE_SOON";
    priorityScore = 50 + (3 - daysRemaining);
  } else {
    status = "NOT_STARTED";
    priorityScore = 10;
  }

  return {
    fabricReceivedDate: fabricReceivedISO,
    fabricReceivedDateFormatted,
    soffTargetDate: soffTargetISO,
    soffTargetDateFormatted,
    soffCompletedDate: soffDateStr,
    isSoffComplete,
    daysElapsed,
    daysRemaining,
    status,
    priorityScore,
    plantName,
  };
}

/**
 * Computes summary SLA statistics across active rows for the Watchlist Bar.
 */
export function getOverallSlaStats(rows: Record<string, unknown>[]) {
  let totalFabricReceived = 0;
  let totalCompleted = 0;
  let totalDueSoon = 0;
  let totalOverdue = 0;

  const plantBreakdown: Record<string, { plant: string; overdue: number; dueSoon: number; completed: number }> = {};

  rows.forEach(r => {
    const sla = calculateSoffSlaStatus(r);
    if (sla.status === "NOT_STARTED" || sla.status === "HISTORICAL") return;

    totalFabricReceived++;
    const plant = sla.plantName || "Unassigned";
    if (!plantBreakdown[plant]) {
      plantBreakdown[plant] = { plant, overdue: 0, dueSoon: 0, completed: 0 };
    }

    if (sla.status === "COMPLETED") {
      totalCompleted++;
      plantBreakdown[plant].completed++;
    } else if (sla.status === "OVERDUE") {
      totalOverdue++;
      plantBreakdown[plant].overdue++;
    } else if (sla.status === "DUE_SOON") {
      totalDueSoon++;
      plantBreakdown[plant].dueSoon++;
    }
  });

  return {
    totalFabricReceived,
    totalCompleted,
    totalDueSoon,
    totalOverdue,
    plantBreakdown: Object.values(plantBreakdown).sort((a, b) => b.overdue - a.overdue),
  };
}
