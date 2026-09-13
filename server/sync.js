const { createClient } = require("@supabase/supabase-js");

// Source Database (Original)
const SOURCE_URL = "https://ktgsyakzevczufcziqci.supabase.co";
const SOURCE_KEY = "sb_publishable_sd4ukbcNz0Ut6FEdxUugAA_uuhnCCHE";

// Target Database (New Test DB)
const TARGET_URL = "https://vxsfwwdcjjhsitfauyxa.supabase.co";
const TARGET_KEY = "sb_publishable_Tlo7TJBaxPe-WUAxHP9zyg_unc9W2nP";

const sourceSupabase = createClient(SOURCE_URL, SOURCE_KEY);
const targetSupabase = createClient(TARGET_URL, TARGET_KEY);

console.log("===============================================");
console.log("⚡ Auto Database Sync Service Started");
console.log(`Source (Original): ${SOURCE_URL}`);
console.log(`Target (Test DB):  ${TARGET_URL}`);
console.log("===============================================");

// 1. Listen for Realtime Changes on Source DB and mirror them to Test DB
sourceSupabase
  .channel("realtime-rows-sync")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "rows" },
    async (payload) => {
      const rowId = payload.new?.id || payload.old?.id;
      console.log(`\n[Realtime Sync] Event '${payload.eventType}' on row ID: ${rowId}`);

      if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
        const { error } = await targetSupabase.from("rows").upsert(payload.new);
        if (error) {
          console.error("❌ Sync Error inserting/updating row:", error.message);
        } else {
          console.log(`✅ Synced updated row '${rowId}' to Test DB.`);
        }
      } else if (payload.eventType === "DELETE") {
        const { error } = await targetSupabase.from("rows").delete().eq("id", payload.old.id);
        if (error) {
          console.error("❌ Sync Error deleting row:", error.message);
        } else {
          console.log(`✅ Deleted row '${rowId}' from Test DB.`);
        }
      }
    }
  )
  .subscribe((status) => {
    console.log(`[Realtime Sync] Channel status: ${status}`);
  });

// 2. Periodic Fallback Sync (Every 5 minutes)
const FIVE_MINUTES = 5 * 60 * 1000;
setInterval(async () => {
  console.log("\n[Periodic Sync] Running scheduled check...");
  const { data: rows, error } = await sourceSupabase.from("rows").select("*");
  if (!error && rows) {
    const { error: upsertError } = await targetSupabase.from("rows").upsert(rows);
    if (upsertError) console.error("[Periodic Sync] Error:", upsertError.message);
    else console.log(`[Periodic Sync] Successfully verified and synced ${rows.length} rows.`);
  }
}, FIVE_MINUTES);
