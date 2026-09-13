const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

const DBS = {
  test: ["https://vxsfwwdcjjhsitfauyxa.supabase.co", "sb_publishable_Tlo7TJBaxPe-WUAxHP9zyg_unc9W2nP"],
  prod: ["https://ktgsyakzevczufcziqci.supabase.co", "sb_publishable_sd4ukbcNz0Ut6FEdxUugAA_uuhnCCHE"],
};
const TARGET = process.argv.find((a) => a === "test" || a === "prod") || "test";
const [URL, KEY] = DBS[TARGET];
const supabase = createClient(URL, KEY);
console.log(`>>> DATABASE: ${TARGET.toUpperCase()}  (${URL})`);

const APPLY = process.argv.includes("--apply");

// Same rule as the import fix in app/page.tsx: keep the reference line(s) before the first
// fabric-composition line (a line containing "%" or an "<n>GSM" weight), collapsed to one line.
function cleanFabricRef(v) {
  if (!v || !/\n/.test(v)) return { out: v, strippedComposition: false };
  const lines = String(v).split("\n").map((l) => l.replace(/^["'\s]+|["'\s]+$/g, "").trim());
  const compIdx = lines.findIndex(
    (l) => /%/.test(l) || /^\d{2,4}\s*(?:GSM|G\s*\/\s*M2?|G\/M²)\b/i.test(l)
  );
  const kept = (compIdx === -1 ? lines : lines.slice(0, compIdx)).filter(Boolean);
  let out = kept.join(", ").replace(/\s*,\s*(?:,\s*)+/g, ", ").replace(/^[,\s]+|[,\s]+$/g, "").trim();
  if (!out) out = v;
  return { out, strippedComposition: compIdx !== -1 };
}

(async () => {
  let from = 0, all = [];
  while (true) {
    const { data, error } = await supabase.from("rows").select("id,col3,col5,col7,col13").range(from, from + 999);
    if (error) { console.error(error); process.exit(1); }
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log("Fetched", all.length, "rows");

  const targets = [];
  for (const r of all) {
    if (!r.col13 || !/\n/.test(r.col13)) continue;
    const { out, strippedComposition } = cleanFabricRef(r.col13);
    // Only touch rows where an actual fabric-composition line was removed — that's the bug.
    // Rows that merely have multi-line refs with no composition ("Ground - X\nApplique - Y")
    // are left alone.
    if (strippedComposition && out !== r.col13) {
      targets.push({ id: r.id, cat: r.col3, style: r.col5, graphic: r.col7, before: r.col13, after: out });
    }
  }

  const report = targets.map((t) =>
    `${t.id}  [${t.cat}] ${t.style}/${t.graphic}\n   BEFORE: ${JSON.stringify(t.before)}\n   AFTER : ${JSON.stringify(t.after)}`
  ).join("\n");
  const outFile = "C:/Users/danna/AppData/Local/Temp/claude/D--Brandix-embellishmentplan/ec68cf2b-bfb3-4557-b9b1-3a2a820e5172/scratchpad/fabricref_changes.txt";
  fs.writeFileSync(outFile, report);

  const byCat = {};
  targets.forEach((t) => { byCat[t.cat || "?"] = (byCat[t.cat || "?"] || 0) + 1; });
  const distinctAfter = {};
  targets.forEach((t) => { distinctAfter[t.after] = (distinctAfter[t.after] || 0) + 1; });

  console.log(`\nRows to update: ${targets.length}`);
  console.log("By category:", JSON.stringify(byCat));
  console.log("\nDistinct resulting values:");
  Object.entries(distinctAfter).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}\t${JSON.stringify(k)}`));
  console.log(`\nFull before/after list written to:\n  ${outFile}`);

  const rollbackFile = outFile.replace("changes.txt", "rollback.json");
  fs.writeFileSync(rollbackFile, JSON.stringify(targets.map((t) => ({ id: t.id, col13: t.before })), null, 2));
  console.log(`Rollback data (id -> original col13) written to:\n  ${rollbackFile}`);

  if (!APPLY) {
    console.log("\n*** DRY RUN — nothing written. Re-run with --apply to write. ***");
    return;
  }

  console.log("\n=== APPLYING ===");
  let done = 0, errors = 0;
  for (const t of targets) {
    const { error } = await supabase.from("rows").update({ col13: t.after }).eq("id", t.id);
    if (error) { errors++; console.error(`  FAIL ${t.id}:`, error.message); }
    else { done++; }
    if (done % 100 === 0) console.log(`  ...${done}/${targets.length}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  console.log(`\nDone. Updated ${done}, errors ${errors}.`);
})();
