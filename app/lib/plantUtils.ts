// ============================================================
// Central Plant Normalization & Parsing Utilities
// ============================================================

import { parseEventValue } from "./eventCodes";

const CANONICAL_PLANTS: Record<string, string> = {
  // Antler
  "ANT": "ANTLER",
  "ANTLER": "ANTLER",
  "ANTELR": "ANTLER", // recurring transposed-letter typo in the source charts
  "ANTLER MRC": "ANTLER",

  // AV — AV1 / AV2 / BFFAV / BRANDIXEMB are all the same embellishment plant.
  // (AV1 / AV2 lose their digit in normalizeSinglePlant and land on "AV" already.)
  "AV": "AV",
  "AV1": "AV",
  "AV2": "AV",
  "BFFAV": "AV",
  "BFFAW": "AV",
  "BFF AV": "AV",
  "BFF AW": "AV",
  "BRANDIXEMB": "AV",
  "BRANDIX EMB": "AV",
  "BRANDIX EMBELLISHMENT": "AV",
  "BRANDIX EMBELLISHMENTS": "AV",
  "BRANDIXEMBELLISHMENT": "AV",
  "BRANDIXEMBELLISHMENTS": "AV",

  // BABL
  "BABL": "BABL",

  // BFL
  "BFL": "BFL",

  // Brandix
  "BRANDIX": "BRANDIX",
  "BRANDIX APPAREL": "BRANDIX",
  "BRANDIX - SLEEP": "BRANDIX",
  "BRANDIX - SPORT": "BRANDIX",
  "BRANDIX SPORT": "BRANDIX",
  "BRANDIX SLEEP": "BRANDIX",

  // Expo
  "EXPO": "EXPO",

  // Fusion
  "FUSION": "FUSION",
  "FUSHION": "FUSION",

  // Hi Emb — CKT and every H-EMB / HI-EMB / "H Embellishments" spelling are the same plant
  "HI": "HI EMB",
  "HI EMB": "HI EMB",
  "H-EMB": "HI EMB",
  "H EMB": "HI EMB",
  "HI-EMB": "HI EMB",
  "HIEMB": "HI EMB",
  "HI EMBROIDERY": "HI EMB",
  "HI EMBROIDERY PLANT": "HI EMB",
  "HI EMBROIDERY-PLANT": "HI EMB",
  "H EMBELLISHMENT": "HI EMB",
  "H EMBELLISHMENTS": "HI EMB",
  "HEMBELLISHMENT": "HI EMB",
  "HEMBELLISHMENTS": "HI EMB",
  "HI EMBELLISHMENT": "HI EMB",
  "HI EMBELLISHMENTS": "HI EMB",
  "CKT": "HI EMB",

  // Leema
  "LEEMA": "LEEMA",

  // Martex
  "MARTEX": "MARTEX",
  "BACK-MARTEX": "MARTEX",
  "BACK MARTEX": "MARTEX",

  // MRC
  "MRC": "MRC",

  // Regal
  "REGAL": "REGAL IMAGE",
  "REGAL IMAGE": "REGAL IMAGE",
  "REGAL IMAGES": "REGAL IMAGE",
  "REEGAL": "REGAL IMAGE",
  "REEGAL IMAGE": "REGAL IMAGE",
  "INNER HOOD-REGAL": "REGAL IMAGE",
  "INNER HOOD REGAL": "REGAL IMAGE",
  "IMAGE": "REGAL IMAGE", // bare "Image" is always a fragment of "Regal Image" in this data

  // Rich Color
  "RC": "RICH COLOR",
  "RICH COLOR": "RICH COLOR",
  "RICH COLOUR": "RICH COLOR",
  "RICHCOLOR": "RICH COLOR",
  "RICHCOLOUR": "RICH COLOR",

  // Screen Line
  "SCREEN LINE": "SCREEN LINE",
  "SCREENLINE": "SCREEN LINE",
  "SCREEN-LINE": "SCREEN LINE",
  "SCREN LINE": "SCREEN LINE",
  "SCRENLINE": "SCREEN LINE",
  "SCREN": "SCREEN LINE",
  "SL": "SCREEN LINE",

  // Tharindu Print / Printers
  "THARINDU PRINT": "THARINDU PRINT",
  "THARINDU PRINTERS": "THARINDU PRINT",
  "THRINDU PRINTERS": "THARINDU PRINT",
  "THRINDU PRINT": "THARINDU PRINT",
};

// Runtime, user-managed plant aliases/exclusions — set once from Supabase on app load (see
// applyPlantAliasConfig, called from page.tsx) so a planner can merge two plant spellings or
// hide a bogus one from the Score Card / Plant Manager UI without a code change or
// rewriting the raw col11/col12 text on every row. Layered ON TOP of the hardcoded
// CANONICAL_PLANTS table above (checked first, so a user alias always wins).
let RUNTIME_PLANT_ALIASES: Record<string, string> = {};
let RUNTIME_EXCLUDED_PLANTS: Set<string> = new Set();

export function applyPlantAliasConfig(config: { aliases?: Record<string, string>; excluded?: string[] }): void {
  const aliases: Record<string, string> = {};
  Object.entries(config.aliases || {}).forEach(([k, v]) => {
    if (k && v) aliases[k.trim().toUpperCase()] = v.trim().toUpperCase();
  });
  RUNTIME_PLANT_ALIASES = aliases;
  RUNTIME_EXCLUDED_PLANTS = new Set((config.excluded || []).map((p) => p.trim().toUpperCase()));
}

export function getPlantAliasRuntimeConfig(): { aliases: Record<string, string>; excluded: string[] } {
  return { aliases: { ...RUNTIME_PLANT_ALIASES }, excluded: Array.from(RUNTIME_EXCLUDED_PLANTS) };
}

/**
 * Normalizes an individual raw plant string into its clean canonical name.
 */
export function normalizeSinglePlant(rawName: string): string {
  if (!rawName) return "";
  let clean = rawName
    .replace(/\(.*?\)/g, "") // remove parenthetical comments e.g. (WA01152) or (Cross...)
    .replace(/[^A-Za-z\s-]/g, "") // remove numbers/special chars e.g. BFL01055 -> BFL
    .trim()
    .toUpperCase();

  clean = clean.replace(/\s+/g, " "); // collapse extra spaces

  if (
    !clean ||
    clean.length <= 1 ||
    clean === "N/A" ||
    clean === "TBD" ||
    clean === "NONE"
  ) {
    return "";
  }

  const mapped = CANONICAL_PLANTS[clean];
  let canonical = mapped || clean;

  // Fuzzy catch-all for the messier embellishment-plant spellings that the exact list above
  // can't fully enumerate. "Brandix Embellishment(s)" of any wording -> AV; any "H / HI
  // Embellishment(s)" wording -> HI EMB.
  if (!mapped) {
    if (/BRANDIX/.test(clean) && /\bEMB/.test(clean)) canonical = "AV";
    else if (/^H(?:I)?\s*[- ]?\s*EMB/.test(clean)) canonical = "HI EMB";
  }

  // A user-defined alias (Plant Manager merge) applies on top of the built-in mapping — chase
  // it once more in case the merge target is itself aliased.
  const userMapped = RUNTIME_PLANT_ALIASES[canonical];
  if (userMapped) canonical = userMapped;

  return canonical;
}

// Every distinct canonical plant name, longest first, as a whitespace-flexible regex — used to
// pull the real plants out of a cell that lists several with NO delimiter, e.g.
// "ANTLER REGAL RICH COLOR" or "MRC H EMB" or "EXPO SCREENLINE REGAL". Built once.
const KNOWN_PLANT_MATCHERS: { re: RegExp; canonical: string }[] = Array.from(
  new Set([...Object.keys(CANONICAL_PLANTS), ...Object.values(CANONICAL_PLANTS)]),
)
  .sort((a, b) => b.length - a.length)
  .map((name) => ({
    re: new RegExp(
      "(?:^|\\s)" +
        name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]+/g, "[\\s-]*") +
        "(?:\\s|$)",
    ),
    canonical: CANONICAL_PLANTS[name] || name,
  }));

// Greedily peel every known plant name out of ONE token, returning what matched and whatever
// text was left over (an unrecognised plant, or noise).
function extractKnownPlantsFromToken(token: string): { found: string[]; leftover: string } {
  let s = " " + token.toUpperCase().replace(/[^A-Z\s-]/g, " ").replace(/\s+/g, " ").trim() + " ";
  const found: string[] = [];
  let progressed = true;
  while (progressed && s.trim()) {
    progressed = false;
    for (const { re, canonical } of KNOWN_PLANT_MATCHERS) {
      if (re.test(s)) {
        found.push(canonical);
        s = " " + s.replace(re, " ").replace(/\s+/g, " ").trim() + " ";
        progressed = true;
        break;
      }
    }
  }
  return { found: Array.from(new Set(found)), leftover: s.trim() };
}

// Leftover text after peeling known plants: keep it as its own plant only if it plausibly IS
// one (a word of 3+ letters, not a connector like AND / & / WITH).
const LEFTOVER_STOPWORDS = new Set(["AND", "OR", "WITH", "TO", "VIA", "THEN", "PLUS"]);
function leftoverIsPlant(leftover: string): boolean {
  const w = leftover.replace(/[^A-Z\s]/gi, "").trim().toUpperCase();
  return w.length >= 3 && !LEFTOVER_STOPWORDS.has(w);
}

// Names that show up in the PLANT / PLANT FLOW columns but are NOT tracked plants:
//  - BFL / MARTEX / DYNAWASH are external dye/wash pass-through VENDORS (they drive the
//    PPSDS->RDPS flow but never get their own planning row — see detectMatchingFlow /
//    getEventsForChainStage), so they must not appear as plants in Score Card /
//    Plant Schedules.
//  - short junk codes ("AD") the planner has confirmed aren't plants.
const NON_TRACKED_PLANTS = new Set(["BFL", "MARTEX", "DYNAWASH", "AD"]);

// A resolved plant name only counts as a real trackable plant when it isn't a known
// non-plant and isn't an unrecognised 1-2 char code.
function isTrackablePlant(canonical: string): boolean {
  if (!canonical) return false;
  if (NON_TRACKED_PLANTS.has(canonical)) return false;
  if (RUNTIME_EXCLUDED_PLANTS.has(canonical)) return false;
  if (canonical.length <= 2 && !CANONICAL_PLANTS[canonical]) return false;
  return true;
}

/**
 * Extracts all unique canonical plant names from a raw cell string (col11 or col12).
 * Splits multi-plant flow strings on '>>', '>', '+', '/', ',', newlines — AND on a token that
 * simply lists several known plants separated by spaces ("ANTLER REGAL RICH COLOR").
 */
export function extractPlants(cellValue?: string | null): string[] {
  if (!cellValue || !cellValue.trim()) return [];

  // Remove comments in parentheses
  const clean = cellValue.replace(/\(.*?\)/g, " ");

  // Split on multi-plant flow / list operators: >>, >, +, /, comma, \n
  const tokens = clean.split(/>>|>|\+|\/|,|\n/);

  const plantSet = new Set<string>();
  // extractKnownPlantsFromToken below returns names straight from KNOWN_PLANT_MATCHERS
  // (built once from CANONICAL_PLANTS), bypassing normalizeSinglePlant entirely — so a runtime
  // Plant Manager merge (RUNTIME_PLANT_ALIASES) has to be re-applied here too, or it would only
  // ever take effect on the "nothing known matched" fallback path below.
  const add = (name: string) => {
    const resolved = RUNTIME_PLANT_ALIASES[name] || name;
    if (isTrackablePlant(resolved)) plantSet.add(resolved);
  };
  tokens.forEach((tok) => {
    if (!tok || !tok.trim()) return;

    // Peel known plant names out first — this is what splits "ANTLER REGAL RICH COLOR" or
    // "MRC H EMB" into their real plants instead of one bogus leaderboard entry.
    const { found, leftover } = extractKnownPlantsFromToken(tok);
    found.forEach(add);

    if (found.length > 0) {
      // Anything the matcher couldn't identify but that still looks like a plant name.
      if (leftover && leftoverIsPlant(leftover)) {
        const c = normalizeSinglePlant(leftover);
        if (c) add(c);
      }
      return;
    }

    // Nothing known matched — treat the whole token as one plant (covers brand-new plants and
    // the fuzzy BRANDIX-EMB / HI-EMB rules in normalizeSinglePlant).
    const canonical = normalizeSinglePlant(tok);
    if (canonical) add(canonical);
  });

  return Array.from(plantSet);
}

export interface CrossDevGroup {
  name: string;
  isCrossDev: boolean;
}

/**
 * Parses a raw Plant (col11) string into its constituent locations, honoring the cross-development
 * convention: "/" separates distinct CROSS-DEVELOPMENT locations — parallel, simultaneous production
 * at each one, e.g. "Antler+Leema/RC+MRC" means two places: "Antler+Leema" and "RC+MRC". ">>"/">"
 * instead separate distinct SEQUENTIAL stages (fabric moves from one to the next, not in parallel),
 * so those groups aren't flagged cross-dev. "+" WITHIN one segment combines plant names into a
 * single location — "Antler+Leema" is one place where they work together, not two separate plants.
 * Shared by FabricDispatchView (grouping/export), Table (Split-row rendering), and the auto-
 * scheduler (per-plant date keys for cross-dev rows) so all three treat the notation identically.
 */
export function parseCrossDevGroups(raw?: string | null): CrossDevGroup[] {
  const s = (raw || "").trim();
  if (!s) return [];
  const crossDevGroups = s.split("/").map((g) => g.trim()).filter(Boolean);
  const isCrossDev = crossDevGroups.length > 1;
  const result: CrossDevGroup[] = [];
  crossDevGroups.forEach((group) => {
    const stages = group.split(/>>|>/).map((x) => x.trim()).filter(Boolean);
    stages.forEach((stageName) => {
      result.push({ name: stageName, isCrossDev });
    });
  });
  return result;
}

/**
 * Fallback: recover the Plant (col11) from the Plant Flow (col12) chain when col11 is blank.
 * The Plant Flow spells out the same locations plus the wash/dye vendor and its sequence, e.g.
 * "BFL WA01055>>REGAL" or "REGAL IMAGE/MRC>>BFL WA01055>>REGAL IMAGE/MRC". Split on ">>"/">", drop
 * any segment that is (or contains) a wash/dye vendor (BFL / MARTEX / DYNAWASH / a "WASH" step),
 * and return the first real segment VERBATIM — its "/" cross-dev structure preserved. Returns ""
 * when the chain is nothing but wash/dye steps.
 */
export function plantFromFlow(plantFlowRaw?: string | null): string {
  const raw = String(plantFlowRaw || "").trim();
  if (!raw) return "";
  const isWashDye = (seg: string) => {
    const u = seg.toUpperCase();
    return u.includes("BFL") || u.includes("MARTEX") || u.includes("DYNAWASH") || /\bWASH\b/i.test(seg);
  };
  const segments = raw
    .split(/>>|->|=>|>/)
    .map((s) => s.trim())
    .filter(Boolean);
  const real = segments.find((s) => !isWashDye(s));
  return real || "";
}

/**
 * Slices a shared PLANT FLOW (col12) down to a single "/"-split leg's own chain, for when that leg
 * is replanned on its own (a per-plant Set Start Date, an Event Status Panel edit on one leg's
 * "<date>_<leg>" cell, or a newly-added leg from import) — e.g. "REGAL IMAGE/HI EMB/LEEMA>>BFL
 * WA01055>>REGAL IMAGE/HI EMB/LEEMA" sliced for "HI EMB" becomes "HI EMB>>BFL WA01055>>HI EMB".
 * Each ">>"/"->"/"=>"/">"-separated stage that lists several "/"-parallel plants is narrowed to
 * just this leg's own branch; a stage with no "/" (a dye/wash vendor like "BFL WA01055", or a
 * single plant) is kept verbatim. Without this, callers used to blank col12 out entirely for a
 * solo-leg replan, which also erased the dye-vendor name detectMatchingFlow's isDyeWashPlant looks
 * for — silently downgrading that leg from the PPSDS->RDPS dye flow to the plain 1-plant flow.
 * Confirmed against real data: GVU27-205 / 10356691, REGAL added as a new leg onto an existing
 * "HI EMB/LEEMA >> BFL WA01055 >> HI EMB/LEEMA" row lost its dye planning entirely.
 */
export function legPlantFlow(plantFlowRaw: unknown, legPlant: string): string {
  const raw = String(plantFlowRaw || "").trim();
  const leg = String(legPlant || "").trim();
  if (!raw || !leg) return "";
  const legUpper = leg.toUpperCase();
  const stages = raw
    .split(/>>|->|=>|>/)
    .map((s) => s.trim())
    .filter(Boolean);
  const mineStages = stages.map((stage) => {
    if (!stage.includes("/")) return stage;
    const branches = stage.split("/").map((b) => b.trim()).filter(Boolean);
    const mine = branches.find((b) => {
      const u = b.toUpperCase();
      return u === legUpper || u.includes(legUpper) || legUpper.includes(u);
    });
    return mine || stage;
  });
  return mineStages.join(">>");
}

/**
 * A cross-dev leg can itself be a "+"-combined location ("Antler+Leema") — one shared production
 * event that BOTH plants work at together. Return each individual canonical plant so both get
 * their own row; callers keep every one pointed at the same "<date>_<leg>" schedule key, so a
 * Pass/Fail from either plant confirms the one event. Falls back to the cleaned leg string if
 * nothing canonicalizes. Mirror of splitLegPlants_ in integrations/google-sheet/Code.gs.
 */
export function splitLegPlants(legName: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  String(legName)
    .split("+")
    .forEach((s) => {
      const p = normalizeSinglePlant(s);
      if (p && !seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    });
  if (out.length) return out;
  const fallback = String(legName).replace(/[()]/g, "").trim().toUpperCase();
  return [fallback || "Unassigned"];
}

/**
 * The parallel cross-development legs of a row (top-level "/" split in col11), or [] when the row
 * is a single location, a dye/wash round-trip, or a purely sequential ">>"/">" chain (no "/").
 * Mirror of crossDevLegs_ in integrations/google-sheet/Code.gs — kept in lockstep so the Daily
 * Events export and the Plant Event Updates sheet build the same per-plant rows.
 *
 * The leg count comes ONLY from col11's "/" split (the planner's rule: "always use the PLANT
 * column to identify how many plants"). A dye/wash step in the PLANT FLOW (col12
 * "BFL (WA01055) >> ANTLER/REGAL/EXPO") or the PROCESS text ("send to dye") drives the flow
 * (PPSDS -> RDPS, via detectMatchingFlow), NOT the leg count — so it is not checked here. The
 * one dye case that still collapses the split is a dye vendor sitting as one of col11's own "/"
 * legs ("LEEMA / BFL" = send-to-BFL-and-back round-trip, not two parallel locations).
 */
export function crossDevLegNames(row: Record<string, unknown>): string[] {
  const raw = String(row.col11 || "")
    .replace(/\(.*?\)/g, " ")
    .trim();
  if (!raw) return [];
  const groups = raw
    .split("/")
    .map((g) => g.trim())
    .filter(Boolean);
  if (groups.length < 2) return [];

  const isDyeWash = (p: unknown) => {
    const u = String(p || "").toUpperCase();
    return (
      u.includes("BFL") ||
      u.includes("MARTEX") ||
      u.includes("DYNAWASH") ||
      u.includes("DYE") ||
      u.includes("WASH")
    );
  };
  if (groups.some(isDyeWash)) {
    return [];
  }

  const legs: string[] = [];
  groups.forEach((g) => {
    g.split(/>>|>/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => {
        if (!legs.includes(s)) legs.push(s);
      });
  });
  return legs.length > 1 ? legs : [];
}

// The "approval chain" half of the 2-plant PPSES flow (PLANNING_FLOWS id 2/6/9/12 in
// planningFlows.ts: sequence [...,"PPSES","PPS","NY","NYC","MAST","REAP/FCHP","PLSD","PLSA"]).
// For a "+"-combined single-row location, this is the block that belongs on the SECOND plant —
// mirror of the POST_PPS_EVENT_CODES set in integrations/google-sheet/Code.gs.
const POST_PPS_EVENT_CODES = new Set(["PPS", "NY", "NYC", "MAST", "REAP/FCHP", "PLSD", "PLSA"]);

export interface PlantDateTarget {
  plant: string; // canonical individual plant -> the PLANT column + its own grid row
  fieldKey: string; // schedule key this cell confirms ("2026-09-02" or "2026-09-02_MRC")
  legLabel: string; // "" or the verbatim leg ("MRC", "Antler+Leema") — for grid-row grouping
  code: string; // base event code, for display
  rawValue: string; // current stored value at fieldKey
}

/**
 * Every plant that should see (and confirm) `row`'s planned events on `isoDate`, one entry per
 * individual plant. Mirrors rebuildSheets() in the Google Sheet:
 *  - "<date>_<leg>" key  -> that leg, "+"-split into its individual plants, same key
 *  - bare "<date>" key on a "/"-split cross-dev row -> every leg that hasn't diverged yet, each
 *    confirming against its own "<date>_<leg>" key, "+"-split into its individual plants
 *  - bare key on any other row -> the first plant only (unchanged)
 * Already pass/fail events are skipped (they need no confirmation) unless `includeVerdicts` is set —
 * the Plant Performance page needs exactly those, to score the plant that owned a green/red event.
 */
export function resolvePlantDateTargets(
  row: Record<string, unknown>,
  isoDate: string,
  opts?: { includeVerdicts?: boolean },
): PlantDateTarget[] {
  const legs = crossDevLegNames(row);
  const out: PlantDateTarget[] = [];
  const seen = new Set<string>();
  const push = (t: PlantDateTarget) => {
    const k = t.plant + "|" + t.fieldKey;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  };

  Object.keys(row).forEach((key) => {
    const m = key.match(/^(\d{4}-\d{2}-\d{2})(?:_(.+))?$/);
    if (!m || m[1] !== isoDate) return;
    const suffix = m[2] || "";
    const rawValue = String((row as Record<string, unknown>)[key] || "");
    const parsed = parseEventValue(rawValue);
    if (!parsed || (parsed.status !== "planned" && !opts?.includeVerdicts)) return;

    if (suffix) {
      splitLegPlants(suffix).forEach((p) =>
        push({ plant: p, fieldKey: key, legLabel: suffix, code: parsed.code, rawValue }),
      );
    } else if (legs.length) {
      legs.forEach((leg) => {
        // A leg that has fully diverged (its "_leg_<leg>" marker is set) keeps a complete
        // independent schedule on its own "<date>_<leg>" keys — it must NEVER pick up a
        // bare-key event, which is by then stale left-over from the pre-divergence plan.
        // Without this, a row whose legs BOTH diverged emitted duplicate FS/FR lines on the
        // old shared dates as well as the leg's real ones.
        if (String((row as Record<string, unknown>)[`_leg_${leg}`] || "").trim()) return;
        const own = String(
          (row as Record<string, unknown>)[`${isoDate}_${leg}`] || "",
        ).trim();
        if (own) return; // that leg has its own value for this date — handled by the suffix branch
        splitLegPlants(leg).forEach((p) =>
          push({
            plant: p,
            fieldKey: `${isoDate}_${leg}`,
            legLabel: leg,
            code: parsed.code,
            rawValue,
          }),
        );
      });
    } else {
      const plants = extractPlants(String(row.col11 || ""));
      let target = plants[0] || normalizeSinglePlant(String(row.col11 || "")) || "Unassigned";
      // A single "+"-combined location ("Antler+Leema", "MRC+Rich Color") is NOT a cross-dev
      // split — it's one shared production event both plants work at (see splitLegPlants/
      // plus-combo-two-plants-ppses). The planner's rule: everything from PPS onward — PPS, NY,
      // NYC, MAST, REAP/FCHP, PLSD, PLSA — always goes to the SECOND plant listed (e.g. Leema,
      // or Rich Color in "MRC+Rich Color"), never the first. Only the earlier origin/strike-off
      // steps (FS, FR, PPSES, ...) stay on the first plant.
      if (POST_PPS_EVENT_CODES.has(parsed.code) && plants.length >= 2) {
        target = plants[1];
      }
      push({ plant: target, fieldKey: key, legLabel: "", code: parsed.code, rawValue });
    }
  });

  return out;
}

/**
 * Formats a multi-plant flow string for display (e.g. "ANTLER>>LEEMA" -> "ANTLER >> LEEMA")
 */
export function formatPlantFlowDisplay(rawFlow?: string | null): string {
  if (!rawFlow || !rawFlow.trim()) return "";
  let formatted = rawFlow.trim();
  formatted = formatted.replace(/\s*>>\s*/g, " >> ");
  formatted = formatted.replace(/\s*\+\s*/g, " + ");
  formatted = formatted.replace(/\s*\/\s*/g, " / ");
  return formatted;
}

/**
 * Checks if a row (checking both col11 and col12) belongs to or involves a target plant.
 */
export function rowInvolvesPlant(
  row: Record<string, unknown>,
  targetPlant: string
): boolean {
  if (!targetPlant) return true;
  const canonicalTarget = normalizeSinglePlant(targetPlant);
  if (!canonicalTarget) return false;

  const plantsCol11 = extractPlants(row.col11 as string | undefined);
  const plantsCol12 = extractPlants(row.col12 as string | undefined);

  return plantsCol11.includes(canonicalTarget) || plantsCol12.includes(canonicalTarget);
}

/**
 * Extracts a deduplicated, sorted list of all individual canonical plants across all rows.
 */
export function getAllUniquePlantsFromRows(
  rows: Record<string, unknown>[]
): string[] {
  const plantSet = new Set<string>();
  rows.forEach((r) => {
    extractPlants(r.col11 as string | undefined).forEach((p) => plantSet.add(p));
    extractPlants(r.col12 as string | undefined).forEach((p) => plantSet.add(p));
  });

  return Array.from(plantSet).sort();
}

/**
 * Calculates Target Graphic Send Date (default 4 days before 1st S/OFF Date)
 * e.g., "31-Jul" -> Target Send Date: "27-Jul" (4 days lead time)
 */
export function calculateTargetSendDate(rawDateStr: string, leadDays = 4): {
  soffDateFormatted: string;
  targetSendDateFormatted: string;
  soffDateISO: string;
  targetSendDateISO: string;
  daysRemaining: number;
} | null {
  if (!rawDateStr || !rawDateStr.trim()) return null;
  const str = rawDateStr.trim();

  let d: Date | null = null;

  // Handle "31-Jul", "31-July", "31/07", "31 Jul 2026"
  const dayMonthMatch = str.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})(?:[-/\s](\d{2,4}))?$/i);
  if (dayMonthMatch) {
    const day = parseInt(dayMonthMatch[1], 10);
    const monthStr = dayMonthMatch[2];
    const yearStr = dayMonthMatch[3] || new Date().getFullYear().toString();
    const year = yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10);

    const monthIndex = new Date(`${monthStr} 1, 2000`).getMonth();
    if (!isNaN(monthIndex)) {
      d = new Date(year, monthIndex, day);
    }
  }

  if (!d || isNaN(d.getTime())) {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) d = parsed;
  }

  if (!d || isNaN(d.getTime())) return null;

  // Calculate target send date = 1st S/OFF date - leadDays
  const targetDate = new Date(d);
  targetDate.setDate(d.getDate() - leadDays);

  const soffDateISO = d.toISOString().split("T")[0];
  const targetSendDateISO = targetDate.toISOString().split("T")[0];

  const formatDDMMYYYY = (dateObj: Date) => `${String(dateObj.getDate()).padStart(2, "0")}/${String(dateObj.getMonth() + 1).padStart(2, "0")}/${dateObj.getFullYear()}`;
  const soffDateFormatted = formatDDMMYYYY(d);
  const targetSendDateFormatted = formatDDMMYYYY(targetDate);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffTime = targetDate.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return {
    soffDateFormatted,
    targetSendDateFormatted,
    soffDateISO,
    targetSendDateISO,
    daysRemaining,
  };
}
