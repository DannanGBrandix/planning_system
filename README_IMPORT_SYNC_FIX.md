# Excel Import → Database Sync: Bug Fix Notes

This note explains a bug in the Excel re-import flow, what was actually
wrong, and how it was fixed. Written in plain language so anyone on the
team can follow it — not just developers.

---

## 🐛 The bug (what you were seeing)

When re-uploading an updated Excel plan on top of data that was already in
the database, some changes weren't landing correctly:

- A row that already existed (e.g. graphic **GVH26-541**) would show up
  **twice** after import — an old copy and a new copy — instead of the
  single row being updated with the new info (like a DHL tracking number
  that wasn't there before).
- The **Trigger** column would sometimes get wiped and replaced with
  `N/A`, even though the database already had the correct value.

Root cause: it wasn't that the database update itself was broken — it was
that the app was failing to recognize "this Excel row is the same row as
that database row," so it either overwrote the wrong data or created a
duplicate instead of updating in place.

---

## 🔍 Root causes found

### 1. Season / Category weren't actually checked when matching rows

The code that decides "is this Excel row the same as an existing database
row?" compares **Style + Combo + Graphic + Ground + Technique**. It was
*supposed* to also require the **Category** and **Season** to match — there
was even a comment in the code saying so — but that check was never
actually wired in. It was calculated and then never used.

**Effect:** a row could accidentally match (or fail to match) a row from a
*different season*, because season/category weren't part of the identity
check. A failed match doesn't update the existing row — it silently
creates a brand new duplicate row instead. That's almost certainly what
produced the GVH26-541 "double entry" — DHL just happened to land on the
new duplicate row, not the original one.

### 2. The Trigger column could get force-reset to "N/A"

If an uploaded Excel file didn't have a recognizable Trigger column for a
given row, the old code immediately set that row's Trigger to the literal
text `"N/A"` **before** even checking what was already saved in the
database. That `"N/A"` was then treated as "new data from the file" and
overwrote the real, correct Trigger value already stored for that row.

**Effect:** re-importing a file that was missing/misformatted the Trigger
column for some rows would quietly erase good Trigger data on those rows.

### 3. Word-wrapped text under Season (e.g. "ICON SHOP") was silently dropped

Some Season cells have a second piece of text under the season code — like
`SP27` with `ICON SHOP` wrapped onto a second visual line beneath it
inside the same cell. In Excel that's usually just **word-wrap** (the
column is too narrow to fit the text on one line) — the cell's actual
stored value is a single line: `"SP27 ICON SHOP"`. There's no real
line-break character in it.

The Trigger-extraction logic could only recognize a *real* line break
(from someone pressing Alt+Enter). Since a word-wrapped cell doesn't have
one, text like `ICON SHOP` fell through every check and was thrown away —
it never reached the Season column (which only keeps the season code) or
the Trigger column (which required either a real 2nd line or a numeric
date code).

**Effect:** any label typed after the season code — like `ICON SHOP` —
disappeared during import, with no trace of it saved anywhere.

---

## ✅ The fix

All three fixes were made in `app/page.tsx`, in the Excel import logic.

1. **Season/Category are now enforced as part of row identity.**
   A row match now requires Season and Category to agree too (only when
   both the file and the database actually have a value for them — so
   files that don't include those columns still work as before). This
   makes the app correctly recognize "this is the same row" and update it
   in place, instead of creating a duplicate.

2. **Trigger is no longer force-defaulted to `"N/A"` while parsing.**
   If the file doesn't have a usable Trigger value for a row, it's now
   left blank during parsing. The existing "smart fallback" logic (which
   already runs later, once the row has been matched to the database) is
   the only place allowed to decide the final value — and it always
   checks the existing database value first before ever falling back to
   `"N/A"`.

3. **The Trigger extractor now also catches word-wrapped text**, not just
   text on a real second line. It finds the recognizable season code at
   the start of the cell (e.g. `SP27`) and treats whatever text is left
   over after it — wrapped onto a visual second line or just following a
   space on the same line — as the Trigger value. So `SP27 ICON SHOP` and
   `SP27` + Alt+Enter + `ICON SHOP` are now both handled the same way, and
   `ICON SHOP` gets saved into the Trigger column instead of being
   dropped.

No changes were needed on the backend / database side — when the app
*does* decide a row changed, it already sends the **entire row** (every
column: status, comments, DHL tracking, everything) to the server, which
performs a full update keyed by that row's unique ID. That part was
always working correctly; the bug was upstream, in deciding *which* row to
update and *what* the new values should be.

---

## 🔁 How the import flow works now (step by step)

1. **Upload** — you pick an Excel/CSV file. The app reads every column and
   maps the headers (Status, Trigger, Graphic, Ground, Comment, etc.) into
   its internal format.
2. **Match** — for each row in the file, the app looks for the matching
   row already in the database, using Style + Combo + Graphic + Ground +
   Technique **and now Season + Category too**.
3. **Merge** — if a match is found, the new values from the file are
   layered on top of the existing database row (blank cells in the file
   don't erase existing data).
4. **Compare** — every single column is compared old vs. new. If
   **anything** differs — comment, status, DHL number, literally any
   column — the row is flagged as changed.
5. **Preview** — the "CSV Data Import Analysis" screen shows you counts of
   Matched / New / Unchanged rows before anything is saved, so you can
   sanity-check the import.
6. **Sync** — on "Confirm & Sync," every changed or new row is written to
   the database as a **full row update** (all columns), keyed by that
   row's unique ID — so nothing gets partially updated or left stale.

---

## ⚠️ Known follow-up: existing duplicates

This fix stops **new** duplicates from being created going forward. It
does **not** automatically clean up duplicate rows that the old bug may
have already created in the database before this fix was applied.

If you're seeing rows you know are duplicates (same graphic/style/combo,
one with older data and one with newer data), those need a one-time
cleanup pass to merge them back into a single row. Ask for this to be
built as a separate script — it wasn't run automatically since deleting
data always needs a human to confirm first.
