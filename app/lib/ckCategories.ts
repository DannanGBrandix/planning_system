// ---------------------------------------------------------------------------
// CK category model
//
// Before Sept 2026 every CK row was stored as the bare category "CK". CK is now
// split into four separately-tracked categories, each backed by its own
// SharePoint tracking chart (see the "Sync CK Charts" button / server/ckSync.js):
//
//   • CKNA Men's      — "CKNA FAWI27 Men's Tracking Chart.xlsx" / "...SPSU27..."
//   • CKNA Women's     — "CKNA FAWI27 Women's Tracking Chart.xlsx" / "...SPSU27..."
//   • CKP             — "SP27 CKP Tracking Chart.xlsx"
//   • Other Knit      — "SPSU27 Other Knit Tracker.xlsx"
//
// The category is decided by the FILE NAME, not by any column inside the sheet
// (the CKNA charts have no Category column at all; the CKP chart's "Category"
// column holds "Men"/"Women" which we ignore — CKP is a single category).
//
// Legacy bare "CK" rows still exist. They stay compatible with any of the four
// specific categories for row-identity matching, so a sync can re-label them;
// but the four specifics never cross-match each other.
// ---------------------------------------------------------------------------

export const LEGACY_CK = "CK";

export const CK_CATEGORIES = [
  "CKNA Men's",
  "CKNA Women's",
  "CKP",
  "Other Knit",
] as const;

export type CkCategory = (typeof CK_CATEGORIES)[number];

/**
 * Derive the tracked CK category from a tracking-chart file name.
 * Returns null when the name doesn't look like one of the CK charts.
 */
export function ckCategoryFromFilename(fileName: string): CkCategory | null {
  const n = (fileName || "").toLowerCase();
  // "women" MUST be tested before "men" — the substring "men" is inside "women".
  if (n.includes("women")) return "CKNA Women's";
  if (n.includes("men")) return "CKNA Men's";
  if (n.includes("ckp")) return "CKP";
  if (n.includes("other knit")) return "Other Knit";
  return null;
}

/**
 * Normalised token used only for comparing two Category strings during import
 * matching. Legacy / unspecified CK -> "CK"; each specific CK category gets its
 * own token; a genuine non-CK category (PINK, VS-…) -> "".
 */
export function ckCategoryCanonical(raw: string): string {
  const compact = (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";
  if (compact === "CK") return "CK";
  if (compact.startsWith("CKNA")) {
    if (compact.includes("WOMEN")) return "CKNAWOMEN";
    if (compact.includes("MEN")) return "CKNAMEN";
    return "CK"; // "CKNA" with no gender -> treat as the legacy family
  }
  if (compact.startsWith("CKP")) return "CKP";
  if (compact.startsWith("OTHERKNIT")) return "OTHERKNIT";
  if (compact.startsWith("CK")) return "CK";
  return "";
}

const CK_CANONS = new Set(["CK", "CKNAMEN", "CKNAWOMEN", "CKP", "OTHERKNIT"]);

/**
 * Canonical display label for any CK-family category spelling — case- and
 * punctuation-insensitive, so "CKNA MEN'S", "CKNA Men's" and "ckna mens" all
 * collapse to the single label "CKNA Men's". Returns null when `raw` is not a
 * CK-family category (callers keep the original string in that case).
 */
export function ckCanonicalCategoryLabel(raw: string): string | null {
  switch (ckCategoryCanonical(raw)) {
    case "CKNAMEN":
      return "CKNA Men's";
    case "CKNAWOMEN":
      return "CKNA Women's";
    case "CKP":
      return "CKP";
    case "OTHERKNIT":
      return "Other Knit";
    case "CK":
      return "CK";
    default:
      return null;
  }
}

/** True when the category is CK, one of the four CK categories, or a CK* variant. */
export function isCkFamilyCategory(raw: string): boolean {
  return CK_CANONS.has(ckCategoryCanonical(raw));
}

/**
 * Category compatibility for row-identity matching between an incoming import
 * row and an existing DB row, when at least one side is CK-family:
 *   - blank on either side ............................ compatible
 *   - equal / same canonical token .................... compatible
 *   - legacy bare "CK" vs a specific CK category ...... compatible (lets a sync re-label)
 *   - CK-family vs a genuine non-CK category .......... NOT compatible
 *   - two DIFFERENT specific CK categories ............ NOT compatible
 */
export function ckCategoriesCompatible(a: string, b: string): boolean {
  const ra = (a || "").trim();
  const rb = (b || "").trim();
  if (!ra || !rb) return true;
  const ca = ckCategoryCanonical(ra);
  const cb = ckCategoryCanonical(rb);
  // one side CK-family, the other a real non-CK category -> different rows
  if (!!ca !== !!cb) return false;
  if (!ca && !cb) return true;
  if (ca === cb) return true;
  if (ca === "CK" || cb === "CK") return true;
  return false;
}
