#!/usr/bin/env node
// One-time (re-runnable) copy of every planning event from rows.schedule into planning_events.
//
//   npm run events:backfill              # dry run: counts only, writes nothing
//   npm run events:backfill -- --apply   # writes to the ACTIVE database (server/.env)
//
// Run server/sql/planning_events.sql in the Supabase SQL editor first.
// - Only ADDS events the table doesn't have yet; an event already in the table (active or cleared)
//   is left exactly as it is, so re-running is safe.
// - Each event is stamped with the plant it belongs to: the leg name for "<date>_<LEG>" / "_leg_<LEG>"
//   keys, otherwise the row's Plant (col11). Rows with a blank Plant get plant = NULL and are listed.
// - Covers current AND archived (is_current = false) rows.
// - Refuses to write to the production project unless --allow-prod is given.

const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const rowColumns = require("./rowColumns");
const planningEvents = require("./planningEvents");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const URL_ = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const PROD_REFS = ["dxppkrlwsrbeiakvjtcg", "ktgsyakzevczufcziqci"];

if (!URL_ || !KEY) {
  console.error("No database configured in server/.env");
  process.exit(2);
}
const ref = (URL_.match(/https:\/\/([^.]+)\./) || [])[1] || "";
if (APPLY && PROD_REFS.includes(ref) && !args.includes("--allow-prod")) {
  console.error(`Refusing to write to PRODUCTION (${ref}). Switch to test (npm run use:test) or pass --allow-prod.`);
  process.exit(2);
}

const sb = createClient(URL_, KEY);
const str = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

(async () => {
  console.log(`Database: ${ref}  mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
  const named = await rowColumns.isNamed(sb);

  const { error: probeErr } = await sb.from("planning_events").select("row_id").limit(1);
  if (probeErr) {
    console.error("planning_events table not found — run server/sql/planning_events.sql first.", probeErr.message);
    process.exit(2);
  }

  // Every row (current + archived).
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("rows")
      .select(rowColumns.selectList(["id", "col11", "is_current", "schedule"], named))
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []).map((d) => rowColumns.fromDb(d, named)));
    if (!data || data.length < 1000) break;
  }

  // Every event key already in the table (active or cleared) — never touched.
  const known = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("planning_events")
      .select("row_id,event_key")
      .order("row_id", { ascending: true })
      .order("event_key", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    (data || []).forEach((e) => known.add(`${e.row_id}\u0000${e.event_key}`));
    if (!data || data.length < 1000) break;
  }

  const now = new Date().toISOString();
  const records = [];
  const blankPlantRows = [];
  let already = 0;
  rows.forEach((r) => {
    const plant = str(r.col11).trim() || null;
    let rowEvents = 0;
    Object.entries(r.schedule || {}).forEach(([k, v]) => {
      if (!planningEvents.isEventKey(k) || str(v).trim() === "") return;
      rowEvents++;
      if (known.has(`${r.id}\u0000${k}`)) { already++; return; }
      const { event_date, leg } = planningEvents.parseKey(k);
      records.push({
        row_id: r.id, event_key: k, event_date, leg, value: str(v), plant: leg || plant,
        source: "backfill", created_at: now, updated_at: now, deleted_at: null, deleted_source: null,
      });
    });
    if (rowEvents && !plant) blankPlantRows.push(r.id);
  });

  console.log(`rows scanned: ${rows.length}`);
  console.log(`events to add: ${records.length}   already in table: ${already}`);
  console.log(`rows with events but a blank Plant: ${blankPlantRows.length}${blankPlantRows.length ? " -> " + blankPlantRows.slice(0, 30).join(", ") : ""}`);
  if (!APPLY) {
    console.log("Dry run — nothing written. Re-run with --apply to write.");
    return;
  }

  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { error } = await sb.from("planning_events").upsert(batch, { onConflict: "row_id,event_key", ignoreDuplicates: true });
    if (error) throw error;
    process.stdout.write(`\rwritten ${Math.min(i + 500, records.length)}/${records.length}`);
  }
  if (records.length) process.stdout.write("\n");

  const { count, error: cntErr } = await sb
    .from("planning_events")
    .select("row_id", { count: "exact", head: true })
    .is("deleted_at", null);
  if (cntErr) throw cntErr;
  console.log(`done. active events in planning_events: ${count}`);
})().catch((err) => {
  console.error("Backfill failed:", err.message || err);
  process.exit(1);
});
