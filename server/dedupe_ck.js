// CK duplicate-row cleanup — CLI wrapper around server/ckDedupe.js.
//
//   node server/dedupe_ck.js            # dry run — prints the plan, writes nothing
//   node server/dedupe_ck.js --apply    # execute (backup -> merge -> delete)
//
// Reads the DB from server/.env — run `node server/switch_db.js test` first and
// confirm it says TESTING DATABASE before using --apply.

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const { createClient } = require("@supabase/supabase-js");
const { planDedupe, applyDedupe } = require("./ckDedupe");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_KEY ||
  process.env.SUPABASE_KEY;

const APPLY = process.argv.includes("--apply");
const IS_TEST = /vxsfwwdcjjhsitfauyxa/.test(url || "");
const sb = createClient(url, key);

(async () => {
  console.log("=".repeat(70));
  console.log(APPLY ? "CK DEDUPE — APPLY MODE" : "CK DEDUPE — DRY RUN (no writes)");
  console.log("DB:", url, IS_TEST ? "  [TESTING DATABASE]" : "  *** NOT the known test DB ***");
  console.log("=".repeat(70));

  if (APPLY && !IS_TEST) {
    console.error("\nRefusing to --apply against a DB that isn't the known test DB.");
    console.error("Run `node server/switch_db.js test` first.\n");
    process.exit(1);
  }

  const plan = await planDedupe(sb);
  console.log(`\nCK-family rows: ${plan.ckRowCount}`);
  console.log(`Duplicate groups (same identity, >1 row): ${plan.duplicateGroups}`);

  for (const g of plan.groups) {
    console.log(`\n─ ${g.key}   (${g.total} rows)`);
    g.kept.forEach((k) => console.log(`    KEEP    ${k.id}  (${k.reason})`));
    if (g.merged) console.log(`    MERGE + ${g.merged.fields.join(", ")}  -> ${g.merged.id}`);
    g.deleted.forEach((d) =>
      console.log(
        `    DELETE  ${d.id}` +
          (d.lostFields.length
            ? "   fields not on the kept row: " +
              d.lostFields.map((f) => `${f.field}=${JSON.stringify(f.value)}`).join(", ")
            : ""),
      ),
    );
  }

  console.log("\n" + "=".repeat(70));
  console.log(
    `PLAN: delete ${plan.toDelete.length} rows, merge-update ${plan.toUpdate.length} survivors, back up ${plan.backupIds.length} rows`,
  );
  console.log("=".repeat(70));

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to execute.");
    return;
  }
  const result = await applyDedupe(sb, plan);
  console.log(
    `\nDone. Deleted ${result.deleted}, updated ${result.updated}. Backup: ${result.backupId || "(none needed)"}`,
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
