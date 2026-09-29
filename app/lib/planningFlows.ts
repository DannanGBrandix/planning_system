import { parseEventValue } from "./eventCodes";
import { isSriLankaHoliday } from "./sriLankaHolidays";
import { extractPlants } from "./plantUtils";
import { isCkFamilyCategory } from "./ckCategories";

// BABL runs on its own, much longer turnaround than every other plant: fabric sent there isn't
// received (FR) the next working day like everywhere else — it takes 8 working days — and BABL's
// approval turnaround (-> NY) is the same 8 days instead of the usual 1. Every other step in the
// flow (FR -> PPS included) uses the same lead time as every other plant. Checked via
// extractPlants (not a raw substring match) so it also fires correctly on multi-plant chains like
// "BABL>>LEEMA", not just a lone "BABL" cell.
const BABL_LONG_LEAD_DAYS = 8;
function isBablPlant(plantRaw: unknown): boolean {
  return extractPlants(String(plantRaw ?? "")).includes("BABL");
}

// BABL and AV, like the CK family (see getPlanningCategory), only ever run the FABRICS-style
// flow (FS-first) — never SEWIN/GMT (Garments) or SEWIN/MOC (Mock-Ups) — regardless of what the
// row's own Application Form / S-Off Requirement says. Checked via extractPlants (handles
// multi-plant chains and every plant-name alias — "AV1"/"AV2"/"BFFAV"/"BRANDIXEMB" all canonicalize
// to "AV") against BOTH the Plant (col11) and Plant Flow (col12) columns, same as every other
// plant-structure check in this file. col12 is skipped when it's actually PROCESS free text, not a
// plant chain (plantFlowIsProcessText) — same guard detectMatchingFlowRaw uses.
const FABRIC_ONLY_PLANTS = new Set(["BABL", "AV"]);
function isFabricOnlyPlant(row: Record<string, unknown>): boolean {
  const plant = extractPlants(String(row.col11 ?? ""));
  const plantFlow = plantFlowIsProcessText(row.col12) ? [] : extractPlants(String(row.col12 ?? ""));
  return plant.some((p) => FABRIC_ONLY_PLANTS.has(p)) || plantFlow.some((p) => FABRIC_ONLY_PLANTS.has(p));
}

// A day the auto-scheduler must skip over — not just Saturday/Sunday, but also any gazetted Sri
// Lankan public holiday (see sriLankaHolidays.ts) — plants aren't working either day, so no
// planning event should ever land on one.
function isNonWorkingDay(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6 || isSriLankaHoliday(date);
}

function isRealAllocationValue(val: unknown): boolean {
  if (!val || typeof val !== "string") return false;
  const upper = val.trim().toUpperCase();
  if (
    !upper ||
    upper === "TBD" ||
    upper === "N/A" ||
    // The Allocation Chart template's own placeholder for "not applicable" is the slash-less
    // "NA" (confirmed against a real file: Application Form, AWR, Risk Category etc. are all
    // literally "NA" on every row) — without this it slipped past the "N/A" check above and
    // counted as a real value, since the two spellings aren't the same string.
    upper === "NA" ||
    upper === "NONE" ||
    upper === "STANDARD FORMAT" ||
    upper === "FORMAT" ||
    upper === "TRACKING" ||
    upper === "SUMMARY" ||
    upper === "PIVOT" ||
    upper === "MASTER"
  ) {
    return false;
  }
  return true;
}

// Shared with the import pipeline (page.tsx handleConfirmImport) so it can tell "this row already
// had everything an allocation chart provides" apart from "this import is what just completed it"
// — the latter is what should always trigger a fresh plan, per autoScheduleEmbellishmentRow below.
//
// Process (col10) and Application Form (col15) are deliberately NOT required here. Real
// allocation charts routinely arrive without a Process column at all (confirmed: the standard
// Allocation Chart template only ever supplies Plant + S-Off Requirement as real data —
// Application Form is always the template's own "NA" placeholder, never a real value), and
// detectMatchingFlow already copes with both blank fine — its Dye/Wash detection also checks
// Plant/Plant Flow names, not just Process text, and category detection falls back to "FABRICS"
// when Application Form/S-Off Requirement don't say otherwise. Requiring either of them here
// simply blocked auto-planning outright on files that were never going to carry them.
//
// Plant + S-Off Requirement stay mandatory. Note this is a narrower safety net than before: the
// real incident that originally motivated this gate (a row with only Process filled in, no
// Application Form or Sign-off Requirement yet, got a fabricated duplicate FR event) involved a
// row missing BOTH of the fields now excluded — Plant + S-Off Requirement alone wasn't the
// scenario that broke. Requested explicitly, aware of that history.
export function hasCompleteAllocationContext(row: Record<string, unknown>): boolean {
  const hasPlant = isRealAllocationValue(row.col11);
  const hasSoffReq = isRealAllocationValue(row.col27);
  return hasPlant && hasSoffReq;
}

// ============================================================
// EMBELLISHMENT PLANNING PROCESS & LEAD TIMES (BRANDIX)
// ============================================================

export interface PlanningStep {
  fromEvent: string;
  toEvent: string;
  leadTimeDays: number; // Lead time in calendar days
  label: string;        // e.g. "1d", "3d", "2W", "1W"
}

export interface PlanningFlow {
  id: number;
  category: "FABRICS" | "MOCK-UPS" | "GARMENTS" | "CUT PANELS" | "FIT FUNCTIONALS";
  title: string;
  description: string;
  sequence: string[];
  steps: PlanningStep[];
  totalLeadTimeDays: number;
}

export const EVENT_SUFFIXES = {
  S: "S/off (Sign-off)",
  F: "Actual color final s/off",
  T: "Trials",
};

export const POST_NY_TESTING_RULES = [
  { trigger: "V8 & PINK", testEvent: "DTC-3010 / LTD-92", description: "Plan DTC-3010 / LTD-92 testing after NY" },
];

// External wash/dye VENDOR names — these never get their own tracked planning row (they're a
// pass-through subcontracted step, not an internally-managed plant). Used both to detect the
// PPSDS -> RDPS dye/wash flow (detectMatchingFlow) and to decide which bookend plant absorbs
// the send/return events when no dedicated row exists for the vendor itself (getEventsForChainStage).
export const DYE_WASH_PLANT_NAMES = ["BFL", "MARTEX", "DYNAWASH"];

// PLANT FLOW (col12) normally holds a short chain of plant / vendor codes —
// "CKT>>BFL", "BFL >> ANTLER", "ANTLER >> LEEMA". A few rows instead carry a
// manufacturing PROCESS description there ("Fabric cut>>Front Send to Print>>
// Print Panel Received>>Garment Stitch>>Finish") — that text belongs in PROCESS
// (col10) and lands in col12 through an import/column-mapping slip. Its ">>"
// steps are NOT plants, so they must never be read as a multi-plant chain:
// otherwise a normal single-plant fabric plan is given a spurious dye/wash
// round-trip (PPSDS -> RDPS) or a 2-plant PPSES flow. Real plant codes never
// contain these phrases.
const PLANT_FLOW_PROCESS_RE =
  /(fabric\s*cut|(?:front|back|panel)\s*send\s*to\s*(?:print|wash)|send\s*to\s*(?:print|wash)|(?:print\s*)?panel\s*receiv|garment\s*(?:stitch|sew|wash))/i;

/** True when col12 holds a process-step description rather than a plant chain. */
export function plantFlowIsProcessText(plantFlowRaw: unknown): boolean {
  return PLANT_FLOW_PROCESS_RE.test(String(plantFlowRaw || ""));
}

export const PLANNING_FLOWS: PlanningFlow[] = [
  // ------------------------------------------------------------
  // FABRICS (1 - 4)
  // ------------------------------------------------------------
  {
    id: 1,
    category: "FABRICS",
    title: "Standard Fabrics Flow",
    description: "Standard fabric embellishment workflow from FS to PLSA",
    sequence: ["FS", "FR", "PPS", "NY", "NYC", "MAST", "REAP/FCHP", "PLSD", "PLSA"],
    steps: [
      { fromEvent: "FS", toEvent: "FR", leadTimeDays: 1, label: "1d" },
      { fromEvent: "FR", toEvent: "PPS", leadTimeDays: 2, label: "2d" },
      { fromEvent: "PPS", toEvent: "NY", leadTimeDays: 1, label: "1d" },
      { fromEvent: "NY", toEvent: "NYC", leadTimeDays: 14, label: "2W" },
      { fromEvent: "NYC", toEvent: "MAST", leadTimeDays: 3, label: "3d" },
      { fromEvent: "MAST", toEvent: "REAP/FCHP", leadTimeDays: 3, label: "3d" },
      { fromEvent: "REAP/FCHP", toEvent: "PLSD", leadTimeDays: 7, label: "1W" },
      { fromEvent: "PLSD", toEvent: "PLSA", leadTimeDays: 3, label: "3d" },
    ],
    totalLeadTimeDays: 35,
  },
  {
    id: 2,
    category: "FABRICS",
    title: "Fabrics with Emb Plant Strike-Off (PPSES)",
    description: "Fabric workflow with dedicated Emb Plant strike-off sending step",
    sequence: ["FS", "FR", "PPSES", "PPS", "NY", "NYC", "MAST", "REAP/FCHP", "PLSD", "PLSA"],
    steps: [
      { fromEvent: "FS", toEvent: "FR", leadTimeDays: 1, label: "1d" },
      { fromEvent: "FR", toEvent: "PPSES", leadTimeDays: 1, label: "1d" },
      { fromEvent: "PPSES", toEvent: "PPS", leadTimeDays: 2, label: "2d" },
      { fromEvent: "PPS", toEvent: "NY", leadTimeDays: 1, label: "1d" },
      { fromEvent: "NY", toEvent: "NYC", leadTimeDays: 14, label: "2W" },
      { fromEvent: "NYC", toEvent: "MAST", leadTimeDays: 3, label: "3d" },
      { fromEvent: "MAST", toEvent: "REAP/FCHP", leadTimeDays: 3, label: "3d" },
      { fromEvent: "REAP/FCHP", toEvent: "PLSD", leadTimeDays: 7, label: "1W" },
      { fromEvent: "PLSD", toEvent: "PLSA", leadTimeDays: 3, label: "3d" },
    ],
    totalLeadTimeDays: 35,
  },
  {
    id: 3,
    category: "FABRICS",
    title: "Fabrics with Dye Plant Strike-Off (PPSDS -> RDPS)",
    description: "Fabric workflow with Dye plant strike-off and panel return steps",
    sequence: ["FS", "FR", "PPSDS", "RDPS", "PPS", "NY", "NYC", "MAST", "REAP/FCHP", "PLSD", "PLSA"],
    steps: [
      { fromEvent: "FS", toEvent: "FR", leadTimeDays: 1, label: "1d" },
      { fromEvent: "FR", toEvent: "PPSDS", leadTimeDays: 1, label: "1d" },
      { fromEvent: "PPSDS", toEvent: "RDPS", leadTimeDays: 2, label: "2d" },
      { fromEvent: "RDPS", toEvent: "PPS", leadTimeDays: 1, label: "1d" },
      { fromEvent: "PPS", toEvent: "NY", leadTimeDays: 1, label: "1d" },
      { fromEvent: "NY", toEvent: "NYC", leadTimeDays: 14, label: "2W" },
      { fromEvent: "NYC", toEvent: "MAST", leadTimeDays: 3, label: "3d" },
      { fromEvent: "MAST", toEvent: "REAP/FCHP", leadTimeDays: 3, label: "3d" },
      { fromEvent: "REAP/FCHP", toEvent: "PLSD", leadTimeDays: 7, label: "1W" },
      { fromEvent: "PLSD", toEvent: "PLSA", leadTimeDays: 3, label: "3d" },
    ],
    totalLeadTimeDays: 36,
  },
  {
    id: 4,
    category: "FABRICS",
    title: "Direct Fabrics Fast-Track",
    description: "Accelerated fabric workflow bypassing NY/NYC dispatch",
    sequence: ["FS", "FR", "PPS", "MAST", "REAP/FCHP", "PLSD", "PLSA"],
    steps: [
      { fromEvent: "FS", toEvent: "FR", leadTimeDays: 1, label: "1d" },
      { fromEvent: "FR", toEvent: "PPS", leadTimeDays: 2, label: "2d" },
      { fromEvent: "PPS", toEvent: "MAST", leadTimeDays: 1, label: "1d" },
      { fromEvent: "MAST", toEvent: "REAP/FCHP", leadTimeDays: 3, label: "3d" },
      { fromEvent: "REAP/FCHP", toEvent: "PLSD", leadTimeDays: 7, label: "1W" },
      { fromEvent: "PLSD", toEvent: "PLSA", leadTimeDays: 3, label: "3d" },
    ],
    totalLeadTimeDays: 18,
  },

  // ------------------------------------------------------------
  // MOCK-UPS (5 - 7)
  // ------------------------------------------------------------
  {
    id: 5,
    category: "MOCK-UPS",
    title: "Standard Mock-Ups Flow",
    description: "Mock-up workflow starting from Sewing to FR, PPS, NY, MAST",
    sequence: ["SEWIN/SEWS", "MOC", "FR", "PPS", "NY", "NYC", "MAST", "REAP/FCHP", "PLSD", "PLSA"],
    steps: [
      { fromEvent: "SEWIN/SEWS", toEvent: "MOC", leadTimeDays: 1, label: "1d" },
      { fromEvent: "MOC", toEvent: "FR", leadTimeDays: 1, label: "1d" },
      { fromEvent: "FR", toEvent: "PPS", leadTimeDays: 2, label: "2d" },
      { fromEvent: "PPS", toEvent: "NY", leadTimeDays: 1, label: "1d" },
      { fromEvent: "NY", toEvent: "NYC", leadTimeDays: 14, label: "2W" },
      { fromEvent: "NYC", toEvent: "MAST", leadTimeDays: 3, label: "3d" },
      { fromEvent: "MAST", toEvent: "REAP/FCHP", leadTimeDays: 3, label: "3d" },
      { fromEvent: "REAP/FCHP", toEvent: "PLSD", leadTimeDays: 7, label: "1W" },
      { fromEvent: "PLSD", toEvent: "PLSA", leadTimeDays: 3, label: "3d" },
    ],
    totalLeadTimeDays: 36,
  },
  {
    id: 6,
    category: "MOCK-UPS",
    title: "Mock-Ups with Emb Plant Strike-Off (PPSES)",
    description: "Mock-up workflow with Emb plant strike-off sending",
    sequence: ["SEWIN/SEWS", "MOC", "FR", "PPSES", "PPS", "NY", "NYC", "MAST", "REAP/FCHP", "PLSD", "PLSA"],
    steps: [
      { fromEvent: "SEWIN/SEWS", toEvent: "MOC", leadTimeDays: 1, label: "1d" },
      { fromEvent: "MOC", toEvent: "FR", leadTimeDays: 1, label: "1d" },
      { fromEvent: "FR", toEvent: "PPSES", leadTimeDays: 1, label: "1d" },
      { fromEvent: "PPSES", toEvent: "PPS", leadTimeDays: 2, label: "2d" },
      { fromEvent: "PPS", toEvent: "NY", leadTimeDays: 1, label: "1d" },
      { fromEvent: "NY", toEvent: "NYC", leadTimeDays: 14, label: "2W" },
      { fromEvent: "NYC", toEvent: "MAST", leadTimeDays: 3, label: "3d" },
      { fromEvent: "MAST", toEvent: "REAP/FCHP", leadTimeDays: 3, label: "3d" },
      { fromEvent: "REAP/FCHP", toEvent: "PLSD", leadTimeDays: 7, label: "1W" },
      { fromEvent: "PLSD", toEvent: "PLSA", leadTimeDays: 3, label: "3d" },
    ],
    totalLeadTimeDays: 36,
  },
  {
    id: 7,
    category: "MOCK-UPS",
    title: "Mock-Ups with Dye Plant Strike-Off (PPSDS -> RDPS)",
    description: "Mock-up workflow with Dye plant strike-off and return dye panels",
    sequence: ["SEWIN/SEWS", "MOC", "FR", "PPSDS", "RDPS", "PPS", "NY", "NYC", "MAST", "REAP/FCHP", "PLSD", "PLSA"],
    steps: [
      { fromEvent: "SEWIN/SEWS", toEvent: "MOC", leadTimeDays: 1, label: "1d" },
      { fromEvent: "MOC", toEvent: "FR", leadTimeDays: 1, label: "1d" },
      { fromEvent: "FR", toEvent: "PPSDS", leadTimeDays: 1, label: "1d" },
      { fromEvent: "PPSDS", toEvent: "RDPS", leadTimeDays: 2, label: "2d" },
      { fromEvent: "RDPS", toEvent: "PPS", leadTimeDays: 1, label: "1d" },
      { fromEvent: "PPS", toEvent: "NY", leadTimeDays: 1, label: "1d" },
      { fromEvent: "NY", toEvent: "NYC", leadTimeDays: 14, label: "2W" },
      { fromEvent: "NYC", toEvent: "MAST", leadTimeDays: 3, label: "3d" },
      { fromEvent: "MAST", toEvent: "REAP/FCHP", leadTimeDays: 3, label: "3d" },
      { fromEvent: "REAP/FCHP", toEvent: "PLSD", leadTimeDays: 7, label: "1W" },
      { fromEvent: "PLSD", toEvent: "PLSA", leadTimeDays: 3, label: "3d" },
    ],
    totalLeadTimeDays: 37,
  },

  // ------------------------------------------------------------
  // GARMENTS (8 - 10)
  // ------------------------------------------------------------
  {
    id: 8,
    category: "GARMENTS",
    title: "Standard Garments Flow",
    description: "Full garment embellishment workflow from Sewing to Garment sending, FR, PPS",
    sequence: ["SEWIN/SEWS", "GMT", "FR", "PPS", "NY", "NYC", "MAST", "REAP/FCHP", "PLSD", "PLSA"],
    steps: [
      { fromEvent: "SEWIN/SEWS", toEvent: "GMT", leadTimeDays: 1, label: "1d" },
      { fromEvent: "GMT", toEvent: "FR", leadTimeDays: 1, label: "1d" },
      { fromEvent: "FR", toEvent: "PPS", leadTimeDays: 2, label: "2d" },
      { fromEvent: "PPS", toEvent: "NY", leadTimeDays: 1, label: "1d" },
      { fromEvent: "NY", toEvent: "NYC", leadTimeDays: 14, label: "2W" },
      { fromEvent: "NYC", toEvent: "MAST", leadTimeDays: 3, label: "3d" },
      { fromEvent: "MAST", toEvent: "REAP/FCHP", leadTimeDays: 3, label: "3d" },
      { fromEvent: "REAP/FCHP", toEvent: "PLSD", leadTimeDays: 7, label: "1W" },
      { fromEvent: "PLSD", toEvent: "PLSA", leadTimeDays: 3, label: "3d" },
    ],
    totalLeadTimeDays: 36,
  },
  {
    id: 9,
    category: "GARMENTS",
    title: "Garments with Emb Plant Strike-Off (PPSES)",
    description: "Garment workflow with Emb plant strike-off sending",
    sequence: ["SEWIN/SEWS", "GMT", "FR", "PPSES", "PPS", "NY", "NYC", "MAST", "REAP/FCHP", "PLSD", "PLSA"],
    steps: [
      { fromEvent: "SEWIN/SEWS", toEvent: "GMT", leadTimeDays: 1, label: "1d" },
      { fromEvent: "GMT", toEvent: "FR", leadTimeDays: 1, label: "1d" },
      { fromEvent: "FR", toEvent: "PPSES", leadTimeDays: 1, label: "1d" },
      { fromEvent: "PPSES", toEvent: "PPS", leadTimeDays: 2, label: "2d" },
      { fromEvent: "PPS", toEvent: "NY", leadTimeDays: 1, label: "1d" },
      { fromEvent: "NY", toEvent: "NYC", leadTimeDays: 14, label: "2W" },
      { fromEvent: "NYC", toEvent: "MAST", leadTimeDays: 3, label: "3d" },
      { fromEvent: "MAST", toEvent: "REAP/FCHP", leadTimeDays: 3, label: "3d" },
      { fromEvent: "REAP/FCHP", toEvent: "PLSD", leadTimeDays: 7, label: "1W" },
      { fromEvent: "PLSD", toEvent: "PLSA", leadTimeDays: 3, label: "3d" },
    ],
    totalLeadTimeDays: 36,
  },
  {
    id: 10,
    category: "GARMENTS",
    title: "Garments with Return Dye Panels (RDPS)",
    description: "Garment workflow with dye panel return prior to PPS",
    sequence: ["SEWIN/SEWS", "GMT", "RDPS", "PPS", "NY", "NYC", "MAST", "REAP/FCHP", "PLSD", "PLSA"],
    steps: [
      { fromEvent: "SEWIN/SEWS", toEvent: "GMT", leadTimeDays: 1, label: "1d" },
      { fromEvent: "GMT", toEvent: "RDPS", leadTimeDays: 1, label: "1d" },
      { fromEvent: "RDPS", toEvent: "PPS", leadTimeDays: 2, label: "2d" },
      { fromEvent: "PPS", toEvent: "NY", leadTimeDays: 1, label: "1d" },
      { fromEvent: "NY", toEvent: "NYC", leadTimeDays: 14, label: "2W" },
      { fromEvent: "NYC", toEvent: "MAST", leadTimeDays: 3, label: "3d" },
      { fromEvent: "MAST", toEvent: "REAP/FCHP", leadTimeDays: 3, label: "3d" },
      { fromEvent: "REAP/FCHP", toEvent: "PLSD", leadTimeDays: 7, label: "1W" },
      { fromEvent: "PLSD", toEvent: "PLSA", leadTimeDays: 3, label: "3d" },
    ],
    totalLeadTimeDays: 35,
  },

  // ------------------------------------------------------------
  // CUT PANELS (11 - 12)
  // ------------------------------------------------------------
  {
    id: 11,
    category: "CUT PANELS",
    title: "Standard Cut Panels Flow",
    description: "Cut panel embellishment starting from CSRF -> CPS -> FR -> PPS",
    sequence: ["CSRF", "CPS", "FR", "PPS", "NY", "NYC", "MAST", "REAP/FCHP", "PLSD", "PLSA"],
    steps: [
      { fromEvent: "CSRF", toEvent: "CPS", leadTimeDays: 1, label: "1d" },
      { fromEvent: "CPS", toEvent: "FR", leadTimeDays: 1, label: "1d" },
      { fromEvent: "FR", toEvent: "PPS", leadTimeDays: 2, label: "2d" },
      { fromEvent: "PPS", toEvent: "NY", leadTimeDays: 1, label: "1d" },
      { fromEvent: "NY", toEvent: "NYC", leadTimeDays: 14, label: "2W" },
      { fromEvent: "NYC", toEvent: "MAST", leadTimeDays: 3, label: "3d" },
      { fromEvent: "MAST", toEvent: "REAP/FCHP", leadTimeDays: 3, label: "3d" },
      { fromEvent: "REAP/FCHP", toEvent: "PLSD", leadTimeDays: 7, label: "1W" },
      { fromEvent: "PLSD", toEvent: "PLSA", leadTimeDays: 3, label: "3d" },
    ],
    totalLeadTimeDays: 36,
  },
  {
    id: 12,
    category: "CUT PANELS",
    title: "Cut Panels with Emb Plant Strike-Off (PPSES)",
    description: "Cut panel workflow with Emb plant strike-off sending",
    sequence: ["CSRF", "CPS", "FR", "PPSES", "PPS", "NY", "NYC", "MAST", "REAP/FCHP", "PLSD", "PLSA"],
    steps: [
      { fromEvent: "CSRF", toEvent: "CPS", leadTimeDays: 1, label: "1d" },
      { fromEvent: "CPS", toEvent: "FR", leadTimeDays: 1, label: "1d" },
      { fromEvent: "FR", toEvent: "PPSES", leadTimeDays: 1, label: "1d" },
      { fromEvent: "PPSES", toEvent: "PPS", leadTimeDays: 2, label: "2d" },
      { fromEvent: "PPS", toEvent: "NY", leadTimeDays: 1, label: "1d" },
      { fromEvent: "NY", toEvent: "NYC", leadTimeDays: 14, label: "2W" },
      { fromEvent: "NYC", toEvent: "MAST", leadTimeDays: 3, label: "3d" },
      { fromEvent: "MAST", toEvent: "REAP/FCHP", leadTimeDays: 3, label: "3d" },
      { fromEvent: "REAP/FCHP", toEvent: "PLSD", leadTimeDays: 7, label: "1W" },
      { fromEvent: "PLSD", toEvent: "PLSA", leadTimeDays: 3, label: "3d" },
    ],
    totalLeadTimeDays: 36,
  },

  // ------------------------------------------------------------
  // FIT FUNCTIONALS (13)
  // ------------------------------------------------------------
  {
    id: 13,
    category: "FIT FUNCTIONALS",
    title: "Fit Functionals Flow (FF)",
    description: "Specialized workflow for fit functional embellishments leading to model fit (RFIT)",
    sequence: ["CSRF-FF", "CPS-FF", "FR-FF", "PPS-FF", "SEWIN-FF/SEWS-FF", "RFIT"],
    steps: [
      { fromEvent: "CSRF-FF", toEvent: "CPS-FF", leadTimeDays: 1, label: "1d" },
      { fromEvent: "CPS-FF", toEvent: "FR-FF", leadTimeDays: 1, label: "1d" },
      { fromEvent: "FR-FF", toEvent: "PPS-FF", leadTimeDays: 3, label: "3d" },
      { fromEvent: "PPS-FF", toEvent: "SEWIN-FF/SEWS-FF", leadTimeDays: 1, label: "1d" },
      { fromEvent: "SEWIN-FF/SEWS-FF", toEvent: "RFIT", leadTimeDays: 1, label: "1d" },
    ],
    totalLeadTimeDays: 7,
  },
];

/**
 * Helper to advance date by working days (skipping Saturdays & Sundays).
 */
export function addWorkingDays(startDate: Date, calendarDays: number): Date {
  const result = new Date(startDate);
  let addedDays = 0;
  while (addedDays < calendarDays) {
    result.setDate(result.getDate() + 1);
    // Skip weekends and Sri Lankan public holidays
    if (!isNonWorkingDay(result)) {
      addedDays++;
    }
  }
  // Ensure final date does not fall on a weekend or holiday
  while (isNonWorkingDay(result)) {
    result.setDate(result.getDate() + 1);
  }
  return result;
}

/**
 * Auto-calculates schedule target dates for a flow starting from a given start date.
 * Returns an object mapping YYYY-MM-DD date string -> event code string.
 */
export function calculateAutoSchedule(
  startDateStr: string,
  flowIdOrFlow: number | PlanningFlow,
  eventSuffix: "S" | "F" | "T" = "S",
  triggerBrand?: string,
  failedEventsMap?: Record<string, { dateKey: string; val: string; code: string }>,
  plantRaw?: unknown,
  // Planner-locked ("|X") milestones, keyed by dateKey — a mid-flow event that was manually
  // dropped on a specific day (e.g. moving PPS out after a retry). Every step at/after a pinned
  // code must re-anchor its forward walk to the REAL pinned date instead of the naive lead-time
  // math, or every downstream milestone silently drifts off the sequence-only computed date
  // (confirmed against real data: pinning PPS on a later date only fixed PPS's own cell — NY/NYC/
  // MAST after it kept cascading off the wrong, un-pinned date this function computed internally).
  pinnedEventsMap?: Record<string, { dateKey: string; val: string; code: string }>
): Record<string, string> {
  // Accepts either a flow id (looked up from the static list, e.g. an external caller) or an
  // already-resolved PlanningFlow (e.g. matchedFlow/flow from autoScheduleEmbellishmentRow /
  // resumeStaleFlow, which may be the row's graphic-type-adjusted flow — see
  // detectMatchingFlow/applyGraphicTypeSkip). Re-resolving by id there would silently discard that
  // adjustment (NY/NYC would come back for a Branding/Trial row's schedule).
  const flow = typeof flowIdOrFlow === "number" ? PLANNING_FLOWS.find((f) => f.id === flowIdOrFlow) : flowIdOrFlow;
  if (!flow) return {};

  const isBabl = isBablPlant(plantRaw);

  const resultSchedule: Record<string, string> = {};
  let current = new Date(startDateStr);
  if (isNaN(current.getTime())) return {};

  // Ensure start date doesn't land on a weekend or Sri Lankan public holiday
  while (isNonWorkingDay(current)) {
    current.setDate(current.getDate() + 1);
  }

  const applySuffix = (code: string) => {
    if (!eventSuffix) return code;
    if (code.includes("-")) return code;
    return `${code}-${eventSuffix}`;
  };

  // First event in sequence
  const firstEvent = flow.sequence[0];
  const formattedFirstDate = current.toISOString().split("T")[0];

  // Check whether the first event has ever been marked failed, anywhere — not just on the
  // original planned date. A retry that itself fails again lands on a LATER date, not
  // formattedFirstDate, so an exact-match-only check stops recognizing it as "the first event's
  // failure" the moment it's retried more than once — every downstream step then gets computed
  // from the untouched original start date instead of cascading off the real latest retry,
  // which is exactly how FR/PPS/NY end up colliding with old failure markers instead of shifting
  // forward (confirmed against real data: a first failure on day+1, then a second failure of that
  // SAME retry on day+4, left the whole rest of the chain computed as if neither ever happened).
  const firstBase = firstEvent.split("-")[0].toUpperCase();
  const firstFailedList = failedEventsMap
    ? Object.values(failedEventsMap)
        .filter((f) => f.code === firstBase)
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
    : [];
  const firstFailed = firstFailedList.length > 0 ? firstFailedList[firstFailedList.length - 1] : null;
  const firstPinned = pinnedEventsMap
    ? Object.values(pinnedEventsMap).find((p) => p.code === firstBase)
    : undefined;

  if (firstPinned) {
    resultSchedule[firstPinned.dateKey] = firstPinned.val;
    current = new Date(firstPinned.dateKey);
  } else if (firstFailed) {
    // Keep EVERY failed attempt of the first event on its own date, not just the latest one.
    firstFailedList.forEach((f) => {
      resultSchedule[f.dateKey] = f.val;
    });
    current = addWorkingDays(new Date(firstFailed.dateKey), 1);
    const retryDateKey = current.toISOString().split("T")[0];
    const retryCode = firstFailed.val.split("|")[0];
    resultSchedule[retryDateKey] = applySuffix(retryCode);
  } else {
    resultSchedule[formattedFirstDate] = applySuffix(firstEvent);
  }

  // Advance date step by step along the flow using working days (skipping Sat/Sun)
  flow.steps.forEach((step) => {
    const toBase = step.toEvent.split("-")[0].toUpperCase();
    // BABL override: fabric arriving there (-> FR) and BABL's approval turnaround (-> NY) each
    // take 8 working days instead of the usual 1. Every other step (FR -> PPS included) uses the
    // same lead time as every other plant.
    const effectiveLeadTimeDays =
      isBabl && (toBase === "FR" || toBase === "NY")
        ? BABL_LONG_LEAD_DAYS
        : step.leadTimeDays;
    current = addWorkingDays(current, effectiveLeadTimeDays);
    const dateKey = current.toISOString().split("T")[0];

    const codeToUse = step.toEvent;
    const baseCode = codeToUse.split("-")[0].toUpperCase();

    // A pinned milestone always wins: the planner explicitly dropped it on this exact day, so use
    // that real date verbatim and re-anchor the forward walk to it — every step after this one
    // must cascade off the REAL pinned date, not the lead-time-only date this loop would otherwise
    // compute for it.
    const pinnedForStep = pinnedEventsMap
      ? Object.values(pinnedEventsMap).find((p) => codeMatchesSlot(p.code, baseCode))
      : undefined;
    if (pinnedForStep) {
      resultSchedule[pinnedForStep.dateKey] = pinnedForStep.val;
      current = new Date(pinnedForStep.dateKey);
      return;
    }

    // Find ALL failed attempts for this event code sorted by date
    const failedListForStep = failedEventsMap
      ? Object.values(failedEventsMap)
          .filter((f) => codeMatchesSlot(f.code, baseCode))
          .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      : [];

    if (failedListForStep.length > 0) {
      // Keep ALL failed attempts on their original failed dates (turning RED)
      failedListForStep.forEach((f) => {
        resultSchedule[f.dateKey] = f.val;
      });

      // Get the LATEST failed attempt date
      const latestFail = failedListForStep[failedListForStep.length - 1];
      const latestFailD = new Date(latestFail.dateKey);

      if (!isNaN(latestFailD.getTime())) {
        const nextWorkD = addWorkingDays(latestFailD, 1);
        const retryDateKey = nextWorkD.toISOString().split("T")[0];

        // Re-schedule the EXACT failed event code on the next working day after latest failure
        const retryCode = latestFail.val.split("|")[0];
        resultSchedule[retryDateKey] = applySuffix(retryCode);

        // Update current date tracker for subsequent downstream steps
        current = nextWorkD;
        return;
      }
    }
    
    // Check Post-NY testing rule
    if (step.fromEvent === "NY") {
      const brandUpper = (triggerBrand || "").toUpperCase();
      if (brandUpper.includes("V8") || brandUpper.includes("PINK")) {
        resultSchedule[dateKey] = `DTC-3010`;
        return;
      }
    }

    resultSchedule[dateKey] = applySuffix(codeToUse);
  });

  // Ensure all failed entries in failedEventsMap remain on their date and have next working day retry scheduled after latest failure
  if (failedEventsMap) {
    const groupedFails: Record<string, Array<{ dateKey: string; val: string; code: string }>> = {};
    Object.values(failedEventsMap).forEach((f) => {
      // Only restore the failure onto its date if that cell is still blank, or already holds
      // the SAME event family being retried — never stomp a genuinely different, downstream
      // milestone the step loop above just legitimately computed for that date. A later step's
      // date is derived by adding lead-time days from the sequence start, and a repeated
      // failure's date is derived by adding working days from an earlier failure — these are
      // unrelated calculations that can land on the exact same calendar date by pure coincidence
      // (confirmed against real data: two FS failures a few days apart landed exactly on FR's and
      // PPS's own computed dates, silently erasing both from the schedule every time this ran).
      const existing = resultSchedule[f.dateKey];
      const existingBase = existing ? existing.split("|")[0].split("-")[0].toUpperCase() : "";
      const failBase = f.code.split("-")[0].toUpperCase();
      if (!existing || codeMatchesSlot(existingBase, failBase)) {
        resultSchedule[f.dateKey] = f.val;
      }
      const base = f.code.split("-")[0].toUpperCase();
      if (!groupedFails[base]) groupedFails[base] = [];
      groupedFails[base].push(f);
    });

    Object.values(groupedFails).forEach((fails) => {
      fails.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
      const latest = fails[fails.length - 1];
      const fD = new Date(latest.dateKey);
      if (!isNaN(fD.getTime())) {
        const nextWorkD = addWorkingDays(fD, 1);
        const retryDateKey = nextWorkD.toISOString().split("T")[0];
        if (!resultSchedule[retryDateKey]) {
          const retryCode = latest.val.split("|")[0];
          resultSchedule[retryDateKey] = applySuffix(retryCode);
        }
      }
    });
  }

  return resultSchedule;
}

/**
 * Auto-detects the most suitable PlanningFlow for a given row following the strict priority:
 * 1. PROCESS (col10)
 * 2. APPLICATION FORM (col15) / Sign Off Req (col27)
 * 3. PLANT FLOW (col12) & PLANT (col11)
 * 4. Number of Plants allocated & Dye/Wash vs 2-Plant vs Bulk Fast-Track vs 1-Plant (Option 1, 2, 3, 4)
 */
export type ApplicationFormCategory = "FIT FUNCTIONALS" | "CUT PANELS" | "MOCK-UPS" | "GARMENTS" | "FABRICS";

// Reads a row's APPLICATION FORM (col15) and S-Off Requirement (col27) — the fields that say
// what kind of item is being planned regardless of which specific event is scheduled on any
// given date — and returns which of the 5 categories it belongs to. Pulled out of
// detectMatchingFlow's step 1 so callers that only need the category (e.g. routing exports)
// don't have to run the rest of the flow-detection logic.
export function getApplicationFormCategory(row: Record<string, unknown>): ApplicationFormCategory {
  const appForm = String(String(String(String(String(row.col15 || ""))))).toUpperCase();
  const soffReq = String(String(String(String(String(row.col27 || ""))))).toUpperCase();

  // The S-Off Requirement (col27) is the authoritative "what kind of strike-off is this" field —
  // its values come from a fixed list (FABRIC / CUT PANEL / PILLOW CASES / MOCK-UP / FULL GARMENT
  // / FIT). When it carries one of those, it decides the category OUTRIGHT. The Application Form
  // (col15) is NOT consulted in that case: real charts write multi-stage app-form labels like
  // "PANEL>>GMT FORM" (panel form for the embellishment step, garment form for a later step) and
  // the stray "GMT" was misclassifying a FABRIC strike-off as GARMENTS — planning it SEWIN/GMT
  // instead of FS/FR. Confirmed against real data: GVU27-211 / 10355361, S-Off Req "FABRIC",
  // App Form "PANEL>>GMT FORM".
  if (soffReq.includes("FIT")) return "FIT FUNCTIONALS";
  if (soffReq.includes("MOCK")) return "MOCK-UPS";
  if (soffReq.includes("GARMENT") || soffReq.includes("PILLOW")) return "GARMENTS";
  if (soffReq.includes("CUT PANEL") || soffReq.includes("CUT-PANEL")) return "CUT PANELS";
  if (soffReq.includes("FABRIC")) return "FABRICS";

  // No recognised S-Off Requirement — fall back to the Application Form.
  if (appForm.includes("FIT") || appForm.includes("-FF")) {
    return "FIT FUNCTIONALS";
  }
  if (appForm.includes("MOCK")) {
    return "MOCK-UPS";
  }
  if (
    appForm.includes("GARMENT") ||
    appForm.includes("GMT") ||
    appForm.includes("PILLOW")
  ) {
    return "GARMENTS";
  }
  if (appForm.includes("CUT PANEL")) {
    return "CUT PANELS";
  }
  return "FABRICS";
}

/**
 * The category a row is actually PLANNED as — getApplicationFormCategory plus the fabric-only
 * overrides: a CK-family item (by Category, col3), OR a row running at BABL / AV (by Plant,
 * col11/col12 — see isFabricOnlyPlant), whose Application Form / S-Off Requirement says Garments
 * or Mock-Ups is planned the FABRICS way instead, starting FS. Callers that must line up with the
 * row's real event sequence — flow detection, the Fabric Dispatch export's sheet routing — use
 * THIS, not the raw Application-Form category, otherwise e.g. a CK garment row is planned
 * FS-first but exported onto a per-plant GARMENT tab.
 */
export function getPlanningCategory(row: Record<string, unknown>): ApplicationFormCategory {
  const category = getApplicationFormCategory(row);
  if (
    (category === "GARMENTS" || category === "MOCK-UPS") &&
    (isCkFamilyCategory(String(row.col3 || "")) || isFabricOnlyPlant(row))
  ) {
    return "FABRICS";
  }
  return category;
}

/**
 * Every planning flow a planner could reasonably pick for this row — i.e. all flows in the row's
 * Application-Form category (FABRICS has 4, MOCK-UPS 3, GARMENTS 3, CUT PANELS 2, FIT FUNCTIONALS
 * 1). detectMatchingFlow auto-picks ONE of these from plant/process structure; this returns the
 * full menu so the planner can override it (Event Status panel "Apply a planning flow" section).
 * The fabric-only rule (see getPlanningCategory) is inherited here too — via getPlanningCategory,
 * not a separate copy — so a CK, BABL, or AV garment/mock-up row offers the fabric flows,
 * matching what auto-detection would do.
 */
export function getApplicableFlows(row: Record<string, unknown>): PlanningFlow[] {
  const category: PlanningFlow["category"] = getPlanningCategory(row);
  return PLANNING_FLOWS.filter((f) => f.category === category);
}

// A planning event's milestone code with any trailing -S/-F/-T/-PASS/-FAIL marker and "|..."
// verdict tail stripped ("FR-S" -> "FR", "PPS|P" -> "PPS", "CK-TEST" stays "CK-TEST").
function planCycleEventBase(v: string): string {
  return v.split("|")[0].trim().toUpperCase().replace(/-(S|F|T|PASS|FAIL)$/i, "");
}

// Two milestone base codes "match" only when they're identical, or one is a slash-separated half
// of a combined slot the other represents ("REAP" is one half of "REAP/FCHP", "SEWIN" one half of
// "SEWIN/SEWS"). A plain string-prefix check ("x.startsWith(y) || y.startsWith(x)") was used here
// instead and matched unrelated codes that merely happen to share a prefix — "PPSDS".startsWith
// ("PPS") and "NYC".startsWith("NY") are both true even though PPS/PPSDS and NY/NYC are distinct
// milestones. That made a PPSDS failure get treated as a failure of the PPS step: PPS was skipped
// entirely and the forward date-walk reset backwards to the PPSDS retry, landing NY BEFORE RDPS
// (confirmed against real data: GVU27-059 / 10356689 combo C1 — failing PPSDS corrupted every
// event from PPS onward).
function codeMatchesSlot(a: string, b: string): boolean {
  if (a === b) return true;
  const aParts = a.split("/");
  const bParts = b.split("/");
  return aParts.includes(b) || bParts.includes(a);
}

// A gap this large (calendar days) between two consecutive scheduled events means the later one
// belongs to a fresh re-plan — a secondary cycle boundary on top of the "flow's first milestone
// appears again" rule below.
const PLAN_CYCLE_GAP_DAYS = 45;

export interface PlanCycle {
  index: number;      // 0-based order, oldest first
  label: string;      // "1 Sep 2026 – 15 Dec 2026 · 9 events"
  startKey: string;   // earliest date key in the cycle ("2026-09-01")
  endKey: string;     // latest date key
  count: number;      // number of event cells
  keys: string[];     // the actual row keys that make up this cycle (bare or "_<plant>"-suffixed)
}

/**
 * Splits a row's scheduled events into distinct planning cycles. One cycle is the normal case; a
 * graphic planned more than once over time (finished, then re-planned) has several.
 *
 * A new cycle begins when the row's detected flow's FIRST milestone (FS for fabrics, SEWIN/SEWS
 * for garments/mock-ups, CSRF for cut panels, …) shows up again AFTER the current cycle has
 * already moved past that milestone — i.e. it already has an FR/PPS/etc. A re-tried first
 * milestone (failed FS, then FS again the next day, with nothing in between) does NOT start a new
 * cycle. A >45-day gap also splits, as a backstop.
 *
 * Used by "Clear planning events" so the planner can wipe just one cycle instead of the lot.
 */
export function detectPlanCycles(row: Record<string, unknown>): PlanCycle[] {
  const events: { key: string; date: string; base: string }[] = [];
  for (const [k, v] of Object.entries(row)) {
    const m = k.match(/^(\d{4}-\d{2}-\d{2})(?:_.+)?$/);
    if (!m) continue;
    const s = String(v ?? "").trim();
    if (!s) continue;
    events.push({ key: k, date: m[1], base: planCycleEventBase(s) });
  }
  if (events.length === 0) return [];

  // The flow's first milestone — "FS", or a combined slot like "SEWIN/SEWS" / "CSRF-FF".
  const firstSlot = String(detectMatchingFlow(row).sequence[0] || "").toUpperCase();
  const firstParts = firstSlot.split("/").map((p) => p.split("-")[0].trim()).filter(Boolean);
  const isFirstMilestone = (base: string) => {
    if (!firstSlot) return false;
    if (base === firstSlot) return true;
    const b = base.split("-")[0];
    return firstParts.includes(b);
  };

  events.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));

  const groups: { key: string; date: string; base: string }[][] = [];
  let current: { key: string; date: string; base: string }[] = [];
  let prevDate: string | null = null;

  for (const ev of events) {
    const gapDays = prevDate
      ? (Date.parse(ev.date) - Date.parse(prevDate)) / 86_400_000
      : 0;
    // Current cycle has already progressed past its opening milestone (it holds an event that
    // isn't the first milestone) — so a fresh first milestone now means a genuine re-plan.
    const cycleHasProgressed = current.some((e) => !isFirstMilestone(e.base));
    const startsNewCycle =
      current.length === 0 ||
      gapDays > PLAN_CYCLE_GAP_DAYS ||
      (isFirstMilestone(ev.base) && cycleHasProgressed);
    if (startsNewCycle) {
      current = [];
      groups.push(current);
    }
    current.push(ev);
    prevDate = ev.date;
  }

  const fmt = (d: string) => {
    const dt = new Date(d);
    return isNaN(dt.getTime())
      ? d
      : dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  return groups.map((g, i) => {
    const dates = g.map((e) => e.date).sort();
    const startKey = dates[0];
    const endKey = dates[dates.length - 1];
    return {
      index: i,
      startKey,
      endKey,
      count: g.length,
      keys: g.map((e) => e.key),
      label: `${fmt(startKey)}${endKey !== startKey ? ` – ${fmt(endKey)}` : ""} · ${g.length} event${g.length === 1 ? "" : "s"}`,
    };
  });
}

// Graphic Type (col19) values that never go to New York — per the planner, Branding and Trial
// graphics are visibly called out in that column on the dashboard already, so no separate flag
// is needed to decide it. Same values/matching convention as db.ts's
// ADVANCED_ANALYTICS_EXCLUDED_GRAPHIC_TYPES (lowercase substring match).
const NY_SKIPPED_GRAPHIC_TYPES = ["branding", "trial"];

function skipsNyForGraphicType(row: Record<string, unknown>): boolean {
  const graphicType = String(row.col19 || "").toLowerCase();
  return NY_SKIPPED_GRAPHIC_TYPES.some((t) => graphicType.includes(t));
}

/**
 * Bridges a flow's NY/NYC leg out entirely — the step feeding NY reconnects straight to whatever
 * followed NYC, reusing that feeding step's own lead time (same convention already used by the
 * "Direct Fabrics Fast-Track" flow, which bypasses NY/NYC the same way). A flow with no NY/NYC
 * (already a fast-track / FIT FUNCTIONALS flow) is returned unchanged.
 */
function stripNyNyc(flow: PlanningFlow): PlanningFlow {
  const isNyNode = (event: string) => event === "NY" || event === "NYC";
  if (!flow.sequence.some(isNyNode)) return flow;

  const toNy = flow.steps.find((s) => isNyNode(s.toEvent) && !isNyNode(s.fromEvent));
  const fromNy = [...flow.steps].reverse().find((s) => isNyNode(s.fromEvent) && !isNyNode(s.toEvent));
  const steps = flow.steps.filter((s) => !isNyNode(s.fromEvent) && !isNyNode(s.toEvent));
  if (toNy && fromNy) {
    const keptBefore = flow.steps.slice(0, flow.steps.indexOf(toNy)).filter(
      (s) => !isNyNode(s.fromEvent) && !isNyNode(s.toEvent),
    ).length;
    steps.splice(keptBefore, 0, {
      fromEvent: toNy.fromEvent,
      toEvent: fromNy.toEvent,
      leadTimeDays: toNy.leadTimeDays,
      label: toNy.label,
    });
  }

  return {
    ...flow,
    sequence: flow.sequence.filter((s) => !isNyNode(s)),
    steps,
    totalLeadTimeDays: steps.reduce((sum, s) => sum + s.leadTimeDays, 0),
  };
}

function applyGraphicTypeSkip(row: Record<string, unknown>, flow: PlanningFlow): PlanningFlow {
  return skipsNyForGraphicType(row) ? stripNyNyc(flow) : flow;
}

/** Auto-picks the planning flow for a row's plant/process structure — see detectMatchingFlow. */
function detectMatchingFlowRaw(row: Record<string, unknown>): PlanningFlow {
  const process = String(String(String(String(String(row.col10 || ""))))).toUpperCase();
  // col12 that is actually a PROCESS description (not a plant chain) is ignored for every
  // plant-structure check below — see plantFlowIsProcessText.
  const plantFlow = plantFlowIsProcessText(row.col12)
    ? ""
    : String(String(String(String(String(row.col12 || ""))))).toUpperCase();
  const plant = String(String(String(String(String(row.col11 || ""))))).toUpperCase();

  // 1. Determine Application Form Category
  // Fabric-only rule (inside getPlanningCategory): a CK-category item, or a row running at BABL /
  // AV, whose S-Off Requirement is Garments or Mock-Ups is planned the FABRICS way — starting FS
  // (not the SEWIN-first garments/mock-ups flow) — and still picks up the dye-plant (PPSDS ->
  // RDPS) and two-plant (PPSES) fabric variants from the plant-structure checks below. Only
  // CK/BABL/AV behave this way; every other Garments/Mock-Ups item keeps its own flow.
  const category = getPlanningCategory(row);

  if (category === "FIT FUNCTIONALS") {
    return PLANNING_FLOWS.find((f) => f.id === 13) || PLANNING_FLOWS[0];
  }

  // Longest sequential plant chain within any single branch (see the fuller comment further
  // below where maxChainPlants is used).
  const CHAIN_STEP_SPLIT = />>|->|=>|,|>/;
  const longestChain = (raw: string): number =>
    Math.max(
      0,
      ...raw
        .split(/\/|\+/)
        .map((branch) => branch.split(CHAIN_STEP_SPLIT).map((s) => s.trim()).filter(Boolean).length),
    );
  const maxChainPlants = Math.max(longestChain(plantFlow), longestChain(plant));

  // A single dispatch location that COMBINES two or more real embellishment plants with "+"
  // ("Antler + Leema", "RC + MRC") runs a genuine plant-to-plant strike-off between them, so it
  // takes the 2-plant PPSES flow just like a sequential ">>" chain does — even though "+" means
  // one location, not a parallel "/" split. Per the planner: decided per combined location, on
  // either the PLANT or PLANT FLOW column. Dye/wash vendors (BFL / MARTEX / DYNAWASH) are dropped
  // by extractPlants, so "LEEMA + BFL" still resolves to one plant here and is left alone.
  const SEGMENT_SPLIT = /\/|>>|->|=>|,|>/;
  const hasCombinedMultiPlantLocation = [plant, plantFlow].some((raw) =>
    raw
      .split(SEGMENT_SPLIT)
      .some((seg) => seg.includes("+") && extractPlants(seg).length >= 2),
  );

  // 2. Dye-plant strike-off flow (Option 3: PPSDS -> RDPS).
  //
  // PER THE PLANNER: this is driven ONLY by a known dye/wash vendor named in the PLANT FLOW
  // (col12) — BFL / MARTEX / DYNAWASH. It is NOT inferred from the PROCESS column (free text
  // like "Send to Wash" is an in-house step and must never pull in the dye-plant round-trip on
  // its own), and NOT from the PLANT column (col11). The structural "3+-plant chain in the
  // plant flow is a dye round-trip" case is handled separately below. Confirmed against real
  // data: GVU27-231 style 10355864 has PLANT FLOW "CKT" (one plant) yet process "…Send to
  // Wash…" and was wrongly planned as a dye-plant item with no dye plant anywhere.
  const isDyeWashPlant = DYE_WASH_PLANT_NAMES.some((name) => plantFlow.includes(name));

  if (isDyeWashPlant) {
    switch (category) {
      case "MOCK-UPS":
        return PLANNING_FLOWS.find((f) => f.id === 7) || PLANNING_FLOWS.find((f) => f.id === 3)!;
      case "GARMENTS":
        return PLANNING_FLOWS.find((f) => f.id === 10) || PLANNING_FLOWS.find((f) => f.id === 3)!;
      case "CUT PANELS":
      case "FABRICS":
      default:
        return PLANNING_FLOWS.find((f) => f.id === 3)!; // Dye Plant Flow: PPSDS -> RDPS -> PPS
    }
  }

  // 3. Check Bulk Fast-Track / Direct Flow (Option 4 flow)
  const isBulkFastTrack =
    process.includes("BULK") ||
    process.includes("DIRECT") ||
    process.includes("FAST");

  if (isBulkFastTrack) {
    return PLANNING_FLOWS.find((f) => f.id === 4)!;
  }

  // 4. Multi-plant strike-off flows — Option 2 (2-plant PPSES) / Option 3 (3+-plant dye/wash
  // round-trip). These add extra send/return steps and only apply to a genuine SEQUENTIAL chain
  // (A > B > C, where a middle plant is an intermediary the item is sent to and back from).
  //
  // Cross-dev "/" branches are PARALLEL — each plant does the full embellishment on its own — and
  // "+" is one combined location. Plants on different sides of a "/" or "+" must NOT be counted
  // together toward these tests. Confirmed against real data: "AV / HI-EMB" and
  // "ANTLER >> LEEMA / REGAL IMAGE" are NOT dye/PPSES chains — the first is two independent
  // 1-plant flows, the second a 2-plant chain plus a separate 1-plant branch. `maxChainPlants`
  // (computed near the top of this function) is the length of the longest chain within any
  // single branch. The single ">" is a real delimiter in the data ("RICHCOLOR>BFL>LEEMA").

  // A 3rd (or more) plant IN ONE PLANT FLOW chain is structurally a dye/wash round-trip
  // intermediary (PPSDS -> RDPS), regardless of that plant's specific name — this generalizes
  // beyond the hardcoded BFL/MARTEX/DYNAWASH list. Keyed off the PLANT FLOW (col12) only, per
  // the planner's rule that the dye flow is decided by the plant flow.
  if (!isDyeWashPlant && longestChain(plantFlow) >= 3) {
    switch (category) {
      case "MOCK-UPS":
        return PLANNING_FLOWS.find((f) => f.id === 7) || PLANNING_FLOWS.find((f) => f.id === 3)!;
      case "GARMENTS":
        return PLANNING_FLOWS.find((f) => f.id === 10) || PLANNING_FLOWS.find((f) => f.id === 3)!;
      case "CUT PANELS":
      case "FABRICS":
      default:
        return PLANNING_FLOWS.find((f) => f.id === 3)!; // Dye Plant Flow: PPSDS -> RDPS -> PPS
    }
  }

  // 2-plant PPSES chain — same parallel-vs-sequential rule as above: a "/" cross-dev split like
  // "AV / HI-EMB" is NOT a 2-plant chain (each branch does its own single-plant flow), so count
  // only plants within one branch. A "+"-combined location naming two real plants
  // ("Antler + Leema") DOES count (hasCombinedMultiPlantLocation) — both plants strike off.
  const hasTwoPlants =
    maxChainPlants >= 2 ||
    plantFlow.includes(">>") ||
    plantFlow.includes("->") ||
    hasCombinedMultiPlantLocation;

  if (hasTwoPlants) {
    switch (category) {
      case "FABRICS":
        return PLANNING_FLOWS.find((f) => f.id === 2)!; // Fabrics with PPSES
      case "MOCK-UPS":
        return PLANNING_FLOWS.find((f) => f.id === 6)!; // Mock-ups with PPSES
      case "GARMENTS":
        return PLANNING_FLOWS.find((f) => f.id === 9)!; // Garments with PPSES
      case "CUT PANELS":
        return PLANNING_FLOWS.find((f) => f.id === 12)!; // Cut Panels with PPSES
    }
  }

  // 5. Default: Option 1 (Basic / 1-Plant Flow)
  switch (category) {
    case "MOCK-UPS":
      return PLANNING_FLOWS.find((f) => f.id === 5)!; // Standard Mock-ups Flow
    case "GARMENTS":
      return PLANNING_FLOWS.find((f) => f.id === 8)!; // Standard Garments Flow
    case "CUT PANELS":
      return PLANNING_FLOWS.find((f) => f.id === 11)!; // Standard Cut Panels Flow
    case "FABRICS":
    default:
      return PLANNING_FLOWS.find((f) => f.id === 1)!; // Standard Fabrics Flow
  }
}

/**
 * Auto-picks the planning flow for this row from its plant/process structure (detectMatchingFlow-
 * Raw), then drops NY/NYC from it when the row's Graphic Type (col19) is Branding or Trial —
 * those never go to New York, so no planning event should ever be generated for either milestone.
 */
export function detectMatchingFlow(row: Record<string, unknown>): PlanningFlow {
  return applyGraphicTypeSkip(row, detectMatchingFlowRaw(row));
}

/**
 * For a row that's one stage of a multi-plant PLANT FLOW chain (e.g. "LEEMA>BFL>RICHCOLOR"),
 * returns which of the matched flow's sequence events actually belong to THIS row's plant —
 * so auto-scheduling one stage's row doesn't stamp the entire end-to-end sequence onto it.
 *
 * PLANT FLOW order = physical process order (this is a business rule, not inferred): the FIRST
 * plant in the chain starts the item (FS/FR — or GMT/MOC/CPS for garments/mock-ups/cut panels),
 * any MIDDLE plant(s) are a wash/dye round-trip (the strike-off send/return step(s) between the
 * origin milestone and PPS), and the LAST plant carries the strike-off onward through final
 * approval (PPS.../PLSA). A 2-plant chain has no middle stage, so the last plant picks up the
 * strike-off step too.
 *
 * Returns null when the row isn't part of a recognized multi-stage chain, or the matched flow's
 * shape isn't recognized (no FR/GMT/MOC/CPS milestone or no PPS step to anchor the boundaries) —
 * callers should fall back to applying the full flow, same as today's single-plant behavior.
 */
export function getEventsForChainStage(
  flow: PlanningFlow,
  plantFlowRaw: unknown,
  plantRaw: unknown
): string[] | null {
  // col12 that is really a PROCESS description, not a plant chain — its ">>" steps are
  // manufacturing stages, not plants, so this row gets the full flow like any single-plant row.
  if (plantFlowIsProcessText(plantFlowRaw)) return null;

  const PLANT_CHAIN_SPLIT = />>|->|=>|,|\+|\/|>/;
  // A "/" INSIDE one PLANT FLOW stage lists alternative plants for that stage (a cross-dev
  // split), NOT further stages: "BFL (WA01055) >>ANTLER/REGAL/EXPO" is BFL -> one of
  // ANTLER/REGAL/EXPO, i.e. 2 stages. Splitting on "/" here made it a 4-plant chain, so the EXPO
  // row counted as the LAST stage and only got PPS onward (SEWIN/GMT/RDPS were handed to
  // phantom earlier plants). Confirmed against real data: GVF27-012 / 10356717 (C2).
  const STAGE_SPLIT = />>|->|=>|,|\+|>/;
  const segments = String(plantFlowRaw || "")
    .toUpperCase()
    .split(STAGE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length < 2) return null;

  // If the PLANT cell (col11) ITSELF spells out the whole chain — "ANTLER => LEEMA",
  // "ANTLER >> LEEMA", "RICHCOLOR>BFL>LEEMA" — then this one row represents every stage of the
  // flow, not a single plant's slice of it, so it must get the full sequence (return null, same
  // as an ordinary single-plant row). "=>" in the PLANT column is the data's way of saying "goes
  // to two plants in sequence" (NOT a cross-dev "/" split). The stage-narrowing below only
  // applies when col11 names ONE plant that shows up as a stage inside col12's chain — the real
  // multi-row case ("LEEMA" / "BFL" / "RICHCOLOR" rows all sharing one PLANT FLOW).
  const plantChainParts = String(plantRaw || "")
    .toUpperCase()
    .split(PLANT_CHAIN_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
  if (plantChainParts.length >= 2) return null;

  const plant = String(plantRaw || "").trim().toUpperCase();
  if (!plant) return null;
  const plantMatches = (seg: string) =>
    seg.split("/").map((s) => s.trim()).filter(Boolean)
      .some((s) => s === plant || plant.includes(s) || s.includes(plant));
  const myIndex = segments.findIndex(plantMatches);
  if (myIndex === -1) return null;

  // This one plant may occupy MORE than one position in the chain — "REGAL IMAGE >> BFL >> REGAL"
  // is a SINGLE plant ("REGAL IMAGE" == "REGAL") doing a wash round-trip via BFL, not three
  // distinct plants. If every chain segment is either this plant or a known external wash/dye
  // vendor (BFL / MARTEX / DYNAWASH), there is no "other" real plant to hand the later steps to —
  // this row carries the WHOLE sequence. Fall back to the full flow (return null), same as an
  // ordinary single-plant row. Confirmed against real data: GVU27-200 / 10356691, PLANT
  // "REGAL IMAGE", PLANT FLOW "REGAL IMAGE>>BFL WA01055>>REGAL" was getting only FS/FR/PPSDS —
  // RDPS and PPS-onward were assigned to a non-existent "REGAL" row.
  const everySegIsMineOrWashVendor = segments.every(
    (s) => plantMatches(s) || DYE_WASH_PLANT_NAMES.some((n) => s.includes(n)),
  );
  const myMatchCount = segments.filter(plantMatches).length;
  if (everySegIsMineOrWashVendor && myMatchCount >= 2) {
    return null;
  }

  // A 2-plant chain where the OTHER plant is a known external wash/dye VENDOR
  // (BFL / MARTEX / DYNAWASH) that never gets its own tracked planning row —
  // e.g. PLANT FLOW "CKT>>BFL", PLANT "CKT". There's no BFL row to pick up the
  // strike-off round-trip (PPSDS/RDPS) or the approval chain (PPS onward), so
  // narrowing this row to just its origin block (FS/FR) silently drops every
  // later event. This one real plant carries the WHOLE sequence — fall back to
  // the full flow (return null), same as an ordinary single-plant row. The
  // 3-plant "middle is a wash vendor" case is still split across the bookends
  // below; this only covers the 2-plant case that had no handling at all.
  if (segments.length === 2) {
    const otherSegment = segments[myIndex === 0 ? 1 : 0];
    const otherIsWashVendor = DYE_WASH_PLANT_NAMES.some((n) => otherSegment.includes(n));
    const iAmWashVendor = DYE_WASH_PLANT_NAMES.some((n) => plant.includes(n));
    if (otherIsWashVendor && !iAmWashVendor) return null;
  }

  const seq = flow.sequence;
  // Origin block: everything up to and including the fabric/sample-received milestone.
  const originEndIdx = seq.findIndex(
    (s) => s === "FR" || s.startsWith("FR-") || s === "GMT" || s === "MOC" || s === "CPS"
  );
  // PPS anchors where the strike-off block ends and the approval chain (PPS onward) begins.
  const ppsIdx = seq.findIndex((s) => s === "PPS" || s.startsWith("PPS-"));
  if (originEndIdx === -1 || ppsIdx === -1 || ppsIdx <= originEndIdx) return null;

  const originSteps = seq.slice(0, originEndIdx + 1);
  const strikeOffSteps = seq.slice(originEndIdx + 1, ppsIdx); // PPSES alone, or PPSDS+RDPS
  const finalSteps = seq.slice(ppsIdx); // PPS through PLSA/RFIT

  const isFirst = myIndex === 0;
  const isLast = myIndex === segments.length - 1;

  // A middle segment naming a known external wash/dye VENDOR (BFL, MARTEX, DYNAWASH — same
  // names detectMatchingFlow's isDyeWashPlant checks) never gets its own tracked planning row —
  // it's a pass-through step, not an internally-managed plant. So unless THIS row's own Plant
  // literally IS that middle name (a historical row that genuinely does track it separately —
  // real data has both patterns), nobody will ever claim the strike-off block in the middle:
  // split it across the two real bookend plants instead — send (first step, e.g. PPSDS) goes
  // with the origin plant, return (the rest, e.g. RDPS) goes with the final plant.
  if (!isFirst && !isLast) {
    return strikeOffSteps; // this row genuinely IS the middle plant — keep the whole round trip
  }
  if (segments.length === 3) {
    const middleIsWashVendor = DYE_WASH_PLANT_NAMES.some((name) => segments[1].includes(name));
    if (middleIsWashVendor && strikeOffSteps.length >= 2) {
      const [sendStep, ...returnSteps] = strikeOffSteps;
      if (isFirst) return [...originSteps, sendStep];
      if (isLast) return [...returnSteps, ...finalSteps];
    }
  }

  if (isFirst) return originSteps;
  if (isLast) return segments.length === 2 ? [...strikeOffSteps, ...finalSteps] : finalSteps;
  return strikeOffSteps; // unreachable (isFirst/isLast covers every case above) — kept for safety
}

/**
 * Subtracts working days from a date (skipping Saturdays and Sundays).
 */
export function subtractWorkingDays(startDate: Date, days: number): Date {
  const result = new Date(startDate);
  let count = 0;
  while (count < days) {
    result.setDate(result.getDate() - 1);
    if (!isNonWorkingDay(result)) {
      count++;
    }
  }
  return result;
}

/**
 * Smart backfills preceding flow milestone events (e.g. SEWIN/SEWS, MOC, GMT, CSRF, CPS, FS)
 * before FR / Fabric Received date if they are missing from the row schedule.
 */
export function backfillPrecedingMilestones<T extends Record<string, unknown>>(row: T): T {
  const updated: Record<string, unknown> = { ...row };
  const flow = detectMatchingFlow(row);

  // This whole function backfills the milestones that come BEFORE FR (FS, or SEWIN/SEWS + GMT/MOC,
  // or CSRF + CPS). If the detected flow has no FR step at all — only the Garments + Dye flow
  // (id 10: SEWIN/SEWS -> GMT -> RDPS -> PPS) — there is nothing to anchor against, and the
  // PPS-derived fallback below would fabricate a bogus "FR-S" that isn't part of the sequence.
  // Its opening milestones (SEWIN/SEWS, GMT) are already placed by calculateAutoSchedule as
  // sequence[0]/[1], so bail out. Confirmed against real data: GVU27-203 / 10356690, S-Off Req
  // "PILLOW CASES", was getting a stray FR wedged in front of SEWIN/SEWS.
  if (!flow.sequence.some((s) => s.toUpperCase().startsWith("FR"))) {
    return row;
  }

  const formatLocalDate = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  // Find the FR date to backfill FS (etc.) against. The ACTUAL scheduled FR date key wins —
  // col14 (Fabric In Date) is only a fallback for when no FR is scheduled at all. col14 used to
  // be checked FIRST, which stranded FS one working day before the fabric-in date even when the
  // real FR was weeks later (planned from a picked start date). Confirmed against real data:
  // col14 "2026-08-29" put FS on 2026-08-28 while the flow ran FR onward from 2026-09-09.
  // Priority: an actual FR date key > FR derived from a scheduled PPS > col14 (Fabric In Date).
  let frDateStr: string | null = null;
  for (const [k, v] of Object.entries(row)) {
    if (k.match(/^\d{4}-\d{2}-\d{2}$/) && typeof v === "string" && v.toUpperCase().startsWith("FR")) {
      frDateStr = k;
      break;
    }
  }

  // If FR is not explicitly found on a date key, derive FR from PPS if PPS is present
  if (!frDateStr) {
    let ppsDateStr: string | null = null;
    for (const [k, v] of Object.entries(row)) {
      if (k.match(/^\d{4}-\d{2}-\d{2}$/) && typeof v === "string" && v.toUpperCase().startsWith("PPS")) {
        ppsDateStr = k;
        break;
      }
    }
    if (ppsDateStr) {
      const matchPPS = ppsDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (matchPPS) {
        const ppsD = new Date(parseInt(matchPPS[1], 10), parseInt(matchPPS[2], 10) - 1, parseInt(matchPPS[3], 10));
        if (!isNaN(ppsD.getTime())) {
          const frD = subtractWorkingDays(ppsD, 1);
          frDateStr = formatLocalDate(frD);
          if (!updated[frDateStr]) {
            updated[frDateStr] = "FR-S";
          }
        }
      }
    }
  }

  // Last resort: no FR and no PPS anywhere — fall back to col14 (Fabric In Date).
  if (!frDateStr && row.col14 && typeof row.col14 === "string" && (row.col14 as string).match(/^\d{4}-\d{2}-\d{2}$/)) {
    frDateStr = row.col14 as string;
  }

  if (!frDateStr) return row;

  const matchFR = frDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matchFR) return row;

  const frDate = new Date(parseInt(matchFR[1], 10), parseInt(matchFR[2], 10) - 1, parseInt(matchFR[3], 10));
  if (isNaN(frDate.getTime())) return row;

  // Check if any date key already contains SEWIN/SEWS, MOC, GMT, CSRF, CPS, FS
  const existingValues = Object.entries(row)
    .filter(([k, v]) => k.match(/^\d{4}-\d{2}-\d{2}$/) && Boolean(v))
    .map(([_, v]) => String(v).toUpperCase());

  const hasEvent = (code: string) => existingValues.some((val) => val.includes(code.toUpperCase()));

  // Backfill steps based on flow category/sequence
  if (flow.category === "MOCK-UPS" || flow.sequence.includes("MOC")) {
    // Sequence: SEWIN/SEWS -> MOC -> FR
    let mocDateStr: string | null = null;
    if (!hasEvent("MOC")) {
      const mocD = subtractWorkingDays(frDate, 1);
      mocDateStr = formatLocalDate(mocD);
      if (!updated[mocDateStr]) {
        updated[mocDateStr] = "MOC";
      }
    }

    if (!hasEvent("SEWIN") && !hasEvent("SEWS")) {
      const baseD = mocDateStr ? new Date(mocDateStr) : frDate;
      const sewinD = subtractWorkingDays(baseD, 1);
      const sewinDateStr = formatLocalDate(sewinD);
      if (!updated[sewinDateStr]) {
        updated[sewinDateStr] = "SEWIN/SEWS";
      }
    }
  } else if (flow.category === "GARMENTS" || flow.sequence.includes("GMT")) {
    // Sequence: SEWIN/SEWS -> GMT -> FR
    let gmtDateStr: string | null = null;
    if (!hasEvent("GMT")) {
      const gmtD = subtractWorkingDays(frDate, 1);
      gmtDateStr = formatLocalDate(gmtD);
      if (!updated[gmtDateStr]) {
        updated[gmtDateStr] = "GMT";
      }
    }

    if (!hasEvent("SEWIN") && !hasEvent("SEWS")) {
      const baseD = gmtDateStr ? new Date(gmtDateStr) : frDate;
      const sewinD = subtractWorkingDays(baseD, 1);
      const sewinDateStr = formatLocalDate(sewinD);
      if (!updated[sewinDateStr]) {
        updated[sewinDateStr] = "SEWIN/SEWS";
      }
    }
  } else if (flow.category === "CUT PANELS" || flow.sequence.includes("CSRF")) {
    // Sequence: CSRF -> CPS -> FR
    let cpsDateStr: string | null = null;
    if (!hasEvent("CPS")) {
      const cpsD = subtractWorkingDays(frDate, 1);
      cpsDateStr = formatLocalDate(cpsD);
      if (!updated[cpsDateStr]) {
        updated[cpsDateStr] = "CPS";
      }
    }

    if (!hasEvent("CSRF")) {
      const baseD = cpsDateStr ? new Date(cpsDateStr) : frDate;
      const csrfD = subtractWorkingDays(baseD, 1);
      const csrfDateStr = formatLocalDate(csrfD);
      if (!updated[csrfDateStr]) {
        updated[csrfDateStr] = "CSRF";
      }
    }
  } else if (flow.category === "FABRICS" || flow.sequence.includes("FS")) {
    // Sequence: FS -> FR
    if (!hasEvent("FS")) {
      const fsD = subtractWorkingDays(frDate, 1);
      const fsDateStr = formatLocalDate(fsD);
      if (!updated[fsDateStr]) {
        updated[fsDateStr] = "FS-S";
      }
    }
  }

  return updated as T;
}

/**
 * Applies calculated schedule dates directly to an EmbellishmentRow object.
 * Preserves any explicit imported dates already present on the row and backfills missing preceding milestones.
 */
export function autoScheduleEmbellishmentRow<T extends Record<string, unknown>>(
  row: T,
  flowId?: number,
  startDateStr?: string,
  eventSuffix: "S" | "F" | "T" = "S",
  // skipNyNyc: drop NY/NYC from the flow regardless of Graphic Type — used only for the
  // brand-new-row scheduling that runs right after a tracking-chart import (Import Excel /
  // Planning Sheet / CK Tracking Chart), per the planner: an import shouldn't stamp NY/NYC
  // submission dates in on its own, only the milestones up to PPS. Manual scheduling (Auto-
  // Schedule button, Replan, Apply Flow, the Event Status Panel) is untouched and keeps NY/NYC.
  options?: { skipNyNyc?: boolean }
): T {
  // STRICT GATE: a row gets planning events ONLY when it has BOTH a real Plant and a real S-Off
  // Requirement (hasCompleteAllocationContext). No S-Off Requirement -> no planning events, full
  // stop. This holds even when the row already carries a real FR / NY pass-or-fail date, and even
  // when a caller passes an explicit flowId — neither is a substitute for the item's own S-Off
  // Requirement. Any auto-projected sequence pills ("-S") already sitting on such a row are
  // stripped here so it can never keep a plan it isn't entitled to. Genuine confirmed events
  // (FR, NY|P, a plant-entered actual — no "-S" suffix) are the row's real history and are left
  // untouched. Set to "" rather than deleted: the server merges schedule keys on save, so an
  // absent key means "leave as-is" while "" actually clears it.
  if (!hasCompleteAllocationContext(row)) {
    const cleanRow = { ...row };
    if (!isRealAllocationValue((cleanRow as Record<string, unknown>).col11)) {
      (cleanRow as Record<string, unknown>).col11 = "";
    }
    Object.keys(cleanRow).forEach((k) => {
      if (k.match(/^\d{4}-\d{2}-\d{2}(_.+)?$/)) {
        const val = String(String(String(String(String(cleanRow[k] || ""))))).toUpperCase();
        if (val.endsWith("-S")) {
          (cleanRow as Record<string, unknown>)[k] = "";
        }
      }
    });
    return cleanRow as T;
  }

  // Planner-locked ("|X") milestones: {BASECODE -> the YYYY-MM-DD key it sits on}. These are
  // fixed points — the plan is built AROUND them, never over them. See ParsedEvent.isPinned.
  const pinnedDateByCode: Record<string, string> = {};
  Object.entries(row).forEach(([k, v]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || typeof v !== "string" || !v.trim()) return;
    const p = parseEventValue(v);
    if (p?.isPinned) pinnedDateByCode[p.code.toUpperCase()] = k;
  });
  const pinnedKeys = new Set(Object.values(pinnedDateByCode));

  let matchedFlow = flowId
    ? applyGraphicTypeSkip(row, PLANNING_FLOWS.find((f) => f.id === flowId) || detectMatchingFlow(row))
    : detectMatchingFlow(row);
  if (options?.skipNyNyc) {
    matchedFlow = stripNyNyc(matchedFlow);
  }

  // Start date is always "as soon as possible" — the next working day — once a row's allocation
  // data is complete, full stop. This used to also check Fabric In Date (col14) / Ready Date
  // (col28) and push the start out to whichever of those was a future date, on the theory that an
  // item can't be submitted before its fabric physically arrives. Explicitly overridden: those
  // fields are not reliable enough to gate scheduling on (confirmed against real data: an
  // Allocation Chart's "Ready date" column held the exact same boilerplate value on every row
  // regardless of technique or plant, silently pushing every schedule weeks into the future) — the
  // moment the required allocation columns are filled is what should start the plan, not a
  // same-file date field of uncertain reliability.
  let effectiveStartDate = startDateStr;
  if (!effectiveStartDate && pinnedKeys.size > 0) {
    const earliestPinnedDate = Array.from(pinnedKeys).sort()[0];

    // Prefer the REAL earliest date already recorded in the SAME planning cycle as this pin (its
    // actual FS/FR/fail-retry history) over back-solving a fictitious start purely from the pin's
    // lead-time math. Back-solving unconditionally — ignoring real history still sitting right on
    // the row — was rewriting FS/FR to brand-new invented dates every time a downstream event got
    // failed/passed (which routes through this full rebuild) AFTER an earlier mid-flow milestone
    // had been manually moved/pinned: confirmed against real data — fail PPSDS, move PPS out to a
    // later date (pinning it), then later fail NY — FS/FR silently reset to dates back-solved from
    // PPS's new position instead of staying on their real recorded dates, corrupting the whole plan.
    // detectPlanCycles already knows how to tell "this pin's own real history" apart from "a stale
    // leftover from an abandoned earlier cycle" (>45-day gap / first-milestone-repeats rule), so
    // reuse it instead of duplicating that judgment here.
    const pinCycle = detectPlanCycles(row).find(
      (c) => c.startKey <= earliestPinnedDate && earliestPinnedDate <= c.endKey,
    );
    if (pinCycle && pinCycle.startKey < earliestPinnedDate) {
      effectiveStartDate = pinCycle.startKey;
    } else {
      // No earlier real history in this cycle (the pin IS the earliest event) — BACK-SOLVE the
      // flow start from the pinned milestone so its slot in the sequence lands on exactly the day
      // the planner pinned it (and everything downstream cascades off it).
      const earliestPinnedCode = Object.keys(pinnedDateByCode).find(
        (c) => pinnedDateByCode[c] === earliestPinnedDate,
      );
      const seqIdx = earliestPinnedCode
        ? matchedFlow.sequence.findIndex((slot) =>
            slot.split("/").some((p) => p.split("-")[0].trim().toUpperCase() === earliestPinnedCode),
          )
        : -1;
      if (seqIdx > 0) {
        let cumulativeDays = 0;
        for (let i = 0; i < seqIdx && i < matchedFlow.steps.length; i++) {
          cumulativeDays += matchedFlow.steps[i].leadTimeDays;
        }
        effectiveStartDate = subtractWorkingDays(new Date(earliestPinnedDate), cumulativeDays)
          .toISOString()
          .split("T")[0];
      } else {
        // Pinned milestone is the flow's opener (or not in the flow): its date IS the start.
        effectiveStartDate = earliestPinnedDate;
      }
    }
  }
  if (!effectiveStartDate) {
    const dateKeys = Object.keys(row)
      .filter((k) => k.match(/^\d{4}-\d{2}-\d{2}$/) && Boolean(row[k]))
      .sort();
    if (dateKeys.length > 0) {
      effectiveStartDate = dateKeys[0];
    }
  }

  if (!effectiveStartDate) {
    // "From the next day onwards" — not today. The working-day skip loop just below still
    // advances further past a weekend/holiday if tomorrow happens to land on one.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    effectiveStartDate = tomorrow.toISOString().split("T")[0];
  }

  // Detect any date keys on row where an event was marked failed (red) or passed (green)
  const failedEventsMap: Record<string, { dateKey: string; val: string; code: string }> = {};
  const preservedEventsMap: Record<string, { dateKey: string; val: string; code: string }> = {};

  Object.entries(row).forEach(([k, v]) => {
    if (k.match(/^\d{4}-\d{2}-\d{2}$/) && typeof v === "string" && v.trim()) {
      const parsed = parseEventValue(v);
      const strVal = v.toUpperCase();
      const isFail =
        parsed?.status === "fail" ||
        strVal.includes("FAIL") ||
        strVal.includes("REJECT") ||
        strVal.includes("RED") ||
        strVal.endsWith("-F") ||
        strVal.includes("|F|");
      const isPass =
        parsed?.status === "pass" ||
        strVal.includes("PASS") ||
        strVal.includes("GREEN") ||
        strVal.endsWith("-PASS") ||
        strVal.includes("|P");

      if (isFail || isPass || parsed?.isPinned) {
        const code = (parsed?.code || v).split("-")[0].split("|")[0].toUpperCase();
        preservedEventsMap[k] = { dateKey: k, val: v, code };
        if (isFail) {
          failedEventsMap[k] = { dateKey: k, val: v, code };
        }
      }
    }
  });

  // A plain (no "-S" suffix) event elsewhere on the row, for the SAME milestone code a fresh plan
  // is about to (re)compute, is a leftover from before this item had full allocation data — e.g. a
  // preliminary FR recorded by an earlier, incomplete chart import. Uploading the allocation chart
  // is what triggers a real, authoritative plan (per the "next working day after upload" rule), so
  // that fresh date supersedes the old one — the old entry gets cleared, not kept alongside it.
  // Confirmed as a real incident: an item's leftover FR from before its allocation chart arrived
  // sat next to the freshly-planned FR at a different date, showing the same milestone twice.
  const staleCodeDateKeys = new Map<string, string[]>();
  Object.entries(row).forEach(([k, v]) => {
    if (!k.match(/^\d{4}-\d{2}-\d{2}$/) || typeof v !== "string" || !v.trim()) return;
    if (v.trim().toUpperCase().endsWith("-S")) return;
    if (parseEventValue(v)?.isPinned) return; // a locked milestone is deliberate, never "stale"
    const code = v.split("|")[0].split("-")[0].toUpperCase();
    if (!staleCodeDateKeys.has(code)) staleCodeDateKeys.set(code, []);
    staleCodeDateKeys.get(code)!.push(k);
  });

  // Same pinned-milestone map as above ({code -> dateKey}), reshaped to calculateAutoSchedule's
  // {dateKey -> {dateKey, val, code}} so its forward walk can re-anchor "current" onto the REAL
  // pinned date at/after each pinned step instead of drifting off its own lead-time-only math.
  const pinnedEventsMap: Record<string, { dateKey: string; val: string; code: string }> = {};
  Object.entries(pinnedDateByCode).forEach(([code, dateKey]) => {
    const val = row[dateKey];
    if (typeof val === "string" && val.trim()) {
      pinnedEventsMap[dateKey] = { dateKey, val, code };
    }
  });

  const triggerBrand = String(row.col3 || row.col7 || "");
  const scheduleMap = calculateAutoSchedule(
    effectiveStartDate,
    matchedFlow,
    eventSuffix,
    triggerBrand,
    failedEventsMap,
    row.col11,
    pinnedEventsMap,
  );

  // If this row is one stage of a multi-plant PLANT FLOW chain (e.g. "LEEMA>BFL>RICHCOLOR"),
  // the FULL sequence's dates are still calculated above (the lead-time math has to account for
  // the whole chain to land later stages on the right date) — but only the events that actually
  // belong to THIS row's plant get written onto it. Null means an ordinary single-plant row:
  // apply the whole flow, exactly as before.
  const chainStageEvents = getEventsForChainStage(matchedFlow, row.col12, row.col11);
  const eventBelongsToThisStage = (val: string): boolean => {
    if (!chainStageEvents) return true;
    const base = val.split("|")[0].split("-")[0].toUpperCase();
    return chainStageEvents.some((ev) => ev.split("-")[0].toUpperCase() === base);
  };

  let updatedRow: Record<string, unknown> = { ...row };

  // Clear old YYYY-MM-DD milestone date keys to prevent lingering stale event pills,
  // BUT ONLY if they are auto-generated (-S) or part of the specific schedule we are about to overwrite.
  // Actually, to prevent shifting dates, we should only delete auto-generated (-S) pills, not manual ones.
  Object.keys(updatedRow).forEach((k) => {
    if (k.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const v = String(updatedRow[k]).toUpperCase();
      // Only remove auto-generated sequence pills (-S suffix) when lacking allocation context
      if (v.endsWith("-S")) {
        updatedRow[k] = "";
      }
    }
  });

  // Any non-"-S" leftover pill (bare code / stale import entry) for a milestone the planner has
  // LOCKED elsewhere is a duplicate — the lock is authoritative, so drop the leftover. Real
  // Pass/Fail verdicts are never touched.
  Object.keys(updatedRow).forEach((k) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || pinnedKeys.has(k)) return;
    const v = updatedRow[k];
    if (typeof v !== "string" || !v.trim()) return;
    const p = parseEventValue(v);
    if (!p || p.status !== "planned") return;
    if (pinnedDateByCode[p.code.toUpperCase()]) updatedRow[k] = "";
  });

  // Apply calculated scheduleMap, preserving pass/fail statuses only when event code matches
  Object.entries(scheduleMap).forEach(([dateKey, val]) => {
    if (!eventBelongsToThisStage(val)) return; // belongs to a different plant's stage in the chain
    const valBase = val.split("|")[0].split("-")[0].toUpperCase();

    // This milestone is locked to a specific day by the planner: keep it exactly where it is and
    // never write the scheduler's own version of it anywhere else.
    const pinnedAt = pinnedDateByCode[valBase];
    if (pinnedAt) {
      updatedRow[pinnedAt] = row[pinnedAt];
      return;
    }

    const preserved = preservedEventsMap[dateKey];

    if (preserved) {
      const preservedBase = preserved.code.split("-")[0].toUpperCase();
      if (codeMatchesSlot(valBase, preservedBase)) {
        updatedRow[dateKey] = preserved.val;
      } else {
        updatedRow[dateKey] = val;
      }
    } else {
      updatedRow[dateKey] = val;
    }

    // The fresh plan just wrote this milestone — clear out any old plain entry for the same code
    // sitting at a different (stale, pre-allocation-chart) date, so it doesn't show up twice.
    //
    // MUST skip any staleKey that's a genuinely preserved pass/fail event (preservedEventsMap).
    // Without this guard, this ran on every scheduleMap entry for the SAME code — including the
    // retry date this loop schedules the working day after a failure — and when it processed that
    // retry entry, it saw the failure's ORIGINAL date holding the same code, decided that was the
    // "stale, different date" leftover, and wiped it. That erased the fail marker on its own date
    // immediately after this same loop had correctly written it moments earlier: confirmed as the
    // cause of a real incident where marking an event Fail correctly scheduled the next-day retry
    // but the fail marker itself vanished from the day it actually happened on.
    const staleDates = staleCodeDateKeys.get(valBase);
    if (staleDates) {
      staleDates.forEach((staleKey) => {
        if (staleKey !== dateKey && !preservedEventsMap[staleKey]) updatedRow[staleKey] = "";
      });
    }

    if (val.startsWith("FR")) {
      if (!updatedRow.col14) updatedRow.col14 = dateKey;
    } else if (val.startsWith("PPS")) {
      if (!updatedRow.col23) updatedRow.col23 = dateKey;
    } else if (val.startsWith("PLSD") || val.startsWith("PLSA")) {
      if (!updatedRow.col28) updatedRow.col28 = dateKey;
    }
  });

  // Ensure mandatory preceding milestones (SEWIN/SEWS, MOC, GMT, CSRF, CPS, FS) are smart-backfilled before FR
  updatedRow = backfillPrecedingMilestones(updatedRow);

  return updatedRow as T;
}

/**
 * Pins one planned milestone to the exact date a planner picked in the grid, then re-derives the
 * rest of the flow around it.
 *
 * Plain autoScheduleEmbellishmentRow always recomputes every planned ("-S") event's date from the
 * flow's lead-time math, so manually dropping e.g. SEWIN/SEWS on Sep 1 just gets snapped back to
 * wherever the sequence says. This instead works out the flow START date that makes the picked
 * event land on the picked date, and schedules from there — so the picked event stays put and
 * everything downstream cascades off it.
 *
 * `anchorCode` is the base event code the panel produced ("SEWIN", "FR", "PPS", ...);
 * `anchorDateStr` is "YYYY-MM-DD". If the code isn't part of the row's detected flow, this falls
 * back to treating the picked date as the plan start.
 */
export function autoScheduleAnchoredToEvent<T extends Record<string, unknown>>(
  row: T,
  anchorCode: string,
  anchorDateStr: string,
): T {
  const flow = detectMatchingFlow(row);
  const targetBase = anchorCode.split("|")[0].split("-")[0].trim().toUpperCase();

  // Match the picked code against a sequence slot, allowing combined slots like "SEWIN/SEWS".
  const seqIndex = flow.sequence.findIndex((slot) =>
    slot.split("/").some((part) => part.split("-")[0].trim().toUpperCase() === targetBase),
  );

  // First event in the flow (or a code this flow doesn't contain): the picked date IS the start.
  if (seqIndex <= 0) {
    return autoScheduleEmbellishmentRow(row, flow.id, anchorDateStr);
  }

  // Sum the lead times from the first event up to the picked one (steps[i] is the transition
  // into sequence[i+1], so steps[0..seqIndex-1] covers the run up to sequence[seqIndex]).
  let cumulativeDays = 0;
  for (let i = 0; i < seqIndex && i < flow.steps.length; i++) {
    cumulativeDays += flow.steps[i].leadTimeDays;
  }

  const toISO = (d: Date) => d.toISOString().split("T")[0];
  const anchorBaseOf = (v: unknown) => String(v).split("|")[0].split("-")[0].toUpperCase();

  let startStr = toISO(subtractWorkingDays(new Date(anchorDateStr), cumulativeDays));
  let scheduled = autoScheduleEmbellishmentRow(row, flow.id, startStr) as Record<string, unknown>;

  // One correction pass: public holidays between the start and the anchor can make the anchor
  // land a day or two off the picked date. Measure the gap and nudge the start to close it.
  const landedKey = Object.keys(scheduled).find(
    (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && typeof scheduled[k] === "string" && anchorBaseOf(scheduled[k]) === targetBase,
  );
  if (landedKey && landedKey !== anchorDateStr) {
    const drift = Math.round((new Date(landedKey).getTime() - new Date(anchorDateStr).getTime()) / 86_400_000);
    if (drift > 0) startStr = toISO(subtractWorkingDays(new Date(startStr), drift));
    else if (drift < 0) startStr = toISO(addWorkingDays(new Date(startStr), -drift));
    scheduled = autoScheduleEmbellishmentRow(row, flow.id, startStr) as Record<string, unknown>;
  }

  return scheduled as T;
}

// Milestone identity of a stored pill: drop the "|P"/"|F|.." verdict tail and only a trailing
// -S/-F/-PASS/-FAIL/-T marker — NOT every hyphen, so "CK-TEST" stays "CK-TEST".
function milestoneBaseOf(v: string): string {
  return v.split("|")[0].trim().toUpperCase().replace(/-(S|F|T|PASS|FAIL)$/i, "");
}

/**
 * Clearing a mid-flow milestone (planner deletes e.g. PPS to move it) should wipe the WHOLE
 * downstream plan too — leave a clean slate from the deleted event onward, so nothing stale is
 * left hanging until the milestone is re-placed on its new date. Everything before the deleted
 * event, and any real Pass/Fail verdict anywhere, is left untouched.
 *
 * Returns the row with `clearedDateKey` and every downstream planned ("-S") pill set to "".
 */
export function clearEventForward<T extends Record<string, unknown>>(
  row: T,
  clearedDateKey: string,
): T {
  const clearedVal = String(row[clearedDateKey] ?? "").trim();
  const out: Record<string, unknown> = { ...row, [clearedDateKey]: "" };
  if (!clearedVal) return out as T;

  const flow = detectMatchingFlow(row);
  const clearedBase = milestoneBaseOf(clearedVal);
  const seqIndex = flow.sequence.findIndex((slot) =>
    slot.split("/").some((p) => p.split("-")[0].trim().toUpperCase() === clearedBase),
  );
  if (seqIndex < 0) return out as T; // not part of the flow — just clear the one cell

  const downstreamSlots = flow.sequence.slice(seqIndex + 1);
  const POST_NY = ["CK-TEST", "DTC-3010", "LTD-92"];
  const isDownstream = (base: string) =>
    POST_NY.includes(base) ||
    downstreamSlots.some((slot) => {
      const s = slot.trim().toUpperCase();
      return s === base || s.split("/").some((p) => p.trim().toUpperCase() === base);
    });

  Object.entries(out).forEach(([k, v]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || typeof v !== "string" || !v.trim()) return;
    if (parseEventValue(v)?.status !== "planned") return; // keep real Pass/Fail verdicts
    if (isDownstream(milestoneBaseOf(v))) out[k] = "";
  });
  return out as T;
}

/**
 * The first milestone in the row's detected flow that has no date yet — used to pre-select the
 * Event Status panel's code when a planner clicks an empty cell, so re-placing a just-deleted
 * milestone is one click (pick the day) instead of hunting the code out of a long list.
 * Returns "" when every milestone already has a date.
 */
export function nextUnscheduledMilestone(row: Record<string, unknown>): string {
  const flow = detectMatchingFlow(row);
  const have = new Set<string>();
  Object.entries(row).forEach(([k, v]) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === "string" && v.trim()) {
      have.add(milestoneBaseOf(v));
    }
  });
  for (const slot of flow.sequence) {
    const parts = slot.split("/").map((p) => p.split("-")[0].trim().toUpperCase());
    if (!parts.some((p) => have.has(p))) return parts[0];
  }
  return "";
}

/**
 * FORWARD-ONLY reschedule from a pinned milestone.
 *
 * Unlike autoScheduleAnchoredToEvent (which back-solves a new plan START so the picked event
 * lands where you clicked, rebuilding the WHOLE flow and shifting everything before it too), this
 * leaves every event at or before the anchor exactly as it was recorded and only re-derives what
 * comes AFTER it, walking the flow's lead times forward from the picked date.
 *
 * Used when a planner deletes a mid-flow event (e.g. PPS) and drops it on a new date: FS/FR that
 * already happened stay put, PPS moves to the picked date, and NY / NYC(→CK-TEST) / MAST / … all
 * cascade forward off it. A downstream event that already carries a real Pass/Fail verdict keeps
 * its own date — only still-"planned" ("-S") pills are moved.
 *
 * Anchor not in the flow, or it IS the first milestone → there's nothing upstream to protect, so
 * this delegates to autoScheduleAnchoredToEvent (identical result for those cases).
 */
export function autoScheduleForwardFromEvent<T extends Record<string, unknown>>(
  row: T,
  anchorCode: string,
  anchorDateStr: string,
): T {
  const flow = detectMatchingFlow(row);
  const targetBase = anchorCode.split("|")[0].split("-")[0].trim().toUpperCase();
  const seqIndex = flow.sequence.findIndex((slot) =>
    slot.split("/").some((part) => part.split("-")[0].trim().toUpperCase() === targetBase),
  );
  if (seqIndex <= 0) return autoScheduleAnchoredToEvent(row, anchorCode, anchorDateStr);

  const toISO = (d: Date) => d.toISOString().split("T")[0];
  // Milestone identity of a stored pill: drop the "|P"/"|F|.." verdict tail and only a trailing
  // -S/-F/-PASS/-FAIL/-T marker — NOT every hyphen, so "CK-TEST" stays "CK-TEST", "REAP/FCHP-S"
  // stays "REAP/FCHP".
  const milestoneBase = (v: string) =>
    v.split("|")[0].trim().toUpperCase().replace(/-(S|F|T|PASS|FAIL)$/i, "");
  const isBabl = isBablPlant(row.col11);
  const brand = String(row.col3 || row.col7 || "").toUpperCase();
  const out: Record<string, unknown> = { ...row };

  // Slots at/after the anchor are the only ones this reschedule touches. Match a pill to a slot
  // by the whole slot OR either half of a combined "REAP/FCHP" / "SEWIN/SEWS" slot. The post-NY
  // testing swap means CK-TEST / DTC-3010 / LTD-92 stand in for the NYC slot.
  const affectedSlots = flow.sequence.slice(seqIndex);
  const POST_NY = ["CK-TEST", "DTC-3010", "LTD-92"];
  const isAffected = (pillBase: string) =>
    POST_NY.includes(pillBase) ||
    affectedSlots.some((slot) => {
      const s = slot.trim().toUpperCase();
      return s === pillBase || s.split("/").some((p) => p.trim().toUpperCase() === pillBase);
    });

  // Remember whatever the panel just set on the anchor date, then wipe the existing planned pills
  // for the anchor and every downstream milestone so they can be rewritten. Real Pass/Fail
  // verdicts and everything before the anchor are left untouched.
  const pinnedVal =
    (typeof out[anchorDateStr] === "string" && String(out[anchorDateStr]).trim()) ||
    (anchorCode.includes("-") || anchorCode.includes("|") ? anchorCode : `${targetBase}-S`);
  Object.entries(out).forEach(([k, v]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || typeof v !== "string" || !v.trim()) return;
    if (parseEventValue(v)?.status !== "planned") return;
    if (parseEventValue(v)?.isPinned) return; // never disturb another locked milestone
    // Downstream of the anchor: rewritten below. Upstream but clearly from an ABANDONED earlier
    // planning cycle (a big gap before the anchor): also clear it, so pinning a mid-flow event on
    // a C+P / resubmission row doesn't leave a stray opener pill stranded weeks in the past.
    const daysBeforeAnchor = (Date.parse(anchorDateStr) - Date.parse(k)) / 86_400_000;
    if (isAffected(milestoneBase(v)) || daysBeforeAnchor > PLAN_CYCLE_GAP_DAYS) out[k] = "";
  });
  out[anchorDateStr] = pinnedVal;

  // Walk forward. flow.steps[i] is the transition sequence[i] -> sequence[i+1], so the hops after
  // the anchor are steps[seqIndex], steps[seqIndex+1], … Each adds its lead time in working days
  // (BABL's long FR / NY turnaround respected, same as calculateAutoSchedule).
  let current = new Date(anchorDateStr);
  for (let i = seqIndex; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    const toSlot = step.toEvent.trim().toUpperCase();
    const toBase = toSlot.replace(/-(S|F|T|PASS|FAIL)$/i, "");
    const lead =
      isBabl && (toBase === "FR" || toBase === "NY")
        ? BABL_LONG_LEAD_DAYS
        : step.leadTimeDays;
    current = addWorkingDays(current, lead);

    // A downstream event that already has a real Pass/Fail verdict stays on the day it happened.
    const hasVerdict = Object.values(out).some(
      (v) => typeof v === "string" && v.trim() &&
        milestoneBase(v) === toBase && parseEventValue(v)?.status !== "planned",
    );
    if (hasVerdict) continue;

    // A downstream milestone the planner LOCKED ("|X", e.g. PPS dragged to a later day) stays on
    // its pinned day and the rest of the walk cascades off that real date. Without this, marking
    // an earlier event (FR) Pass rewrote a fresh "PPS-S" at the lead-time date next to the pinned
    // PPS — two PPS pills, with NY pulled back in front of the pinned one.
    const pinnedKey = Object.keys(out).find((k) => {
      const v = out[k];
      return /^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === "string" && v.trim() &&
        parseEventValue(v)?.isPinned === true && codeMatchesSlot(milestoneBase(v), toBase);
    });
    if (pinnedKey) {
      current = new Date(pinnedKey);
      continue;
    }

    const dateKey = toISO(current);
    if (step.fromEvent === "NY") {
      if (brand.includes("V8") || brand.includes("PINK")) { out[dateKey] = "DTC-3010"; continue; }
    }
    out[dateKey] = toSlot.includes("-") ? step.toEvent : `${toBase}-S`;
  }

  return out as T;
}

/**
 * Resumes a plan that has real historical dates but has gone stale — nothing recorded last
 * month or this month, meaning it looks abandoned or stuck partway through — by projecting
 * whichever of the matched flow's steps haven't happened yet, starting from a given date
 * (normally today). Unlike autoScheduleEmbellishmentRow, this NEVER clears or overwrites
 * anything already on the row: it only adds a date for a step whose event code doesn't already
 * have a real value recorded anywhere in the row's schedule, so a plan that's simply finished
 * (every step already has a value) gets nothing added, and a plan that's mid-flow only gets its
 * remaining steps filled in.
 */
export function continueStalledSchedule<T extends Record<string, unknown>>(
  row: T,
  fromDateStr: string
): T {
  // A "Dropped" item is intentionally dead, not stalled — never resurrect it with fresh dates.
  const statusVal = String((row as Record<string, unknown>).col1 || "").trim().toUpperCase();
  if (statusVal === "D" || statusVal === "DROPPED") {
    return row;
  }

  // Same strict gate as autoScheduleEmbellishmentRow: no Plant + S-Off Requirement, no events.
  if (!hasCompleteAllocationContext(row)) {
    return row;
  }

  const flow = detectMatchingFlow(row);

  const existingCodes = new Set<string>();
  Object.entries(row).forEach(([k, v]) => {
    if (k.match(/^\d{4}-\d{2}-\d{2}$/) && typeof v === "string" && v.trim()) {
      const parsed = parseEventValue(v);
      if (parsed) existingCodes.add(parsed.code.toUpperCase());
    }
  });

  // "Stale" is only supposed to mean "abandoned mid-flow, no recent activity" — NOT "finished a
  // while ago". If the matched flow's very last milestone (PLSA, or RFIT for Fit Functionals)
  // already has a real recorded date anywhere on the row, the whole sequence already completed;
  // fabricating brand-new events starting today for a genuinely finished item was the actual bug
  // reported ("already done once has started planning events from tomorrow"). Bail out untouched.
  const finalStep = flow.sequence[flow.sequence.length - 1];
  const finalStepBase = finalStep.split("-")[0].toUpperCase();
  if (existingCodes.has(finalStepBase)) {
    return row;
  }

  const triggerBrand = String(row.col3 || row.col7 || "");
  const scheduleMap = calculateAutoSchedule(fromDateStr, flow, "S", triggerBrand, undefined, row.col11);

  const updatedRow: Record<string, unknown> = { ...row };
  Object.entries(scheduleMap).forEach(([dateKey, val]) => {
    const code = val.split("|")[0].split("-")[0].toUpperCase();
    if (existingCodes.has(code)) return; // this step already actually happened — don't add a duplicate
    if (!updatedRow[dateKey]) updatedRow[dateKey] = val;
  });

  return updatedRow as T;
}


