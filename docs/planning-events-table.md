# Planning events table

Planning events (date keys such as `2026-09-29`, cross-dev leg keys such as `2026-09-29_LEEMA`, and
`_leg_<PLANT>` markers) used to exist only inside `rows.schedule`, a single JSONB value per row. One
bad save, import or heal that rewrote that value could wipe a row's whole plan.

Each event is now also a record in `planning_events`, and every change is logged in
`planning_events_history`. `rows.schedule` keeps a mirror copy, so the app, the Google Sheet and the
exports read events exactly as before.

## Rules

| Situation | What happens to the events |
|---|---|
| Manual Delete / Clear / move / replan in the app | Cleared. The action names the keys it clears (`withEventClears` in `app/lib/db.ts` → `_event_clears`). |
| Plant changed in Edit, e.g. ANTLER → LEEMA | The **only** automatic clear. The whole plan is cleared and replanned for the new plant from today, after a confirm prompt. |
| Plant blank (bad import, sync, bug) | Kept. The row still shows them, using the plant stamped on the events, with a **⚠ Plant missing** badge. Editing the row saves that plant back. |
| Cross-dev leg added or removed (ANTLER → ANTLER/LEEMA) | Kept. The first plant's plan stays as it is; the new leg is planned from a picked date (Clear + replan one plant). |
| Import, page-load heal, bulk jobs, stale full-row saves | Cannot clear. Any `""` for an event that has a value is refused, the stored event stays, and the attempt is logged as `refused-clear`. |
| Row deleted | Its events are soft-deleted (`deleted_at`) and can be restored. |
| Restore backup / reset / clear all | The table follows the snapshot. Previously active events are soft-deleted first. |

On read, an active event that a row's JSON lost (for example through the SQL editor or a script) is
filled back in. The table never overrides a value the JSON already has.

## Setup (per database)

1. Paste `server/sql/planning_events.sql` into the Supabase SQL editor and run it.
2. Run `npm run events:backfill`. This is a dry run that only prints counts.
3. Run `npm run events:backfill -- --apply`. It copies every existing event in. It only adds
   events, and it's safe to re-run. It refuses to write to PROD without `--allow-prod`.
4. Restart the server. The log should say `[EVENTS] planning_events table found — event protection is ON`.

If the table is missing, the server logs a warning and keeps the no-silent-clear rule on the JSON
itself. Set `PLANNING_EVENTS=off` in `server/.env` to switch the table off completely.

## Useful queries

```sql
-- what happened to one row's events
select at, event_key, action, old_value, new_value, plant, source
from planning_events_history where row_id = '<row id>' order by at desc;

-- clears that were blocked (who tried to wipe what)
select * from planning_events_history where action = 'refused-clear' order by at desc limit 100;

-- restore a cleared event
update planning_events set deleted_at = null, deleted_source = null
where row_id = '<row id>' and event_key = '<key>';
-- then reload the app: the event is filled back into the row automatically
```
