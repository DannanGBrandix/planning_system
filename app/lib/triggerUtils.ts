// Shared helpers for anything that groups rows by their Trigger (col2) value — the
// "TRIGGER & SUB-CATEGORY AOQ DATES" card on Advanced Analytics and the dedicated Trigger
// Manager page (TriggerManagementView) both need to parse/format the AOQ Date (col20) the same
// way, so those two small parsers live here once instead of drifting apart as two copies.

// Recognizes an actual date buried in an AOQ Date cell, rejecting status words / free text that
// sometimes end up in the same column (e.g. "Approved", "Will proceed once finalize the Thread").
export function extractValidDate(str: unknown): string | null {
  if (!str) return null;
  const val = String(str).trim();
  if (!val) return null;

  const lower = val.toLowerCase();
  if (
    [
      "approved",
      "active",
      "pending",
      "dropped",
      "none",
      "n/a",
      "-",
      "null",
      "undefined",
      "pass",
      "fail",
    ].includes(lower)
  ) {
    return null;
  }

  // Reject text containing English words (e.g. "Will proceed once finalize the Thread", "COST OPT 6/20")
  if (/[a-zA-Z]{4,}/.test(val) && !val.includes("T00:00:00")) {
    return null;
  }

  // Match ISO YYYY-MM-DD
  const isoMatch = val.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoMatch) {
    return isoMatch[0];
  }

  // Match MM/DD/YYYY or M/D/YYYY
  const slashMatch = val.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
  if (slashMatch) {
    const [m, d, y] = slashMatch[0].split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return null;
}

// Formats an ISO / US-style date string as DD/MM/YYYY for display. Returns the original string
// unchanged if it isn't recognizably a date (so we never silently hide unexpected data).
export function formatDateDDMMYYYY(val: unknown): string | null {
  if (!val) return null;
  const s = String(val).trim();
  if (!s || s === "Not Set" || s === "N/A") return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [p1, p2, y] = s.split("/");
    const dStr = parseInt(p1, 10) > 12 ? p1 : p2;
    const mStr = parseInt(p1, 10) > 12 ? p2 : p1;
    return `${dStr.padStart(2, "0")}/${mStr.padStart(2, "0")}/${y}`;
  }

  const dObj = new Date(s);
  if (!isNaN(dObj.getTime())) {
    const dd = String(dObj.getDate()).padStart(2, "0");
    const mm = String(dObj.getMonth() + 1).padStart(2, "0");
    const yyyy = dObj.getFullYear();
    if (yyyy > 2000 && yyyy < 2100) {
      return `${dd}/${mm}/${yyyy}`;
    }
  }

  return s;
}

// A handful of Trigger (col2) values name a stand-alone marketing event / capsule (Super Bowl,
// …) that sits INSIDE a season but is planned and reported on its own. Every default view hides
// these: a plain Category + Season filter (e.g. VS AE + SP27) should show the regular seasonal
// flow only, not the event rows folded in on top of it. They reappear the moment that Trigger
// is explicitly picked in the Trigger filter. Patterns are matched case-insensitively anywhere
// in the Trigger text. `sup+er\s*bowl` deliberately covers every spelling seen in the charts —
// "super bowl", the frequent "supper bowl" typo, "superbowl", "Superbowl - Brandix", etc.
// Add another event by appending its pattern here.
export const HIDDEN_EVENT_TRIGGER_PATTERNS: RegExp[] = [/sup+er\s*bowl/i];

export function isHiddenEventTrigger(triggerRaw: unknown): boolean {
  const t = String(triggerRaw || "");
  if (!t.trim()) return false;
  return HIDDEN_EVENT_TRIGGER_PATTERNS.some((re) => re.test(t));
}

// A col2 (Trigger) value this blank/placeholder is treated as "no Trigger set" everywhere else
// in the app (the "All Triggers" filter, the merge-time import fallback) — kept here so the
// Trigger Manager page's grouping agrees with them instead of drifting into its own definition.
export function isValidTriggerValue(s: unknown): boolean {
  const str = String(s || "").trim();
  if (!str) return false;
  const upper = str.toUpperCase();
  return upper !== "N/A" && upper !== "-";
}

// Key format shared by the Trigger Manager's "Season AOQ Dates" table and Plant Performance's
// AOQ fallback lookup (SeasonAoqMap from app/lib/db.ts) — a Trigger with no date of its own
// (col20 blank, text doesn't parse as an M.D code) falls back to its Category+Season deadline,
// since PINK/VS/CK each run their own AOQ calendar even within the same season.
export function seasonAoqKey(category: unknown, season: unknown): string {
  return `${String(category || "").trim().toUpperCase()}|||${String(season || "").trim().toUpperCase()}`;
}
