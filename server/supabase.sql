-- Embellishment Planning System PostgreSQL Database Schema
-- Paste this script directly into your Supabase SQL Editor to set up the tables!

-- 1. Create Embellishment Rows Table
CREATE TABLE IF NOT EXISTS rows (
    id TEXT PRIMARY KEY,
    col1 TEXT,  -- Status
    col2 TEXT,  -- Trigger
    col3 TEXT,  -- Category
    col4 TEXT,  -- Season
    col5 TEXT,  -- Style
    col6 TEXT,  -- Graphi-Combo
    col7 TEXT,  -- Graphic
    col8 TEXT,  -- Ground
    col9 TEXT,  -- Technique(s)
    col10 TEXT, -- Process
    col11 TEXT, -- Plant
    col12 TEXT, -- Plant Flow
    col13 TEXT, -- Fabric Reference
    col14 TEXT, -- Fabric In Date
    col15 TEXT, -- Application Form
    col16 TEXT, -- Alternative Fabric
    col17 TEXT, -- Risk Factor
    col18 TEXT, -- Technique Category
    col19 TEXT, -- Graphic Type
    col20 TEXT, -- AOQ/Graphic Approval
    col21 TEXT, -- Technique Type
    col22 TEXT, -- Comment
    col23 TEXT, -- Dispatch
    col24 TEXT, -- DHL/Stickoff Tracking
    col25 TEXT, -- Embellishment Apply Parts
    col26 TEXT, -- AWR
    col27 TEXT, -- S-Off Requirement
    col28 TEXT, -- Ready Date (Advance Plan)
    col29 TEXT, -- Placement Sample
    col30 TEXT, -- Dev Trial Requirement
    col31 TEXT, -- TC3010/LTD-92 Required
    col32 TEXT, -- Fabric IH
    col33 TEXT, -- Approved Status
    team_owner TEXT, -- Which team created/owns this row (NULL = Planner-created, visible to all)
    shared_id TEXT, -- Groups versions of the same row together
    version_number INTEGER DEFAULT 1,
    is_current BOOLEAN DEFAULT true,
    change_reason TEXT,
    changed_date TEXT,
    schedule JSONB DEFAULT '{}'::jsonb, -- Dynamic calendar dates (e.g. {"2026-07-04": "PPS-S"})
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Migration: If the rows table already exists, add new columns if missing
ALTER TABLE rows ADD COLUMN IF NOT EXISTS team_owner TEXT;
ALTER TABLE rows ADD COLUMN IF NOT EXISTS col33 TEXT;
ALTER TABLE rows ADD COLUMN IF NOT EXISTS shared_id TEXT;
ALTER TABLE rows ADD COLUMN IF NOT EXISTS version_number INTEGER DEFAULT 1;
ALTER TABLE rows ADD COLUMN IF NOT EXISTS is_current BOOLEAN DEFAULT true;
ALTER TABLE rows ADD COLUMN IF NOT EXISTS change_reason TEXT;
ALTER TABLE rows ADD COLUMN IF NOT EXISTS changed_date TEXT;

-- For existing data, initialize shared_id to id
UPDATE rows SET shared_id = id WHERE shared_id IS NULL;

-- 2. Create Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    style_code TEXT,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    user_role TEXT
);

-- 3. Create Columns Configuration Table
CREATE TABLE IF NOT EXISTS columns_config (
    id TEXT PRIMARY KEY DEFAULT 'default',
    config JSONB NOT NULL
);

-- Enable RLS (Row Level Security)
ALTER TABLE rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE columns_config ENABLE ROW LEVEL SECURITY;

-- Create policies (modify these according to your actual security requirements later)
-- This allows all operations for all users, satisfying the Supabase UI requirement while keeping functionality identical
CREATE POLICY "Enable full access for all users" ON rows FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable full access for all users" ON audit_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable full access for all users" ON columns_config FOR ALL USING (true) WITH CHECK (true);

-- 4. Create User Roles Table
CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL
);

-- Enable RLS on user_roles
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable full access for all users" ON user_roles FOR ALL USING (true) WITH CHECK (true);

-- 5. Create Backups Table
-- Stores a full snapshot of the "rows" table, taken automatically right before every
-- Excel import and every "Clear Database" wipe, so bad imports can be undone.
CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    label TEXT NOT NULL,          -- e.g. "Before importing SU27_plan.xlsx"
    reason TEXT,                  -- 'import' | 'clear' | 'manual'
    row_count INTEGER DEFAULT 0,
    created_by TEXT,              -- user role/email that triggered the backup
    data JSONB NOT NULL           -- full snapshot of every row, exactly as returned by GET /api/rows
);

ALTER TABLE backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable full access for all users" ON backups FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 6. Plant Update Sync (shared Google Sheet -> staging -> approve in app)
-- ============================================================

-- 6a. Reason codes — the controlled list a plant must pick from when marking an
-- event "Fail". Seeded from app/lib/eventCodes.ts by `npm run seed:codes`.
CREATE TABLE IF NOT EXISTS reason_codes (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    responsible TEXT,
    notes TEXT,
    deprecated BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0
);

-- 6b. Event codes — the milestone vocabulary (NY, PPS, RDPS, ...). Seeded likewise.
CREATE TABLE IF NOT EXISTS event_codes (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT,
    category TEXT,
    has_pass_fail BOOLEAN DEFAULT true,
    recommended_reason_codes TEXT[] DEFAULT '{}',
    sort_order INTEGER DEFAULT 0
);

-- 6c. Pending updates — one row per (system row, calendar/event field) edited in
-- the Google Sheet. The Apps Script inserts these directly via the Supabase REST
-- API (open RLS policy below). A planner reviews them in /plant-updates and the
-- Express API applies approved ones into rows.schedule.
CREATE TABLE IF NOT EXISTS pending_updates (
    id TEXT PRIMARY KEY,                      -- "pu_<row_id>_<field_key>" so a re-submit upserts
    source TEXT DEFAULT 'google-sheet',
    plant TEXT,                               -- plant tab name / canonical plant
    row_id TEXT,                              -- rows.id (not FK-enforced; row may be archived)
    style TEXT,                               -- denormalized for the review screen
    graphic TEXT,
    combo TEXT,
    field_key TEXT,                           -- schedule key, e.g. "2026-07-04" or "2026-07-04_ANTLER"
    base_code TEXT,                           -- e.g. "PPS"
    old_value TEXT,                           -- event value the sheet last saw (stale detection)
    new_value TEXT,                           -- encoded result, e.g. "PPS|F|14" / "PPS|P"
    result TEXT,                              -- 'pass' | 'fail'
    reason_code TEXT,
    note TEXT,
    status TEXT DEFAULT 'pending',            -- 'pending' | 'applied' | 'rejected' | 'stale'
    submitted_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewed_by TEXT
);

CREATE INDEX IF NOT EXISTS pending_updates_status_idx ON pending_updates (status);
CREATE INDEX IF NOT EXISTS pending_updates_row_id_idx ON pending_updates (row_id);

ALTER TABLE reason_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_updates ENABLE ROW LEVEL SECURITY;
-- DROP first so re-running this script never trips "policy already exists" (42710).
DROP POLICY IF EXISTS "Enable full access for all users" ON reason_codes;
DROP POLICY IF EXISTS "Enable full access for all users" ON event_codes;
DROP POLICY IF EXISTS "Enable full access for all users" ON pending_updates;
CREATE POLICY "Enable full access for all users" ON reason_codes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable full access for all users" ON event_codes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable full access for all users" ON pending_updates FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 7. Season AOQ dates (per Category + Season fallback deadline) and Plant Aliases
--    (user-managed plant merge/hide). Both are singleton JSON blobs stored as extra rows
--    (id "season_aoq" / id "plant_aliases") in columns_config above, rather than their own
--    tables — no schema change needed to add either one.
-- ============================================================
