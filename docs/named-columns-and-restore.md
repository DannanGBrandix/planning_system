# Readable column names + restoring a backup into a new Supabase project

(2026-09-19)

## What changed

New databases store the first 33 row fields under **readable names** instead of `col1 … col33`.
Nothing above the database layer changed: the app (page.tsx, tables, utils) still says `col3`, `col5`, …
`server/rowColumns.js` translates at the boundary, and `server/db.js` detects which style the connected
database uses on startup (the server log prints `rows table uses NAMED columns` or `LEGACY columns`).
Old databases (old prod, old test, old backups) keep working exactly as before — that is your rollback.

| App field | Column name | | App field | Column name |
|---|---|---|---|---|
| col1 | `status` | | col18 | `technique_category` |
| col2 | `trigger_name` | | col19 | `graphic_type` |
| col3 | `category` | | col20 | `aoq` |
| col4 | `season` | | col21 | `technique_type` |
| col5 | `style` | | col22 | `comments` |
| col6 | `graphic_combo` | | col23 | `dispatch_deadline` |
| col7 | `graphic` | | col24 | `dhl_stickoff_tracking` |
| col8 | `ground` | | col25 | `embellishment_apply_parts` |
| col9 | `techniques` | | col26 | `awr` |
| col10 | `process` | | col27 | `soff_requirement` |
| col11 | `plant` | | col28 | `ready_date_advance_plan` |
| col12 | `plant_flow` | | col29 | `placement_sample` |
| col13 | `fabric_reference` | | col30 | `dev_trial_requirement` |
| col14 | `fabric_in_date` | | col31 | `tc3010_ltd92_required` |
| col15 | `application_form` | | col32 | `fabric_ih` |
| col16 | `alternative_fabric` | | col33 | `approved_status` |
| col17 | `risk_factor` | | | |

**Not renamed:** `col34` and above (strike-off comment, submission #, artwork date, approvals, plan status,
buy flag, …) and every calendar/event date live *inside* the `schedule` JSON column, in both styles.
`server/supabase_named_view.sql` (optional) adds a read-only view `rows_readable` that shows those JSON
fields as normal columns for browsing in the Supabase Table Editor.

## Files

| File | Purpose |
|---|---|
| `server/supabase_named.sql` | Schema for a NEW project (same tables/policies as `supabase.sql`, `rows` with readable names). Idempotent. |
| `server/supabase_named_view.sql` | Optional `rows_readable` view. |
| `server/rowColumns.js` | The name map + style detection (`ROWS_COLUMN_STYLE=named\|legacy` in `server/.env` overrides detection). |
| `server/restore_from_export.js` | Restores an export folder into a new project **and verifies every value**. |
| `server/db.js`, `server/ckDedupe.js`, `integrations/google-sheet/Code.gs` | Translate col↔name. Code.gs tries the readable names first and falls back to col3/col5/… |

## Status (2026-09-19): DONE

- New project: `https://dxppkrlwsrbeiakvjtcg.supabase.co` (new Supabase account, Tokyo, free plan). Schema from `supabase_named.sql`.
- Restored from `D:\Brandix\prod_backup_2026-09-19_fresh` (byte-identical to the morning backup) and verified: 4,934 rows, 21,290 audit logs, 20 snapshots, all config/code tables — 350k+ values compared, 0 differences.
- `server/switch_db.js`: `prod` now points at the new project; `oldprod` = the previous project (rollback only). `npm run use:prod` was run, so server/.env and .env.local point at the new project.
- Real-server check against the new project: GET /api/rows returned 4,911 rows identical to the backup (255,908 values), cache HIT/MISS working; sign-in settings match the old project (Confirm email ON, signups on).
- Login user created by hand in the new project (Authentication -> Users, Auto Confirm) — the first login auto-grants Planner.

## TEST database (2026-09-19)

- Test project: `https://wetaazteocnpkkciemvw.supabase.co` (same new account, Singapore, free plan). Schema from `supabase_named.sql`.
- Loaded with an export of the NEW prod taken the same day (`D:\Brandix\newprod_export_2026-09-19`, made with `npm run db:export`): 4,918 rows, 21,306 audit logs, 20 snapshots, all config — 350k+ values compared, 0 differences. Real-server check against it returned 4,895 usable rows identical to the export.
- `npm run use:test` -> new test project; `npm run use:oldtest` -> the previous test project (old account, legacy columns); `npm run use:prod` -> production. ALWAYS check the "Active Database Mode" line in server/.env (or the server log) before testing anything destructive, and `npm run use:prod` when done.
- The free plan allows 2 active projects per Supabase ACCOUNT: prod + test now use both slots.
- Login users are per project: create the user in Authentication -> Users (Auto Confirm) for each project.
- Google Sheet Script Properties: SUPABASE_URL_TEST / SUPABASE_KEY_TEST = the test URL/key above; DB_MODE picks which one the sheet uses.

## Backups (free plan has none)

`npm run db:export` (server/export_database.js) writes a full read-only export of the ACTIVE database to `D:\Brandix\db_backups\<ref>_<date>`; rows are normalized to col1..col33 so an export of a named DB restores into either style with `restore_from_export.js`. Run it regularly and copy the folder somewhere safe.

## Restoring the PROD backup into the new project

1. New project → SQL Editor → run `server/supabase_named.sql` (if the OLD `supabase.sql` was already run there,
   first run `DROP TABLE IF EXISTS rows CASCADE;` — the table is empty).
2. `node server/restore_from_export.js D:\Brandix\prod_backup_2026-09-19 --url https://<new>.supabase.co --key sb_publishable_…`
   (add `--dry-run` to see the plan without writing).
3. The script: checks the export against `MANIFEST.json`; refuses to write into the old prod/test projects or a project
   that already has data; restores columns_config, reason_codes, event_codes, rows, pending_updates, audit_logs, backups;
   leaves out the junk `bulk` row and `user_roles` (it points at auth users that don't exist in the new project);
   then reads everything back and compares it value by value. Exit code 0 = everything matched; report in
   `<exportDir>\RESTORE_REPORT.json`.
4. Point the app at the new project (`server/switch_db.js` prod entry → `npm run use:prod`), restart the server,
   update `SUPABASE_URL_PROD` / `SUPABASE_KEY_PROD` in the Google Sheet's Script Properties, and have users sign up again.

## Not updated (still assume the old col1..col33 column names)

One-off maintenance scripts: `_fix_fabricref.js`, `_gen_su27_plant_chart.js`, `fix_lounge_season_duplicates.sql`,
`fix_vs_ae_category.sql`, `server/sql/dedupe_duplicate_rows.sql`, and `server/sync.js` (mirrors rows between two
projects — both must use the same style). They keep working against old-style databases; against a new one, use
the names in the table above.

## How it was verified

- `supabase_named.sql` + the view ran on a real Postgres engine (PGlite): clean, re-runnable, 42 columns, all 33 names present.
- 300 real PROD rows inserted under the new names and read back identical (12,600 values).
- Server code (`db.js`) exercised against a fake database that enforces column names, in both styles: reads, team filters,
  saves, partial saves, imports, seed, delete, plant-sheet approvals.
- The real restore script run against the real backup into fake targets of both styles: 4,934 rows, 21,290 audit logs,
  20 snapshots, all config — 350k+ values compared, 0 differences.
- Detection confirmed against the real (old-style) TEST project: `42703 column rows.category does not exist` → LEGACY.
