/**
 * Seed `reason_codes` and `event_codes` in Supabase from the single source of
 * truth in `app/lib/eventCodes.ts`.
 *
 *   npm run seed:codes
 *
 * Targets whichever database `server/.env` currently points at (switch with
 * `npm run use:test` / `npm run use:prod`). Re-running is safe — it upserts on
 * `code`, so it refreshes the definitions to match the code. Run it again after
 * editing EVENT_CODES / REASON_CODES / EVENT_REASON_PRIORITY in eventCodes.ts.
 *
 * The pending_updates table is NOT touched here — create the schema first by
 * pasting server/supabase.sql into the Supabase SQL editor.
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("[seed:codes] Supabase URL/key missing from server/.env — run `npm run use:test` or `npm run use:prod` first.");
  process.exit(1);
}

// --- Load eventCodes.ts without a build step -------------------------------
// It has no imports, so a bare transpile + eval is enough.
function loadEventCodesModule() {
  const ts = require("typescript");
  const srcPath = path.resolve(__dirname, "../app/lib/eventCodes.ts");
  const source = fs.readFileSync(srcPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  });
  const mod = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", outputText)(
    mod.exports,
    require,
    mod,
    srcPath,
    path.dirname(srcPath)
  );
  return mod.exports;
}

const { EVENT_CODES, REASON_CODES, EVENT_REASON_PRIORITY } = loadEventCodesModule();

// Mirror getGroupedReasonsForEvent's code normalization.
function recommendedReasonsFor(code) {
  const norm = String(code || "").toUpperCase().split("-")[0].split("|")[0];
  const group = EVENT_REASON_PRIORITY.find((g) => g.events.includes(norm));
  return group ? group.reasonCodes : [];
}

async function run() {
  const supabase = createClient(supabaseUrl, supabaseKey);
  console.log("[seed:codes] Target:", supabaseUrl);

  const reasonRows = REASON_CODES.map((r, i) => ({
    code: r.code,
    label: r.label,
    responsible: r.responsible || null,
    notes: r.notes || null,
    deprecated: !!r.deprecated,
    sort_order: i,
  }));

  const eventRows = EVENT_CODES.map((e, i) => ({
    code: e.code,
    label: e.label,
    description: e.description || null,
    category: e.category || null,
    has_pass_fail: e.hasPassFail !== false,
    recommended_reason_codes: recommendedReasonsFor(e.code),
    sort_order: i,
  }));

  const { error: rErr } = await supabase.from("reason_codes").upsert(reasonRows, { onConflict: "code" });
  if (rErr) {
    console.error("[seed:codes] reason_codes failed:", rErr.message);
    if (/does not exist|schema cache|relation/i.test(rErr.message)) {
      console.error("  -> Paste server/supabase.sql into the Supabase SQL editor first.");
    }
    process.exit(1);
  }
  console.log(`[seed:codes] reason_codes: upserted ${reasonRows.length}`);

  const { error: eErr } = await supabase.from("event_codes").upsert(eventRows, { onConflict: "code" });
  if (eErr) {
    console.error("[seed:codes] event_codes failed:", eErr.message);
    process.exit(1);
  }
  console.log(`[seed:codes] event_codes: upserted ${eventRows.length}`);

  console.log("[seed:codes] Done.");
}

run().catch((err) => {
  console.error("[seed:codes] Unexpected error:", err);
  process.exit(1);
});
