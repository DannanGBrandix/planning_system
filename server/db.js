const { createClient } = require("@supabase/supabase-js");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Check if credentials are placeholders or empty
const isSupabaseConfigured =
  supabaseUrl &&
  supabaseUrl !== "" &&
  !supabaseUrl.includes("your-project-id") &&
  supabaseKey &&
  supabaseKey !== "" &&
  !supabaseKey.includes("your-supabase-service-role");

const rowColumns = require("./rowColumns");

let supabase = null;
let useSupabase = isSupabaseConfigured;
let dbInitialized = false;
// true when the connected database stores col1..col33 under readable names (category, style, …);
// false for legacy databases that literally have columns named col1..col33. Detected in ensureDb.
let namedColumns = false;

// Supabase has limits on single-request row counts — batch all writes
const BATCH_SIZE = 500;

if (isSupabaseConfigured) {
  console.log("[DB] Connecting to Supabase at:", supabaseUrl);
  supabase = createClient(supabaseUrl, supabaseKey);
} else {
  console.warn(
    "\n============================================================" +
    "\n[WARNING] Supabase is NOT configured in server/.env." +
    "\nFalling back to in-memory temporary database." +
    "\nAll data will be lost when the server restarts." +
    "\n============================================================\n"
  );
}

// Runs the startup checks ONCE. Requests that arrive together right after the server starts (the
// page fires several) all wait on the same in-flight check instead of each repeating it — before,
// each ran its own probe, printed its own "uses NAMED columns" line, and their first reads raced
// each other into separate Supabase refills instead of sharing one.
let dbInitPromise = null;
function ensureDb() {
  if (!useSupabase || !supabase || dbInitialized) return Promise.resolve();
  if (!dbInitPromise) dbInitPromise = initDb();
  return dbInitPromise;
}

async function initDb() {
  try {
    const { error } = await supabase.from("rows").select("id").limit(1);
    if (error && (error.code === "PGRST205" || error.message?.includes("schema cache") || error.message?.includes("relation") || error.message?.includes("does not exist"))) {
      console.warn(
        "\n============================================================" +
        "\n[WARNING] Supabase is connected, but the 'rows' table does not exist." +
        "\nPlease paste the schema script from 'server/supabase_named.sql' into the Supabase SQL Editor." +
        "\nFalling back to the in-memory temporary database." +
        "\n============================================================\n"
      );
      useSupabase = false;
    } else {
      namedColumns = await rowColumns.isNamed(supabase);
      console.log(`[DB] rows table uses ${namedColumns ? "NAMED columns (category, style, plant, …)" : "LEGACY columns (col1 … col33)"}`);
    }
  } catch (err) {
    console.error("[DB] Failed to verify Supabase tables, falling back to in-memory:", err);
    useSupabase = false;
  } finally {
    dbInitialized = true;
  }
}

// Default columns mapping
const DEFAULT_COLUMNS = {
  col1: "Status",
  col2: "Trigger",
  col3: "Category",
  col4: "Season",
  col5: "Style",
  col6: "Graphi-Combo#",
  col7: "Graphic",
  col8: "Ground",
  col9: "Technique(s)",
  col10: "Process",
  col11: "Plant",
  col12: "Plant Flow",
  col13: "Fabric Reference",
  col14: "Fabric In Date",
  col15: "Application Form",
  col16: "Alternative Fabric",
  col17: "Risk Factor",
  col18: "Technique Category",
  col19: "Graphic Type",
  col20: "AOQ",
  col21: "Technique Type",
  col22: "Comment",
  col23: "Dispach Deadline",
  col24: "DHL/Stickoff Tracking",
  col25: "Embellishment Apply Parts",
  col26: "AWR",
  col27: "S-Off Requirement",
  col28: "Ready Date (Advance Plan)",
  col29: "Placement Sample",
  col30: "Dev Trial Requirement",
  col31: "TC3010/LTD-92 Required",
  col32: "Fabric IH",
  col33: "Approved Status",
  col34: "Strike-Off Comment",
  col35: "Strike-Off Submission #",
  col36: "Artwork Date",
  col37: "Submission Status",
  col38: "Final Edit Meeting",
  col39: "Approve Date",
  col40: "Layout Approval",
  col41: "Color Approval",
  col42: "Placement Approval",
  col43: "Category Line",
  col44: "Dispatch To",
  col45: "Estimated 1st S/Off Ready Date",
  col46: "Estimated 2nd S/Off Ready Date",
  // Manual per-row Buy flag ("Y" / "N" / blank) — set from the combo drill-down cards
  // and the Edit Row modal. col34+ route through the `schedule` JSONB column automatically.
  col48: "Buy",
};

// Initial Seed Data for fallback
let inMemoryRows = [
  {
    id: "row_1",
    col1: "Completed",
    col2: "4.7/4.28",
    col3: "ANGEL ESSENTIALS",
    col4: "SU27",
    col5: "10356889",
    col6: "C02",
    col7: "GVU27-057",
    col8: "VS MED HTR GREY (APPLIQUE: VS MED HTR GREY)",
    col9: "SELF APPLIQUE/RUNNING STITCH/3D COLUMN STITCH",
    col10: "FABRIC CUT>>SEND FRONT PANEL & FUSED APPLIQUE FABRIC TO EMB>>RECEIVE>>GARMENT STITCH>>SEND TO DYE>>RECEIVE>>COMPLETE",
    col11: "HI EMB/MRC",
    col12: "HI EMB>>MRC",
    col13: "FB # 22693(APPLIQUE: FB # 22693)",
    col14: "2026-07-02",
    col15: "PANEL FORM",
    col16: "FB-890",
    col17: "LOW",
    col18: "26.Applique",
    col19: "Multi-color",
    col20: "Approved",
    col21: "1.EMBROIDERY",
    col22: "Ready for production",
    col23: "2026-07-25",
    col24: "DHL-99812732",
    col25: "FRONT",
    col26: "15-Jun",
    col27: "FABRIC",
    col28: "2-Jul",
    col29: "NO",
    col30: "NO",
    col31: "NO",
    col32: "IH",
    col33: "Active",
    team_owner: null,
    shared_id: "row_1",
    version_number: 1,
    is_current: true,
    change_reason: "",
    changed_date: "",
    "2026-07-04": "PPS-S",
    "2026-07-07": "RDPS-S"
  },
  {
    id: "row_2",
    col1: "In Progress",
    col2: "4.7/4.28",
    col3: "ANGEL ESSENTIALS",
    col4: "SU27",
    col5: "10356890",
    col6: "C02",
    col7: "GVU27-057",
    col8: "VS MED HTR GREY (APPLIQUE: VS MED HTR GREY)",
    col9: "SELF APPLIQUE/RUNNING STITCH/3D COLUMN STITCH",
    col10: "FABRIC CUT>>SEND FRONT PANEL & FUSED APPLIQUE FABRIC TO EMB>>RECEIVE>>GARMENT STITCH>>SEND TO DYE>>RECEIVE>>COMPLETE",
    col11: "HI EMB/MRC",
    col12: "HI EMB>>MRC",
    col13: "FB # 22693(APPLIQUE: FB # 22693)",
    col14: "2026-07-12",
    col15: "PANEL FORM",
    col16: "FB-915",
    col17: "LOW",
    col18: "26.Applique",
    col19: "Plastisol",
    col20: "Pending",
    col21: "1.EMBROIDERY",
    col22: "Awaiting approval of colors",
    col23: "2026-07-28",
    col24: "",
    col25: "FRONT LEFT",
    col26: "15-Jun",
    col27: "FABRIC",
    col28: "2-Jul",
    col29: "NO",
    col30: "NO",
    col31: "NO",
    col32: "IH",
    col33: "Pending",
    team_owner: null,
    shared_id: "row_2",
    version_number: 1,
    is_current: true,
    change_reason: "",
    changed_date: "",
    "2026-07-05": "NY"
  }
];

let inMemoryLogs = [];
let inMemoryColumns = { ...DEFAULT_COLUMNS };
let inMemoryBackups = [];
let inMemoryPendingUpdates = [];
let inMemorySeasonAoq = {};
let inMemoryPlantAliases = { aliases: {}, excluded: [] };
let inMemoryTriggerCatalog = [];

// Keep only the most recent N backups so storage doesn't grow forever
const MAX_BACKUPS = 20;

// ---------------------------------------------------------------------------
// Rows cache — protects the Supabase EGRESS quota.
//
// GET /api/rows used to run `select *` over the whole table (5 pages x 1000 rows, ~0.64 MB on the
// wire) on EVERY call, and the Planner's browser calls it every 15 s while the page is open —
// ~1,400 full-table downloads per working day, which alone used up the free plan's 5 GB egress
// (see docs/supabase-egress-investigation.md). Every row write in the app flows through this
// module, so the rows are kept in memory and only re-read from Supabase when
//   (a) a write happened (invalidateRowsCache, wired around every row writer at the bottom of this
//       file, plus POST /api/ck-charts/dedupe in index.js which writes via its own client), or
//   (b) the cached copy is older than ROWS_CACHE_TTL_MS — the safety net for changes made outside
//       this process (Supabase SQL editor, the CLI scripts in server/, a second server instance).
// Team filtering is applied to the cached copy, so all roles share one cached read.
// If a TTL refresh fails (Supabase down / 402 after the quota), the stale copy is served instead
// of erroring, and the refresh is retried after ROWS_CACHE_RETRY_MS.
// ---------------------------------------------------------------------------
const ROWS_CACHE_TTL_MS = Number(process.env.ROWS_CACHE_TTL_MS) || 60 * 60 * 1000;
const ROWS_CACHE_RETRY_MS = 30 * 1000;
let rowsCache = null; // { rows, at }
let rowsCacheGen = 0; // bumped on every invalidation so an in-flight read can't repopulate stale data
let rowsInflight = null; // { gen, promise } — concurrent readers share one Supabase read

// Counters so it's visible whether the cache is actually working (GET /api/rows-cache, the
// X-Rows-Cache response header, and the summary line logged every 10 minutes).
//   hits   = answered from memory                  misses = this request triggered a Supabase refill
//   waits  = joined a refill already in flight     stale  = refill failed, served the old copy
const cacheStats = {
  since: new Date().toISOString(),
  hits: 0,
  misses: 0,
  waits: 0,
  stale: 0,
  refillErrors: 0,
  invalidations: 0,
  patches: 0, // single-row writes applied to the cached copy in place (no refill needed)
  supabasePageRequests: 0,
  lastRefill: null, // { at, rows, ms }
};

// Archived versions (is_current = false) — kept OUT of the main rows read so dashboards / import
// matching never see them, but loaded on their own (tiny: a few dozen rows) for the Revision
// History modal and Plant Performance, where an older version's work still counts for its plant.
let archivedRowsCache = null; // { rows, at }

function invalidateRowsCache() {
  rowsCacheGen++;
  rowsCache = null;
  archivedRowsCache = null;
  cacheStats.invalidations++;
}

// A single-row write (saveRow / upsertMultipleRows / deleteRow / deleteMultipleRows) updates just
// those rows in the cached copy instead of dropping the whole cache — otherwise the 15 s poll right
// after every edit re-downloaded the full table (~0.64 MB per edit). `savedDbRows` are the rows as
// Supabase returned them from the write (`.select()`), so the cache holds exactly what's stored.
// Bulk jobs (import via saveAllRows, restore, clear, seed) still invalidate outright.
function patchRowsCache(savedDbRows, deletedIds) {
  // An in-flight refill may have read the table BEFORE this write — never let it land.
  rowsCacheGen++;
  cacheStats.patches++;
  // A patched row may have just become (or stopped being) an archived version.
  if ((savedDbRows || []).some((r) => r.is_current === false || r.is_current === "false") || (deletedIds || []).length) {
    archivedRowsCache = null;
  }
  if (!rowsCache) return;
  const updates = new Map();
  (savedDbRows || []).forEach((dbRow) => updates.set(dbRow.id, formatDbRow(dbRow)));
  const removed = new Set(deletedIds || []);
  const next = [];
  rowsCache.rows.forEach((r) => {
    if (removed.has(r.id)) return;
    if (updates.has(r.id)) {
      const u = updates.get(r.id);
      updates.delete(r.id);
      if (isUsableRow(u)) next.push(u);
      return;
    }
    next.push(r);
  });
  // Brand-new rows: newest first, same as the refill's created_at DESC order.
  const added = Array.from(updates.values()).filter(isUsableRow);
  rowsCache = { rows: [...added, ...next], at: rowsCache.at };
}

function getRowsCacheStats() {
  const requests = cacheStats.hits + cacheStats.misses + cacheStats.waits + cacheStats.stale;
  return {
    ...cacheStats,
    requests,
    hitRatePct: requests ? Math.round((1000 * cacheStats.hits) / requests) / 10 : null,
    cached: !!rowsCache,
    cachedRows: rowsCache ? rowsCache.rows.length : 0,
    cacheAgeSeconds: rowsCache ? Math.round((Date.now() - rowsCache.at) / 1000) : null,
    ttlSeconds: Math.round(ROWS_CACHE_TTL_MS / 1000),
    note: "Only 'misses' (and 'stale' retries) cost Supabase egress: each miss reads the whole table (~0.64 MB).",
  };
}

// One line every 10 min (only if anything happened) so the server console shows the effect.
let lastSummary = { hits: 0, misses: 0, waits: 0, stale: 0, invalidations: 0 };
setInterval(() => {
  const d = (k) => cacheStats[k] - lastSummary[k];
  if (d("hits") + d("misses") + d("waits") + d("stale") > 0) {
    console.log(
      `[DB] rows cache, last 10 min: ${d("hits")} hits, ${d("misses")} misses (=Supabase refills), ` +
        `${d("waits")} shared, ${d("stale")} stale, ${d("invalidations")} invalidations by writes`,
    );
  }
  lastSummary = { hits: cacheStats.hits, misses: cacheStats.misses, waits: cacheStats.waits, stale: cacheStats.stale, invalidations: cacheStats.invalidations };
}, 10 * 60 * 1000).unref();

// Rows the app can never use: the blank-row filter below drops them anyway, but only AFTER they've
// been downloaded. "bulk" is a stray 919 KB row (an array PUT to /api/rows/bulk once got stored
// under that id) — excluding it in the query saves that download on every cache refill.
const EXCLUDED_ROW_IDS = ["bulk"];

// Map PostgreSQL structures back: merge "schedule" JSONB values directly into row object
// (fromDb first, so a named database's `category` etc. become the app's col3 etc.)
function formatDbRow(dbRow) {
  const { schedule, created_at, ...rest } = rowColumns.fromDb(dbRow, namedColumns);
  return {
    ...rest,
    ...(schedule || {}),
  };
}

// Filter out invalid/empty rows and soft-archived rows (is_current === false)
function isUsableRow(r) {
  if (EXCLUDED_ROW_IDS.includes(r.id)) return false;
  if (r.is_current === false || r.is_current === "false") return false;
  return (
    (r.col2 || "").trim() !== "" ||
    (r.col3 || "").trim() !== "" ||
    (r.col4 || "").trim() !== "" ||
    (r.col5 || "").trim() !== "" ||
    (r.col6 || "").trim() !== "" ||
    (r.col7 || "").trim() !== "" ||
    (r.col8 || "").trim() !== "" ||
    (r.col9 || "").trim() !== "" ||
    (r.col24 || "").trim() !== ""
  );
}

async function fetchAllRowsFromSupabase() {
  const startedAt = Date.now();
  // Supabase caps single queries at 1000 rows by default.
  // We paginate in batches of 1000 until all rows are fetched.
  const PAGE_SIZE = 1000;
  let allData = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from("rows")
      .select("*")
      .or("is_current.eq.true,is_current.is.null")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    EXCLUDED_ROW_IDS.forEach((id) => {
      query = query.neq("id", id);
    });

    cacheStats.supabasePageRequests++;
    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < PAGE_SIZE) break; // Last page reached
    from += PAGE_SIZE;
  }

  const rows = allData.map(formatDbRow).filter(isUsableRow);
  const ms = Date.now() - startedAt;
  cacheStats.lastRefill = { at: new Date().toISOString(), rows: rows.length, ms };
  console.log(`[DB] rows cache MISS -> refilled from Supabase: ${rows.length} rows in ${ms} ms`);
  return rows;
}

// Resolves to { rows, outcome } where outcome is HIT | MISS | WAIT | STALE (see cacheStats above).
async function loadAllRowsCached() {
  if (rowsCache && Date.now() - rowsCache.at < ROWS_CACHE_TTL_MS) {
    cacheStats.hits++;
    return { rows: rowsCache.rows, outcome: "HIT" };
  }
  if (rowsInflight && rowsInflight.gen === rowsCacheGen) {
    cacheStats.waits++;
    const shared = await rowsInflight.promise;
    return { rows: shared.rows, outcome: shared.outcome === "STALE" ? "STALE" : "WAIT" };
  }

  const gen = rowsCacheGen;
  const promise = fetchAllRowsFromSupabase()
    .then((rows) => {
      if (gen === rowsCacheGen) rowsCache = { rows, at: Date.now() };
      cacheStats.misses++;
      return { rows, outcome: "MISS" };
    })
    .catch((err) => {
      cacheStats.refillErrors++;
      // Only fall back to the stale copy for a plain TTL expiry (rowsCache is null after a write,
      // so a read-your-writes caller still sees the error instead of pre-write data).
      if (rowsCache && gen === rowsCacheGen) {
        console.warn("[DB] rows cache STALE -> refresh failed, serving old copy:", err.message || err);
        rowsCache.at = Date.now() - ROWS_CACHE_TTL_MS + ROWS_CACHE_RETRY_MS;
        cacheStats.stale++;
        return { rows: rowsCache.rows, outcome: "STALE" };
      }
      throw err;
    })
    .finally(() => {
      if (rowsInflight && rowsInflight.promise === promise) rowsInflight = null;
    });
  rowsInflight = { gen, promise };
  return promise;
}

// Same team → category mapping the old per-query filter used (col3 ilike / team_owner is null).
function filterRowsForTeam(rows, teamOwner) {
  if (!teamOwner) return rows;
  const cat = (r) => String(r.col3 || "").toUpperCase();
  if (teamOwner.includes("Team 1") || teamOwner.includes("VS")) {
    return rows.filter((r) => cat(r).includes("VS") || cat(r).includes("ANGEL"));
  }
  if (teamOwner.includes("Team 2") || teamOwner.includes("Pink")) {
    return rows.filter((r) => cat(r).includes("PINK"));
  }
  if (teamOwner.includes("Team 3") || teamOwner.includes("CK")) {
    return rows.filter((r) => cat(r).includes("CK"));
  }
  return rows.filter((r) => r.team_owner == null || r.team_owner === teamOwner);
}

// DB abstraction methods
module.exports = {
  // Same as getAllRows, plus how the read was served: "HIT" | "MISS" | "WAIT" | "STALE"
  // ("N/A" when running on the in-memory fallback DB). Used for the X-Rows-Cache header.
  async getAllRowsWithMeta(teamOwner) {
    await ensureDb();
    if (useSupabase && supabase) {
      const { rows, outcome } = await loadAllRowsCached();
      return { rows: filterRowsForTeam(rows, teamOwner), cache: outcome };
    }
    return { rows: await module.exports.getAllRows(teamOwner), cache: "N/A" };
  },

  getRowsCacheStats,

  // Archived (is_current = false) versions only, app format. Cached like the main read; dropped on
  // any write that archives/deletes a row, and by the TTL.
  async getArchivedRows() {
    await ensureDb();
    if (!(useSupabase && supabase)) {
      return inMemoryRows.filter((r) => r.is_current === false || r.is_current === "false");
    }
    if (archivedRowsCache && Date.now() - archivedRowsCache.at < ROWS_CACHE_TTL_MS) {
      return archivedRowsCache.rows;
    }
    const all = [];
    const PAGE_SIZE = 1000;
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("rows")
        .select("*")
        .eq("is_current", false)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
    const rows = all.map(formatDbRow).filter((r) => !EXCLUDED_ROW_IDS.includes(r.id));
    archivedRowsCache = { rows, at: Date.now() };
    return rows;
  },

  // Get all planning rows, optionally filtered by team ownership
  async getAllRows(teamOwner) {
    await ensureDb();
    if (useSupabase && supabase) {
      return filterRowsForTeam((await loadAllRowsCached()).rows, teamOwner);
    } else {
      // In-memory filtering
      let result = inMemoryRows.filter((r) => r.is_current !== false && r.is_current !== "false");
      if (teamOwner) {
        if (teamOwner.includes("Team 1") || teamOwner.includes("VS")) {
          result = result.filter((r) => { const c = (r.col3||"").toUpperCase(); return c.includes("VS") || c.includes("ANGEL"); });
        } else if (teamOwner.includes("Team 2") || teamOwner.includes("Pink")) {
          result = result.filter((r) => (r.col3||"").toUpperCase().includes("PINK"));
        } else if (teamOwner.includes("Team 3") || teamOwner.includes("CK")) {
          result = result.filter((r) => (r.col3||"").toUpperCase().includes("CK"));
        } else {
          result = result.filter((r) => !r.team_owner || r.team_owner === teamOwner);
        }
      }
      return result;
    }
  },

  // Save or update a single row
  async saveRow(row) {
    await ensureDb();
    // Separate dynamic calendar date fields from structural specification columns
    const specFields = {};
    const scheduleDates = {};

    const TOP_LEVEL_KEYS = new Set(["id", "team_owner", "shared_id", "version_number", "is_current", "change_reason", "changed_date"]);

    Object.keys(row).forEach((key) => {
      // col1..col33 are real Supabase columns; col34+ stored in JSONB schedule
      if (key.startsWith("col") && !isNaN(Number(key.substring(3))) && Number(key.substring(3)) <= 33) {
        specFields[key] = row[key];
      } else if (TOP_LEVEL_KEYS.has(key)) {
        specFields[key] = row[key];
      } else {
        // col34, col35, and calendar dates all go into JSONB schedule
        scheduleDates[key] = row[key];
      }
    });

    if (useSupabase && supabase) {
      // `schedule` is a single JSONB column holding col34+ and every calendar date field, so an
      // upsert that just assigns `scheduleDates` outright REPLACES the whole thing — any
      // schedule-only field missing or stale on the caller's in-memory `row` (e.g. a background
      // pass that only meant to change col20, holding a `row` object fetched moments earlier)
      // silently reverts or wipes it. Confirmed as a real incident: a background auto-approve
      // pass that only intended to change col20 reverted col34 (2nd Strike-Off Comment) on other
      // rows back to a stale value because it saved a full row snapshot. Merge onto whatever is
      // already stored instead, so this call only ever touches the schedule keys it actually has
      // an opinion about.
      const { data: existing } = await supabase
        .from("rows")
        .select("schedule")
        .eq("id", row.id)
        .maybeSingle();
      const mergedSchedule = { ...(existing?.schedule || {}), ...scheduleDates };

      const dbRow = rowColumns.toDb({ ...specFields, schedule: mergedSchedule }, namedColumns);

      const { data: saved, error } = await supabase.from("rows").upsert(dbRow).select("*");
      if (error) throw error;
      patchRowsCache(saved);
    } else {
      const idx = inMemoryRows.findIndex((r) => r.id === row.id);
      if (idx > -1) {
        inMemoryRows[idx] = { ...row };
      } else {
        inMemoryRows.push({ ...row });
      }
    }
    return row;
  },

  // Save all rows (bulk operations)
  async saveAllRows(rows) {
    await ensureDb();
    if (useSupabase && supabase) {
      const TOP_LEVEL_KEYS = new Set(["id", "team_owner", "shared_id", "version_number", "is_current", "change_reason", "changed_date"]);
      const dbRows = rows.map((row) => {
        const specFields = {};
        const scheduleDates = {};

        Object.keys(row).forEach((key) => {
          // col1..col33 are real Supabase columns; col34+ stored in JSONB schedule
          if (key.startsWith("col") && !isNaN(Number(key.substring(3))) && Number(key.substring(3)) <= 33) {
            specFields[key] = row[key];
          } else if (TOP_LEVEL_KEYS.has(key)) {
            specFields[key] = row[key];
          } else {
            scheduleDates[key] = row[key];
          }
        });

        return rowColumns.toDb({ ...specFields, schedule: scheduleDates }, namedColumns);
      });

      // Batch the upsert to handle large imports
      for (let i = 0; i < dbRows.length; i += BATCH_SIZE) {
        const batch = dbRows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from("rows").upsert(batch);
        if (error) throw error;
      }
    } else {
      inMemoryRows = rows.map((r) => ({ ...r }));
    }
  },

  // Upsert multiple rows (used for bulk resubmit without wiping existing rows)
  async upsertMultipleRows(rows) {
    await ensureDb();
    if (useSupabase && supabase) {
      // Merge onto each row's existing `schedule` JSONB instead of replacing it outright — see
      // the identical comment in saveRow() above for why replacing wholesale silently reverts or
      // wipes any schedule-only field (col34+, calendar dates) the caller's in-memory row didn't
      // happen to carry a fresh value for. Fetch the current schedules for this batch up front so
      // each row can be merged before upserting.
      const ids = rows.map((r) => r.id).filter(Boolean);
      const existingScheduleById = new Map();
      const FETCH_BATCH = 200;
      for (let i = 0; i < ids.length; i += FETCH_BATCH) {
        const idBatch = ids.slice(i, i + FETCH_BATCH);
        const { data: existingRows, error: fetchErr } = await supabase
          .from("rows")
          .select("id, schedule")
          .in("id", idBatch);
        if (fetchErr) throw new Error(fetchErr.message || JSON.stringify(fetchErr));
        (existingRows || []).forEach((er) => existingScheduleById.set(er.id, er.schedule || {}));
      }

      const dbRows = rows.map((row) => {
        const specFields = {};
        const scheduleDates = {};

        Object.keys(row).forEach((key) => {
          const val = row[key] !== null && row[key] !== undefined ? row[key] : "";
          const strVal = typeof val === "object" ? JSON.stringify(val) : String(val);

          // col1..col33 are real Supabase columns; col34+ stored in JSONB schedule
          if (key.startsWith("col") && !isNaN(Number(key.substring(3))) && Number(key.substring(3)) <= 33) {
            specFields[key] = strVal;
          } else if (["id", "team_owner", "shared_id", "version_number", "is_current", "change_reason", "changed_date"].includes(key)) {
            specFields[key] = strVal;
          } else {
            scheduleDates[key] = strVal;
          }
        });

        const mergedSchedule = { ...(existingScheduleById.get(row.id) || {}), ...scheduleDates };

        return rowColumns.toDb({ ...specFields, schedule: mergedSchedule }, namedColumns);
      });

      // supabase-js bulk upsert sends the UNION of every object's keys as `columns`, and any row
      // missing one of those keys gets it written as NULL. Callers send PARTIAL rows (the
      // page-load heal in page.tsx sends only {id, <changed fields>}), so one row's {col11} and
      // another's {col23} in the same batch nulled each other's Plant / S-Off date — Plant blank
      // -> the heal then stripped the row's planning events. Upsert each distinct key-set as its
      // own batch so a row only ever writes the columns it actually carries.
      const groups = new Map();
      dbRows.forEach((r) => {
        const sig = Object.keys(r).sort().join(",");
        if (!groups.has(sig)) groups.set(sig, []);
        groups.get(sig).push(r);
      });
      const batches = [];
      const UPLOAD_BATCH = 25;
      groups.forEach((groupRows) => {
        for (let i = 0; i < groupRows.length; i += UPLOAD_BATCH) {
          batches.push(groupRows.slice(i, i + UPLOAD_BATCH));
        }
      });

      // Batch the upsert in small chunks of 25 with pacing to handle large datasets reliably
      const savedRows = [];
      for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        const i = b * UPLOAD_BATCH;
        const { data: saved, error } = await supabase.from("rows").upsert(batch).select("*");
        if (saved) savedRows.push(...saved);
        if (error) {
          console.error(`Error in Supabase upsert (batch ${i}-${i + batch.length}):`, error);
          throw new Error(error.message || JSON.stringify(error));
        }
        if (i + UPLOAD_BATCH < dbRows.length) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
      patchRowsCache(savedRows);
    } else {
      rows.forEach((row) => {
        const idx = inMemoryRows.findIndex((r) => r.id === row.id);
        if (idx > -1) {
          inMemoryRows[idx] = { ...row };
        } else {
          inMemoryRows.push({ ...row });
        }
      });
    }
  },

  // Delete a row
  async deleteRow(id) {
    await ensureDb();
    if (useSupabase && supabase) {
      const { error } = await supabase.from("rows").delete().eq("id", id);
      if (error) throw error;
      patchRowsCache([], [id]);
    } else {
      inMemoryRows = inMemoryRows.filter((r) => r.id !== id);
    }
  },

  // Delete multiple rows
  async deleteMultipleRows(ids) {
    await ensureDb();
    if (useSupabase && supabase) {
      const { error } = await supabase.from("rows").delete().in("id", ids);
      if (error) throw error;
      patchRowsCache([], ids);
    } else {
      inMemoryRows = inMemoryRows.filter((r) => !ids.includes(r.id));
    }
  },

  // Get audit logs
  async getAuditLogs() {
    await ensureDb();
    if (useSupabase && supabase) {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("timestamp", { ascending: false });

      if (error) throw error;
      return (data || []).map(log => ({
        id: log.id,
        timestamp: log.timestamp,
        styleCode: log.style_code,
        field: log.field,
        oldValue: log.old_value,
        newValue: log.new_value,
        userRole: log.user_role
      }));
    } else {
      return [...inMemoryLogs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
  },

  // Add an audit log
  async saveAuditLog(log) {
    await ensureDb();
    if (useSupabase && supabase) {
      const dbLog = {
        id: log.id,
        timestamp: log.timestamp,
        style_code: log.styleCode,
        field: log.field,
        old_value: log.oldValue,
        new_value: log.newValue,
        user_role: log.userRole
      };
      const { error } = await supabase.from("audit_logs").insert(dbLog);
      if (error) throw error;
    } else {
      inMemoryLogs.push({ ...log });
    }
  },

  // Add multiple audit logs (used for bulk actions)
  async saveMultipleAuditLogs(logs) {
    await ensureDb();
    if (useSupabase && supabase) {
      const dbLogs = logs.map(log => ({
        id: log.id,
        timestamp: log.timestamp,
        style_code: log.styleCode,
        field: log.field,
        old_value: log.oldValue,
        new_value: log.newValue,
        user_role: log.userRole
      }));
      const { error } = await supabase.from("audit_logs").insert(dbLogs);
      if (error) throw error;
    } else {
      inMemoryLogs.push(...logs.map(log => ({ ...log })));
    }
  },

  // Clear audit logs
  async clearAuditLogs() {
    await ensureDb();
    if (useSupabase && supabase) {
      const { error } = await supabase.from("audit_logs").delete().neq("id", "0");
      if (error) throw error;
    } else {
      inMemoryLogs = [];
    }
  },

  // Get columns configurations
  async getColumns() {
    await ensureDb();
    let cols = { ...DEFAULT_COLUMNS };
    if (useSupabase && supabase) {
      const { data, error } = await supabase
        .from("columns_config")
        .select("config")
        .eq("id", "default")
        .single();

      // Merge over defaults so newly-introduced columns show up even for a
      // deployment that already has an older column config saved (the saved
      // config only overrides keys it actually has; it never hides new ones).
      if (!error && data?.config) {
        cols = { ...DEFAULT_COLUMNS, ...data.config };
      }
    } else if (inMemoryColumns && Object.keys(inMemoryColumns).length > 0) {
      cols = { ...DEFAULT_COLUMNS, ...inMemoryColumns };
    }

    if (cols.col20 && (cols.col20.includes("Graphic Approval") || cols.col20.includes("GRAPHIC APPROVAL"))) {
      cols.col20 = "AOQ";
    }
    return cols;
  },

  // Update columns config
  async saveColumns(cols) {
    await ensureDb();
    if (useSupabase && supabase) {
      const { error } = await supabase
        .from("columns_config")
        .upsert({ id: "default", config: cols });
      if (error) throw error;
    } else {
      inMemoryColumns = { ...cols };
    }
  },

  // Season AOQ dates — { "<CATEGORY>|||<SEASON>": "YYYY-MM-DD" }. Fallback deadline used by
  // Score Card when a row's Trigger has no date of its own (col20 blank and the trigger
  // text doesn't parse as an M.D code).
  //
  // Stored as its own row (id "season_aoq") in the existing columns_config table rather than a
  // dedicated season_aoq_config table: that table's CREATE TABLE statement was added to
  // supabase.sql but never actually run against production, so every save silently no-opped
  // (PGRST205 "table not found in schema cache") while the UI looked like it worked. Reusing
  // columns_config — already present and already a generic {id, config jsonb} singleton store —
  // sidesteps needing a manual Supabase migration. See also getPlantAliases/savePlantAliases below.
  async getSeasonAoq() {
    await ensureDb();
    if (useSupabase && supabase) {
      const { data, error } = await supabase
        .from("columns_config")
        .select("config")
        .eq("id", "season_aoq")
        .single();
      if (!error && data?.config) return data.config;
      return {};
    }
    return { ...inMemorySeasonAoq };
  },

  async saveSeasonAoq(map) {
    await ensureDb();
    if (useSupabase && supabase) {
      const { error } = await supabase
        .from("columns_config")
        .upsert({ id: "season_aoq", config: map });
      if (error) throw error;
    } else {
      inMemorySeasonAoq = { ...map };
    }
  },

  // Plant aliases — { aliases: { "<RAW>": "<TARGET>" }, excluded: ["<PLANT>", ...] }. Lets a
  // planner merge two plant spellings or hide a bogus one without rewriting the raw col11/col12
  // text on every row; applied as a normalization layer in app/lib/plantUtils.ts.
  //
  // Stored as its own row (id "plant_aliases") in columns_config for the same reason as
  // getSeasonAoq above — plant_aliases_config was never actually created in production, which is
  // why the Score Card "Hide"/"Merge" buttons looked like they worked but didn't persist.
  async getPlantAliases() {
    await ensureDb();
    if (useSupabase && supabase) {
      const { data, error } = await supabase
        .from("columns_config")
        .select("config")
        .eq("id", "plant_aliases")
        .single();
      if (!error && data?.config) return data.config;
      return { aliases: {}, excluded: [] };
    }
    return {
      aliases: { ...inMemoryPlantAliases.aliases },
      excluded: [...inMemoryPlantAliases.excluded],
    };
  },

  async savePlantAliases(config) {
    await ensureDb();
    const safe = {
      aliases: config?.aliases && typeof config.aliases === "object" ? config.aliases : {},
      excluded: Array.isArray(config?.excluded) ? config.excluded : [],
    };
    if (useSupabase && supabase) {
      const { error } = await supabase
        .from("columns_config")
        .upsert({ id: "plant_aliases", config: safe });
      if (error) throw error;
    } else {
      inMemoryPlantAliases = safe;
    }
  },

  // Trigger catalog — planner-defined Triggers, each carrying its own AOQ date and the
  // Category+Season it belongs to. Lets col2 (Trigger) be picked from a known list instead of
  // freehand-typed on every row, and the picked entry's AOQ date can be applied to col20
  // automatically (see the autocomplete in app/components/Table.tsx). Stored the same way as
  // season_aoq / plant_aliases above — a row in columns_config, not its own table.
  async getTriggerCatalog() {
    await ensureDb();
    if (useSupabase && supabase) {
      const { data, error } = await supabase
        .from("columns_config")
        .select("config")
        .eq("id", "trigger_catalog")
        .single();
      if (!error && Array.isArray(data?.config?.triggers)) return data.config.triggers;
      return [];
    }
    return [...inMemoryTriggerCatalog];
  },

  async saveTriggerCatalog(triggers) {
    await ensureDb();
    const safe = Array.isArray(triggers) ? triggers : [];
    if (useSupabase && supabase) {
      const { error } = await supabase
        .from("columns_config")
        .upsert({ id: "trigger_catalog", config: { triggers: safe } });
      if (error) throw error;
    } else {
      inMemoryTriggerCatalog = safe;
    }
  },

  // Clear all and seed database
  async seedDatabase(mockRows) {
    await ensureDb();
    if (useSupabase && supabase) {
      // Clear
      const { error: delRowsErr } = await supabase.from("rows").delete().neq("id", "0");
      if (delRowsErr) throw delRowsErr;

      const { error: delLogsErr } = await supabase.from("audit_logs").delete().neq("id", "0");
      if (delLogsErr) throw delLogsErr;

      // Seed Rows
      const dbRows = mockRows.map((row) => {
        const specFields = {};
        const scheduleDates = {};

        Object.keys(row).forEach((key) => {
          // col1..col33 are real Supabase columns; col34+ stored in JSONB schedule
          if (key.startsWith("col") && !isNaN(Number(key.substring(3))) && Number(key.substring(3)) <= 33) {
            specFields[key] = row[key];
          } else if (key === "id" || key === "team_owner") {
            specFields[key] = row[key];
          } else {
            scheduleDates[key] = row[key];
          }
        });

        return rowColumns.toDb({ ...specFields, schedule: scheduleDates }, namedColumns);
      });

      // Batch the inserts to handle large CSV imports
      for (let i = 0; i < dbRows.length; i += BATCH_SIZE) {
        const batch = dbRows.slice(i, i + BATCH_SIZE);
        const { error: insErr } = await supabase.from("rows").insert(batch);
        if (insErr) throw insErr;
      }

      // Seed default column config
      const { error: colErr } = await supabase
        .from("columns_config")
        .upsert({ id: "default", config: DEFAULT_COLUMNS });
      if (colErr) throw colErr;
    } else {
      inMemoryRows = mockRows.map((r) => ({ ...r }));
      inMemoryLogs = [];
      inMemoryColumns = { ...DEFAULT_COLUMNS };
    }
  },

  // Clear all rows completely
  async clearAllRows() {
    await ensureDb();
    if (useSupabase && supabase) {
      const { error } = await supabase.from("rows").delete().neq("id", "0");
      if (error) throw error;
    } else {
      inMemoryRows = [];
    }
  },

  // Save a full snapshot of the current rows as a restorable backup.
  // `rows` is the exact array the frontend already has in memory (avoids a second fetch).
  async createBackup(label, rows, reason, createdBy) {
    await ensureDb();
    const backup = {
      id: `backup_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      created_at: new Date().toISOString(),
      label: label || "Manual backup",
      reason: reason || "manual",
      row_count: Array.isArray(rows) ? rows.length : 0,
      created_by: createdBy || "unknown",
      data: rows || [],
    };

    if (useSupabase && supabase) {
      const { error } = await supabase.from("backups").insert(backup);
      if (error) throw error;

      // Prune old backups beyond MAX_BACKUPS, oldest first
      const { data: all, error: listErr } = await supabase
        .from("backups")
        .select("id, created_at")
        .order("created_at", { ascending: false });
      if (!listErr && all && all.length > MAX_BACKUPS) {
        const idsToDelete = all.slice(MAX_BACKUPS).map((b) => b.id);
        if (idsToDelete.length > 0) {
          await supabase.from("backups").delete().in("id", idsToDelete);
        }
      }
    } else {
      inMemoryBackups.unshift(backup);
      if (inMemoryBackups.length > MAX_BACKUPS) {
        inMemoryBackups = inMemoryBackups.slice(0, MAX_BACKUPS);
      }
    }

    return { id: backup.id, created_at: backup.created_at, label: backup.label, reason: backup.reason, row_count: backup.row_count, created_by: backup.created_by };
  },

  // List backups (lightweight — no row `data` payload, just metadata)
  async listBackups() {
    await ensureDb();
    if (useSupabase && supabase) {
      const { data, error } = await supabase
        .from("backups")
        .select("id, created_at, label, reason, row_count, created_by")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    } else {
      return inMemoryBackups
        .map(({ id, created_at, label, reason, row_count, created_by }) => ({ id, created_at, label, reason, row_count, created_by }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  // Fetch one backup including its full row snapshot
  async getBackup(id) {
    await ensureDb();
    if (useSupabase && supabase) {
      const { data, error } = await supabase.from("backups").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    } else {
      return inMemoryBackups.find((b) => b.id === id) || null;
    }
  },

  // Restore a backup: replaces everything currently in `rows` with the snapshot's data.
  async restoreBackup(id) {
    await ensureDb();
    const backup = await module.exports.getBackup(id);
    if (!backup) throw new Error("Backup not found");
    const snapshotRows = backup.data || [];

    if (useSupabase && supabase) {
      const { error: delErr } = await supabase.from("rows").delete().neq("id", "0");
      if (delErr) throw delErr;

      const dbRows = snapshotRows.map((row) => {
        const specFields = {};
        const scheduleDates = {};
        Object.keys(row).forEach((key) => {
          if (key.startsWith("col") && !isNaN(Number(key.substring(3))) && Number(key.substring(3)) <= 33) {
            specFields[key] = row[key];
          } else if (["id", "team_owner", "shared_id", "version_number", "is_current", "change_reason", "changed_date"].includes(key)) {
            specFields[key] = row[key];
          } else {
            scheduleDates[key] = row[key];
          }
        });
        return rowColumns.toDb({ ...specFields, schedule: scheduleDates }, namedColumns);
      });

      for (let i = 0; i < dbRows.length; i += BATCH_SIZE) {
        const batch = dbRows.slice(i, i + BATCH_SIZE);
        const { error: insErr } = await supabase.from("rows").insert(batch);
        if (insErr) throw insErr;
      }
    } else {
      inMemoryRows = snapshotRows.map((r) => ({ ...r }));
    }

    return { restored: snapshotRows.length };
  },

  // ============================================================
  // Plant update sync: shared Google Sheet -> pending_updates -> approve in app
  // ============================================================

  // Controlled failure-reason list (seeded from app/lib/eventCodes.ts by
  // `npm run seed:codes`). Empty array on the in-memory fallback / unseeded DB —
  // the frontend falls back to its bundled constants in that case.
  async getReasonCodes() {
    await ensureDb();
    if (useSupabase && supabase) {
      const { data, error } = await supabase
        .from("reason_codes")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data || [];
    }
    return [];
  },

  async getEventCodes() {
    await ensureDb();
    if (useSupabase && supabase) {
      const { data, error } = await supabase
        .from("event_codes")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data || [];
    }
    return [];
  },

  // Admin CRUD for reason codes (see /plant-updates + admin "Reason Codes" tab).
  async upsertReasonCode(row) {
    await ensureDb();
    if (!row || !row.code) throw new Error("code is required");
    const record = {
      code: String(row.code).trim(),
      label: row.label != null ? String(row.label) : String(row.code),
      responsible: row.responsible || null,
      notes: row.notes || null,
      deprecated: !!row.deprecated,
      sort_order: Number.isFinite(row.sort_order) ? row.sort_order : 999,
    };
    if (useSupabase && supabase) {
      const { error } = await supabase.from("reason_codes").upsert(record, { onConflict: "code" });
      if (error) throw error;
    }
    return record;
  },

  async deleteReasonCode(code) {
    await ensureDb();
    if (useSupabase && supabase) {
      const { error } = await supabase.from("reason_codes").delete().eq("code", code);
      if (error) throw error;
    }
  },

  // status: 'pending' (default) | 'applied' | 'rejected' | 'stale' | 'all'
  async listPendingUpdates(status = "pending") {
    await ensureDb();
    if (useSupabase && supabase) {
      let q = supabase.from("pending_updates").select("*").order("created_at", { ascending: true });
      if (status && status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }
    let result = [...inMemoryPendingUpdates];
    if (status && status !== "all") result = result.filter((p) => p.status === status);
    return result.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  },

  // Insert/replace a single staging row. The Google Apps Script normally writes
  // straight to Supabase; this exists for manual/curl entry and the in-memory path.
  async createPendingUpdate(item) {
    await ensureDb();
    const record = {
      id: item.id || `pu_${item.row_id}_${item.field_key}`,
      source: item.source || "manual",
      plant: item.plant || null,
      row_id: item.row_id || null,
      style: item.style || null,
      graphic: item.graphic || null,
      combo: item.combo || null,
      field_key: item.field_key || null,
      base_code: item.base_code || null,
      old_value: item.old_value != null ? String(item.old_value) : null,
      new_value: item.new_value != null ? String(item.new_value) : null,
      result: item.result || null,
      reason_code: item.reason_code || null,
      note: item.note || null,
      status: "pending",
      submitted_by: item.submitted_by || null,
      created_at: new Date().toISOString(),
      reviewed_at: null,
      reviewed_by: null,
    };
    if (useSupabase && supabase) {
      const { error } = await supabase.from("pending_updates").upsert(record, { onConflict: "id" });
      if (error) throw error;
    } else {
      const idx = inMemoryPendingUpdates.findIndex((p) => p.id === record.id);
      if (idx > -1) inMemoryPendingUpdates[idx] = record;
      else inMemoryPendingUpdates.push(record);
    }
    return record;
  },

  async _setPendingStatus(id, status, userRole) {
    const patch = {
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: userRole || null,
    };
    if (useSupabase && supabase) {
      const { error } = await supabase.from("pending_updates").update(patch).eq("id", id);
      if (error) throw error;
    } else {
      const idx = inMemoryPendingUpdates.findIndex((p) => p.id === id);
      if (idx > -1) inMemoryPendingUpdates[idx] = { ...inMemoryPendingUpdates[idx], ...patch };
    }
  },

  // Apply approved staging rows into rows.schedule. Each is stale-checked against
  // the value the sheet was built from, so a planner edit in the meantime wins.
  async applyPendingUpdates(ids, userRole) {
    await ensureDb();
    const result = { applied: 0, stale: [], errors: [] };
    if (!Array.isArray(ids) || ids.length === 0) return result;

    const all = await module.exports.listPendingUpdates("all");
    const byId = new Map(all.map((p) => [p.id, p]));

    for (const id of ids) {
      const pu = byId.get(id);
      if (!pu) { result.errors.push({ id, error: "not found" }); continue; }
      if (pu.status !== "pending") { result.errors.push({ id, error: `already ${pu.status}` }); continue; }

      try {
        let currentRow = null;
        if (useSupabase && supabase) {
          const { data } = await supabase
            .from("rows")
            .select(rowColumns.selectList(["id", "col5", "schedule"], namedColumns))
            .eq("id", pu.row_id)
            .maybeSingle();
          currentRow = data ? rowColumns.fromDb(data, namedColumns) : data;
        } else {
          currentRow = inMemoryRows.find((r) => r.id === pu.row_id) || null;
        }

        if (!currentRow) {
          await module.exports._setPendingStatus(pu.id, "stale", userRole);
          result.stale.push({ ...pu, staleReason: "row not found / archived" });
          continue;
        }

        const currentVal =
          useSupabase && supabase
            ? String((currentRow.schedule || {})[pu.field_key] != null ? currentRow.schedule[pu.field_key] : "")
            : String(currentRow[pu.field_key] != null ? currentRow[pu.field_key] : "");
        const expected = String(pu.old_value != null ? pu.old_value : "");

        if (currentVal !== expected) {
          await module.exports._setPendingStatus(pu.id, "stale", userRole);
          result.stale.push({ ...pu, staleReason: `current "${currentVal}" no longer matches submitted-from "${expected}"` });
          continue;
        }

        const rowToSave =
          useSupabase && supabase
            ? { id: pu.row_id, [pu.field_key]: pu.new_value }
            : { ...currentRow, [pu.field_key]: pu.new_value };
        await module.exports.saveRow(rowToSave);

        await module.exports.saveAuditLog({
          id: `al_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          styleCode: currentRow.col5 || pu.style || "",
          field: pu.field_key,
          oldValue: expected,
          newValue: String(pu.new_value != null ? pu.new_value : ""),
          userRole: `${userRole || "Planner"} (sheet:${pu.plant || "?"})`,
        });

        await module.exports._setPendingStatus(pu.id, "applied", userRole);
        result.applied++;
        // Small pace between rows, matching upsertMultipleRows.
        await new Promise((r) => setTimeout(r, 60));
      } catch (err) {
        result.errors.push({ id, error: err.message || String(err) });
      }
    }
    return result;
  },

  async rejectPendingUpdates(ids, userRole) {
    await ensureDb();
    if (!Array.isArray(ids) || ids.length === 0) return { rejected: 0 };
    let rejected = 0;
    for (const id of ids) {
      await module.exports._setPendingStatus(id, "rejected", userRole);
      rejected++;
    }
    return { rejected };
  }
};

// Every function that changes the `rows` table drops the rows cache once it finishes — in a
// `finally`, so a half-applied bulk write (some batches landed, then one failed) is also picked up
// by the next read. Wrapped here rather than inside each writer so no write path can forget it.
// (Writers that go through this module's own methods, e.g. applyPendingUpdates -> saveRow, are
// covered too; anything that writes with its own client must call invalidateRowsCache itself.)
//
// saveRow / upsertMultipleRows / deleteRow / deleteMultipleRows patch the cached rows themselves on
// success (patchRowsCache) and only drop the cache when they FAIL (a half-applied write).
// applyPendingUpdates writes through saveRow, so it's covered by those patches.
["saveAllRows", "seedDatabase", "clearAllRows", "restoreBackup"].forEach((name) => {
  const original = module.exports[name];
  module.exports[name] = async function (...args) {
    try {
      return await original.apply(this, args);
    } finally {
      invalidateRowsCache();
    }
  };
});
["saveRow", "upsertMultipleRows", "deleteRow", "deleteMultipleRows"].forEach((name) => {
  const original = module.exports[name];
  module.exports[name] = async function (...args) {
    try {
      return await original.apply(this, args);
    } catch (err) {
      invalidateRowsCache();
      throw err;
    }
  };
});
module.exports.invalidateRowsCache = invalidateRowsCache;
