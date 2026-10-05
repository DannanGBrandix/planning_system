// Planning events in their own table (planning_events + planning_events_history,
// server/sql/planning_events.sql). See docs/planning-events-table.md.
//
// rows.schedule (JSONB) still carries a mirror copy of every event, so the app, the Google Sheet and
// the exports keep reading it as before. This module adds the protection around it:
//
//   1. An event is only CLEARED when the save says so explicitly: the app lists the keys a manual
//      action (Delete / Clear / move / plant change in Edit) blanks in `_event_clears`. Any other
//      "" for an event that currently has a value is REFUSED — the key is dropped from the write, so
//      the stored event stays — and logged as 'refused-clear'. Import, page-load heals, bulk jobs and
//      stale full-row saves can therefore never wipe a plan.
//   2. Clears are soft (deleted_at) and every change goes to planning_events_history.
//   3. Each event stores the plant it was planned for, so a blank Plant column can't lose it.
//   4. On read, an active event missing from a row's JSON (wiped by a writer outside this server —
//      SQL editor, a script, a bug) is filled back in. The table never overrides a value the JSON
//      has; it only fills gaps.
//
// Everything is fail-open: if the table is missing (e.g. PROD before the SQL was run) the module
// switches itself off and the server behaves exactly as before; a failed table write is logged and
// the row save still goes through.

const EVENT_DATE_KEY_RE = /^(\d{4}-\d{2}-\d{2})(?:_(.+))?$/;
const LEG_MARKER_PREFIX = "_leg_";
const PAGE_SIZE = 1000;
const WRITE_BATCH = 500;
const IN_BATCH = 200;

let enabled = false;
let probed = null; // Promise<boolean>

const isEventKey = (k) => EVENT_DATE_KEY_RE.test(k) || String(k).startsWith(LEG_MARKER_PREFIX);

// A key can look like a date but not be one ("2026-23-07" exists in real data) — keep the event,
// just leave event_date NULL so the DATE column doesn't reject the whole write.
function validIsoDate(s) {
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

function parseKey(k) {
  const m = EVENT_DATE_KEY_RE.exec(k);
  if (m) return { event_date: validIsoDate(m[1]), leg: m[2] || null };
  if (String(k).startsWith(LEG_MARKER_PREFIX)) return { event_date: null, leg: k.slice(LEG_MARKER_PREFIX.length) || null };
  return { event_date: null, leg: null };
}

const str = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const isBlank = (v) => str(v).trim() === "";

async function init(supabase) {
  if (String(process.env.PLANNING_EVENTS || "").toLowerCase() === "off") {
    console.log("[EVENTS] planning_events table disabled by PLANNING_EVENTS=off");
    enabled = false;
    return false;
  }
  if (!probed) {
    probed = (async () => {
      const { error } = await supabase.from("planning_events").select("row_id").limit(1);
      if (error) {
        console.warn(
          "[EVENTS] planning_events table not found — event protection is OFF on this database. " +
            "Run server/sql/planning_events.sql in the Supabase SQL editor, then `npm run events:backfill`.",
        );
        return false;
      }
      console.log("[EVENTS] planning_events table found — event protection is ON");
      return true;
    })().catch((err) => {
      console.warn("[EVENTS] probe failed, event protection OFF:", err.message || err);
      probed = null;
      return false;
    });
  }
  enabled = await probed;
  return enabled;
}

const isEnabled = () => enabled;

// Active events -> Map<row_id, Map<event_key, { value, plant }>>. rowIds = null loads everything.
async function loadActive(supabase, rowIds) {
  const out = new Map();
  const add = (data) =>
    (data || []).forEach((e) => {
      if (!out.has(e.row_id)) out.set(e.row_id, new Map());
      out.get(e.row_id).set(e.event_key, { value: e.value, plant: e.plant });
    });

  const pageThrough = async (applyFilter) => {
    for (let from = 0; ; from += PAGE_SIZE) {
      let q = supabase
        .from("planning_events")
        .select("row_id,event_key,value,plant")
        .is("deleted_at", null)
        .order("row_id", { ascending: true })
        .order("event_key", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      q = applyFilter(q);
      const { data, error } = await q;
      if (error) throw error;
      add(data);
      if (!data || data.length < PAGE_SIZE) break;
    }
  };

  if (rowIds === null) {
    await pageThrough((q) => q);
  } else {
    const ids = [...new Set(rowIds.filter(Boolean))];
    for (let i = 0; i < ids.length; i += IN_BATCH) {
      const chunk = ids.slice(i, i + IN_BATCH);
      await pageThrough((q) => q.in("row_id", chunk));
    }
  }
  return out;
}

async function writeBatches(supabase, table, records, opts) {
  for (let i = 0; i < records.length; i += WRITE_BATCH) {
    const batch = records.slice(i, i + WRITE_BATCH);
    const { error } = opts?.upsert
      ? await supabase.from(table).upsert(batch, { onConflict: "row_id,event_key" })
      : await supabase.from(table).insert(batch);
    if (error) throw error;
  }
}

// The heart of the protection. `rows` are app-format rows about to be saved (colN + event keys +
// optional `_event_clears`), `existingById` is Map<id, { col11, schedule }> of what's stored now.
// MUTATES each row: strips `_event_clears` and deletes every refused "" key, so the caller's JSON
// merge keeps the stored value. Returns Map<id, Map<event_key, { value, plant }>> of the row's active events
// after the save (used to keep the rows cache consistent).
async function guardRows(supabase, rows, existingById, source) {
  const clearsById = new Map();
  rows.forEach((r) => {
    const list = Array.isArray(r._event_clears) ? r._event_clears.map(String) : [];
    clearsById.set(r.id, new Set(list));
    delete r._event_clears;
  });
  if (!enabled) {
    // Even without the table, keep the no-silent-clear rule on the JSON itself.
    rows.forEach((r) => {
      const stored = existingById.get(r.id)?.schedule || {};
      const clears = clearsById.get(r.id);
      Object.keys(r).forEach((k) => {
        if (isEventKey(k) && isBlank(r[k]) && !isBlank(stored[k]) && !clears.has(k)) {
          console.warn(`[EVENTS] refused auto-clear of ${r.id} ${k}="${str(stored[k])}" (${source})`);
          delete r[k];
        }
      });
    });
    return new Map();
  }

  let active;
  try {
    active = await loadActive(supabase, rows.map((r) => r.id));
  } catch (err) {
    console.error("[EVENTS] could not read planning_events, guarding on the JSON only:", err.message || err);
    active = new Map();
  }

  const now = new Date().toISOString();
  const upserts = [];
  const history = [];
  const activeAfter = new Map();
  let refused = 0;

  rows.forEach((r) => {
    const stored = existingById.get(r.id) || {};
    const storedSchedule = stored.schedule || {};
    const rowActive = active.get(r.id) || new Map();
    const clears = clearsById.get(r.id);
    const plant = !isBlank(r.col11) ? str(r.col11).trim() : !isBlank(stored.col11) ? str(stored.col11).trim() : null;
    const after = new Map(rowActive);

    Object.keys(r).forEach((k) => {
      if (!isEventKey(k)) return;
      const incoming = str(r[k]);
      const tableCur = rowActive.get(k);
      const current = tableCur ? tableCur.value : !isBlank(storedSchedule[k]) ? str(storedSchedule[k]) : null;
      const { event_date, leg } = parseKey(k);
      const eventPlant = leg || plant;

      if (!isBlank(incoming)) {
        after.set(k, { value: incoming, plant: tableCur?.plant || eventPlant });
        if (current === incoming && tableCur) return; // unchanged
        upserts.push({
          row_id: r.id, event_key: k, event_date, leg, value: incoming,
          plant: tableCur && current === incoming ? tableCur.plant || eventPlant : eventPlant,
          source, updated_at: now, deleted_at: null, deleted_source: null,
        });
        if (current !== incoming) {
          history.push({ row_id: r.id, event_key: k, action: "set", old_value: current, new_value: incoming, plant: eventPlant, source, at: now });
        }
        return;
      }

      // incoming is blank
      if (current === null) return; // nothing stored — plain no-op
      if (clears.has(k)) {
        after.delete(k);
        upserts.push({
          row_id: r.id, event_key: k, event_date, leg, value: current,
          plant: tableCur?.plant || eventPlant, source, updated_at: now,
          deleted_at: now, deleted_source: source,
        });
        history.push({ row_id: r.id, event_key: k, action: "clear", old_value: current, new_value: "", plant: tableCur?.plant || eventPlant, source, at: now });
        return;
      }
      // Not an explicit manual clear -> refuse: keep the stored event.
      refused++;
      delete r[k];
      history.push({ row_id: r.id, event_key: k, action: "refused-clear", old_value: current, new_value: "", plant: tableCur?.plant || eventPlant, source, at: now });
    });
    activeAfter.set(r.id, after);
  });

  if (refused) console.warn(`[EVENTS] refused ${refused} non-manual event clear(s) (${source})`);

  try {
    await writeBatches(supabase, "planning_events", upserts, { upsert: true });
    await writeBatches(supabase, "planning_events_history", history);
  } catch (err) {
    console.error("[EVENTS] planning_events write failed (row save continues):", err.message || err);
  }
  return activeAfter;
}

// Rows deleted from `rows`: soft-delete their events (restorable from the table/history).
async function softDeleteRows(supabase, rowIds, source) {
  if (!enabled || !rowIds.length) return;
  try {
    const active = await loadActive(supabase, rowIds);
    const now = new Date().toISOString();
    const history = [];
    active.forEach((events, rowId) =>
      events.forEach((e, k) =>
        history.push({ row_id: rowId, event_key: k, action: "row-deleted", old_value: e.value, new_value: "", plant: e.plant, source, at: now }),
      ),
    );
    for (let i = 0; i < rowIds.length; i += IN_BATCH) {
      const { error } = await supabase
        .from("planning_events")
        .update({ deleted_at: now, deleted_source: source })
        .in("row_id", rowIds.slice(i, i + IN_BATCH))
        .is("deleted_at", null);
      if (error) throw error;
    }
    await writeBatches(supabase, "planning_events_history", history);
  } catch (err) {
    console.error("[EVENTS] soft-delete on row delete failed:", err.message || err);
  }
}

// Full-table replacements (restore backup / reset / clear all): the table follows the snapshot.
// Every currently active event is soft-deleted, then the snapshot's events are written as active.
async function replaceAll(supabase, appRows, source) {
  if (!enabled) return;
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("planning_events")
      .update({ deleted_at: now, deleted_source: source })
      .is("deleted_at", null);
    if (error) throw error;
    const upserts = [];
    (appRows || []).forEach((r) => {
      const plant = !isBlank(r.col11) ? str(r.col11).trim() : null;
      Object.keys(r).forEach((k) => {
        if (!isEventKey(k) || isBlank(r[k])) return;
        const { event_date, leg } = parseKey(k);
        upserts.push({
          row_id: r.id, event_key: k, event_date, leg, value: str(r[k]), plant: leg || plant,
          source, updated_at: now, deleted_at: null, deleted_source: null,
        });
      });
    });
    await writeBatches(supabase, "planning_events", upserts, { upsert: true });
    console.log(`[EVENTS] ${source}: planning_events replaced with ${upserts.length} event(s) from the snapshot`);
  } catch (err) {
    console.error(`[EVENTS] ${source}: planning_events replace failed:`, err.message || err);
  }
}

// Read side, applied to app-format rows. Fills any active event the JSON lost, and when the Plant
// column is blank on a row that has events, shows the plant the events were planned for and flags
// the row (`__plant_missing`) — a blank plant means something broke; the plan must still show.
function overlay(row, rowActive) {
  if (!rowActive || rowActive.size === 0) return row;
  let out = row;
  const ensureCopy = () => {
    if (out === row) out = { ...row };
  };
  rowActive.forEach((e, k) => {
    if (isBlank(out[k]) && !isBlank(e.value)) {
      ensureCopy();
      out[k] = e.value;
      out.__events_restored = (Number(out.__events_restored) || 0) + 1;
    }
  });
  if (isBlank(out.col11)) {
    const plants = new Set();
    const legs = new Set();
    rowActive.forEach((e, k) => {
      const { leg } = parseKey(k);
      if (leg) legs.add(leg);
      else if (e.plant) plants.add(e.plant);
    });
    // Shared events carry the whole Plant value they were planned under ("ANTLER/LEEMA" on a
    // cross-dev row), so prefer that; otherwise rebuild it from the legs' own keys.
    const recovered = plants.size === 1 ? [...plants][0] : legs.size ? [...legs].join("/") : "";
    ensureCopy();
    out.__plant_missing = "1";
    if (recovered) out.col11 = recovered;
  }
  return out;
}

module.exports = {
  init,
  isEnabled,
  isEventKey,
  parseKey,
  loadActive,
  guardRows,
  softDeleteRows,
  replaceAll,
  overlay,
};
