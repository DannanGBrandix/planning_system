// Client-side adaptation layer communicating with Node/Express backend API.

import { isCkFamilyCategory, ckCanonicalCategoryLabel } from "./ckCategories";

export interface EmbellishmentRow {
  id: string;
  shared_id?: string;
  version_number?: number;
  is_current?: boolean;
  change_reason?: string;
  changed_date?: string;
  [key: string]: string | number | boolean | null | undefined; // col1, col2, ... col32 + team_owner
}

export interface ColumnMapping {
  [key: string]: string; // col1: "Status", ...
}

export interface AuditLog {
  id: string;
  timestamp: string;
  styleCode: string;
  field: string;
  oldValue: string;
  newValue: string;
  userRole: string;
}

import { createSupabaseClient } from '../utils/supabase/client';

function getApiUrl(): string {
  if (typeof window !== "undefined" && window.location && window.location.hostname) {
    const protocol = window.location.protocol || "http:";
    const hostname = window.location.hostname || "127.0.0.1";
    return `${protocol}//${hostname}:5001/api`;
  }
  return "http://127.0.0.1:5001/api";
}

let cachedAuthHeader: Record<string, string> | null = null;
let lastAuthFetchTime = 0;

// Fetch the current user session and return authorization headers (cached for 60 seconds)
async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const now = Date.now();
    if (cachedAuthHeader && (now - lastAuthFetchTime < 60000)) {
      return cachedAuthHeader;
    }
    const supabase = createSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    cachedAuthHeader = session ? { Authorization: `Bearer ${session.access_token}` } : {};
    lastAuthFetchTime = now;
    return cachedAuthHeader;
  } catch (err) {
    console.warn("Failed to get session:", err);
    return cachedAuthHeader || {};
  }
}

async function apiFetch(endpoint: string, options: RequestInit = {}, retries = 2): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  
  const headers = {
    ...authHeaders,
    ...(options.headers || {})
  };

  const url = `${getApiUrl()}${endpoint}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { cache: "no-store", ...options, headers });
      if (res.ok) return res;
      if (attempt === retries) return res;
    } catch (err) {
      if (attempt === retries) throw err;
    }
    await new Promise(res => setTimeout(res, 500 * (attempt + 1))); // Exponential backoff
  }
  throw new Error("apiFetch failed after retries");
}


export function cleanSeason(season: string): string {
  if (!season) return "";
  // Strip surrounding quotes/whitespace first. The CK Tracking Charts store their SEASON column
  // as a quoted literal — every cell is the 6-char string `"SP27"` (quote marks included), which
  // otherwise slips through every rule below and gets stored verbatim, so `col4` reads `"SP27"`
  // and never matches a clean "SP27" anywhere (season filter, Trigger fallback, dedupe key…).
  let s = season.toUpperCase().trim().replace(/^["'\s]+/, "").replace(/["'\s]+$/, "");

  if (s === "N/A" || s === "NA") return "N/A";
  
  if (s.includes("MOVED FROM")) {
    s = s.replace("MOVED FROM", "").trim();
  }
  
  if (s.includes("VDAY")) {
    const yearMatch = s.match(/\d{2,4}/);
    if (yearMatch) {
       let year = yearMatch[0];
       if (year.length === 4 && year.startsWith("20")) year = year.substring(2);
       return `VDAY${year}`;
    }
    return "VDAY";
  }
  
  if (s === "FALL 2026") return "FA26";
  if (s === "FALL 2027") return "FA27";
  if (s === "SPRING 2026") return "SP26";
  if (s === "SPRING 2027") return "SP27";
  if (s === "SUMMER 2026") return "SU26";
  if (s === "SUMMER 2027") return "SU27";
  if (s === "HOLIDAY 2026") return "HO26";
  if (s === "HOLIDAY 2027") return "HO27";
  if (s === "WINTER 2026") return "WI26";
  if (s === "WINTER 2027") return "WI27";

  // Extract just the leading season token — "<letters><year>" at the start — and drop anything
  // after it. Tracking charts often cram the whole season string into one column, e.g.
  // "F26 PINK APPAREL Lounge" or "FALL 26 CHASE LA"; only the "F26" / "FALL 26" part is the
  // season. Allow a single-letter code (F26 = Fall 26) — the old check required 2+ letters, so a
  // "F26 …" value fell through and the entire brand/division/line string got stored as the season.
  const match = s.match(/^([A-Z]{1,})\s*'?\s*(\d{2,4})/);
  if (match) {
     let text = match[1];
     let year = match[2];
     if (year.length === 4 && year.startsWith("20")) {
       year = year.substring(2);
     }

     // Normalize common prefixes to the app's 2-letter form (SP27, SU27, FA26, …). Single-letter
     // codes from tracking charts are the same season: F26 == FA26, H27 == HO27, W27 == WI27.
     // "S" alone is left as-is — it's ambiguous between Spring and Summer.
     if (text === "HOLIDAY" || text === "HOL" || text === "H") text = "HO";
     else if (text === "FALL" || text === "F") text = "FA";
     else if (text === "SPRING" || text === "SPR") text = "SP";
     else if (text === "SUMMER" || text === "SUM") text = "SU";
     else if (text === "WINTER" || text === "WIN" || text === "W") text = "WI";

     return `${text}${year}`;
  }

  // No season code at the START — the chart may put the line name first. Confirmed against real
  // data: the VS CASUAL SLEEP SU27 Graphic Chart writes "Casual Sleep \r\nSU27" in SEASON on 34 of
  // its 100 rows (the rest just say "SU27"). Left as-is that whole string became col4, failed the
  // import's season guard against the existing "SU27" rows, and every one showed up as a
  // duplicate "New Record". Look for a known season token anywhere in the value instead.
  const inner = s.match(/(?:^|[^A-Z0-9])(SU|SP|FA|HO|WI|SUMMER|SPRING|FALL|HOLIDAY|WINTER)\s*'?\s*(?:20)?(\d{2})(?![0-9])/);
  if (inner) {
    const map: Record<string, string> = { SUMMER: "SU", SPRING: "SP", FALL: "FA", HOLIDAY: "HO", WINTER: "WI" };
    return `${map[inner[1]] || inner[1]}${inner[2]}`;
  }

  return s;
}

export function cleanCategory(cat: string): string {
  if (!cat) return "";
  const normalized = cat.replace(/[\r\n]+/g, " ").trim();
  const upper = normalized.toUpperCase();
  // VS Angel Essential(s) is written a dozen ways across source files — "VS AE",
  // "VS-ANGEL ESSENTIALS", "VS ANGEL ESSENTIAL", bare "ANGEL ESSENTIALS", … — collapse
  // EVERY spelling to the one canonical "VS AE" so it stays a single category everywhere
  // (dropdown, filter, row-identity matching). Compare on letters only so punctuation,
  // spacing and a trailing "S" never split it into two buckets again.
  const lettersOnly = upper.replace(/[^A-Z]/g, "");
  if (/^(VS)?(AE|ANGELESSENTIALS?)$/.test(lettersOnly)) {
    return "VS AE";
  }
  // KNIT and LOUNGE are sub-categories of PINK — merge them into a single "PINK"
  // bucket for filtering/display only. This is display-time canonicalization: it
  // does NOT rewrite the underlying stored data (a row's col3 stays "KNIT" or
  // "LOUNGE"), it only affects how rows group in the Category filter dropdown and
  // how selecting "PINK" matches rows.
  if (upper === "KNIT" || upper === "LOUNGE" || upper === "PINK KNIT" || upper === "PINK LOUNGE") {
    return "PINK";
  }
  // PINK Sport / PINK Sleep are PINK sub-lines too — "PINK-SPORT", "PINK SPORT", "Pink Sport",
  // "PINK-SLEEP", ... all collapse into the single "PINK" category.
  if (/^PINK(SPORTS?|SLEEP)$/.test(lettersOnly)) {
    return "PINK";
  }
  // VS Sleep is stored both as "VS-SLEEP" (dominant) and "VS SLEEP" — same category,
  // collapse the space/hyphen/"CASUAL SLEEP" spellings to one bucket.
  if (/^(VS[- ]?SLEEP|CASUAL ?SLEEP)$/.test(upper)) {
    return "VS-SLEEP";
  }
  // CK-family categories arrive in mixed casing from the tracking charts ("CKNA
  // MEN'S" vs "CKNA Men's"). Collapse every spelling to the one canonical label
  // so they stay a single bucket in the Category filter / dropdown and in
  // row-identity matching.
  const ckLabel = ckCanonicalCategoryLabel(normalized);
  if (ckLabel) return ckLabel;
  return normalized;
}

// ---------------------------------------------------------------------------
// Plan Status (col47) — a planning-lifecycle flag, DELIBERATELY separate from
// the S/off Status (col1) that getRowStatus() and every Advanced Analytics
// count key off. Nothing in getRowStatus / AdvancedDashboard reads col47, so
// marking planned rows "Active" here never touches the Approved / C+P /
// Pending / Dropped / approval-rate figures.
//
//   "Dropped"  — the row's S/off Status is Dropped (a real drop; on a tracking
//               chart import this also clears the row's planning events)
//   "Active"   — a plan exists / is being worked: the row has scheduled events,
//               or it's a hand-created planning row
//   ""         — allocated but not yet planned
//
// Recomputed on every read (getAllRows) and every write (saveRow /
// saveMultipleRows), so it's always consistent with no migration/backfill.
// ---------------------------------------------------------------------------
export const PLAN_STATUS_COL = "col47";

export function derivePlanStatus(row: Record<string, unknown>): string {
  const s = String(row.col1 || "").trim().toLowerCase();
  if (s === "dropped" || s === "d") return "Dropped";
  const hasEvents = Object.keys(row).some(
    (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && String(row[k] ?? "").trim() !== "",
  );
  if (hasEvents) return "Active";
  if (String(row.manual_entry ?? "") === "1") return "Active";
  return "";
}

// How the most recent getAllRows() call was served, so the UI can show it (see Header.tsx).
//   cache: "HIT" (server memory) | "MISS" (server re-read the database) | "WAIT" (shared a re-read
//   already running) | "STALE" (database unreachable — server sent its last saved copy) |
//   "ERROR" (the request failed; the caller keeps showing what it already had)
export interface RowsSyncInfo {
  ok: boolean;
  cache: string;
  at: number; // when this fetch finished (ms since epoch)
  lastGoodAt: number | null; // last time a fetch succeeded (for "showing data from …")
  error?: string;
}

let lastRowsSync: RowsSyncInfo | null = null;
export function getLastRowsSync(): RowsSyncInfo | null {
  return lastRowsSync;
}

// Fetch all rows from backend, filtered by role for team isolation.
// `fresh: true` (the "Refresh now" button) tells the server to bypass its cache and re-read the
// database; the server throttles this to once per 5 s.
// Archived (older) versions of rows — is_current = false. Never part of getAllRows (so dashboards,
// imports and matching only ever see current versions); used by the Revision History modal and by
// Plant Performance, where an older version's completed work still counts for its plant.
export async function getArchivedRows(): Promise<EmbellishmentRow[]> {
  try {
    const response = await apiFetch(`/rows-archived`);
    if (!response.ok) throw new Error(`Failed to fetch archived rows (HTTP ${response.status})`);
    const rows: EmbellishmentRow[] = await response.json();
    return rows.map((r) => {
      if (typeof r.col4 === "string") r.col4 = cleanSeason(r.col4);
      if (typeof r.col3 === "string") r.col3 = cleanCategory(r.col3);
      return { ...r, is_current: false };
    });
  } catch (err) {
    console.warn("getArchivedRows failed:", err);
    return [];
  }
}

export async function getAllRows(role?: string, opts?: { fresh?: boolean }): Promise<EmbellishmentRow[]> {
  try {
    // Build query string: teams get filtered results, privileged roles get all rows
    const params: string[] = [];
    if (role) params.push(`team=${encodeURIComponent(role)}`);
    if (opts?.fresh) params.push("fresh=1");
    const response = await apiFetch(`/rows${params.length ? `?${params.join("&")}` : ""}`);
    if (!response.ok) throw new Error(`Failed to fetch rows (HTTP ${response.status})`);

    const now = Date.now();
    lastRowsSync = { ok: true, cache: response.headers.get("X-Rows-Cache") || "?", at: now, lastGoodAt: now };
    const rows: EmbellishmentRow[] = await response.json();
    return rows.map(r => {
      if (typeof r.col4 === 'string') {
        r.col4 = cleanSeason(r.col4);
      }
      if (typeof r.col3 === 'string') {
        r.col3 = cleanCategory(r.col3);
      }
      r.col47 = derivePlanStatus(r as unknown as Record<string, unknown>);
      return r;
    });
  } catch (err) {
    console.warn("getAllRows failed:", err);
    lastRowsSync = {
      ok: false,
      cache: "ERROR",
      at: Date.now(),
      lastGoodAt: lastRowsSync?.lastGoodAt ?? null,
      error: err instanceof Error ? err.message : String(err),
    };
    return [];
  }
}

// ── Planning-event protection (server/planningEvents.js) ─────────────────────────────────────
// Planning events (date keys "2026-09-29" / "2026-09-29_LEEMA" and "_leg_<plant>" markers) are
// only ever CLEARED when the save lists them in `_event_clears`. Any other "" the server receives
// for an event that has a value — a stale full-row save, the page-load heal, an import — is refused
// and the stored event is kept. So a MANUAL action (Delete / Clear / move / replan / plant change
// in Edit) must run its outgoing row through withEventClears(next, before) to name exactly the
// events it removes. The list rides on the row as a newline-joined `__eventClears` string (client
// only — never stored, never kept in React state).
const PLANNING_EVENT_KEY_RE = /^\d{4}-\d{2}-\d{2}(_.+)?$/;
export const isPlanningEventKey = (k: string): boolean =>
  PLANNING_EVENT_KEY_RE.test(k) || k.startsWith("_leg_");

export function withEventClears<T extends EmbellishmentRow>(
  next: T,
  before: EmbellishmentRow | Record<string, unknown> | undefined | null,
): T {
  if (!before) return next;
  const prev = before as Record<string, unknown>;
  const clears = Object.keys(next).filter(
    (k) =>
      isPlanningEventKey(k) &&
      String(next[k] ?? "").trim() === "" &&
      String(prev[k] ?? "").trim() !== "",
  );
  if (clears.length === 0) return next;
  return { ...next, __eventClears: clears.join("\n") };
}

// __eventClears -> the `_event_clears` array the server reads.
const eventClearsOf = (row: EmbellishmentRow): string[] =>
  typeof row.__eventClears === "string" && row.__eventClears
    ? row.__eventClears.split("\n").filter(Boolean)
    : [];

export async function saveRow(row: EmbellishmentRow): Promise<void> {
  try {
    const rowToSave: Record<string, unknown> = {};
    Object.entries(row).forEach(([key, val]) => {
      if (!key.startsWith("__")) {
        rowToSave[key] = val;
      }
    });

    if (typeof rowToSave.col4 === 'string') {
      rowToSave.col4 = cleanSeason(rowToSave.col4);
    }
    if (typeof rowToSave.col3 === 'string') {
      rowToSave.col3 = cleanCategory(rowToSave.col3);
    }
    rowToSave.col47 = derivePlanStatus(rowToSave);
    const clears = eventClearsOf(row);
    if (clears.length) rowToSave._event_clears = clears;
    const response = await apiFetch(`/rows/${rowToSave.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rowToSave),
    });
    if (!response.ok) throw new Error("Failed to save row");
  } catch (err) {
    console.warn("saveRow failed:", err);
    throw err;
  }
}

// Bulk save/reset rows
export async function saveAllRows(rows: EmbellishmentRow[]): Promise<void> {
  try {
    const response = await apiFetch(`/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mockRows: rows }),
    });
    if (!response.ok) throw new Error("Failed to save all rows");
  } catch (err) {
    console.error("saveAllRows failed:", err);
    throw err;
  }
}

// Delete a row
export async function deleteRow(id: string): Promise<void> {
  try {
    const response = await apiFetch(`/rows/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Failed to delete row");
  } catch (err) {
    console.error("deleteRow failed:", err);
    throw err;
  }
}

// Delete multiple rows
export async function deleteMultipleRows(ids: string[]): Promise<void> {
  try {
    const response = await apiFetch(`/rows/delete-multiple`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) throw new Error("Failed to delete multiple rows");
  } catch (err) {
    console.error("deleteMultipleRows failed:", err);
    throw err;
  }
}

// Fetch audit logs
export async function getAuditLogs(): Promise<AuditLog[]> {
  try {
    const response = await apiFetch(`/audit-logs`);
    if (!response.ok) throw new Error("Failed to fetch audit logs");
    return await response.json();
  } catch (err) {
    console.error("getAuditLogs failed:", err);
    return [];
  }
}

// Save an audit log
export async function saveAuditLog(log: AuditLog): Promise<void> {
  try {
    const response = await apiFetch(`/audit-logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(log),
    });
    if (!response.ok) throw new Error("Failed to save audit log");
  } catch (err) {
    console.error("saveAuditLog failed:", err);
    throw err;
  }
}

// Save multiple audit logs
export async function saveMultipleAuditLogs(logs: AuditLog[]): Promise<void> {
  try {
    const response = await apiFetch(`/audit-logs/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logs }),
    });
    if (!response.ok) throw new Error("Failed to save multiple audit logs");
  } catch (err) {
    console.error("saveMultipleAuditLogs failed:", err);
    throw err;
  }
}

// Upsert multiple rows (bulk action with small batching and pacing delay for max reliability)
export async function saveMultipleRows(rows: EmbellishmentRow[]): Promise<void> {
  try {
    // Sanitize row payloads: only include valid DB columns (col1..col33, id, schedule, team_owner, created_at)
    const sanitizedRows = rows.map((r) => {
      const cleanObj: Record<string, unknown> = {};
      const cleanedSeason = typeof r.col4 === 'string' ? cleanSeason(r.col4) : "";
      
      const dateColumns = ["col14", "col23", "col26", "col28", "col36", "col38", "col39"];
      
      Object.entries(r).forEach(([key, val]) => {
        // Strip out only internal processing fields starting with double underscore
        if (!key.startsWith("__")) {
          let finalVal = val;
          
          // Bulletproof date fallback: if a date column accidentally contains an Excel serial like "46213"
          if (dateColumns.includes(key) && typeof val === "string" && val.trim().match(/^\d{5}(\.\d+)?$/)) {
            const numVal = Number(val.trim());
            if (numVal > 40000 && numVal < 100000) {
              const d = new Date((Math.floor(numVal) - 25569) * 86400 * 1000);
              finalVal = d.toISOString().split("T")[0];
            }
          }

          if (key === "col4") {
            cleanObj[key] = cleanedSeason;
          } else {
            cleanObj[key] = finalVal;
          }
        }
      });
      cleanObj.col47 = derivePlanStatus(cleanObj);
      const clears = eventClearsOf(r);
      if (clears.length) cleanObj._event_clears = clears;
      return cleanObj as unknown as EmbellishmentRow;
    });
    // Deduplicate by id to prevent 'ON CONFLICT DO UPDATE command cannot affect row a second time' error
    const uniqueRowsMap = new Map<string, EmbellishmentRow>();
    sanitizedRows.forEach((r) => {
      uniqueRowsMap.set(r.id, r);
    });
    const deduplicatedRows = Array.from(uniqueRowsMap.values());

    const BATCH_SIZE = 250;
    for (let i = 0; i < deduplicatedRows.length; i += BATCH_SIZE) {
      const batch = deduplicatedRows.slice(i, i + BATCH_SIZE);
      const response = await apiFetch(`/rows/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: batch }),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Batch (${i + 1}-${i + batch.length}) failed: ${errText}`);
      }
      // Pacing delay (250ms) between batches to prevent database rate limits
      if (i + BATCH_SIZE < deduplicatedRows.length) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  } catch (err) {
    console.error("saveMultipleRows failed:", err);
    throw err;
  }
}

// Clear all audit logs
export async function clearAuditLogs(): Promise<void> {
  try {
    const response = await apiFetch(`/audit-logs`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Failed to clear audit logs");
  } catch (err) {
    console.error("clearAuditLogs failed:", err);
    throw err;
  }
}

// Get active column mapping
export async function getColumns(): Promise<ColumnMapping> {
  try {
    const response = await apiFetch(`/columns`);
    if (!response.ok) throw new Error("Failed to fetch columns config");
    const fetchedCols = await response.json();
    // Merge over defaults so newly-introduced columns show up even for accounts
    // that already have an older column config saved (persisted config only
    // overrides keys it actually has; it never hides new default columns).
    const cols = { ...DEFAULT_COLUMNS, ...fetchedCols };
    if (cols && cols.col20 && (cols.col20.includes("Graphic Approval") || cols.col20.includes("GRAPHIC APPROVAL"))) {
      cols.col20 = "AOQ";
    }
    return cols;
  } catch (err) {
    console.error("getColumns failed:", err);
    return { ...DEFAULT_COLUMNS, col20: "AOQ" };
  }
}

// Save customized columns config
export async function saveColumns(cols: ColumnMapping): Promise<void> {
  try {
    const response = await apiFetch(`/columns`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cols),
    });
    if (!response.ok) throw new Error("Failed to save columns");
  } catch (err) {
    console.error("saveColumns failed:", err);
    throw err;
  }
}

// Season AOQ dates — { "<CATEGORY>|||<SEASON>": "YYYY-MM-DD" }. See triggerUtils.seasonAoqKey
// for the key format both Trigger Manager and Score Card share.
export type SeasonAoqMap = Record<string, string>;

export async function getSeasonAoqConfig(): Promise<SeasonAoqMap> {
  try {
    const res = await apiFetch(`/season-aoq`);
    if (!res.ok) throw new Error("Failed to fetch season AOQ config");
    return await res.json();
  } catch (err) {
    console.warn("getSeasonAoqConfig failed:", err);
    return {};
  }
}

export async function saveSeasonAoqConfig(map: SeasonAoqMap): Promise<void> {
  const res = await apiFetch(`/season-aoq`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(map),
  });
  if (!res.ok) throw new Error("Failed to save season AOQ config");
}

// Plant aliases — merge (aliases) or hide (excluded) plant names without touching raw
// col11/col12 row data. Applied in app/lib/plantUtils.ts via applyPlantAliasConfig.
export interface PlantAliasConfig {
  aliases: Record<string, string>;
  excluded: string[];
}

export async function getPlantAliasConfig(): Promise<PlantAliasConfig> {
  try {
    const res = await apiFetch(`/plant-aliases`);
    if (!res.ok) throw new Error("Failed to fetch plant aliases");
    const data = await res.json();
    return {
      aliases: data?.aliases && typeof data.aliases === "object" ? data.aliases : {},
      excluded: Array.isArray(data?.excluded) ? data.excluded : [],
    };
  } catch (err) {
    console.warn("getPlantAliasConfig failed:", err);
    return { aliases: {}, excluded: [] };
  }
}

export async function savePlantAliasConfig(config: PlantAliasConfig): Promise<void> {
  const res = await apiFetch(`/plant-aliases`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error("Failed to save plant aliases");
}

// Trigger catalog — planner-defined Triggers, each with its own AOQ date and the Category +
// Season it belongs to. Backs the Trigger autocomplete on col2 (Table.tsx) and the "Add Trigger"
// form on the Season AOQ Dates page (TriggerManagementView.tsx).
export interface TriggerCatalogEntry {
  id: string;
  name: string;
  category: string;
  season: string;
  aoqIso: string; // "YYYY-MM-DD"
}

export async function getTriggerCatalog(): Promise<TriggerCatalogEntry[]> {
  try {
    const res = await apiFetch(`/trigger-catalog`);
    if (!res.ok) throw new Error("Failed to fetch trigger catalog");
    const data = await res.json();
    return Array.isArray(data?.triggers) ? data.triggers : [];
  } catch (err) {
    console.warn("getTriggerCatalog failed:", err);
    return [];
  }
}

export async function saveTriggerCatalog(triggers: TriggerCatalogEntry[]): Promise<void> {
  const res = await apiFetch(`/trigger-catalog`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ triggers }),
  });
  if (!res.ok) throw new Error("Failed to save trigger catalog");
}

// Default columns mapping
export const DEFAULT_COLUMNS: ColumnMapping = {
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
  col23: "1st S/OFF & Target Send Date",
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
  // CK Tracking Chart-specific fields (see page.tsx HEADER_ALIASES for the import mapping and the
  // row-identity matching that relies on col43/col44 to stop CK rows from colliding). No schema
  // migration was needed for these — any col-number above col33 already routes through the
  // `schedule` JSONB column automatically (see server/db.js saveRow/upsertMultipleRows).
  col43: "Category Line",
  col44: "Dispatch To",
  col45: "Estimated 1st S/Off Ready Date",
  col46: "Estimated 2nd S/Off Ready Date",
  // Planning-lifecycle flag — Active / Dropped / blank. Derived (see
  // derivePlanStatus); never read by getRowStatus or Advanced Analytics.
  col47: "Plan Status",
  // Buy status — a manual per-row flag the planner sets: "Y" = has an order buy,
  // "N" (or blank) = no buy yet. Toggled from the combo drill-down cards and the
  // Edit Row modal. Like col40-col46 it needs no schema migration — any col number
  // above col33 routes through the `schedule` JSONB column automatically.
  col48: "Buy",
  // Fabric used on the 2ND submission specifically — same free-text convention as col16
  // ("Alternative Fabric"): blank = went out on the actual fabric, filled = the alternative
  // fabric reference used. Needed because col16 alone only records ONE fabric decision for the
  // whole row, but a combo commonly goes out on Alternative for the 1st submission and Actual
  // for the 2nd (or vice versa) — col16 stays the 1st submission's answer, this is the 2nd's.
  col49: "2nd Submission Fabric",
  // Free-text note for the Fabric Dispatch sheet — what is actually being sent this time
  // (e.g. body fabric already went, now sending the applique fabric). Shown on the Fabric
  // Dispatch page and in its Excel export. Routes through `schedule` JSONB like col34+.
  col50: "Fabric Dispatch Comment",
};

// Seed Mock Data in server
export async function seedDatabase(force = false): Promise<void> {
  try {
    if (!force) {
      const rows = await getAllRows();
      if (rows.length > 0) return; // Already populated
    }

    const mockRows = [
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
        col33: "Approved",
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
        "2026-07-05": "NY"
      },
      {
        id: "row_3",
        col1: "Pending",
        col2: "4.7/4.28",
        col3: "ANGEL ESSENTIALS",
        col4: "SU27",
        col5: "10356891",
        col6: "C03",
        col7: "GVU27-057",
        col8: "PFD>>SEXY LITTLE PINK(APPLIQUE: PFD)",
        col9: "SELF APPLIQUE/RUNNING STITCH/3D COLUMN STITCH",
        col10: "FABRIC CUT>>SEND FRONT PANEL",
        col11: "HI EMB/MRC",
        col12: "HI EMB>>MRC",
        col13: "FB # 22693(APPLIQUE: FB # 22693)",
        col14: "2026-07-03",
        col15: "PANEL FORM",
        col16: "FB-112",
        col17: "HIGH",
        col18: "26.Applique",
        col19: "Foil",
        col20: "Approved",
        col21: "1.EMBROIDERY",
        col22: "Awaiting components from knitting",
        col23: "2026-07-30",
        col24: "DHL-11029381",
        col25: "FRONT",
        col26: "15-Jun",
        col27: "FABRIC",
        col28: "2-Jul",
        col29: "NO",
        col30: "NO",
        col31: "NO",
        col32: "IH",
        col33: "Approved",
        "2026-07-08": "PPS-S"
      },
      {
        id: "row_4",
        col1: "Completed",
        col2: "4.7/4.28",
        col3: "ANGEL ESSENTIALS",
        col4: "SU27",
        col5: "10356891",
        col6: "C04",
        col7: "GVU27-057",
        col8: "PFD>>VELVET MORNING(APPLIQUE: PFD)",
        col9: "SELF APPLIQUE/RUNNING STITCH/3D COLUMN STITCH",
        col10: "FABRIC CUT>>SEND OUTER",
        col11: "HI EMB/MRC",
        col12: "HI EMB>>MRC",
        col13: "FB # 22693(APPLIQUE: FB # 22693)",
        col14: "2026-07-01",
        col15: "PANEL FORM",
        col16: "FB-225",
        col17: "HIGH",
        col18: "26.Applique",
        col19: "Single-color",
        col20: "Approved",
        col21: "1.EMBROIDERY",
        col22: "Perfect stitching quality.",
        col23: "2026-07-22",
        col24: "DHL-88723910",
        col25: "FRONT",
        col26: "15-Jun",
        col27: "FABRIC",
        col28: "2-Jul",
        col29: "NO",
        col30: "NO",
        col31: "NO",
        col32: "IH",
        col33: "Approved"
      },
      {
        id: "row_5",
        col1: "In Progress",
        col2: "4.7/4.28",
        col3: "ANGEL ESSENTIALS",
        col4: "SU27",
        col5: "10356889",
        col6: "C05",
        col7: "GVU27-057",
        col8: "PFD>>YELLOW DREAM(APPLIQUE: PFD)",
        col9: "SELF APPLIQUE/RUNNING STITCH/3D COLUMN STITCH",
        col10: "FABRIC CUT>>SEND FRONT PANEL",
        col11: "HI EMB/MRC",
        col12: "HI EMB>>MRC",
        col13: "FB # 22693(APPLIQUE: FB # 22693)",
        col14: "2026-07-11",
        col15: "PANEL FORM",
        col16: "FB-890",
        col17: "HIGH",
        col18: "26.Applique",
        col19: "Multi-color",
        col20: "Approved",
        col21: "1.EMBROIDERY",
        col22: "Awaiting green thread.",
        col23: "2026-07-26",
        col24: "",
        col25: "FRONT",
        col26: "15-Jun",
        col27: "FABRIC",
        col28: "2-Jul",
        col29: "NO",
        col30: "NO",
        col31: "NO",
        col32: "IH",
        col33: "Pending",
        "2026-07-06": "NY"
      }
    ];

    const response = await apiFetch(`/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mockRows }),
    });

    if (!response.ok) throw new Error("Failed to seed database");
  } catch (err) {
    console.error("seedDatabase failed:", err);
    throw err;
  }
}

export interface BackupMeta {
  id: string;
  created_at: string;
  label: string;
  reason: string; // 'import' | 'clear' | 'manual'
  row_count: number;
  created_by: string;
}

// Snapshot the given rows as a restorable backup. Used automatically right before an
// Excel import is synced and right before "Clear Database", so a bad import/wipe can be undone.
export async function createBackup(label: string, rows: EmbellishmentRow[], reason: string = "manual"): Promise<BackupMeta> {
  const response = await apiFetch(`/backups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, rows, reason }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Failed to create backup: ${errText}`);
  }
  return await response.json();
}

// List backups (metadata only — newest first)
export async function listBackups(): Promise<BackupMeta[]> {
  try {
    const response = await apiFetch(`/backups`);
    if (!response.ok) throw new Error("Failed to fetch backups");
    return await response.json();
  } catch (err) {
    console.error("listBackups failed:", err);
    return [];
  }
}

// Restore a backup by id — replaces all current rows with that snapshot
export async function restoreBackup(id: string): Promise<{ restored: number }> {
  const response = await apiFetch(`/backups/${id}/restore`, { method: "POST" });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Failed to restore backup: ${errText}`);
  }
  return await response.json();
}

// Clear all rows completely from database
export async function clearDatabase(): Promise<void> {
  try {
    const rows = await getAllRows();
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      const BATCH_SIZE = 100;
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        await deleteMultipleRows(batch);
      }
    }
  } catch (err) {
    console.error("clearDatabase failed:", err);
    throw err;
  }
}

// ============================================================
// Plant update sync (shared Google Sheet -> staging -> approve)
// ============================================================

export interface ReasonCodeRow {
  code: string;
  label: string;
  responsible: string | null;
  notes: string | null;
  deprecated: boolean;
  sort_order: number;
}

export interface EventCodeRow {
  code: string;
  label: string;
  description: string | null;
  category: string | null;
  has_pass_fail: boolean;
  recommended_reason_codes: string[];
  sort_order: number;
}

export interface PendingUpdate {
  id: string;
  source: string;
  plant: string | null;
  row_id: string;
  style: string | null;
  graphic: string | null;
  combo: string | null;
  field_key: string;
  base_code: string | null;
  old_value: string | null;
  new_value: string | null;
  result: string | null;
  reason_code: string | null;
  note: string | null;
  status: "pending" | "applied" | "rejected" | "stale";
  submitted_by: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  staleReason?: string;
}

export interface ApplyResult {
  applied: number;
  stale: PendingUpdate[];
  errors: { id: string; error: string }[];
}

export async function getReasonCodes(): Promise<ReasonCodeRow[]> {
  try {
    const res = await apiFetch(`/reason-codes`);
    if (!res.ok) throw new Error("Failed to fetch reason codes");
    return await res.json();
  } catch (err) {
    console.warn("getReasonCodes failed:", err);
    return [];
  }
}

export async function getEventCodes(): Promise<EventCodeRow[]> {
  try {
    const res = await apiFetch(`/event-codes`);
    if (!res.ok) throw new Error("Failed to fetch event codes");
    return await res.json();
  } catch (err) {
    console.warn("getEventCodes failed:", err);
    return [];
  }
}

export async function listPendingUpdates(status: string = "pending"): Promise<PendingUpdate[]> {
  try {
    const res = await apiFetch(`/plant-updates?status=${encodeURIComponent(status)}`);
    if (!res.ok) throw new Error("Failed to fetch plant updates");
    return await res.json();
  } catch (err) {
    console.warn("listPendingUpdates failed:", err);
    return [];
  }
}

export async function applyPendingUpdates(ids: string[]): Promise<ApplyResult> {
  const res = await apiFetch(`/plant-updates/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Failed to apply plant updates: ${t}`);
  }
  return await res.json();
}

export async function rejectPendingUpdates(ids: string[]): Promise<{ rejected: number }> {
  const res = await apiFetch(`/plant-updates/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Failed to reject plant updates: ${t}`);
  }
  return await res.json();
}

// ---- CK Charts sync ---------------------------------------------------------
export interface CkChartInfo {
  key: string;
  label: string;
  category: string;
  present: boolean;
  fileName?: string;
  size?: number;
  modified?: string;
  hash?: string;
  lastSyncedHash?: string | null;
  lastSyncedAt?: string | null;
  changed?: boolean;
  source?: "sharepoint" | "folder" | null;
}
export interface CkChartStatus {
  dir: string;
  dirOk: boolean;
  charts: CkChartInfo[];
  anyChanged: boolean;
  missing: string[];
  haveSharePoint?: boolean;
}

export async function getCkChartStatus(): Promise<CkChartStatus> {
  const res = await apiFetch(`/ck-charts`);
  if (!res.ok) throw new Error("Failed to read CK charts folder");
  return await res.json();
}

export interface CkFetchResult {
  fetched: string[];
  failed: { name: string; error: string }[];
  unclassified?: string[];
  needAuth: boolean;
  reason?: string;
  logs: string[];
  status: CkChartStatus;
}

// Pull the live CK workbooks straight from SharePoint into server memory (no
// files saved) using the session from `npm run ck:login`. needAuth === true
// means that session has expired and the user must re-run ck:login. After this
// resolves, run the normal CK sync — it reads the pulled workbooks from memory.
export async function fetchCkChartsFromSharePoint(): Promise<CkFetchResult> {
  const res = await apiFetch(`/ck-charts/fetch`, { method: "POST" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Failed to pull CK charts from SharePoint: ${t}`);
  }
  return await res.json();
}

export async function fetchCkChartFile(
  key: string,
): Promise<{ buffer: ArrayBuffer; fileName: string; category: string }> {
  const res = await apiFetch(`/ck-charts/file?key=${encodeURIComponent(key)}`);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Failed to fetch CK chart "${key}": ${t}`);
  }
  const buffer = await res.arrayBuffer();
  const disp = res.headers.get("Content-Disposition") || "";
  const m = disp.match(/filename="?([^"]+)"?/i);
  return {
    buffer,
    fileName: m ? m[1] : `${key}.xlsx`,
    category: res.headers.get("X-CK-Category") || "CK",
  };
}

export async function markCkChartsSynced(keys?: string[]): Promise<CkChartStatus> {
  const res = await apiFetch(`/ck-charts/mark-synced`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys: keys || null }),
  });
  if (!res.ok) throw new Error("Failed to record CK charts as synced");
  return await res.json();
}

export interface CkDedupePlan {
  ckRowCount: number;
  duplicateGroups: number;
  toDelete: { id: string; reason: string }[];
  toUpdate: { id: string; patch: Record<string, unknown> }[];
  backupIds: string[];
  groups: {
    key: string;
    total: number;
    kept: { id: string; reason: string }[];
    deleted: { id: string; lostFields: { field: string; value: string }[] }[];
    merged: { id: string; fields: string[] } | null;
  }[];
}

export async function getCkDedupePlan(): Promise<CkDedupePlan> {
  const res = await apiFetch(`/ck-charts/dedupe`);
  if (!res.ok) throw new Error("Failed to compute CK duplicate cleanup plan");
  return await res.json();
}

export async function applyCkDedupe(): Promise<{ deleted: number; updated: number; backupId: string | null }> {
  const res = await apiFetch(`/ck-charts/dedupe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apply: true }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`CK duplicate cleanup failed: ${t}`);
  }
  return (await res.json()).result;
}

// CK Tracking Chart imports carry a structured S/off Status column whose only ever values are the
// five letter codes A / D / SP / CP / H (confirmed against every 2027 chart). page.tsx's import
// translates them 1:1 into col1 as "Approved" / "Dropped" / "Pending" / "C+P" / "Hold" — a clean,
// definitive signal for every row, and the ONLY thing that decides a CK row's status. VS/PINK
// tracking charts (imported via the plain Import Excel / Planning Sheet buttons) have no such
// column, so their status has to be inferred from col20 text and freeform comments instead —
// that's the cascade below. Mixing the two together is what let stale comment text ("ALREADY
// APPROVED IN PREVIOUS SEASON") or an unrelated col20 value outrank a CK row's own S/off Status.
// Category = "CK" is the signal the CK import stamps on every row it touches, so it's used here to
// give CK rows their own direct, letter-code-only status path and leave the VS/PINK cascade
// completely untouched for everything else.
//
//   A  -> approved   ("APPROVED / C & P" per the chart legend — C&P here means "correct & proceed")
//   D  -> dropped
//   CP -> c+p         (Comments Pending)
//   H  -> hold        (Hold — CROSS DEVELOPMENT; NOT a drop, and not a live submission either)
//   SP -> pending     (Submission Pending / Submission Due / Resubmission — no separate code exists)
//
// "Reactivated" was never a chart code — it was a value the generic import-merge invented when it
// re-saw an already-Dropped row and couldn't tell the drop was authoritative (that bug is fixed in
// page.tsx). Any such legacy value still in the database means "the chart dropped this and a
// re-sync hasn't corrected col1 yet", so it maps to dropped, not pending.
const getCkRowStatus = (c1: string): 'approved' | 'dropped' | 'hold' | 'pending' | 'c+p' => {
  if (c1 === 'A' || c1 === 'APPROVED') return 'approved';
  if (c1 === 'CP' || c1 === 'C+P') return 'c+p';
  if (c1 === 'H' || c1 === 'HOLD') return 'hold';
  if (c1 === 'D' || c1 === 'DROPPED' || c1 === 'REACTIVATED') return 'dropped';
  // SP ("Pending") and anything unrecognized/blank both fall here — CK's S/off Status only ever
  // means "not yet resolved" when it isn't one of the explicit outcomes above.
  return 'pending';
};

// "Final reference" / "send final s/off" / "send for final record" all describe the SAME
// stage: NY has given its comments (C+P) and the vendor is sending the final strike-off for
// NY's records. Per the planner this is NOT an approval — the combo stays at **C+P** until a
// real approval verdict ("approved for layout/tech/ex", "confirmed") comes back. So these
// phrases do NOT feed getRowStatus's approved branch.
//
// `hasFinalStrikeReferenceOrDirective` is kept only so the page.tsx C+P auto-approve effect
// can (a) not re-flip these rows to "Approved" and (b) self-heal the ~31 rows an earlier pass
// wrongly wrote col20="Approved" onto. `FINAL_REFERENCE_RE` = a logged "Final reference"
// confirmation (forgiving of spelling: "final ref", "final-reference", "final s/off reference",
// the "refrence" typo); `FINAL_STRIKE_DIRECTIVE_RE` = the instruction "… SEND FINAL SOFF" /
// "… FOR FINAL RECORD" / "submit final strike". Checked on col22 / col34 (+ col24 for the
// confirmation, where the final DHL number lands).
const FINAL_REFERENCE_RE = /\bFINAL[\s.\-]*(?:S[\s.\-/]*O(?:FF)?[\s.\-]*)?REF/i;
const FINAL_STRIKE_DIRECTIVE_RE = /\bFINAL\s*(?:S\s*\/?\s*O\s*FF|SOFF|STRIKE|RECORDS?)\b|\bFOR\s+(?:OUR\s+)?FINAL\s+RECORDS?\b/i;
export const hasFinalStrikeReferenceOrDirective = (r: EmbellishmentRow): boolean => {
  const c22 = String(r.col22 || '');
  const c34 = String(r.col34 || '');
  const c24 = String(r.col24 || '');
  return (
    FINAL_REFERENCE_RE.test(c22) || FINAL_REFERENCE_RE.test(c34) || FINAL_REFERENCE_RE.test(c24) ||
    FINAL_STRIKE_DIRECTIVE_RE.test(c22) || FINAL_STRIKE_DIRECTIVE_RE.test(c34)
  );
};

// The ONE "final reference" case that DOES mean approved (planner, 2026-09-23): the C+P
// directive has actually been carried out — the 2nd STRIKE OFF AWB# (col24) holds a real DHL/AWB
// number AND is marked "Final Reference" (e.g. "DHL 8/25 9148951700 (NY Office) Final Referance"),
// and no 2nd Strike-Off Comment (col34) has come back with a new verdict. A bare "… & SEND FINAL
// SOFF" directive, or a "final ref" note with no second DHL, still stays C+P as above.
export const hasFinalReferenceSecondDhl = (r: EmbellishmentRow): boolean => {
  const c24 = String(r.col24 || '');
  if (String(r.col34 || '').trim()) return false;
  return FINAL_REFERENCE_RE.test(c24) && /\d{8,}/.test(c24.replace(/[\s-]/g, ''));
};

// Helper function to resolve item approval status
// Evaluated based on col20 (Strike off Aesthetic Approval / Dropped) and col1/cell colors
export const getRowStatus = (r: EmbellishmentRow): 'approved' | 'dropped' | 'hold' | 'pending' | 'resubmit' | 'c+p' => {
  const c1 = String(r.col1 || '').trim().toUpperCase();

  // Any CK-family category (legacy bare "CK", or "CKNA Men's" / "CKNA Women's" / "CKP" /
  // "Other Knit" after the Sept 2026 split) follows the S/off Status letter-code path.
  if (isCkFamilyCategory(String(r.col3 || ''))) {
    return getCkRowStatus(c1);
  }

  // Legacy safety net: the source charts' "MOVED / REALLOCATED" column means the graphic is no
  // longer being planned here — per the planner, ANY value in it is a drop. New imports set the
  // row's Status to "Dropped" outright and route the text into col20 (see page.tsx), but rows
  // imported before that change still carry the value (e.g. "REALLOCATED TO HANSOLL") in col2 —
  // treat any move/re-allocation wording there as Dropped too.
  const c2Trigger = String(r.col2 || '').trim();
  if (/re-?allocat/i.test(c2Trigger) || /\bmov(?:e|ed|ing)\b/i.test(c2Trigger)) {
    return 'dropped';
  }

  const c20 = String(r.col20 || '').trim().toUpperCase();
  const c22 = String(r.col22 || '').trim().toUpperCase();
  const c34 = String(r.col34 || '').trim().toUpperCase();

  const isExplicitResubmit = c20.includes('RESUBMIT') || c20.includes('RESUB') || c1.includes('RESUBMIT') || c1.includes('RESUB');
  
  const latestComment = c34 || c22;
  const isCommentResubmit = latestComment.includes('RESUBMIT') || latestComment.includes('RESUB');

  const isCommentDropped = /\b(dropped|drop|reallocated|moved)\b/i.test(latestComment);

  const isExplicitDropped =
    c20.includes('DROPPED') || c20.includes('DROP') || c20.includes('REALLOCATED') || /\bMOVED\b/.test(c20) ||
    c1 === 'D' || c1.includes('DROPPED') || c1.includes('DROP') || c1.includes('REALLOCATED');

  // Status (col1) is what the planner sets by hand; col20 can be stale auto-written text.
  const isStatusApproved =
    c1 === 'A' || c1 === 'C' || c1 === 'LA' || c1.includes('APPROVED') || c1.includes('CONFIRMED') || c1.includes('COMPLETED');
  const isExplicitApproved =
    c20.includes('APPROVED') || c20.includes('CONFIRMED') || isStatusApproved;

  // Approval is checked against BOTH strike-off comment columns independently, not just
  // "whichever is non-empty" (unlike the resubmit/dropped checks above, which deliberately use
  // latestComment so a newer verdict can supersede an older one). A color approval recorded on
  // the 1st Strike-Off Comment (col22) must still count once a 2nd Strike-Off Comment (col34)
  // shows up for an unrelated reason (e.g. a layout/artwork note) — it shouldn't get masked just
  // because col34 is non-empty and doesn't happen to repeat the word "approved".
  const isCommentApproved = c22.includes('APPROVED') || c34.includes('APPROVED');

  const isCommentCP = latestComment.includes('C+P') || latestComment.includes('C + P');

  const isExplicitCP = c20 === 'C+P' || c1 === 'C+P';

  // 1. Check explicitly provided status in col20 or col1 first (highest priority)
  if (isExplicitResubmit) {
    return 'resubmit';
  }
  if (isExplicitDropped || isCommentDropped) {
    return 'dropped';
  }
  // A C+P comment that only asks for the final strike-off ("… & SEND FINAL SOFF",
  // "… FOR FINAL RECORD") or notes a logged "Final reference" is still C+P, NOT approved —
  // even if a stale col20 says "Approved" (an earlier auto-approve pass wrote that; the
  // page.tsx effect now self-heals it back to "C+P"). A real approval verdict in the comment
  // ("APPROVED FOR LAYOUT/TECH/EX") still wins via isCommentApproved below.
  // A Status the planner set to Approved by hand always wins over the C+P hold below.
  if (isStatusApproved) {
    return 'approved';
  }
  if (isCommentCP && !isCommentApproved && hasFinalReferenceSecondDhl(r)) {
    return 'approved';
  }
  if (isCommentCP && !isCommentApproved && hasFinalStrikeReferenceOrDirective(r)) {
    return 'c+p';
  }
  if (isExplicitApproved || isCommentApproved) {
    return 'approved';
  }
  if (isExplicitCP || isCommentCP) {
    return 'c+p';
  }

  // 2. If main status columns are empty/don't have an explicit status, check the comments
  if (isCommentResubmit) {
    return 'resubmit';
  }

  return 'pending';
};

// Detects an "APPROVED (FOR) COLOR" sign-off inside the 1st/2nd Strike-Off Comment fields
// (col22, col34) — the optional "FOR" and "COLOUR"/"COLOR" spelling both vary across charts.
// Color approval is a later, independent step from the overall Approved status (col1/col20):
// col20 only ever flips to "Approved" once Tech & Layout is signed off, so it does NOT imply
// color has been approved too. Shared by AdvancedDashboard's approval-split metrics and the
// Reports page's Approved/Not-Approved-by-Graphic+Style exports, so both read the exact same
// two comment columns the same way.
//
// Two shapes are accepted:
//   1. "APPROVED FOR TECHNIQUE, LAYOUT & COLORS" — a forward list; the connector class
//      allows digits / "/" / "," / "&" / spaces but deliberately stops at "-" "." "+" so a
//      "C+P APPROVED - … region to make sure COLOR is to standard" note (colour still
//      pending) does NOT match.
//   2. a bare "COLOR APPROVED" / "COLORS APPROVED" line — frequently appended on its own row
//      under a comment that only signed off tech/layout (planner confirmed these count).
//      APPROVED must sit immediately after COLOR(S) so "COLOR NOT APPROVED" can't match.
const COLOR_APPROVED_RE = /(?:APPROVED|APP)\s+(?:FOR\s+)?[A-Z0-9\/,&\s]*\bCOLOU?RS?\b|\bCOLOU?RS?\s+APPROVED\b/;
export function hasColorApproval(r: EmbellishmentRow): boolean {
  const c22 = String(r.col22 || '').toUpperCase();
  const c34 = String(r.col34 || '').toUpperCase();
  return COLOR_APPROVED_RE.test(c22) || COLOR_APPROVED_RE.test(c34);
}

// Detects placement sign-off from col42 ("Placement Approval"). This column now carries the
// PINK/VS Graphic Tracking Chart's "Placment Approval Status" free text ("Approved") as well as
// the older manual ✓/✗ tick ("Y"/"N"). Like color approval, this is an independent later step —
// a combo can be Tech/Layout- and overall-Approved with placement still pending. Shared by the
// Advanced Analytics Placement Approval card so its count and drill-down list stay in sync.
export function hasPlacementApproval(r: EmbellishmentRow): boolean {
  const v = String(r.col42 || '').trim().toUpperCase();
  if (!v) return false;
  if (v === 'Y') return true;
  if (v === 'N') return false;
  return /APPROV|CONFIRM/.test(v);
}

// Buy status (col48) — "Y" = this graphic/combo has an order buy, "N" = no buy. An explicit
// Y/N always wins (the planner's toggle, or a future buy-data import). BLANK falls back to the
// colour approval: per the planner (2026-09-30), colour sign-offs so far were only taken for
// graphics that came for the buy, so until the real buy data is loaded a colour-approved row
// counts as Has Buy. Toggling it to "No Buy" writes an explicit "N" and overrides this.
export function hasBuy(r: EmbellishmentRow): boolean {
  const v = String(r.col48 || '').trim().toUpperCase();
  if (v === 'Y') return true;
  if (v === 'N') return false;
  return hasColorApproval(r);
}

// Graphic Type (col19) values the business does NOT want inflating Advanced Analytics'
// counts, charts, or tables — "branding" (logo/care-label brandings, not real graphic
// developments) and "trial" (added 2026-09-15, same reasoning: not a production graphic).
// Substring match, case-insensitive, so "TRIAL", "Trial Only", etc. all match. Every other
// view (Dashboard, Table, Action Center, ...) keeps these rows — only Advanced Analytics
// (and the DashboardStats tile that deliberately mirrors it, see below) drops them.
// "dev" (added 2026-10-06): DEV development graphics ("H27_DEV_011", "GPH27_DEV") — also caught
// by the graphic number itself (DEV_GRAPHIC_RE) so a new DEV row with a blank Graphic Type is
// excluded without anyone having to tag it first.
const ADVANCED_ANALYTICS_EXCLUDED_GRAPHIC_TYPES = ["branding", "trial", "dev"];
const DEV_GRAPHIC_RE = /(^|[^A-Z])DEV([^A-Z]|$)/i;
export function isDevGraphic(graphic: unknown): boolean {
  return DEV_GRAPHIC_RE.test(String(graphic || ""));
}
export function isExcludedFromAdvancedAnalytics(r: EmbellishmentRow): boolean {
  const graphicType = String(r.col19 || "").toLowerCase();
  return (
    ADVANCED_ANALYTICS_EXCLUDED_GRAPHIC_TYPES.some((t) => graphicType.includes(t)) ||
    isDevGraphic(r.col7)
  );
}

// col20 (Strike off Aesthetic Approval / Dropped) holds two very different kinds of content: an
// actual verdict once one exists ("Approved", "Dropped", free-text comments...), or — before
// that — just a scheduled AOQ *target* date ("2026-10-12") sitting there as a plain future
// deadline. Only the former is evidence anything actually happened; a bare date is a plan, not a
// result. Confirmed against real data: rows with a future AOQ target date, no DHL tracking, and
// no comment were counting as "sent to NY" purely because col20 wasn't blank.
function isBareAoqTargetDate(col20: string): boolean {
  const trimmed = col20.trim();
  if (!trimmed) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed);
}

// A row counts as "sent" (dispatched out of the plant) once it has any trace of leaving —
// an AWB/DHL tracking number, an aesthetic approval verdict, a strike-off comment, or an
// outright Approved/Resubmit status. RESUBMIT still counts as sent because it already went
// out once and came back needing a redo, so it belongs in Pending Approvals, not Remaining.
// col20 only counts here when it holds a real verdict, not just a bare scheduled AOQ date (see
// isBareAoqTargetDate above) — otherwise a row with nothing but a future target date gets
// wrongly counted as already sent.
// This is the single source of truth for "sent" so Total Items / DHL Sent / Remaining always
// add up the same way on every dashboard that shows them.
//
// CK-family (CKNA Men's / Women's, CKP, Other Knit): the S/off Status letter code is
// authoritative, so "sent to NY" is decided purely by it — Approved (A) or Comments Pending
// (CP, i.e. NY reviewed the strike-off and returned comments) means it went out; Submission
// Pending (SP, "Submission Due / Resubmission") means it has NOT gone out yet, even though the
// strike-off comment columns often already read "S/off ... sent to NY for approval". Hold (H)
// and Dropped (D) are not live submissions. With this rule CK reconciles as
// Sent + Submission Pending = Active Combos.
export const isRowSent = (r: EmbellishmentRow): boolean => {
  const status = getRowStatus(r);

  if (isCkFamilyCategory(String(r.col3 || ''))) {
    return status === 'approved' || status === 'c+p';
  }

  const col20 = String(r.col20 || "").trim();
  return status !== 'dropped' && (
    !!(r.col24 && String(r.col24 || "").trim()) ||
    (!!col20 && !isBareAoqTargetDate(col20)) ||
    !!(r.col22 && String(r.col22 || "").trim()) ||
    !!(r.col34 && String(r.col34 || "").trim()) ||
    status === 'approved' ||
    status === 'resubmit'
  );
};

export type GroupStatus =
  | 'approved' | 'c+p' | 'sent-pending' | 'resubmit' | 'pending' | 'hold' | 'dropped';

// VS / PINK only: has this row's strike-off physically gone out for NY review yet?
// Per the planner, the evidence is exactly three columns — a DHL/AWB tracking number
// (col24), a 1st Strike-Off Comment (col22), or a 2nd Strike-Off Comment (col34). The
// "Strike off Aesthetic Approval / Dropped" column (col20) is deliberately NOT a signal
// here: it's where the verdict (or just a bare AOQ target date) lands, not proof of
// dispatch. Until a row has one of those three, its combo is still "Submission Pending";
// once it does (but with no C+P / Approved / Dropped / Resubmit verdict yet) the combo is
// "sent-pending" (dashboard card "Comments Pending") instead. CK is excluded — its S/off
// Status letter code (SP) is authoritative and stays Submission Pending even when the
// comment columns already read "sent to NY".
export const hasStrikeOffSubmission = (r: EmbellishmentRow): boolean =>
  !!String(r.col24 || '').trim() ||
  !!String(r.col22 || '').trim() ||
  !!String(r.col34 || '').trim();

// Reduce a group of rows (one combo, or one graphic) to exactly ONE status
// bucket, so every dashboard breakdown partitions its total instead of letting
// buckets overlap. A live verdict on ANY row wins (Approved > C+P > Resubmit);
// 'dropped'/'hold' only apply when the whole group is inactive; anything
// unresolved falls through to 'pending'. This delegates entirely to
// getRowStatus, so CK rows (A/D/SP/CP/H letter codes) and VS/PINK rows (col20 +
// strike-off comment cascade) are classified by their own existing rules — this
// only decides how a multi-row group collapses to one value.
//
// Two adjacent "sent to NY, no verdict yet" buckets, kept separate so the dashboard
// can card them individually:
//   'c+p'          — a row actually carries a C+P note (col20/col1 === "C+P", or a
//                    strike-off comment says "C+P"). NY reviewed the strike-off and
//                    explicitly returned "comments pending".
//   'sent-pending' — either (a) VS/PINK with no C+P (or any other) verdict but the
//                    strike-off has physically gone out for review (hasStrikeOffSubmission
//                    on a row that ISN'T itself dropped — a DHL number or a strike-off
//                    comment), or (b) ANY CK-family group whose row status is 'c+p' —
//                    CK's "CP" letter code already means "Comments Pending", not "C+P",
//                    so it belongs here.
// "Submission Pending" ('pending') still means "not sent to NY yet". CK's SP letter code
// stays 'pending' straight from getCkRowStatus. Full "Sent"/dispatch
// (isRowSent) is a separate axis. Both buckets are active, so the partition is now
// approved + c+p + sent-pending + resubmit + pending (+ hold + dropped) = total.
//
// The hasStrikeOffSubmission check is scoped to non-dropped rows only — a combo that was
// replanned after a drop (an old leg carries a DHL number / strike-off comment from before
// it got dropped, and a fresh leg for the SAME combo is now sitting at Submission Pending
// with no evidence of its own yet) must not inherit "Comments Pending" from the dropped
// leg's stale evidence: nothing is actually outstanding with NY for that combo right now.
// Without this guard those combos also disagreed with the "NY Sent" dispatch axis
// (isRowSent, which already excludes dropped rows) — confirmed 2026-09-15 on VS AE SU27,
// where 4 such combos inflated "Comments Pending" to 41 while "NY Sent" (correctly) stayed
// at 41 too, by coincidence equal to it instead of the expected Approved+C+P+CommentsPending+Resubmit.
export const getGroupStatus = (groupRows: EmbellishmentRow[]): GroupStatus => {
  const s = groupRows.map(getRowStatus);
  const anyCk = groupRows.some((r) => isCkFamilyCategory(String(r.col3 || '')));
  if (s.some((x) => x === 'approved')) return 'approved';
  // CK has no "C+P" concept — its "CP" letter code IS "Comments Pending" (NY reviewed the
  // strike-off and returned comments). Route CK groups straight into the 'sent-pending'
  // bucket (dashboard card "Comments Pending") so the "C+P" card only ever holds VS/PINK.
  if (s.some((x) => x === 'c+p')) return anyCk ? 'sent-pending' : 'c+p';
  if (s.some((x) => x === 'resubmit')) return 'resubmit';
  if (s.length > 0 && s.every((x) => x === 'dropped')) return 'dropped';
  if (s.some((x) => x === 'hold') && s.every((x) => x === 'hold' || x === 'dropped')) return 'hold';
  if (!anyCk && groupRows.some((r) => getRowStatus(r) !== 'dropped' && hasStrikeOffSubmission(r))) {
    return 'sent-pending';
  }
  return 'pending';
};

// Group rows into combos the way the analytics dashboards count them:
// Style | Graphic | Combo | Ground (col5 | col7 | col6 | col8). Shared so the
// standard Dashboard's DashboardStats and the Advanced Analytics page produce
// the same combo counts for the same filter.
export const groupRowsByCombo = (rows: EmbellishmentRow[]): EmbellishmentRow[][] => {
  const m = new Map<string, EmbellishmentRow[]>();
  for (const r of rows) {
    const key = [r.col5, r.col7, r.col6, r.col8]
      .map((v) => String(v || "").trim())
      .join("|");
    if (key === "|||") continue;
    const bucket = m.get(key);
    if (bucket) bucket.push(r);
    else m.set(key, [r]);
  }
  return [...m.values()];
};

// Colour-approval state per combo (same Style|Graphic|Combo|Ground key as groupRowsByCombo),
// scoped to APPROVED combos only — matches Advanced Analytics' Color Approval card:
//   "colorApproved"   = Approved combo with a colour sign-off on any member row
//   "missingColor"    = Approved combo with no colour sign-off yet
// Combos that aren't Approved get no entry. Used by the Dashboard's Color Approval filter.
export type ComboColorState = "colorApproved" | "missingColor";
export const comboKeyOf = (r: EmbellishmentRow): string =>
  [r.col5, r.col7, r.col6, r.col8].map((v) => String(v || "").trim()).join("|");
export const colorApprovalByCombo = (rows: EmbellishmentRow[]): Map<string, ComboColorState> => {
  const out = new Map<string, ComboColorState>();
  for (const g of groupRowsByCombo(rows)) {
    if (getGroupStatus(g) !== "approved") continue;
    out.set(comboKeyOf(g[0]), g.some(hasColorApproval) ? "colorApproved" : "missingColor");
  }
  return out;
};

