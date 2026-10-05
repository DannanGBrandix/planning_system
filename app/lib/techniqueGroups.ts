// Groups the detailed Technique Category (col18, e.g. "Plastisol print", "Satin stich Embroidery")
// into the planner's 8 top-level technique groups (2026-10-05 reference table):
//
//   1. PRINT                            Rubber / Plastisol / Water based / Digital print, Glitter, Foil,
//                                       Silicon, Gel, Shiny Plastisol, Engineered, Metallic, Prints over
//                                       seam, Flock, Burned out, Discharge, Distress, All over, HD Plastisol, Pad
//   2. EMBROIDERY                       Satin / Chain stitch, Eyelet, All over emb, Chenille, Smocking,
//                                       Manipulation, Sequins / Beads, Scallop, Quilting
//   3. HEAT TRANSFER                    Heat Transfer, HD Heat Transfer
//   4. STONES                           Rhinestone, 2MM/3MM Diamante, Rhine stud, All over stones
//   5. APPLIQUÉ / MATERIAL APPLICATION  Applique
//   6. LASER CUT                        Laser panel form, Laser cut combinations
//   7. 3D / TEXTURE                     Puff, Emboss, Deboss/Emboss, Silicone / raised effects
//   8. CONSTRUCTION / BONDING           Bonding, Pin tuck
//
// Rules are checked IN ORDER, so the more specific groups win over the broad keyword ones:
// "HD HEAT TRANSFER" is Heat Transfer (not Print), "PUFF PRINT" is 3D / Texture (not Print),
// "CUTOUT WITH SATIN STITCH" is Laser Cut (not Embroidery). Anything unmatched (WASH, N/A, …)
// lands in OTHER so it is still counted and visible.

export interface TechniqueGroup {
  /** 1–8 in the reference table; 99 for OTHER. */
  order: number;
  label: string;
}

const GROUPS = {
  PRINT: { order: 1, label: "PRINT" },
  EMBROIDERY: { order: 2, label: "EMBROIDERY" },
  HEAT_TRANSFER: { order: 3, label: "HEAT TRANSFER" },
  STONES: { order: 4, label: "STONES" },
  APPLIQUE: { order: 5, label: "APPLIQUÉ / MATERIAL APPLICATION" },
  LASER_CUT: { order: 6, label: "LASER CUT" },
  TEXTURE_3D: { order: 7, label: "3D / TEXTURE" },
  CONSTRUCTION: { order: 8, label: "CONSTRUCTION / BONDING" },
  OTHER: { order: 99, label: "OTHER" },
} satisfies Record<string, TechniqueGroup>;

const RULES: [RegExp, TechniqueGroup][] = [
  [/HEAT\s*TRANSFER/, GROUPS.HEAT_TRANSFER],
  [/LASER|CUT\s*OUT|CUTOUT/, GROUPS.LASER_CUT],
  [/BOND|PIN\s*TUCK/, GROUPS.CONSTRUCTION],
  [/PUFF|EMBOSS|DEBOSS|3D|TEXTURE|RAISED/, GROUPS.TEXTURE_3D],
  [/RHINE|DIAMANTE|STONE/, GROUPS.STONES],
  [/APPLIQU/, GROUPS.APPLIQUE],
  [
    /EMB|STICH|STITCH|SEQUIN|BEAD|SEAD|SEED|CHENILLE|SMOCK|MANIPULATION|SCALLOP|QUILT|EYELET|EYELASH|MERROW|LUREX/,
    GROUPS.EMBROIDERY,
  ],
  [
    /PRINT|PLASTISOL|FOIL|FLOCK|GLITTER|GEL|METALLIC|SILICON|DISCHARGE|BURN|SHINY|DISTRESS|\bHD\b|SHP/,
    GROUPS.PRINT,
  ],
];

/** The top-level group for a detailed technique name (case-insensitive). */
export function techniqueGroupOf(detail: string): TechniqueGroup {
  const up = String(detail || "").toUpperCase();
  for (const [re, group] of RULES) if (re.test(up)) return group;
  return GROUPS.OTHER;
}
