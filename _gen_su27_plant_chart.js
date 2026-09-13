/*
 * Graphic-combo allocation by plant — Season SU27 (Summer 27)
 * Categories: VS Angel Essential, VS Sleep, PINK.
 *
 * Pulls current rows from the PROD Supabase and writes an .xlsx in the
 * "Graphic-Plant-Allocation_SU27" layout:
 *   - Overview sheet: plant x category matrix of graphic-combo line counts
 *   - one sheet per category: count-by-plant table + a filterable detail list
 *     (Plant / Graphic # / Combo # / Style / Ground / Technique(s) / Status / raw plant cols)
 *
 * Run:  node _gen_su27_plant_chart.js  [output.xlsx]
 */
const path = require("path");
const NM = path.join(__dirname, "node_modules");
const { createClient } = require(path.join(NM, "@supabase/supabase-js"));
const XLSX = require(path.join(NM, "xlsx"));

const supabase = createClient(
  "https://ktgsyakzevczufcziqci.supabase.co",
  "sb_publishable_sd4ukbcNz0Ut6FEdxUugAA_uuhnCCHE"
);

const SEASON = "SU27";
const OUT = process.argv[2] || path.join(__dirname, "Graphic-Plant-Allocation_SU27.xlsx");
const TODAY = new Date().toISOString().slice(0, 10);

// category key -> { sheet, label } (label used in the Overview column header and sheet titles)
const CATS = [
  { key: "VS AE", sheet: "VS Angel Essential SU27", label: "VS Angel Essential" },
  { key: "VS-SLEEP", sheet: "VS Sleep SU27", label: "VS Sleep" },
  { key: "PINK", sheet: "PINK SU27", label: "PINK" },
];
const WANTED = new Set(CATS.map((c) => c.key));

// mirrors cleanCategory() in app/lib/db.ts
function canonCategory(cat) {
  const up = String(cat || "").replace(/[\r\n]+/g, " ").trim().toUpperCase();
  if (/^(VS)?(AE|ANGELESSENTIALS?)$/.test(up.replace(/[^A-Z]/g, ""))) return "VS AE";
  if (up === "KNIT" || up === "LOUNGE") return "PINK";
  if (up === "VS-SLEEP" || up === "VS SLEEP") return "VS-SLEEP";
  if (up === "PINK") return "PINK";
  return up;
}

// mirrors getRowStatus() in app/lib/db.ts (enough of it to tell "dropped/reallocated" apart)
function isDroppedOrReallocated(r) {
  const c1 = String(r.col1 || "").trim().toUpperCase();
  const c2 = String(r.col2 || "").trim();
  if (/re-?allocat/i.test(c2) || /\bmov(?:e|ed|ing)\b/i.test(c2)) return true;
  const c20 = String(r.col20 || "").trim().toUpperCase();
  const c22 = String(r.col22 || "").trim().toUpperCase();
  const c34 = String(r.col34 || "").trim().toUpperCase();
  const latestComment = c34 || c22;
  if (/\b(dropped|drop|reallocated|moved)\b/i.test(latestComment)) return true;
  if (c20.includes("DROPPED") || c20.includes("DROP") || c20.includes("REALLOCATED") || /\bMOVED\b/.test(c20)) return true;
  if (c1 === "D" || c1.includes("DROPPED") || c1.includes("DROP") || c1.includes("REALLOCATED")) return true;
  return false;
}

// --- plant name handling ---------------------------------------------------
// Exact-match canonicalisation (case-insensitive, hyphens -> spaces, spaces collapsed).
const PLANT_CANON = {
  "ANTLER": "ANTLER",
  "EXPO": "EXPO",
  "FUSION": "FUSION",
  "LEEMA": "LEEMA",
  "MRC": "MRC",
  "HI EMB": "HI EMB",
  "HIEMB": "HI EMB",
  "REGAL": "REGAL IMAGE",
  "REGAL IMAGE": "REGAL IMAGE",
  "RICH COLOR": "RICH COLOR",
  "SCREENLINE": "SCREEN LINE",
  "SCREEN LINE": "SCREEN LINE",
  "THARINDU PRINT": "THARINDU PRINT",
};
// "BRANDIX" in the Plant column is the managing company, not an actual embellishment plant
// (some tracking charts put it on every row) — treat it as "no plant assigned", same as blank.
const NON_PLANT = new Set(["BRANDIX", "N/A", "NA", "TBD", "TBC", "-"]);
function canonPlant(token) {
  const key = String(token || "").replace(/-/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  if (!key || NON_PLANT.has(key)) return "";
  return PLANT_CANON[key] || key;
}
// A single Plant / Plant Flow cell can list several plants a graphic passes through:
//   "Regal Image/ Antler + Leema", "Rich Color / Antler", "Screenline/ Antler/Regal Image",
//   "EXPO ( Cross - Regal Image )"  -> parenthetical is dropped, not split.
function splitPlants(raw) {
  let s = String(raw || "").trim();
  if (!s) return [];
  s = s.replace(/\([^)]*\)/g, " "); // drop "( cross - ... )" notes entirely
  return [...new Set(s.split(/[/+]|>>/).map(canonPlant).filter(Boolean))];
}

const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();
const NO_PLANT = "(No plant assigned)";

(async () => {
  let from = 0, all = [];
  while (true) {
    const { data, error } = await supabase
      .from("rows")
      .select("id,col1,col2,col3,col4,col5,col6,col7,col8,col9,col11,col12,col20,col22,is_current,schedule")
      .range(from, from + 999);
    if (error) { console.error(error); process.exit(1); }
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  all.forEach((r) => { r.col34 = (r.schedule || {}).col34 || ""; });

  const inScope = all.filter(
    (r) => r.col4 === SEASON && r.is_current !== false && WANTED.has(canonCategory(r.col3))
  );

  // Per category: keep non-dropped rows, expand each to its plant leg(s), dedupe identical lines.
  const perCat = {}; // key -> { kept, distinctGraphics:Set, detail:[], byPlant:Map }
  for (const { key } of CATS) {
    const kept = inScope.filter((r) => canonCategory(r.col3) === key && !isDroppedOrReallocated(r));
    const seen = new Set();
    const detail = [];
    for (const r of kept) {
      const legs = [...new Set([...splitPlants(r.col11), ...splitPlants(r.col12)])];
      const plants = legs.length ? legs : [NO_PLANT];
      const row = {
        graphic: clean(r.col7), combo: clean(r.col6), style: clean(r.col5),
        ground: clean(r.col8), technique: clean(r.col9), status: clean(r.col1) || "Active",
        raw11: clean(r.col11), raw12: clean(r.col12),
      };
      for (const plant of plants) {
        const sig = [plant, row.graphic, row.combo, row.style, row.ground, row.technique, row.status].join("||");
        if (seen.has(sig)) continue;
        seen.add(sig);
        detail.push({ plant, ...row });
      }
    }
    const byPlant = new Map();
    detail.forEach((d) => byPlant.set(d.plant, (byPlant.get(d.plant) || 0) + 1));
    perCat[key] = {
      keptCount: kept.length,
      distinctGraphics: new Set(kept.map((r) => clean(r.col7)).filter(Boolean)).size,
      detail,
      byPlant,
    };
  }

  const wb = XLSX.utils.book_new();
  const addSheet = (name, aoa, cols, filterRow /* 0-based header row for autofilter, optional */) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = cols.map((w) => ({ wch: w }));
    if (filterRow != null) {
      const last = aoa.length - 1;
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: filterRow, c: 0 }, e: { r: last, c: cols.length - 1 } }) };
    }
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  // ---------- Overview ----------
  const allPlants = new Set();
  CATS.forEach(({ key }) => perCat[key].byPlant.forEach((_, p) => { if (p !== NO_PLANT) allPlants.add(p); }));
  const plantList = [...allPlants].sort((a, b) => a.localeCompare(b));

  const ov = [];
  ov.push([`Graphic-combo allocation by plant  —  Season ${SEASON} (Summer 27)`]);
  ov.push([
    `Generated ${TODAY}  ·  Dropped / reallocated items excluded.  ·  count = number of planning rows ` +
    `(graphic-combo lines) allocated to each plant (Plant + Plant Flow columns). A row split across N plants is counted under each.`,
  ]);
  ov.push(["Plant", ...CATS.map((c) => c.label), "Total"]);
  const colTotals = CATS.map(() => 0);
  for (const plant of plantList) {
    const counts = CATS.map(({ key }) => perCat[key].byPlant.get(plant) || 0);
    counts.forEach((n, i) => (colTotals[i] += n));
    ov.push([plant, ...counts, counts.reduce((a, b) => a + b, 0)]);
  }
  ov.push([]);
  ov.push([]);
  ov.push([`TOTAL (graphic-combo lines)`, ...colTotals, colTotals.reduce((a, b) => a + b, 0)]);
  addSheet("Overview", ov, [26, 20, 14, 12, 10]);

  // ---------- per-category sheets ----------
  for (const { key, sheet, label } of CATS) {
    const pc = perCat[key];
    const rows = [];
    rows.push([`${label}  ·  ${SEASON}  —  Overall count by plant`]);
    rows.push([`${pc.keptCount} planning rows  ·  ${pc.distinctGraphics} distinct graphic numbers`]);
    rows.push([]);
    rows.push(["Plant", "Graphic-combo lines"]);

    const plantRows = [...pc.byPlant.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
    plantRows.forEach(([plant, n]) => rows.push([plant, n]));
    rows.push([]);
    rows.push(["TOTAL", plantRows.reduce((s, [, n]) => s + n, 0)]);
    rows.push([]);
    rows.push([]);
    rows.push(["Graphic numbers assigned to each plant  (use the filter arrows to pick a plant)"]);
    rows.push([]);

    const headerRowIdx = rows.length;
    rows.push(["Plant", "Graphic #", "Combo #", "Style", "Ground", "Technique(s)", "Status", "Plant (raw)", "Plant Flow (raw)"]);

    const plantOrder = new Map(plantRows.map(([p], i) => [p, i]));
    const detail = pc.detail.slice().sort(
      (a, b) =>
        (plantOrder.get(a.plant) - plantOrder.get(b.plant)) ||
        a.graphic.localeCompare(b.graphic, undefined, { numeric: true }) ||
        a.combo.localeCompare(b.combo)
    );
    detail.forEach((d) =>
      rows.push([d.plant, d.graphic, d.combo, d.style, d.ground, d.technique, d.status, d.raw11, d.raw12])
    );

    addSheet(sheet, rows, [24, 15, 9, 20, 34, 42, 13, 22, 20], headerRowIdx);
  }

  XLSX.writeFile(wb, OUT);
  console.log(`Wrote ${OUT}`);
  const grand = CATS.reduce((s, { key }) => s + [...perCat[key].byPlant.values()].reduce((a, b) => a + b, 0), 0);
  CATS.forEach(({ key, label }) => {
    const pc = perCat[key];
    const total = [...pc.byPlant.values()].reduce((a, b) => a + b, 0);
    console.log(`  ${label}: ${pc.keptCount} rows / ${pc.distinctGraphics} graphics / ${total} graphic-combo lines across ${pc.byPlant.size} plants`);
  });
  console.log(`  GRAND TOTAL graphic-combo lines: ${grand}`);
})();
