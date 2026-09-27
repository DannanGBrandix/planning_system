-- Planning events in their own table (2026-09-27).
-- Paste this whole script into the Supabase SQL Editor and press Run. Run it on the TEST project
-- first. Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Why: every planning event used to live only inside rows.schedule (one JSONB blob per row), so one
-- bad save / import / heal that rewrote the blob could wipe a row's whole plan. Each event is now its
-- own record here, and the server (server/planningEvents.js) enforces the rules:
--   * an event is only ever cleared by a MANUAL action (Delete / Clear / move / plant change in Edit);
--     every other writer's attempt to blank an event is refused and logged as 'refused-clear'
--   * clears are SOFT (deleted_at), so anything cleared can be restored
--   * every event carries the plant it was planned for, so a blank Plant column can't lose it
-- rows.schedule keeps a mirror copy of the events, so nothing else (Google Sheet, exports) changes.

-- 1. One record per event key of a row --------------------------------------------------------
--    event_key is the same key the app uses: "2026-09-29" (shared plan), "2026-09-29_LEEMA"
--    (cross-dev leg LEEMA's own plan) or "_leg_LEEMA" (leg marker).
CREATE TABLE IF NOT EXISTS planning_events (
    row_id TEXT NOT NULL,
    event_key TEXT NOT NULL,
    event_date DATE,               -- parsed from event_key (NULL for _leg_ markers)
    leg TEXT,                      -- "LEEMA" for "<date>_LEEMA" / "_leg_LEEMA", NULL for shared keys
    value TEXT NOT NULL DEFAULT '',-- "PPS-S", "FR|P", "SEWIN/SEWS|X", "1" (leg marker), ...
    plant TEXT,                    -- plant this event was planned for (stamped when it was set)
    source TEXT,                   -- who last wrote it: 'manual' | 'auto' | 'import' | 'backfill' | ...
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,  -- soft delete: NULL = active
    deleted_source TEXT,
    PRIMARY KEY (row_id, event_key)
);
CREATE INDEX IF NOT EXISTS planning_events_active_idx ON planning_events (row_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS planning_events_date_idx ON planning_events (event_date) WHERE deleted_at IS NULL;

-- 2. Every change, for audit + restore ----------------------------------------------------------
--    action: 'set' | 'clear' | 'refused-clear' | 'row-deleted' | 'restore' | 'backfill'
CREATE TABLE IF NOT EXISTS planning_events_history (
    id BIGSERIAL PRIMARY KEY,
    row_id TEXT NOT NULL,
    event_key TEXT NOT NULL,
    action TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    plant TEXT,
    source TEXT,
    at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS planning_events_history_row_idx ON planning_events_history (row_id, at DESC);

-- 3. Same open policy / grants as the other tables (server/supabase_named.sql) -----------------
ALTER TABLE planning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_events_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable full access for all users" ON planning_events;
DROP POLICY IF EXISTS "Enable full access for all users" ON planning_events_history;
CREATE POLICY "Enable full access for all users" ON planning_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable full access for all users" ON planning_events_history FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON planning_events, planning_events_history TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE planning_events_history_id_seq TO anon, authenticated, service_role;
