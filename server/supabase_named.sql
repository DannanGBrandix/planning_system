-- Embellishment Planning System — Supabase schema with READABLE column names.
-- Paste this whole script into the Supabase SQL Editor of a NEW, EMPTY project and press Run.
--
-- Same tables and policies as server/supabase.sql; the only difference is the `rows` table, whose
-- col1..col33 columns are stored under readable names (col3 -> category, col5 -> style, ...).
-- The app still uses col1..col33 internally: server/db.js translates through server/rowColumns.js
-- and auto-detects which style a database uses, so old databases keep working unchanged.
--
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS). Do NOT run it on top of a database whose
-- `rows` table already has columns named col1..col33 — that table would be left as it is.

-- 1. Embellishment rows ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rows (
    id TEXT PRIMARY KEY,
    status TEXT,                     -- col1   Status
    trigger_name TEXT,               -- col2   Trigger
    category TEXT,                   -- col3   Category
    season TEXT,                     -- col4   Season
    style TEXT,                      -- col5   Style
    graphic_combo TEXT,              -- col6   Graphi-Combo#
    graphic TEXT,                    -- col7   Graphic
    ground TEXT,                     -- col8   Ground
    techniques TEXT,                 -- col9   Technique(s)
    process TEXT,                    -- col10  Process
    plant TEXT,                      -- col11  Plant
    plant_flow TEXT,                 -- col12  Plant Flow
    fabric_reference TEXT,           -- col13  Fabric Reference
    fabric_in_date TEXT,             -- col14  Fabric In Date
    application_form TEXT,           -- col15  Application Form
    alternative_fabric TEXT,         -- col16  Alternative Fabric
    risk_factor TEXT,                -- col17  Risk Factor
    technique_category TEXT,         -- col18  Technique Category
    graphic_type TEXT,               -- col19  Graphic Type
    aoq TEXT,                        -- col20  AOQ / Graphic Approval
    technique_type TEXT,             -- col21  Technique Type
    comments TEXT,                   -- col22  Comment
    dispatch_deadline TEXT,          -- col23  Dispatch deadline / 1st S/OFF & target send date
    dhl_stickoff_tracking TEXT,      -- col24  DHL/Stickoff Tracking
    embellishment_apply_parts TEXT,  -- col25  Embellishment Apply Parts
    awr TEXT,                        -- col26  AWR
    soff_requirement TEXT,           -- col27  S-Off Requirement
    ready_date_advance_plan TEXT,    -- col28  Ready Date (Advance Plan)
    placement_sample TEXT,           -- col29  Placement Sample
    dev_trial_requirement TEXT,      -- col30  Dev Trial Requirement
    tc3010_ltd92_required TEXT,      -- col31  TC3010/LTD-92 Required
    fabric_ih TEXT,                  -- col32  Fabric IH
    approved_status TEXT,            -- col33  Approved Status
    team_owner TEXT,                 -- which team created/owns this row (NULL = Planner-created, visible to all)
    shared_id TEXT,                  -- groups versions of the same row together
    version_number INTEGER DEFAULT 1,
    is_current BOOLEAN DEFAULT true,
    change_reason TEXT,
    changed_date TEXT,
    -- col34 and above (strike-off comment, submission #, artwork date, approvals, plan status, buy flag, ...)
    -- and every calendar/event date (e.g. {"2026-07-04": "PPS-S"}) live in this JSON column.
    schedule JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Audit logs --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    style_code TEXT,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    user_role TEXT
);

-- 3. Columns configuration (also holds the season_aoq / plant_aliases / trigger_catalog blobs) --
CREATE TABLE IF NOT EXISTS columns_config (
    id TEXT PRIMARY KEY DEFAULT 'default',
    config JSONB NOT NULL
);

-- 4. User roles --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL
);

-- 5. Backups — full snapshot of `rows` taken before every import / clear -----------------------
CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    label TEXT NOT NULL,          -- e.g. "Before importing SU27_plan.xlsx"
    reason TEXT,                  -- 'import' | 'clear' | 'manual'
    row_count INTEGER DEFAULT 0,
    created_by TEXT,
    data JSONB NOT NULL           -- every row exactly as the app sees it (col1..col33 + schedule keys)
);

-- 6. Plant update sync (shared Google Sheet -> staging -> approve in app) ----------------------
CREATE TABLE IF NOT EXISTS reason_codes (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    responsible TEXT,
    notes TEXT,
    deprecated BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS event_codes (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT,
    category TEXT,
    has_pass_fail BOOLEAN DEFAULT true,
    recommended_reason_codes TEXT[] DEFAULT '{}',
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pending_updates (
    id TEXT PRIMARY KEY,                      -- "pu_<row_id>_<field_key>" so a re-submit upserts
    source TEXT DEFAULT 'google-sheet',
    plant TEXT,
    row_id TEXT,                              -- rows.id (not FK-enforced; row may be archived)
    style TEXT,
    graphic TEXT,
    combo TEXT,
    field_key TEXT,                           -- schedule key, e.g. "2026-07-04" or "2026-07-04_ANTLER"
    base_code TEXT,
    old_value TEXT,
    new_value TEXT,
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

-- 7. Row Level Security — same open policy the app has always used -----------------------------
ALTER TABLE rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE columns_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE reason_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable full access for all users" ON rows;
DROP POLICY IF EXISTS "Enable full access for all users" ON audit_logs;
DROP POLICY IF EXISTS "Enable full access for all users" ON columns_config;
DROP POLICY IF EXISTS "Enable full access for all users" ON user_roles;
DROP POLICY IF EXISTS "Enable full access for all users" ON backups;
DROP POLICY IF EXISTS "Enable full access for all users" ON reason_codes;
DROP POLICY IF EXISTS "Enable full access for all users" ON event_codes;
DROP POLICY IF EXISTS "Enable full access for all users" ON pending_updates;

CREATE POLICY "Enable full access for all users" ON rows FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable full access for all users" ON audit_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable full access for all users" ON columns_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable full access for all users" ON user_roles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable full access for all users" ON backups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable full access for all users" ON reason_codes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable full access for all users" ON event_codes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable full access for all users" ON pending_updates FOR ALL USING (true) WITH CHECK (true);

-- 8. Make sure the API roles can reach the tables (harmless if Supabase already granted this) ---
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Refresh the API's schema cache so the new tables are visible immediately.
NOTIFY pgrst, 'reload schema';
