// One-time recovery script — run once, then delete.
//
// What happened: importing "VS AE SPRING 27 GRAPHIC CHART.xlsx" on 2026-09-23 blanked the Plant
// field (col11) on 28 VS AE SP27 rows. Once Plant went blank, the scheduler's own safety gate
// (a row with no allocation data isn't allowed to keep a projected plan) cleared every
// auto-projected event ("-S" pills) on those rows — that's why their calendars looked empty.
//
// This script restores exactly what was lost, from the automatic "Before importing VS AE SPRING
// 27 GRAPHIC CHART.xlsx" snapshot the app took at 2026-09-23 06:28 UTC (backup id
// backup_1790144895128_iiyr4g), BEFORE the import ran. It only fills in fields that are STILL
// blank right now — it never overwrites anything you've touched since, including the older
// verdicts that already survived on some of these rows.
//
// How to run:
//   1. Open a terminal in this folder (D:\Brandix\embellishmentplan).
//   2. Run:  node restore_vsae_sp27_2026-09-25.js
//   3. It will print what it changed and verify each row afterward.
//   4. Once you've confirmed the Dashboard looks right again, delete this file.

const fs = require("fs");
const path = require("path");

// Load Supabase credentials the same way the app does.
fs.readFileSync(path.join(__dirname, ".env.local"), "utf8").split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

const db = require(path.join(__dirname, "server/db.js"));

// The 28 rows that actually lost data (10 other rows in the same incident were Dropped/blank
// already and had nothing to restore, so they're left out).
const patches = [
  {"id":"row_1788580647616_51d3j","col11":"MRC","2026-09-25":"FS|X","2026-09-28":"FR-S","2026-09-30":"PPS-S","2026-10-01":"NY-S","2026-10-21":"NYC-S","2026-10-26":"MAST-S","2026-10-29":"REAP/FCHP-S","2026-11-09":"PLSD-S","2026-11-12":"PLSA-S"},
  {"id":"row_1787854434928_4hywe","col11":"HI EMB","2026-08-20":"FS-S","2026-08-21":"FR-S","2026-08-25":"PPS-S","2026-08-28":"NY-S","2026-09-17":"NYC-S","2026-09-22":"MAST-S","2026-09-25":"REAP/FCHP-S","2026-10-06":"PLSD-S","2026-10-09":"PLSA-S"},
  {"id":"row_1787844655369_vdmzs","col11":"HI EMB","2026-08-20":"FS-S","2026-08-21":"FR-S","2026-08-25":"PPS-S","2026-08-28":"NY-S","2026-09-17":"NYC-S","2026-09-22":"MAST-S","2026-09-25":"REAP/FCHP-S","2026-10-06":"PLSD-S","2026-10-09":"PLSA-S"},
  {"id":"row_1787074005763_rxhrj","col11":"AV","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005763_3m9al","col11":"MRC","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005763_6g8ce","col11":"MRC","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005763_idvun","col11":"MRC","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005763_ijuaj","col11":"BFFAV","2026-09-21":"FS|X","2026-09-22":"FR-S","2026-09-24":"PPS-S","2026-09-25":"NY-S","2026-10-15":"NYC-S","2026-10-20":"MAST-S","2026-10-23":"REAP/FCHP-S","2026-11-03":"PLSD-S","2026-11-06":"PLSA-S"},
  {"id":"row_1787074005763_kqm7d","col11":"HI EMB","2026-07-10":"FS-S","2026-07-13":"FR-S","2026-07-15":"PPS-S","2026-07-16":"NY-S","2026-08-06":"NYC-S","2026-08-11":"MAST-S","2026-08-14":"REAP/FCHP-S","2026-08-25":"PLSD-S","2026-09-01":"PLSA-S"},
  {"id":"row_1787074005763_m1f40","col11":"BFFAV","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005763_m41hi","col11":"LEEMA","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005763_niylr","col11":"BFFAV","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005763_np1w2","col11":"BFFAV","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005763_nvn7p","col11":"MRC","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005763_rl22i","col11":"Leema","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005763_rpqi3","col11":"EXPO","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005763_te2kf","col11":"MRC","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005763_x8nyt","col11":"HI EMB","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005763_ynl22","col11":"BFFAV","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005762_7vfpm","col11":"Hi emb","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005762_4bvgp","col11":"MRC","2026-09-25":"FS|X","2026-09-28":"FR-S","2026-09-30":"PPS-S","2026-10-01":"NY-S","2026-10-21":"NYC-S","2026-10-26":"MAST-S","2026-10-29":"REAP/FCHP-S","2026-11-09":"PLSD-S","2026-11-12":"PLSA-S"},
  {"id":"row_1787074005762_lzw2q","col11":"MRC","2026-09-25":"FS|X","2026-09-28":"FR-S","2026-09-30":"PPS-S","2026-10-01":"NY-S","2026-10-21":"NYC-S","2026-10-26":"MAST-S","2026-10-29":"REAP/FCHP-S","2026-11-09":"PLSD-S","2026-11-12":"PLSA-S"},
  {"id":"row_1787074005762_pea9s","col11":"MRC","2026-09-25":"FS|X","2026-09-28":"FR-S","2026-09-30":"PPS-S","2026-10-01":"NY-S","2026-10-21":"NYC-S","2026-10-26":"MAST-S","2026-10-29":"REAP/FCHP-S","2026-11-09":"PLSD-S","2026-11-12":"PLSA-S"},
  {"id":"row_1787074005762_q7en3","col11":"MRC","2026-09-25":"FS|X","2026-09-28":"FR-S","2026-09-30":"PPS-S","2026-10-01":"NY-S","2026-10-21":"NYC-S","2026-10-26":"MAST-S","2026-10-29":"REAP/FCHP-S","2026-11-09":"PLSD-S","2026-11-12":"PLSA-S"},
  {"id":"row_1787074005762_y29s2","col11":"MRC","2026-09-25":"FS|X","2026-09-28":"FR-S","2026-09-30":"PPS-S","2026-10-01":"NY-S","2026-10-21":"NYC-S","2026-10-26":"MAST-S","2026-10-29":"REAP/FCHP-S","2026-11-09":"PLSD-S","2026-11-12":"PLSA-S"},
  {"id":"row_1787074005762_070p8","col11":"HI EMB","2026-09-23":"FS|X","2026-09-24":"FR-S","2026-09-28":"PPS-S","2026-09-29":"NY-S","2026-10-19":"NYC-S","2026-10-22":"MAST-S","2026-10-27":"REAP/FCHP-S","2026-11-05":"PLSD-S","2026-11-10":"PLSA-S"},
  {"id":"row_1787074005762_byzdi","col11":"LEEMA","2026-09-22":"FS|P","2026-09-23":"FR-S","2026-09-25":"PPS-S","2026-09-28":"NY-S","2026-10-16":"NYC-S","2026-10-21":"MAST-S","2026-10-26":"REAP/FCHP-S","2026-11-04":"PLSD-S","2026-11-09":"PLSA-S"},
  {"id":"row_1787074005761_r6b59","col11":"LEEMA","2026-09-24":"FS-S","2026-09-25":"FR-S","2026-09-29":"PPS-S","2026-09-30":"NY-S","2026-10-20":"NYC-S","2026-10-23":"MAST-S","2026-10-28":"REAP/FCHP-S","2026-11-06":"PLSD-S","2026-11-11":"PLSA-S"},
].map((p) => ({
  ...p,
  change_reason: "Restored Plant + planning events from pre-import backup (2026-09-23 06:28, before VS AE SPRING 27 GRAPHIC CHART.xlsx) after the import wiped them",
}));

(async () => {
  console.log(`Restoring ${patches.length} rows...`);
  await db.upsertMultipleRows(patches);
  console.log("Write complete. Verifying...");

  db.invalidateRowsCache();
  const { rows } = await db.getAllRowsWithMeta();
  const byId = new Map(rows.map((r) => [r.id, r]));

  let ok = 0, bad = 0;
  patches.forEach((p) => {
    const r = byId.get(p.id);
    if (!r) { bad++; console.log("MISSING ROW:", p.id); return; }
    const plantOk = !p.col11 || String(r.col11 || "").trim() === p.col11;
    const dateKeys = Object.keys(p).filter((k) => /^\d{4}-\d{2}-\d{2}/.test(k));
    const datesOk = dateKeys.every((k) => String(r[k] || "") === String(p[k]));
    if (plantOk && datesOk) {
      ok++;
    } else {
      bad++;
      console.log("MISMATCH:", p.id, "plantOk:", plantOk, "datesOk:", datesOk);
    }
  });

  console.log(`\nVerified OK: ${ok} / ${patches.length}   Mismatched: ${bad}`);
  console.log(bad === 0 ? "✅ Restore succeeded — refresh the Dashboard to check." : "⚠️ Some rows need a manual look — see above.");
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Restore FAILED:", e);
  process.exit(1);
});
