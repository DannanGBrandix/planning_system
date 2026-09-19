// Real-column naming for the `rows` table.
//
// The app (page.tsx, Table.tsx, every util) addresses row fields as col1..col33 and keeps doing so.
// Databases created BEFORE 2026-09-19 store them under those literal names ("legacy"); databases
// created from server/supabase_named.sql store col1..col33 under readable names ("named"):
//   col3 -> category, col5 -> style, col11 -> plant, ...
// This module translates at the database boundary only, so nothing above it changes:
//   fromDb(row)  named DB row  -> app row   (category -> col3)
//   toDb(row)    app row       -> DB row    (col3 -> category)
// and both are the identity on a legacy database. col34+ and the calendar dates live inside the
// `schedule` JSONB column in either style and are NOT renamed.
//
// The style is auto-detected once per Supabase client by probing for the `category` column
// (isNamed). Set ROWS_COLUMN_STYLE=named|legacy in server/.env to skip the probe.

const NAMES = {
  col1: "status",
  col2: "trigger_name",
  col3: "category",
  col4: "season",
  col5: "style",
  col6: "graphic_combo",
  col7: "graphic",
  col8: "ground",
  col9: "techniques",
  col10: "process",
  col11: "plant",
  col12: "plant_flow",
  col13: "fabric_reference",
  col14: "fabric_in_date",
  col15: "application_form",
  col16: "alternative_fabric",
  col17: "risk_factor",
  col18: "technique_category",
  col19: "graphic_type",
  col20: "aoq",
  col21: "technique_type",
  col22: "comments",
  col23: "dispatch_deadline",
  col24: "dhl_stickoff_tracking",
  col25: "embellishment_apply_parts",
  col26: "awr",
  col27: "soff_requirement",
  col28: "ready_date_advance_plan",
  col29: "placement_sample",
  col30: "dev_trial_requirement",
  col31: "tc3010_ltd92_required",
  col32: "fabric_ih",
  col33: "approved_status",
};

const COL_BY_NAME = Object.fromEntries(Object.entries(NAMES).map(([col, name]) => [name, col]));

function renameKeys(row, map) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[map[k] || k] = v;
  return out;
}

const toDb = (row, named) => (named ? renameKeys(row, NAMES) : row);
const fromDb = (row, named) => (named ? renameKeys(row, COL_BY_NAME) : row);

// "id,col3,col5,schedule" -> "id,category,style,schedule" on a named DB.
const selectList = (columns, named) => (named ? columns.map((c) => NAMES[c] || c) : columns).join(",");

const styleByClient = new WeakMap(); // Supabase client -> Promise<boolean>

async function isNamed(client) {
  const forced = String(process.env.ROWS_COLUMN_STYLE || "").toLowerCase();
  if (forced === "named") return true;
  if (forced === "legacy") return false;

  if (!styleByClient.has(client)) {
    styleByClient.set(
      client,
      (async () => {
        const { error } = await client.from("rows").select("category").limit(1);
        if (!error) return true;
        const msg = String(error.message || "");
        if (error.code === "42703" || error.code === "PGRST204" || /category/i.test(msg)) return false; // no such column => legacy
        throw error; // table missing / network: unknown — don't cache a guess
      })().catch((err) => {
        styleByClient.delete(client);
        throw err;
      }),
    );
  }
  return styleByClient.get(client);
}

module.exports = { NAMES, COL_BY_NAME, toDb, fromDb, selectList, isNamed };
