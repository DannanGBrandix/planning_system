// ---------------------------------------------------------------------------
// Shared "friendly category" mapping — one canonical bucket name per Category
// (col3), used anywhere rows get grouped/exported by category so every report
// (Embellishment Plan export, Reports page, ...) names the same bucket the
// same way instead of each screen inventing its own labels.
// ---------------------------------------------------------------------------
import { cleanCategory } from "./db";
import { isCkFamilyCategory, ckCategoryCanonical } from "./ckCategories";

// Maps a row's Category (col3) to its report bucket name. Category is stored under a mix of
// legacy and current spellings ("KNIT"/"LOUNGE"/"SPORT" as PINK sub-lines, "VS AE", "VS-SLEEP",
// the four CK-family categories, ...) — this gives each its own readable name instead of
// exporting the raw stored value verbatim (or collapsing them all together).
//
// `fallbackText` is checked ONLY when Category itself is blank — some charts leave Category
// empty and instead put the product line (SPORT/LOUNGE/KNIT) in the Trigger (col2) column; "In
// VS there is no category called Sport — it's in PINK" (confirmed against real data), so those
// rows still need to land in a PINK-* bucket rather than "UNCATEGORIZED".
export function categorySheetName(rawCategory: string, fallbackText?: string): string {
  const cleaned = cleanCategory(rawCategory);
  const upper = cleaned.toUpperCase().trim();
  if (!upper) {
    const fb = String(fallbackText || "").toUpperCase();
    if (fb.includes("KNIT")) return "PINK-KNIT";
    if (fb.includes("LOUNGE")) return "PINK-LOUNGE";
    if (fb.includes("SPORT")) return "PINK-SPORT";
    return "UNCATEGORIZED";
  }
  if (isCkFamilyCategory(upper)) {
    switch (ckCategoryCanonical(upper)) {
      case "CKNAMEN":
        return "CK NA-MEN";
      case "CKNAWOMEN":
        return "CK NA-WOMEN";
      case "CKP":
        return "CKP";
      case "OTHERKNIT":
        return "CK OTHER-KNIT";
      default:
        return "CK"; // legacy bare "CK" row not yet re-labeled by a sync
    }
  }
  if (upper === "KNIT") return "PINK-KNIT";
  if (upper === "LOUNGE") return "PINK-LOUNGE";
  if (upper === "SPORT") return "PINK-SPORT";
  if (upper === "PINK") return "PINK";
  if (upper === "VS AE") return "VS-AE";
  if (upper === "VS-SLEEP") return "VS-SLEEP";
  return cleaned; // any other category keeps its own name as-is
}
