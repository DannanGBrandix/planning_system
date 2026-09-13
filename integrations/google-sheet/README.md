# Google Sheet — Plant Update Sync

Apps Script that lives inside a shared Google Sheet. Pulls the day's planned
events per plant from Supabase, collects Pass/Fail + reason, and queues results
into `pending_updates` for approval in the app at `/plant-updates`.

- `Code.gs` — paste into **Extensions → Apps Script**
- `appsscript.json` — paste over the manifest (Project Settings → *Show appsscript.json*)

Full setup, configuration, and the plant/planner workflow:
**[../../docs/plant-sheet-sync.md](../../docs/plant-sheet-sync.md)**

## Running a second, scoped sheet (e.g. fabric-sample / FS only)

The same `Code.gs` drives more than one sheet. Create another Google Sheet, paste
the same `Code.gs` + `appsscript.json`, use the same Supabase Script Properties,
and add:

| Property | Value | Effect |
|---|---|---|
| `EVENT_FILTER` | `FS` | that sheet only shows rows with an **FS** event in the window |
| `COMBINED_SHEET` | `true` | one shared tab (with a `Plant` column) instead of one tab per plant |
| `SHEET_NAME` | `Fabric Sending` | name of that tab (default `All Events`) |
| `SHEET_EDITORS` | `["a@x.com"]` | who can edit `Result`/`Reason` on the combined tab (optional) |

Comma-separate for more than one code (`EVENT_FILTER = FS,FR`). To stop the two
sheets overlapping, set `EVENT_EXCLUDE = FS` on the original all-events sheet.
The hidden `_Meta` tab shows each sheet's **Event scope** and **Layout**.
