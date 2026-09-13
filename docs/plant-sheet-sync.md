# Plant Update Sync — shared Google Sheet

Plants update event status in a shared Google Sheet. Their Pass/Fail results (with
a reason from the controlled list) queue into Supabase, and a planner approves
them in the app at **`/plant-updates`**. Approved results are written into the
plan's `rows.schedule`, with an audit-log entry each.

```
Google Sheet (one tab per plant)
  │  rebuildSheets()  ── reads rows + reason_codes ──►  Supabase REST
  │  flushEdits()     ── queues validated edits ─────►  Supabase.pending_updates
  ▼
Supabase  ──►  Express API (npm run dev:all)  ──►  /plant-updates review page
```

Capture (sheet → `pending_updates`) runs on Google's servers and needs **no
laptop**. Approving/applying runs in the local Express API when the planner
reviews.

---

## 1. One-time database setup

1. Open the Supabase project's **SQL editor** and paste the full contents of
   [`server/supabase.sql`](../server/supabase.sql). It is idempotent — safe to
   re-run. This adds `reason_codes`, `event_codes`, `pending_updates`.
2. From the repo root, seed the code tables from `app/lib/eventCodes.ts`:
   ```
   npm run seed:codes
   ```
   It targets whichever database `server/.env` points at (`npm run use:test` /
   `npm run use:prod`). Re-run it after editing `EVENT_CODES` / `REASON_CODES` /
   `EVENT_REASON_PRIORITY`.
3. Verify: `select count(*) from reason_codes;` (~60), `select count(*) from event_codes;` (~34).

---

## 2. One-time Google Sheet setup

1. Create a new Google Sheet (any Google account you control). Delete nothing —
   the script manages its own tabs.
2. **Extensions → Apps Script.**
3. Replace the default `Code.gs` with
   [`integrations/google-sheet/Code.gs`](../integrations/google-sheet/Code.gs).
4. Click the gear (**Project Settings**) → check *"Show `appsscript.json`"*, then
   paste [`integrations/google-sheet/appsscript.json`](../integrations/google-sheet/appsscript.json)
   over the manifest. Adjust `timeZone` if the plants aren't on `Asia/Colombo`.
5. **Project Settings → Script Properties**, add:

   | Property | Value | Notes |
   |---|---|---|
   | `DB_MODE` | `test` | which database below to use — `test` or `prod`. Flip it from the **Plant Sync** menu. |
   | `SUPABASE_URL_TEST` | `https://<test-ref>.supabase.co` | test project URL |
   | `SUPABASE_KEY_TEST` | `sb_publishable_…` | test project publishable key |
   | `SUPABASE_URL_PROD` | `https://<prod-ref>.supabase.co` | production project URL |
   | `SUPABASE_KEY_PROD` | `sb_publishable_…` | production project publishable key |
   | `WINDOW_DAYS` | *(omit)* | days to show; default `7` |
   | `TARGET_DATE` | *(omit)* | window start; blank = this week's Monday. Set a date only to test against a specific week |
   | `PLANT_EMAILS` | `{"ANTLER":["p1@x.com"],"BFL":["p2@x.com"]}` | optional; grants per-tab edit access |

   The sheet only ever talks to one database at a time — whichever `DB_MODE` names.
   The hidden `_Meta` tab shows which one the current tabs came from.

6. Back in the sheet, reload the tab. A **Plant Sync** menu appears. Run
   **Plant Sync → Rebuild sheets from system** and authorize when prompted.
7. Run **Plant Sync → Install / refresh triggers**. This creates:
   - `rebuildSheets` — daily at ~06:00 (refreshes tabs, pulls new events, stamps applied/rejected)
   - `flushEdits` — every 10 minutes (sends plant edits to Supabase)
   - `onEdit` (installable) — runs as the sheet owner so it can stamp the
     protected `edited_at` / `Sync Status` cells (a plant user's built-in simple
     `onEdit` can't write into the protected trailing columns). `flushEdits` does
     **not** depend on this — it queues any `Result` that differs from what it has
     already sent — but installing it keeps the per-row status hints accurate.
8. **Share** the Sheet with the plant users (Editor). If you set `PLANT_EMAILS`,
   each plant can only edit their own tab's `Result` / `Reason` day columns —
   everything else is protected.

---

## 3. What the plant does

Each plant tab is a **weekly grid**: one row per style/leg, and for **each day
of the week** three columns — `<day>` (the planned event, locked), `<day> Result`,
`<day> Reason`. The context columns (Style, Graphic, …) are frozen on the left.

For every day cell that shows an event, the plant sets:

- **`<day> Result`** — `Pass`, `Fail`, or leave blank / `Planned` if not done yet.
- **`<day> Reason`** — required when that day's Result is `Fail`; pick from the
  dropdown (the system's reason list). A `Fail` with no reason is **not** sent and
  the **Sync Status** column shows `⚠ Fri: reason`.

**Sync Status** column (script-written, read-only) — one summary per row, e.g.
`Wed, Fri queued ✓` or `Wed queued ✓  ·  ⚠ Fri: reason`:

| Value | Meaning |
|---|---|
| *(blank)* | nothing sent for this row yet |
| `Wed, Fri queued ✓` | those days received by the system, waiting for planner approval |
| `⚠ Fri: reason` | Friday is marked Fail but has no reason — add one |
| `Wed: error` | transient send error for that day; it retries on the next flush |

After a rebuild, the **event cell** itself picks up a hint: `FS · sent` (queued,
awaiting approval), `FS · rejected` (planner rejected — set the result again), or
`FS · recheck` (the plan value changed since you submitted — a planner will follow
up). An approved event just disappears from next week's grid.

---

## 4. What the planner does

1. `npm run dev:all`, open **`http://localhost:3000/plant-updates`** (Planner,
   Admin, or Management role — the sidebar shows a badge with the pending count).
2. Review each update — old value → new value, reason, note, who submitted it.
3. Select rows → **Approve** (writes to the plan + audit log) or **Reject**.
4. Anything in the amber **"changed since the plant submitted"** box was edited in
   the plan after the sheet was built — it is *not* auto-applied. Verify and
   handle it on the dashboard, or re-issue the sheet.

---

## Second sheet — fabric-sample (FS) only

The fabric-sending workflow uses its **own** Google Sheet that shows only rows with
an **FS** (First Sample) event in the window. It is the same script, just scoped:

1. Do **§2** again for a brand-new Google Sheet — same `Code.gs`, same
   `appsscript.json`, the **same** `DB_MODE` / `SUPABASE_*` Script Properties.
2. Add these Script Properties:

   | Property | Value | Notes |
   |---|---|---|
   | `EVENT_FILTER` | `FS` | only bucket FS events. Comma-separate for more (`FS,FR`). |
   | `COMBINED_SHEET` | `true` | **one shared tab** (with a leading `Plant` column) instead of one tab per plant. |
   | `SHEET_NAME` | `Fabric Sending` | name of that tab (default `All Events`). |
   | `SHEET_EDITORS` | `["dispatch@x.com"]` | *(optional)* emails allowed to edit the tab's `Result`/`Reason`. If omitted, every address in `PLANT_EMAILS` is granted. |

3. *(optional, to avoid FS showing on both sheets)* On the **original** plant sheet
   add `EVENT_EXCLUDE` = `FS`, then **Plant Sync → Rebuild sheets from system**.
4. **Plant Sync → Rebuild sheets from system**, then **Install / refresh triggers**,
   then share with the fabric-dispatch users.

Everything else is identical — `Result` = `Pass`/`Fail` + `Reason`, `flushEdits` queues to
the same `pending_updates`, planner approves at `/plant-updates`. With `COMBINED_SHEET=true`
every row lives on one tab and its **Plant** column says which plant the fabric goes to
(a `+`-combined location like `Antler+Leema` still gets one row **per plant**). The hidden
`_Meta` tab's **Event scope** / **Layout** rows confirm which sheet is which.

## Notes & limits (v1)

- The sheet only carries **Pass/Fail on existing planned events**. Rescheduling /
  moving a date / adding new items stays a planner action in the app.
- A `/`-split cross-dev row (`MRC / BABL`, `Antler+Leema / RC+MRC`) fans every
  shared (bare-key) event out to **all** its legs — each leg confirms against its
  own `<date>_<leg>` key, so approving one leg's result never touches the shared
  plan or the other legs. A leg the planner has already replanned on its own
  (`<date>_<leg>` key present) uses that key instead.
- A leg that is itself a `+`-combined location (`Antler+Leema` — one shared event
  both plants work at) is fanned one step further: **each plant gets its own
  tab/row**, never a joint `ANTLER + LEEMA` tab. All of those rows point back at
  the one shared `<date>_<leg>` field key, so a `Pass`/`Fail` from either plant
  confirms the same event and the planner approves it once.
- A row whose `col11` is a single location, a dye/wash round-trip, or a purely
  sequential `>>` chain (no `/`) still goes to the **first** plant's tab.
- The `SUPABASE_KEY_*` values are publishable keys (already public in the repo);
  anyone with script-editor access to the Sheet can read them. Share the Sheet,
  not the script project, and keep RLS policies as shipped.
- Deprecated reason codes are excluded from the dropdown automatically.
