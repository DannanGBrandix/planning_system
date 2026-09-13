-- ============================================================================
-- Embellishment Plan — Duplicate Row Cleanup
--
-- Background: the Excel import used to require Technique(s) (col9) to match
-- before treating an imported row as "the same item" as one already in the
-- DB. When a graphic's technique got corrected in the source Excel later
-- (e.g. "DIGITAL" -> "SHP"), the match failed and a duplicate row was
-- inserted instead of updating the original. That import bug is fixed in
-- the app now — this script cleans up the duplicates it already created.
--
-- Row identity used here = Graphic + Combo + Style + Ground Color, within
-- the same Category + Season (matches exactly what the app's importer now
-- treats as "the same row" — see app/page.tsx import matching strategies).
--
-- Run PART 1 first (100% read-only) and look at the results.
-- Only run PART 2 (the actual cleanup) once PART 1's output looks right.
-- ============================================================================


-- ============================================================================
-- PART 1 — PREVIEW (read-only, safe to run any time)
-- Lists every duplicate group among CURRENT rows, with the ids involved and
-- their Status/Technique, so you can eyeball what will be merged.
-- ============================================================================

WITH current_rows AS (
  SELECT
    r.id, r.created_at, r.col1, r.col9,
    upper(trim(coalesce(r.col7, ''))) AS g_graphic,
    regexp_replace(regexp_replace(upper(trim(coalesce(r.col6, ''))), '^CO', 'C'), '^C0+([0-9])', 'C\1') AS g_combo,
    upper(trim(coalesce(r.col5, ''))) AS g_style,
    upper(trim(coalesce(r.col8, ''))) AS g_ground,
    upper(trim(coalesce(r.col3, ''))) AS g_category,
    upper(trim(coalesce(r.col4, ''))) AS g_season
  FROM rows r
  WHERE (r.is_current IS TRUE OR r.is_current IS NULL)
    AND coalesce(trim(r.col7), '') <> ''
),
dup_groups AS (
  SELECT g_graphic, g_combo, g_style, g_ground, g_category, g_season, count(*) AS dup_count
  FROM current_rows
  GROUP BY 1, 2, 3, 4, 5, 6
  HAVING count(*) > 1
)
SELECT
  dg.dup_count,
  cr.g_graphic AS graphic,
  cr.g_combo AS combo,
  cr.g_style AS style,
  cr.g_ground AS ground,
  cr.g_category AS category,
  cr.g_season AS season,
  cr.id,
  cr.created_at,
  cr.col1 AS status,
  cr.col9 AS technique
FROM current_rows cr
JOIN dup_groups dg USING (g_graphic, g_combo, g_style, g_ground, g_category, g_season)
ORDER BY dg.dup_count DESC, cr.g_graphic, cr.g_combo, cr.g_style, cr.g_ground, cr.created_at;


-- ============================================================================
-- PART 2 — CLEANUP (destructive — merges each duplicate group into one row)
--
-- For each duplicate group:
--   - the most-recently-created row is kept ("survivor")
--   - every field (col1..col33 + the schedule/date columns) is merged across
--     the whole group, most-recent non-empty value wins per field — so
--     nothing (DHL tracking, comments, dates, the corrected Technique, etc.)
--     gets silently lost from whichever row didn't survive
--   - the other row(s) in the group are deleted
--   - a full backup of every touched row is written to the `backups` table
--     first, so this can be undone by restoring that snapshot if needed
--
-- Wrapped in one transaction: if anything errors, nothing is committed.
-- ============================================================================

BEGIN;

-- 1) Materialize the merge plan once (reused by the backup, update, delete below)
CREATE TEMP TABLE dedupe_plan AS
WITH current_rows AS (
  SELECT
    r.id,
    r.created_at,
    upper(trim(coalesce(r.col7, ''))) AS g_graphic,
    regexp_replace(regexp_replace(upper(trim(coalesce(r.col6, ''))), '^CO', 'C'), '^C0+([0-9])', 'C\1') AS g_combo,
    upper(trim(coalesce(r.col5, ''))) AS g_style,
    upper(trim(coalesce(r.col8, ''))) AS g_ground,
    upper(trim(coalesce(r.col3, ''))) AS g_category,
    upper(trim(coalesce(r.col4, ''))) AS g_season,
    -- Flatten every real column PLUS the JSONB schedule (col34+, calendar
    -- dates) into one field->value map per row, exactly like the app does
    -- when it reads a row back (rest fields spread, then schedule spread).
    (to_jsonb(r) - 'id' - 'created_at' - 'schedule' - 'team_owner' - 'shared_id'
                 - 'version_number' - 'is_current' - 'change_reason' - 'changed_date')
      || coalesce(r.schedule, '{}'::jsonb) AS all_data
  FROM rows r
  WHERE (r.is_current IS TRUE OR r.is_current IS NULL)
    AND coalesce(trim(r.col7), '') <> ''
),
dup_groups AS (
  SELECT g_graphic, g_combo, g_style, g_ground, g_category, g_season
  FROM current_rows
  GROUP BY 1, 2, 3, 4, 5, 6
  HAVING count(*) > 1
),
dup_rows AS (
  SELECT cr.*
  FROM current_rows cr
  JOIN dup_groups dg USING (g_graphic, g_combo, g_style, g_ground, g_category, g_season)
),
survivors AS (
  SELECT DISTINCT ON (g_graphic, g_combo, g_style, g_ground, g_category, g_season)
    g_graphic, g_combo, g_style, g_ground, g_category, g_season, id AS survivor_id
  FROM dup_rows
  ORDER BY g_graphic, g_combo, g_style, g_ground, g_category, g_season, created_at DESC
),
fields_flat AS (
  SELECT
    dr.g_graphic, dr.g_combo, dr.g_style, dr.g_ground, dr.g_category, dr.g_season,
    dr.created_at, kv.key AS field_key, kv.value AS field_value
  FROM dup_rows dr
  CROSS JOIN LATERAL jsonb_each_text(dr.all_data) AS kv(key, value)
  WHERE kv.value IS NOT NULL AND trim(kv.value) <> ''
),
fields_latest AS (
  -- Most-recently-created row's value wins per field, but only overwrites
  -- when it actually has a non-empty value (see the filter above) — so an
  -- empty field on the survivor doesn't wipe out real data from an older dupe.
  SELECT DISTINCT ON (g_graphic, g_combo, g_style, g_ground, g_category, g_season, field_key)
    g_graphic, g_combo, g_style, g_ground, g_category, g_season, field_key, field_value
  FROM fields_flat
  ORDER BY g_graphic, g_combo, g_style, g_ground, g_category, g_season, field_key, created_at DESC
),
merged AS (
  SELECT g_graphic, g_combo, g_style, g_ground, g_category, g_season,
    jsonb_object_agg(field_key, field_value) AS merged_data
  FROM fields_latest
  GROUP BY 1, 2, 3, 4, 5, 6
)
SELECT
  s.survivor_id,
  m.merged_data,
  array_agg(dr.id) FILTER (WHERE dr.id <> s.survivor_id) AS loser_ids
FROM survivors s
JOIN merged m USING (g_graphic, g_combo, g_style, g_ground, g_category, g_season)
JOIN dup_rows dr USING (g_graphic, g_combo, g_style, g_ground, g_category, g_season)
GROUP BY s.survivor_id, m.merged_data;

-- 2) Safety snapshot of every row about to be touched (survivors + losers)
INSERT INTO backups (id, label, reason, row_count, created_by, data)
SELECT
  'dedupe_backup_' || to_char(now(), 'YYYYMMDD_HH24MISS'),
  'Before duplicate-row cleanup (Graphic+Combo+Style+Ground, same Category/Season)',
  'manual',
  count(*),
  'sql_cleanup_script',
  jsonb_agg(to_jsonb(r))
FROM rows r
WHERE r.id IN (
  SELECT survivor_id FROM dedupe_plan
  UNION
  SELECT unnest(loser_ids) FROM dedupe_plan
);

-- 3) Update each survivor with the merged field values
UPDATE rows r
SET
  col1  = coalesce(dp.merged_data->>'col1',  r.col1),
  col2  = coalesce(dp.merged_data->>'col2',  r.col2),
  col3  = coalesce(dp.merged_data->>'col3',  r.col3),
  col4  = coalesce(dp.merged_data->>'col4',  r.col4),
  col5  = coalesce(dp.merged_data->>'col5',  r.col5),
  col6  = coalesce(dp.merged_data->>'col6',  r.col6),
  col7  = coalesce(dp.merged_data->>'col7',  r.col7),
  col8  = coalesce(dp.merged_data->>'col8',  r.col8),
  col9  = coalesce(dp.merged_data->>'col9',  r.col9),
  col10 = coalesce(dp.merged_data->>'col10', r.col10),
  col11 = coalesce(dp.merged_data->>'col11', r.col11),
  col12 = coalesce(dp.merged_data->>'col12', r.col12),
  col13 = coalesce(dp.merged_data->>'col13', r.col13),
  col14 = coalesce(dp.merged_data->>'col14', r.col14),
  col15 = coalesce(dp.merged_data->>'col15', r.col15),
  col16 = coalesce(dp.merged_data->>'col16', r.col16),
  col17 = coalesce(dp.merged_data->>'col17', r.col17),
  col18 = coalesce(dp.merged_data->>'col18', r.col18),
  col19 = coalesce(dp.merged_data->>'col19', r.col19),
  col20 = coalesce(dp.merged_data->>'col20', r.col20),
  col21 = coalesce(dp.merged_data->>'col21', r.col21),
  col22 = coalesce(dp.merged_data->>'col22', r.col22),
  col23 = coalesce(dp.merged_data->>'col23', r.col23),
  col24 = coalesce(dp.merged_data->>'col24', r.col24),
  col25 = coalesce(dp.merged_data->>'col25', r.col25),
  col26 = coalesce(dp.merged_data->>'col26', r.col26),
  col27 = coalesce(dp.merged_data->>'col27', r.col27),
  col28 = coalesce(dp.merged_data->>'col28', r.col28),
  col29 = coalesce(dp.merged_data->>'col29', r.col29),
  col30 = coalesce(dp.merged_data->>'col30', r.col30),
  col31 = coalesce(dp.merged_data->>'col31', r.col31),
  col32 = coalesce(dp.merged_data->>'col32', r.col32),
  col33 = coalesce(dp.merged_data->>'col33', r.col33),
  -- Whatever's left after pulling out col1..col33 is the col34+/calendar-date
  -- schedule data — put it back exactly where the app expects it.
  schedule = (dp.merged_data - ARRAY[
    'col1','col2','col3','col4','col5','col6','col7','col8','col9','col10',
    'col11','col12','col13','col14','col15','col16','col17','col18','col19','col20',
    'col21','col22','col23','col24','col25','col26','col27','col28','col29','col30',
    'col31','col32','col33'
  ]),
  change_reason = 'Auto-merged duplicate row(s) (same Graphic+Combo+Style+Ground) via dedupe cleanup script',
  changed_date = to_char(now(), 'YYYY-MM-DD')
FROM dedupe_plan dp
WHERE r.id = dp.survivor_id;

-- 4) Delete the now-redundant duplicate rows
DELETE FROM rows r
USING dedupe_plan dp
WHERE r.id = ANY(dp.loser_ids);

-- 5) Verify — re-checks the live table (not the now-stale plan) for any
-- duplicate groups still remaining. This should return 0.
SELECT count(*) AS remaining_duplicate_groups
FROM (
  SELECT
    upper(trim(coalesce(r.col7, ''))) AS g_graphic,
    regexp_replace(regexp_replace(upper(trim(coalesce(r.col6, ''))), '^CO', 'C'), '^C0+([0-9])', 'C\1') AS g_combo,
    upper(trim(coalesce(r.col5, ''))) AS g_style,
    upper(trim(coalesce(r.col8, ''))) AS g_ground,
    upper(trim(coalesce(r.col3, ''))) AS g_category,
    upper(trim(coalesce(r.col4, ''))) AS g_season
  FROM rows r
  WHERE (r.is_current IS TRUE OR r.is_current IS NULL)
    AND coalesce(trim(r.col7), '') <> ''
  GROUP BY 1, 2, 3, 4, 5, 6
  HAVING count(*) > 1
) remaining;

DROP TABLE dedupe_plan;

COMMIT;

-- If anything above looks wrong before you'd otherwise trust it, run
-- ROLLBACK; instead of COMMIT; and nothing will be changed.
