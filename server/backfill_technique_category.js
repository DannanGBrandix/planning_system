// node server/backfill_technique_category.js [--prod] [--apply]
// Dry run (default) / apply (--apply): backfill blank Technique Category (col18) from the "Plan"
// sheet of "Embellishment development plan.xlsm". Targets TEST (server/.env must point at it)
// unless --prod is passed, which targets PRODUCTION directly. Back PROD up first:
//   node server/export_database.js --url <prod url> --key <prod key>
// Writes straight to `rows` (no replan, no versioning) — click the app's refresh icon afterwards
// so the server's rows cache re-reads.
const fs = require("fs");
const path = require("path");
const ROOT = "D:/Brandix/embellishmentplan";
const XLSX = require(ROOT + "/node_modules/xlsx");
const { createClient } = require(ROOT + "/node_modules/@supabase/supabase-js");
const { fromDb, isNamed, NAMES } = require(ROOT + "/server/rowColumns.js");

const APPLY = process.argv.includes("--apply");
const EXPECT_REF = "wetaazteocnpkkciemvw"; // TEST project — refuse anything else
const SCRATCH = require("os").tmpdir();
const CACHE = path.join(SCRATCH, "plan_sheet_cache.json");

const env = Object.fromEntries(
  fs.readFileSync(ROOT + "/server/.env", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const PROD = process.argv.includes("--prod");
const prodCfg = { url: "https://dxppkrlwsrbeiakvjtcg.supabase.co", key: "sb_publishable_HZ8kMu9zqs-RVwj_lUU0Fw_ZURuzH1X" };
const url = PROD ? prodCfg.url : env.NEXT_PUBLIC_SUPABASE_URL;
const key = PROD ? prodCfg.key : env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!PROD && !url.includes(EXPECT_REF)) { console.error("Refusing: active DB is not TEST (pass --prod for production):", url); process.exit(1); }
console.log(`Target: ${PROD ? "PRODUCTION" : "TEST"} ${url}`);

const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();

function loadPlan() {
  if (fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const wb = XLSX.readFile("C:/Users/danna/Downloads/Embellishment development plan.xlsm", { dense: true, sheets: ["Plan"] });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Plan, { header: 1, defval: "", blankrows: false });
  const out = rows.slice(2).map((r) => ({
    cat: String(r[2] ?? ""), season: String(r[3] ?? ""), style: String(r[4] ?? ""), combo: String(r[5] ?? ""),
    graphic: String(r[6] ?? ""), ground: String(r[7] ?? ""), technique: String(r[8] ?? ""),
    techCat: String(r[17] ?? "").replace(/\s+/g, " ").trim(),
  })).filter((r) => r.techCat);
  fs.writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

(async () => {
  const plan = loadPlan();
  console.log(`Plan rows with a Technique Category: ${plan.length}`);

  // index: key -> Map(category -> count)
  const idx = { sgg: new Map(), gg: new Map(), gt: new Map(), g: new Map(), t: new Map() };
  const add = (m, k, c) => { if (!k.replace(/\|/g, "")) return; if (!m.has(k)) m.set(k, new Map()); m.get(k).set(c, (m.get(k).get(c) || 0) + 1); };
  for (const r of plan) {
    const c = r.techCat;
    add(idx.sgg, `${norm(r.style)}|${norm(r.graphic)}|${norm(r.ground)}`, c);
    add(idx.gg, `${norm(r.graphic)}|${norm(r.ground)}`, c);
    add(idx.gt, `${norm(r.graphic)}|${norm(r.technique)}`, c);
    add(idx.g, norm(r.graphic), c);
    add(idx.t, norm(r.technique), c);
  }
  // A key resolves only if all its Excel rows agree (case-insensitive) on one category;
  // the technique-text-only tier needs >=90% agreement and >=3 rows.
  const pick = (m, k, loose) => {
    const hit = m.get(k); if (!hit) return null;
    const merged = new Map();
    for (const [c, n] of hit) { const kk = c.toUpperCase(); const e = merged.get(kk) || { label: c, n: 0 }; e.n += n; merged.set(kk, e); }
    const arr = [...merged.values()].sort((a, b) => b.n - a.n);
    const total = arr.reduce((s, e) => s + e.n, 0);
    if (arr.length === 1) return arr[0].label;
    if (loose && total >= 3 && arr[0].n / total >= 0.9) return arr[0].label;
    return { conflict: arr.map((e) => `${e.label}(${e.n})`).join(", ") };
  };

  const sb = createClient(url, key);
  const named = await isNamed(sb);
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("rows").select("*").range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  const rows = all.map((r) => fromDb(r, named)).filter((r) => r.is_current !== false && r.id !== "bulk");
  const blank = rows.filter((r) => !String(r.col18 || "").trim());
  console.log(`DB (${named ? "named" : "legacy"}) current rows: ${rows.length}, blank Technique Category: ${blank.length}`);

  const tiers = [
    ["Style+Graphic+Ground", (r) => pick(idx.sgg, `${norm(r.col5)}|${norm(r.col7)}|${norm(r.col8)}`)],
    ["Graphic+Ground", (r) => pick(idx.gg, `${norm(r.col7)}|${norm(r.col8)}`)],
    ["Graphic+Technique", (r) => pick(idx.gt, `${norm(r.col7)}|${norm(r.col9)}`)],
    ["Graphic", (r) => pick(idx.g, norm(r.col7))],
    ["Technique text", (r) => pick(idx.t, norm(r.col9), true)],
  ];
  const updates = [];
  const counts = {}; const conflicts = []; const unmatched = [];
  for (const r of blank) {
    let done = false; let lastConflict = null;
    for (const [name, fn] of tiers) {
      const res = fn(r);
      if (typeof res === "string" && /^N\/?A$/i.test(res.trim())) { break; }
      if (typeof res === "string") { updates.push({ r, value: res, tier: name }); counts[name] = (counts[name] || 0) + 1; done = true; break; }
      if (res && res.conflict && !lastConflict) lastConflict = `${name}: ${res.conflict}`;
    }
    if (!done) (lastConflict ? conflicts : unmatched).push({ r, lastConflict });
  }
  console.log("\nWould fill:", updates.length, counts);
  console.log("Left blank — conflicting Excel values:", conflicts.length);
  console.log("Left blank — not found in Excel:", unmatched.length);
  const bySeason = {};
  for (const u of unmatched) { const k = `${u.r.col3} ${u.r.col4}`; bySeason[k] = (bySeason[k] || 0) + 1; }
  console.log("  not-found by category/season:", Object.entries(bySeason).sort((a, b) => b[1] - a[1]).slice(0, 12));
  console.log("\nSample fills:");
  updates.slice(0, 12).forEach((u) => console.log(`  [${u.tier}] ${u.r.col5} | ${u.r.col7} | ${u.r.col9} -> ${u.value}`));
  console.log("\nSample conflicts:");
  conflicts.slice(0, 6).forEach((c) => console.log(`  ${c.r.col5} | ${c.r.col7} | ${c.r.col9} :: ${c.lastConflict}`));
  const valCounts = {}; updates.forEach((u) => (valCounts[u.value] = (valCounts[u.value] || 0) + 1));
  console.log("\nValues to be written:", Object.entries(valCounts).sort((a, b) => b[1] - a[1]));

  fs.writeFileSync(path.join(SCRATCH, "techcat_plan.json"), JSON.stringify(updates.map((u) => ({ id: u.r.id, style: u.r.col5, graphic: u.r.col7, value: u.value, tier: u.tier })), null, 1));

  if (!APPLY) { console.log("\nDRY RUN — nothing written."); return; }
  const col = named ? NAMES.col18 : "col18";
  let ok = 0;
  for (const u of updates) {
    const { error } = await sb.from("rows").update({ [col]: u.value }).eq("id", u.r.id);
    if (error) { console.error("FAIL", u.r.id, error.message); continue; }
    ok++;
  }
  console.log(`\nAPPLIED: ${ok}/${updates.length} rows updated on ${PROD ? "PRODUCTION" : "TEST"}.`);
})().catch((e) => { console.error(e); process.exit(1); });
