// ============================================================
// EVENT CODES & REASON CODES - Central source of truth
// ============================================================

export interface EventCode {
  code: string;
  label: string;
  description: string;
  category: "internal" | "external" | "test" | "approval";
  hasPassFail: boolean; // true if this event can be pass or fail
}

export interface ReasonCode {
  code: string;
  label: string;
  responsible: string;
  notes?: string;
  deprecated?: boolean;
}

// ============================================================
// EVENT CODES (from Excel All Actions Table analysis)
// ============================================================
export const EVENT_CODES: EventCode[] = [
  // Internal / Approval events
  { code: "NY",          label: "NY",          description: "VS s/off direct submission to NY",              category: "internal",  hasPassFail: true  },
  { code: "NYC",         label: "NYC",         description: "Customer comments received",                   category: "internal",  hasPassFail: false },
  // Verdict placed AFTER NYC (comments received): NYC-A = NY approved, NYC-R = NY rejected /
  // re-strike required. The DATE the planner puts it on is the approval date scored against the
  // season's AOQ deadline in Score Card. Not part of any auto-scheduler flow sequence —
  // a planner stamps it manually once the customer verdict lands.
  { code: "NYC-A",       label: "NYC-A",       description: "NY approved (verdict after NYC comments)",     category: "approval",  hasPassFail: false },
  { code: "NYC-R",       label: "NYC-R",       description: "NY rejected — re-strike required (after NYC)", category: "approval",  hasPassFail: false },
  { code: "MAST",        label: "MAST",        description: "Dispatching to regional teams (MISA)",         category: "internal",  hasPassFail: true  },
  { code: "REAP",        label: "REAP",        description: "Regional approval",                            category: "internal",  hasPassFail: true  },
  { code: "FCHP",        label: "FCHP",        description: "Final checkpoint / shopping",                  category: "internal",  hasPassFail: true  },
  { code: "REAP/FCHP",   label: "REAP/FCHP",  description: "Regional approval + final checkpoint",         category: "internal",  hasPassFail: true  },
  { code: "RFIT",        label: "RFIT",        description: "Fit on to a model",                            category: "internal",  hasPassFail: true  },
  { code: "AWR",         label: "AWR",         description: "Art work receive approval",                    category: "approval",  hasPassFail: true  },
  { code: "ADP",         label: "ADP",         description: "ADP event",                                    category: "approval",  hasPassFail: true  },
  { code: "NYC/DRP",     label: "NYC/DRP",     description: "NYC with drop",                                category: "internal",  hasPassFail: false },
  { code: "PLSD",        label: "PLSD",        description: "Placement sample dispatch",                   category: "approval",  hasPassFail: true  },
  { code: "PLSA",        label: "PLSA",        description: "Placement sample approval",                   category: "approval",  hasPassFail: true  },

  // Milestone / Sewing & Panel Request Events
  { code: "CSRF",        label: "CSRF",        description: "Cut SRF IN (Cut panel sample request)",        category: "external",  hasPassFail: true  },
  { code: "CPS",         label: "CPS",         description: "Cut panel sending to plants",                  category: "approval",  hasPassFail: true  },
  { code: "SEWIN",       label: "SEWIN",       description: "MOCK/GMT Sew IN (Garment sew request)",        category: "external",  hasPassFail: true  },
  { code: "SEWS",        label: "SEWS",        description: "Sewing start date",                            category: "external",  hasPassFail: true  },
  { code: "MOC",         label: "MOC",         description: "Mock-up sample ready",                         category: "external",  hasPassFail: true  },
  { code: "GMT",         label: "GMT",         description: "Garment sending (pillowcase)",                 category: "external",  hasPassFail: true  },

  // External / Plant events
  { code: "FS",          label: "FS",          description: "First sample",                                 category: "external",  hasPassFail: true  },
  { code: "FR",          label: "FR",          description: "Fabric / panel received at plant",             category: "external",  hasPassFail: true  },
  { code: "PPS",         label: "PPS",         description: "Print panel / strike-off sending to branch",   category: "external",  hasPassFail: true  },
  { code: "PPSDS",       label: "PPSDS",       description: "Print panel send to dye/wash plants (BFL/MARTEX)", category: "external", hasPassFail: true  },
  { code: "RDPS",        label: "RDPS",        description: "Return dye / wash panels to supplier",         category: "external",  hasPassFail: true  },
  { code: "PPSES",       label: "PPSES",       description: "Print panel sending to emb plant",             category: "external",  hasPassFail: true  },
  { code: "DPSP",        label: "DPSP",        description: "Dye panel send to print",                      category: "external",  hasPassFail: true  },
  { code: "DPSE",        label: "DPSE",        description: "Dye panel send to embroidery",                 category: "external",  hasPassFail: true  },
  { code: "EPSP",        label: "EPSP",        description: "Embroidery panel send to print",               category: "external",  hasPassFail: true  },
  { code: "EPRE",        label: "EPRE",        description: "Embroidery panel received from emb plant",      category: "external",  hasPassFail: true  },

  // Test events
  { code: "DTC-3010",    label: "DTC-3010",    description: "DTC-3010 test ready date",                     category: "test",      hasPassFail: true  },
  { code: "LTD-92",      label: "LTD-92",      description: "LTD-92 test ready date",                       category: "test",      hasPassFail: true  },
  { code: "LTD-37",      label: "LTD-37",      description: "LTD-37 test ready date",                       category: "test",      hasPassFail: true  },
  { code: "CK-TEST",     label: "CK-TEST",     description: "CK check test ready date",                     category: "test",      hasPassFail: true  },
  { code: "BIA",         label: "BIA",         description: "BIA event",                                    category: "test",      hasPassFail: true  },
  { code: "PPR",         label: "PPR",         description: "PPR event",                                    category: "test",      hasPassFail: true  },
];

// All event codes as flat array of strings (base codes only)
export const ALL_EVENT_CODES: string[] = EVENT_CODES.map(e => e.code);

// ============================================================
// PARSE EVENT CELL VALUE
// Format: "NY" = planned, "NY|P" = pass, "NY|F|11" = fail with reason
// Legacy: "NY-S" or "PPS-S" = pass, "FS-F" = fail (from Excel import)
// ============================================================
export interface ParsedEvent {
  code: string;         // base event code e.g. "NY"
  status: "planned" | "pass" | "fail";
  reasonCode?: string;  // only if fail, e.g. "11"
  reasonLabel?: string; // full reason label
  responsible?: string;
  // True for the legacy "-S" suffix (real text, or inferred from a solid cell fill color at
  // import time when the source had no text marker at all — see page.tsx's isCellColored).
  // "-S" means "Sign-off / submitted" — the event actually happened, even though it's NOT a
  // QC "pass" and still renders as an ordinary neutral "planned" event. Consumers that need to
  // know "is this event still genuinely pending" (e.g. Overdue detection) should check this
  // instead of/alongside status, since status alone treats it the same as never-happened.
  isSubmitted?: boolean;
  // True for the "|X" tail — a planner deliberately placed this milestone on this exact date
  // via the Event Status panel. It is LOCKED: the auto-scheduler and the load-time heal effects
  // must never move it to another date or delete it, and a replan anchors to it rather than to
  // a leftover "-S" pill from an earlier planning cycle. Still renders as an ordinary planned
  // event (with a small lock/pin hint). A real Pass/Fail verdict later on naturally supersedes it.
  isPinned?: boolean;
}

export function parseEventValue(raw: string): ParsedEvent | null {
  if (!raw || !raw.trim()) return null;
  const val = raw.trim();

  // New format: "CODE|P" or "CODE|F|reasonCode"
  if (val.includes("|")) {
    const parts = val.split("|");
    const code = parts[0].toUpperCase();
    const statusChar = parts[1]?.toUpperCase();
    if (statusChar === "P") {
      return { code, status: "pass" };
    } else if (statusChar === "F") {
      const reasonCode = parts[2] || "";
      const reason = REASON_CODES.find(r => r.code === reasonCode);
      return {
        code,
        status: "fail",
        reasonCode,
        reasonLabel: reason?.label,
        responsible: reason?.responsible,
      };
    } else if (statusChar === "X") {
      // "<CODE>|X" — planner-locked planned milestone (see ParsedEvent.isPinned).
      return { code, status: "planned", isPinned: true };
    }
    return { code, status: "planned" };
  }

  const upper = val.toUpperCase();
  if (upper.endsWith("-PASS") || upper.endsWith(" PASS")) {
    return { code: val, status: "pass" };
  }
  if (upper.endsWith("-FAIL") || upper.endsWith(" FAIL")) {
    return { code: val, status: "fail" };
  }

  // Legacy Excel suffix format: "<CODE>-F" = fail (e.g. "PPS-F"). "<CODE>-S" ("FS-S", "MAST-S", ...)
  // is NOT a pass marker — it's just the routine "as-scheduled/submitted" tag stamped on nearly
  // every normal event (~50k occurrences vs. ~2.5k "-F" in a real sample file), so it renders as
  // an ordinary planned event, same as a bare code with no suffix at all. Only "-F" is a real signal.
  const legacyFailMatch = val.match(/^(.+)-F$/i);
  if (legacyFailMatch && legacyFailMatch[1].trim()) {
    return { code: legacyFailMatch[1].trim().toUpperCase(), status: "fail" };
  }
  const legacyScheduledMatch = val.match(/^(.+)-S$/i);
  if (legacyScheduledMatch && legacyScheduledMatch[1].trim()) {
    return { code: legacyScheduledMatch[1].trim().toUpperCase(), status: "planned", isSubmitted: true };
  }

  // Plain code (e.g. FS, FR, NYC) = planned
  return { code: val.toUpperCase(), status: "planned" };
}

// Encode event back to storage string
export function encodeEventValue(
  code: string,
  status: "planned" | "pass" | "fail",
  reasonCode?: string,
  pinned?: boolean,
): string {
  if (status === "pass") return `${code}|P`;
  if (status === "fail") return `${code}|F|${reasonCode || ""}`;
  if (pinned) return `${code}|X`; // planner-locked planned milestone
  return code; // planned = just the code
}

// ============================================================
// REASON CODES (01–60) from the Excel Validation table
// ============================================================
export const REASON_CODES: ReasonCode[] = [
  { code: "01", label: "01: Sample capacity",                        responsible: "Embellishment plant" },
  { code: "02", label: "02: Technical issue",                        responsible: "Embellishment plant" },
  { code: "03", label: "03: Testing failure",                        responsible: "Embellishment plant" },
  { code: "04", label: "04: Emb RM IH delay",                       responsible: "Embellishment plant" },
  { code: "05", label: "05: Emb plant quality-RFT",                  responsible: "Embellishment plant", notes: "Color/Technique quality issues, AW size issues, fabric color shadings, customer rejections" },
  { code: "06", label: "06: Placement board delay",                  responsible: "Sample/Technical" },
  { code: "07", label: "07: Cutting/Stores delay",                   responsible: "Sample/Technical" },
  { code: "08", label: "08: Pattern finalization delay",             responsible: "Sample/Technical" },
  { code: "09", label: "09: Sewing delay",                           responsible: "Sample/Technical" },
  { code: "10", label: "10: Fabric/Cut sending delay",               responsible: "Embellishment Merchant" },
  { code: "11", label: "11: BFF RM IH delay-Fabric",                 responsible: "Fabric Merchant" },
  { code: "12", label: "12: MAST approval review capacity",          responsible: "MISA",             deprecated: true, notes: "No more use" },
  { code: "13", label: "13: S/off direct to NY",                     responsible: "MISA",             deprecated: true, notes: "No more use" },
  { code: "14", label: "14: Comments delay",                         responsible: "DD" },
  { code: "15", label: "15: AW/Customer changes",                    responsible: "DD" },
  { code: "16", label: "16: DI/RT Approval delay",                   responsible: "Sample/Technical" },
  { code: "17", label: "17: Plant changed",                          responsible: "DD" },
  { code: "18", label: "18: Placement/Process changed",              responsible: "MISA" },
  { code: "19", label: "19: Dye color not approved on time",         responsible: "Wash plant", notes: "11th Week" },
  { code: "20", label: "20: S/off/Print panel sending delay",        responsible: "Embellishment Merchant" },
  { code: "21", label: "21: BFF RM IH delay-Trims",                  responsible: "PD Merchant" },
  { code: "22", label: "22: MAST Approval delay",                    responsible: "MISA" },
  { code: "23", label: "23: Not received a buy",                     responsible: "DD" },
  { code: "24", label: "24: Customer request",                       responsible: "DD" },
  { code: "25", label: "25: Placement board not approved",           responsible: "Sample/Technical" },
  { code: "26", label: "26: Tech pack delay",                        responsible: "Sample/Technical" },
  { code: "27", label: "27: Pattern maker delay",                    responsible: "Sample/Technical" },
  { code: "28", label: "28: Merchant delay (7) - Communication",     responsible: "Embellishment Merchant", notes: "Communication delay" },
  { code: "28b", label: "28: Merchant delay (8) - Event incomplete", responsible: "Embellishment Merchant", notes: "Event unable to complete as planned" },
  { code: "29", label: "29: Placement board incorrect",              responsible: "Sample/Technical" },
  { code: "30", label: "30: Plant delay",                            responsible: "Embellishment plant",    deprecated: true, notes: "No more use" },
  { code: "31", label: "31: Resubmission",                           responsible: "Embellishment plant",    notes: "Only for LTD test" },
  { code: "32", label: "32: Color standard not available",           responsible: "Fabric Merchant" },
  { code: "33", label: "33: Dye color development/approval pending", responsible: "Fabric Merchant" },
  { code: "34", label: "34: Capability issue",                       responsible: "Embellishment plant" },
  { code: "35", label: "35: Ownership change",                       responsible: "Embellishment Merchant" },
  { code: "36", label: "36: Technical issue BFF",                    responsible: "Sample/Technical" },
  { code: "37", label: "37: PD Merchant delay",                      responsible: "PD Merchant" },
  { code: "38", label: "38: Print plant Lab capacity issue",         responsible: "Embellishment plant" },
  { code: "39", label: "39: Fabric quality issue",                   responsible: "Fabric Merchant" },
  { code: "40", label: "40: Print panels not receive",               responsible: "Embellishment plant" },
  { code: "41", label: "41: Embellishment Plant Merchant delay",     responsible: "Embellishment plant" },
  { code: "42", label: "42: Print process changed",                  responsible: "Embellishment Merchant" },
  { code: "43", label: "43: Emb plant quality",                      responsible: "Embellishment plant",    notes: "Placements/final approvals/trials failed due to quality/internal rejections/testing failures" },
  { code: "44", label: "44: Transport issue",                        responsible: "Admin" },
  { code: "45", label: "45: Incorrect report details",               responsible: "Embellishment plant" },
  { code: "46", label: "46: Merchant delay (9) - Dispatch issue",    responsible: "Embellishment Merchant", notes: "Issue with dispatched package" },
  { code: "47", label: "47: Incorrect update",                       responsible: "Embellishment plant" },
  { code: "48", label: "48: Sewing quality issue",                   responsible: "Sample/Technical" },
  { code: "49", label: "49: Browserware team delay",                 responsible: "Sample/Technical" },
  { code: "50", label: "50: E-Pattern Delay",                        responsible: "Sample/Technical" },
  { code: "51", label: "51: QC Delay",                               responsible: "Sample/Technical" },
  { code: "52", label: "52: Merchant delay (10) - Reference delay",  responsible: "Embellishment Merchant", notes: "Reference Delay" },
  { code: "52b", label: "52: Wrong fabric sent",                     responsible: "Stores" },
  { code: "53", label: "53: No fabric",                              responsible: "Stores", notes: "No fabric available at the plant to run the sample" },
  { code: "54", label: "54: Execution delay",                        responsible: "Execution Coordinator" },
  { code: "55", label: "55: Trial review delay",                     responsible: "Embellishment Technical Team", notes: "Development trails/Shad bands" },
  { code: "56", label: "56: Color standard unavailability",          responsible: "Embellishment plant" },
  { code: "57", label: "57: Fabric has not sent",                    responsible: "Stores" },
  { code: "58", label: "58: Merchant delay (11) - Fabric ordering",  responsible: "Embellishment Merchant", notes: "Fabric Ordering Delay" },
  { code: "59", label: "59: Merchant delay (12) - Layout comment",   responsible: "Embellishment Merchant", notes: "Layout comment delay" },
  { code: "60", label: "60: Wash/DYE plant delay",                   responsible: "Wash plant" },
];

// Map reason code to its data
export function getReasonByCode(code: string): ReasonCode | undefined {
  return REASON_CODES.find(r => r.code === code);
}

// Get all active (non-deprecated) reason codes
export function getActiveReasonCodes(): ReasonCode[] {
  return REASON_CODES.filter(r => !r.deprecated);
}

// Recommended failure reasons per event family, in the order they should be offered.
// First group whose `events` list contains the (dash/pipe-stripped) event code wins.
// Also seeded into `event_codes.recommended_reason_codes` in Supabase by server/seed_codes.js,
// so the Google Sheet dropdowns can offer the same shortlist — keep this the single source.
export const EVENT_REASON_PRIORITY: { events: string[]; reasonCodes: string[] }[] = [
  { events: ["PPSDS", "RDPS", "DPSP", "DPSE"], reasonCodes: ["19", "33", "60", "11", "39", "57", "05", "10", "44"] },
  { events: ["DTC", "DTC-3010", "LTD", "LTD-92", "LTD-37", "CK", "CK-TEST", "BIA", "PPR"], reasonCodes: ["03", "31", "43", "02", "34", "45", "47"] },
  { events: ["FS", "FR", "PPS", "PPSES", "EPSP", "EPRE", "MOC", "GMT"], reasonCodes: ["05", "01", "02", "04", "10", "40", "43", "52b", "53", "57"] },
  { events: ["CSRF", "CPS", "SEWIN", "SEWS"], reasonCodes: ["06", "07", "08", "09", "10", "25", "29", "48", "50"] },
  { events: ["NY", "NYC", "MAST", "REAP", "FCHP", "AWR", "ADP", "PLSD", "PLSA"], reasonCodes: ["14", "15", "16", "18", "20", "22", "24", "28", "28b", "35", "58", "59"] },
];

// Get grouped reasons (Recommended vs Other) based on the event code
export function getGroupedReasonsForEvent(eventCode: string): { recommended: ReasonCode[]; other: ReasonCode[] } {
  const code = (eventCode || "").toUpperCase().split("-")[0].split("|")[0];
  const allActive = getActiveReasonCodes();

  const priorityCodes = EVENT_REASON_PRIORITY.find((g) => g.events.includes(code))?.reasonCodes ?? [];

  if (priorityCodes.length === 0) {
    return { recommended: [], other: allActive };
  }

  const recommended = allActive.filter((r: ReasonCode) => priorityCodes.includes(r.code));
  const other = allActive.filter((r: ReasonCode) => !priorityCodes.includes(r.code));

  return { recommended, other };
}

// Responsible party groups for filtering
export const RESPONSIBLE_PARTIES = [
  "Embellishment plant",
  "Embellishment Merchant",
  "Fabric Merchant",
  "Sample/Technical",
  "DD",
  "MISA",
  "PD Merchant",
  "Wash plant",
  "Stores",
  "Admin",
  "Execution Coordinator",
  "Embellishment Technical Team",
];

// Check if a responsible party means the plant itself is at fault
export function isPlantFault(responsible: string): boolean {
  return responsible === "Embellishment plant";
}
