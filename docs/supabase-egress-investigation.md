# Supabase egress investigation — "Urgent Action Required" (Sep 2026)

**Date of investigation:** 2026-09-19
**Org:** Dannansilva's Org (Free plan) — two projects: `embellishmentplan` (PROD, `ktgsyakzevczufcziqci`) and `embellishment-plan-test` (TEST, `vxsfwwdcjjhsitfauyxa`)
**Trigger:** Supabase email — Egress 12.96 GB of 5.5 GB, grace period ends **21 Sep 2026**, after which projects return **HTTP 402**.
**Scope:** read-only. No code, data or Supabase settings were changed.

---

## 1. Verdict (short)

> **The app downloads the entire `rows` table from Supabase every 15 seconds for as long as a Planner has the page open.**
> One download is ~0.64 MB on the wire (6.35 MB uncompressed) and is repeated ~1,400 times per working day. That is the egress.

It is **not** caused by saving JSON, by Realtime, by the Google Sheet script, or by file storage. Those were all checked and ruled out (section 5).

Supabase's own API log for the last 24 h on PROD lets us reproduce the day's egress bar almost exactly:

| | Value |
|---|---|
| Complete `rows` table downloads (Sep 18 03:00 → Sep 19 03:42 UTC) | **1,385** |
| Wire size of one full download (measured, same query the server runs) | 669,629 bytes |
| 1,385 × 669,629 B | **≈ 927 MB** |
| PROD egress bar for 18 Sep on the Usage page | **≈ 925 MB** |

So the table polling is ~100% of that day's egress, not a contributing factor among many.

---

## 2. What Supabase reports

From `Usage` (billing cycle 04 Sep – 04 Oct 2026), read on 2026-09-19:

| Metric | Value | Meaning |
|---|---|---|
| Egress | **14.03 GB / 5 GB (281%)** | The email said 12.96 GB — it was an earlier snapshot. |
| Cached egress | 0 GB | Nothing is served from cache. |
| Realtime messages / peak connections | **0 / 0** | Realtime is not in use → `server/sync.js` is not the cause. |
| Storage size | 0 GB | Storage is not in use. |
| Monthly active users | 2 | Tiny user base. |
| Database size | 52 MB (PROD), 34 MB (TEST) | Database is small. Size is not the problem. |
| Edge function calls | 0 | |

Egress per day (read off the charts, approximate):

- **PROD (~80–85% of total):** 04 Sep ≈1.0 GB · 05 ≈0.07 · 06 ≈0.3 · 07 ≈0.65 · 08 ≈1.1 · 09 ≈**1.5** · 10 ≈1.2 · 11 ≈0.6 · **12 = 0 · 13 = 0** · 14 ≈0.75 · 15 ≈1.2 · 16 ≈1.0 · 17 ≈0.8 · 18 ≈0.93
- **TEST (~15–20%):** sporadic, 55–460 MB on the days it was used (peak 07 Sep ≈ 460 MB).

Two things stand out:

1. **12–13 Sep (Sat/Sun) = zero on PROD.** A leaking background daemon would show a flat line. Instead usage follows *"someone had the app open"*. That matches a browser-tab poll.
2. Days with ~1 GB+ are ~1,400+ full-table downloads each. It only takes **one Planner tab open for ~6–7 hours**.

---

## 3. Root cause — how the app reads the database

```
Browser (Planner) ──15 s──►  Express API (:5001)  ──►  Supabase REST
   app/page.tsx:377           server/index.js:153        rows?select=*  (5 pages × 1000 rows)
```

**3.1 The poll** — `app/page.tsx:377-391`

```ts
// Planner: auto-poll every 15 seconds to pick up newly published rows from all teams
useEffect(() => {
  if (currentRole !== "Planner") return;
  const interval = setInterval(refreshRows, 15000);
  ...
```

`refreshRows` (`app/page.tsx:356`) calls `getAllRows()` → `GET /api/rows` → `db.getAllRows()` (`server/db.js:217`), which runs:

```js
supabase.from("rows").select("*").or("is_current.eq.true,is_current.is.null")
  .order("created_at", {ascending:false}).order("id", {ascending:true}).range(from, from+999)
```

in a loop until all pages are read. With ~4,930 rows that is **5 requests per poll**, and every request carries the whole row, including the `schedule` JSONB.

There is **no**:
- change detection (no `updated_at` column, no ETag, no "changed since" query),
- pause when the tab is hidden or the window is idle,
- server-side cache — every 15 s poll goes straight to Supabase,
- limit on how many tabs/users do this at once.

**3.2 Size of one poll** (measured against both projects with the exact query above):

| | PROD | TEST |
|---|---|---|
| Rows | 4,935 | 4,966 |
| Uncompressed | 6.35 MB | 6.19 MB |
| **On the wire (gzip)** | **0.64 MB** | 0.60 MB |

Node's `fetch` (used by `supabase-js`) requests gzip, and the numbers above only reconcile with Supabase's chart if billing counts the compressed bytes. So **use 0.64 MB per poll**.

**3.3 Rate**

| | |
|---|---|
| Polls / hour (tab visible) | 240 |
| Egress / hour | ≈ 154 MB |
| Free allowance (5 GB) | used up after ≈ **33 tab-hours** |
| One 6.5 h workday | ≈ 1.0 GB |

Roughly 5 working days of one open Planner tab, for the whole 5 GB. The billing cycle is already at 14 GB after 15 days.

**3.4 Corroboration from the API log (PROD, last 24 h, 23,390 requests)**

| Request | Count | Comment |
|---|---|---|
| `GET /rest/v1/rows … offset=0/1000/2000/3000/4000` | 1,384 / 1,386 / 1,385 / 1,385 / 1,384 | = **1,385 full downloads** |
| `GET /auth/v1/user` | 4,356 | one per Express API call |
| `GET /rest/v1/user_roles?select=role…` | 4,344 | one per Express API call |
| `POST /rest/v1/user_roles` (upsert) | 4,345 | one **write** per Express API call (`server/index.js:56-58`) |
| `POST /rest/v1/audit_logs` | 1,765 | one Express call per audit-log line |
| `GET /rest/v1/pending_updates?status=eq.pending` | 406 | the 60 s badge poll (`app/page.tsx:277-296`) → tab was open ≈ 6.8 h |
| `POST /rest/v1/backups` | 5 | pre-import snapshots (≈30 MB **ingress**) |

Arithmetic check: 1,385×5 + 4,345×3 + 1,765 + 406 ≈ 22.1 k of 23.4 k total requests. Each poll therefore costs **8 Supabase requests** (5 row pages + 3 auth/role calls).

---

## 4. Your JSON question — "do we save JSON?"

Yes — the `schedule` column is JSONB and backups store a JSONB snapshot. **That is not what is producing egress.**

- Writes (saving JSON, imports, backups) are **ingress**, which is not billed here. Ingress in the same 24 h was **29.8 MB**, against ≈ **925 MB** of egress.
- JSON only matters as *bytes per read*: `schedule` is ~33% of each row (≈1.3 KB avg row, ≈0.43 KB of it schedule). Even with that removed entirely, the poll would still cost ~2/3 as much. **The multiplier is the number of reads (1,385/day), not the JSON.**
- Backups are read only on *preview/restore* (`GET /api/backups/:id`); listing them selects metadata only (`server/db.js:815-829`). They are stored (20 × ~6 MB), which affects database *size* (52 MB — nowhere near the 500 MB limit), not egress.

---

## 5. Ruled out

| Suspect | Result |
|---|---|
| `server/sync.js` (PROD→TEST mirror, Realtime + 5-min `select *`) | Realtime messages and connections are **0** for the whole cycle. Its 5-min `select *` (unpaged) doesn't appear in the last 24 h of PROD logs. Not running; not a contributor (it would only be ≈30 MB/day even if it were). Separate bug: it only ever copies the first 1,000 of ~4,900 rows. |
| Google Apps Script (`integrations/google-sheet/Code.gs`) | `rebuildSheets` reads rows once/day (`fetchAllRows_`, `Code.gs:202`); `flushEdits` (every 10 min) never reads Supabase. A few MB/day at most. |
| Storage / images / Edge Functions / Realtime | All zero in the Usage page. |
| Large database | 52 MB / 34 MB. |
| Bots / stolen key | Not evidenced — request volume is fully explained by the app's own call pattern (section 3.4). See side note in section 7. |
| Something running right now | The last-60-minute API log showed only my own probe requests; ports 3000/5001 are not listening on this machine. The leak is **history**, not currently active. |

---

## 6. Waste found inside every poll

**6.1 A junk row named `bulk` (919 KB) is downloaded on every poll.**
- Exists in **both** PROD and TEST, created 2026-08-18 18:56 UTC.
- All `col*` are `null`; its `schedule` has **1,108 keys named `"0"` … `"1107"`**, each a full row object. That is the shape produced when a JSON **array** is spread into an object: `server/index.js:184` does `{ ...req.body, id: req.params.id }` on `PUT /api/rows/:id`, so a `PUT /api/rows/bulk` with an array body stored the whole array under id `bulk`. (Inferred from the shape; the client that sent it is not in current code — the current bulk route is `POST /api/rows/bulk` with `{rows}`.)
- It is ~14% of the uncompressed payload (~10% of the compressed bytes, estimated) and is thrown away by the blank-row filter in `server/db.js:269-282` *after* being fetched — which is why nobody noticed.
- It also holds 1,108 stale copies of real rows. Remove it once you've decided you don't need them (see 8.2).

**6.2** 15–17 other blank rows are fetched and then discarded by the same filter (small).

**6.3** ~41% of all `schedule` values are empty strings `""` (24,908 keys on PROD) — cleared events are stored as tombstones instead of being removed. Roughly 0.4–0.5 MB uncompressed per poll.

**6.4** One legitimate row (`row_1787843447456_…`, VS AE) has **987** schedule keys (~17 KB vs ~1 KB median) — probably accumulated stale date keys; worth a look.

**6.5** Every page load downloads the table **twice** for a Planner: `loadData` (`app/page.tsx:329`) plus the immediate `refreshRows()` in the poll effect (`:384-387`), and `getAuditLogs` (1,000 rows).

**6.6** `authMiddleware` (`server/index.js:29-75`) makes 3 Supabase calls per API request — including an **upsert write** every time for `Planner` — even for a 1-row save.

**6.7** `apiFetch` (`app/lib/db.ts:61-82`) retries every non-OK response 2 extra times, so failures cost 3×.

---

## 7. Risks to be aware of

1. **Monday 21 Sep — what happens when 402s start.** By reading the code (not tested): on any failure `getAllRows()` returns `[]` (`db.ts:231-234`) and `refreshRows` then does `setRows(rawRows)` (`page.tsx:370`), so **a failing poll will blank the Planner's table every 15 s**, with 3× retries each. Don't leave the planner open and unattended once restrictions start; fix the poll (8.1) before then.
2. Fixing the poll stops the growth, but the **cycle's 14 GB is already recorded** and can't be reduced. Whether Supabase lifts the restriction after a fix is their call — contact support, or consider Pro for a month.
3. **Side note (security, not the cause):** the PROD and TEST publishable keys are hard-coded in git-tracked `server/switch_db.js` and `server/sync.js`, and every table has RLS policy `FOR ALL USING (true)` (`server/supabase.sql`). Anyone who has the key can read/modify/delete everything via the REST API. Worth tightening separately.

---

## 8. Recommended fixes (implemented 2026-09-19 — see section 11)

Ordered by impact vs effort.

**8.1 Stop the blind 15 s full-table poll** (≈ 95%+ of egress)
- *Smallest change — server cache:* keep the `getAllRows` result in memory in `server/db.js`; invalidate on every write the server itself performs (`saveRow`, `upsertMultipleRows`, `deleteRow(s)`, `clearAllRows`, `seedDatabase`, `restoreBackup`, `applyPendingUpdates`) plus a TTL (e.g. 5 min). All row writes go through Express, so the 15 s poll then costs 0 Supabase egress. Filter per team in memory.
- *In the browser:* skip the poll when `document.hidden`, and slow it to 60–300 s.
- *Longer term:* add an `updated_at` column + trigger and poll only rows changed since the last check (needs a migration; today there is only `created_at`).

**8.2 Remove the `bulk` row and prevent a repeat** (≈ 10%)
- After confirming you don't need it: `delete from rows where id = 'bulk';` on **both** projects.
- Guard `PUT /api/rows/:id`: reject array bodies and non-`row_*` ids.
- Add `.neq("id","bulk")`/`.not(...)` or a non-null `col` filter in the `getAllRows` query so blank rows are never fetched.

**8.3 Trim the payload**: stop persisting `""` schedule tombstones; investigate the 987-key row.

**8.4 `authMiddleware`**: cache token → role for ~60 s; only upsert when the role row is actually missing (removes ~4.3 k writes/day and 2 of the 3 calls per request).

**8.5 Small ones**: drop the duplicate initial load; don't retry 4xx (esp. 402) in `apiFetch`; keep a failed poll from calling `setRows([])`.

**Expected result:** with 8.1 (cache) alone, a Planner day drops from ~1 GB to a few MB — roughly the size of the actual edits plus the occasional refresh.

---

## 11. Fix applied (2026-09-19)

A full PROD backup was taken first: `D:\Brandix\prod_backup_2026-09-19\` (all 8 tables, counts verified).
The fix is code-only (uncommitted in the working tree); **no data was changed and the `bulk` row was NOT deleted.**

| # | Change | File |
|---|---|---|
| 1 | **Rows cache.** `getAllRows` serves the whole table from memory. Supabase is re-read only after a row write (every writer is wrapped once at the bottom of `db.js`, in a `finally`) or after `ROWS_CACHE_TTL_MS` (default 60 min, raised from 5 min on 2026-09-21 — safety net for edits made outside this process). One cached copy serves all roles (team filters are applied in memory, same rules as before). Concurrent readers share one refill; a write that lands during a refill cannot leave stale data cached. | `server/db.js` |
| 2 | **Stale-if-error.** If a TTL refresh fails (e.g. Supabase 402 after the quota), the last good copy is served and retried after 30 s. After a *write* the error surfaces instead (never serves pre-write data). | `server/db.js` |
| 3 | The junk `bulk` row is excluded in the query (no longer downloaded on each refill). | `server/db.js` |
| 4 | `POST /api/ck-charts/dedupe` writes rows through its own client → it clears the cache itself. | `server/index.js` |
| 5 | **Auth middleware.** token → role cached 60 s; the `user_roles` upsert now happens only when the user has *no* role row (was: every request for every Planner). Also stops a transient select failure from overwriting a real role with "Planner". | `server/index.js` |
| 6 | Array bodies on `PUT /api/rows/:id` (and `bulk` as an id) and on `POST /api/rows` return 400 — the bug that created the `bulk` row. | `server/index.js` |
| 7 | Browser poll skips while the tab is hidden and refreshes when it becomes visible; a failed poll can no longer replace the table with `[]`. | `app/page.tsx` |

**Effect (measured against a fake client, plus the real server on TEST):**
- 41 polls → 2 Supabase pages (previously 82); on real Supabase, 7 requests → 1 refill (2.2 s cold, ~50 ms cached).
- Per poll, Supabase requests drop from 8 (5 row pages + 3 auth/role) to 0 while cached (1 getUser + 1 role select per minute per token).
- Planner day: ~1 GB → roughly the cost of a refill after each write burst + one per 5 min (order of tens of MB).

**Watching the cache (hit / miss)**
- **`http://localhost:5001/api/rows-cache`** — live counters: `hits`, `misses` (= Supabase refills, the only thing that costs egress), `waits`, `stale`, `invalidations` (writes), `hitRatePct`, `cachedRows`, `cacheAgeSeconds`, `lastRefill`, `supabasePageRequests`. Counters reset when the server restarts.
- **`X-Rows-Cache` response header** on `GET /api/rows` (browser DevTools → Network): `HIT` (from memory), `MISS` (this request re-read Supabase), `WAIT` (shared a refill already running), `STALE` (Supabase failed, old copy served).
- **Server console**: a `[DB] rows cache MISS -> refilled …` line on every refill, and a summary line every 10 minutes (`N hits, N misses, …`).
- **In the web app (header chip, left of the mail button):** `● Synced 11:06:57 AM · cache HIT` (green) / `cache MISS` (green; the server re-read the database). **Amber** `Old copy · database unreachable` = Supabase failed and the server sent its last saved copy. **Red** `Refresh failed … · showing data from HH:MM` = the last refresh failed and the table on screen is from the last good load. The **↻ button ("Refresh now")** skips the cache and reads straight from the database (`GET /api/rows?fresh=1`, throttled server-side to one forced re-read per 5 s). Implemented in `Header.tsx` (`RowsSyncChip`), `getLastRowsSync()` in `lib/db.ts`, and `page.tsx`.
- **Why nothing is missed:** every save made through the app clears the server cache immediately, so the next poll (≤15 s) shows it. The only changes that can lag are ones made *outside* the app (Supabase SQL editor, CLI scripts) — up to 60 min (`ROWS_CACHE_TTL_MS`) — and "Refresh now" removes even that wait.
- A healthy day looks like a hit rate above ~95%; misses should track "someone saved something" + about one per hour (TTL 60 min).

**To activate:** restart the Express server (`npm run dev:all` or `node server/index.js`) — the cache lives in that process. The page change hot-reloads.

**Known limits / follow-ups**
- Each write empties the cache, so the next read refills (~0.64 MB). Heavy editing = more refills; patching single rows into the cache would reduce that further if it ever matters.
- Edits made straight in the Supabase SQL editor or by the CLI scripts appear after the TTL (≤ 60 min) or a server restart, or immediately via "Refresh now". Lower `ROWS_CACHE_TTL_MS` in `server/.env` if that's too slow.
- `sync.js`'s periodic `select *` and the `bulk` row's deletion (`delete from rows where id = 'bulk';` on PROD and TEST) are left as they were.
- This does not reduce the 14 GB already recorded this billing cycle (04 Sep – 04 Oct).

---

## 9. How to confirm after the fix

1. Supabase → Project → Observability → API Gateway → *Last 24 hours*: count `GET /rest/v1/rows?select=*…offset=0`. Target: tens per day, not ~1,400.
2. Org → Usage → Egress per day: the weekday bars should fall from ~1 GB to well under 100 MB.
3. Rows requests per open tab-hour should go from 240 → ~0–12.

---

## 10. Method & limits

- Read the code paths (`app/page.tsx`, `app/lib/db.ts`, `server/index.js`, `server/db.js`, `server/sync.js`, `integrations/google-sheet/Code.gs`, `proxy.ts`).
- Measured real payload sizes with read-only REST GETs against both projects using the app's own publishable keys (temp copies deleted afterwards).
- Read Supabase's Usage and API Gateway pages in the browser (read-only).
- **Approximations:** daily bars are read off charts (±10%); the PROD/TEST split is approximate; the TEST-project call pattern is inferred from identical code, not from its logs; only the last 24 h of request logs is available on the Free plan (7-day logs are locked), so earlier days are inferred from the egress chart + the same mechanism.
- The origin of the `bulk` row (which client sent it) is inferred from its shape, not from logs.
