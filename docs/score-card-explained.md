# How Score Card Is Calculated (Plain-English Guide)

This explains the numbers on the **Score Card** page — no code, just the logic.

## The big idea

For every **graphic** (a design, not a row — one graphic can have several rows/legs), we ask two questions:

1. **Which plant(s) did it go to?**
2. **Did it get NY-approved before the deadline?**

Then we add up the answers, plant by plant, to get a score.

## Step 1 — Which graphics count?

- Only graphics in the **Season / Category** you've picked.
- Graphics marked **Dropped** or **Hold** are thrown out first — they're not "in the running."
- Everything else that's live gets scored.

## Step 2 — Find the deadline (the "AOQ date")

Every graphic needs a deadline to be judged against. We look in three places, first one found wins:

1. A real date already sitting in the row (**S-Off Req column**, col20).
2. If not, the **Trigger** name itself sometimes encodes a date (like "AD 5.12"). We work out which year that means.
3. If still nothing, we fall back to a deadline set for that **Category + Season** on the Trigger Manager page (a shared default, e.g. "all VS AE SP27 graphics are due 12-May").

If a graphic has several rows with different dates, we use the **latest** one (gives it the benefit of the doubt).

## Step 3 — Find out if/when it got approved

We look for an **NYC-A (approved)** or **NYC-R (rejected)** verdict, checked in this order:

1. A verdict already saved on the row.
2. A verdict someone set by hand.
3. A verdict figured out automatically the last time "Recompute NY approvals" was run.
4. As a last resort, read the strike-off comment live and guess ("approved", "rejected", etc.).

If there's an "Approved" status but genuinely no date anywhere to hang it on, and the **"Include undated approvals"** checkbox is ticked, we borrow the date of its last NYC event as a stand-in — marked with a **≈** so you know it's estimated.

## Step 4 — Decide the verdict

Compare the approval date to the deadline (plus a few **grace days**, adjustable on the page):

| Situation | Verdict |
|---|---|
| Approved on/before deadline + grace | ✅ **On time** |
| Approved after deadline + grace | 🟠 **Late** |
| Rejected (and that's the newest verdict) | 🔴 **Rejected** |
| Approved, but no deadline exists to compare to | ⚪ **Unscored** |
| Nothing decided yet | ⚫ **Pending** |

## Step 5 — Roll it up per plant

Every plant a graphic touched (from the Plant / Plant Flow columns) gets credited with that graphic's verdict. A graphic with two plants counts once for each.

For each plant we then get:
- **Allocated** — how many graphics it received
- **On time / Late / Rejected / Pending / Unscored** — counts of each verdict
- **Score % = On time ÷ Allocated × 100**  ← the main ranking number
- **Net score = (On time × 40) − ((Late + Rejected) × 60)**  ← a stricter number that punishes problems harder than it rewards good ones; used as a tiebreaker

## The two knobs on the page

- **AOQ grace (days)** — how many extra days after the deadline still count as "on time."
- **Include undated approvals** — whether an "Approved" graphic with no real date still counts (as an estimate), or gets ignored until it has one.

Turning these changes the On time/Late/Score numbers — nothing else about the underlying data.

## What plant merging/hiding does

If two spellings really mean the same plant (or a plant shouldn't appear at all), you can merge or hide it from this page. This is purely cosmetic — it only changes how graphics are *grouped for display*, it never edits the actual Plant column on any row, and can be undone any time.
