const { createClient } = require("@supabase/supabase-js");

// Source Database (Original)
const SOURCE_URL = "https://ktgsyakzevczufcziqci.supabase.co";
const SOURCE_KEY = "sb_publishable_sd4ukbcNz0Ut6FEdxUugAA_uuhnCCHE";

// Target Database (New Test DB)
const TARGET_URL = "https://vxsfwwdcjjhsitfauyxa.supabase.co";
const TARGET_KEY = "sb_publishable_Tlo7TJBaxPe-WUAxHP9zyg_unc9W2nP";

const sourceSupabase = createClient(SOURCE_URL, SOURCE_KEY);
const targetSupabase = createClient(TARGET_URL, TARGET_KEY);

const TABLES = ["columns_config", "rows", "audit_logs", "user_roles"];
const BATCH_SIZE = 250;

async function migrateTable(tableName) {
  console.log(`\n========================================`);
  console.log(`📦 Starting migration for table: ${tableName}`);
  console.log(`========================================`);

  let offset = 0;
  let totalMigrated = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: rows, error: readError } = await sourceSupabase
      .from(tableName)
      .select("*")
      .range(offset, offset + BATCH_SIZE - 1);

    if (readError) {
      console.error(`❌ Error fetching data from source table '${tableName}':`, readError.message);
      break;
    }

    if (!rows || rows.length === 0) {
      hasMore = false;
      break;
    }

    console.log(` Fetched ${rows.length} rows (offset ${offset}) from source...`);

    const { data: upsertData, error: writeError } = await targetSupabase
      .from(tableName)
      .upsert(rows);

    if (writeError) {
      console.error(`❌ Error inserting batch into target table '${tableName}':`, writeError.message);
      if (writeError.message.includes("does not exist") || writeError.code === "42P01") {
        console.error(`\n⚠️  The target table '${tableName}' does not exist on the target database!`);
        console.error(`Please run the SQL schema script (server/supabase.sql) in your target Supabase SQL editor first.`);
        return;
      }
      break;
    }

    totalMigrated += rows.length;
    offset += rows.length;

    if (rows.length < BATCH_SIZE) {
      hasMore = false;
    }
  }

  console.log(`✅ Successfully migrated ${totalMigrated} rows for table: '${tableName}'`);
}

async function runMigration() {
  console.log("🚀 Starting Data Migration: Source -> Test Database");
  console.log("Source URL:", SOURCE_URL);
  console.log("Target URL:", TARGET_URL);

  for (const table of TABLES) {
    await migrateTable(table);
  }

  console.log("\n🎉 Migration process completed!");
}

runMigration();
