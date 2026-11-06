// Colour-approval ("final chop") replan.
//
// A graphic that already went through its development plan sometimes has to be planned AGAIN for
// the colour approval / final chop. The old plan must stay on the same row (it is the plant's real
// history) and the new run is added after it — but the new run is NOT development work, so it must
// not move the plant's Plant Performance score (PPS on time / failed, approved before AOQ).
//
// Storage: the replan's start date is recorded on a "cpr:<YYYY-MM-DD>" key (value "1"), kept in the
// schedule JSONB like the "nycv:" keys. Every event dated on/after the EARLIEST such marker belongs
// to a colour-approval run. "cpr:" keys do not match /^\d{4}-\d{2}-\d{2}/, so nothing that scans
// event keys picks them up.

export const COLOR_REPLAN_PREFIX = "cpr:";
const CPR_RE = /^cpr:(\d{4}-\d{2}-\d{2})$/;
const EVENT_KEY_RE = /^(\d{4}-\d{2}-\d{2})(?:_.+)?$/;
const NYCV_RE = /^nycv:(\d{4}-\d{2}-\d{2})$/;

/** Start dates of the row's colour-approval runs, oldest first. */
export function getColorReplanStarts(row: Record<string, unknown>): string[] {
  return Object.keys(row)
    .map((k) => {
      const m = k.match(CPR_RE);
      return m && String(row[k] ?? "").trim() ? m[1] : null;
    })
    .filter((d): d is string => !!d)
    .sort();
}

/** Earliest colour-approval run start, or null when the row has none. */
export function colorReplanFrom(row: Record<string, unknown>): string | null {
  return getColorReplanStarts(row)[0] ?? null;
}

/** True when an event on this ISO date belongs to a colour-approval run. */
export function isColorReplanDate(row: Record<string, unknown>, iso: string): boolean {
  const from = colorReplanFrom(row);
  return !!from && iso >= from;
}

/**
 * The row as Plant Performance should see it: every planning event ("<date>" / "<date>_<leg>")
 * and NY verdict ("nycv:<date>") on/after the first colour-approval run start is dropped. Rows
 * without a colour-approval run are returned unchanged (same object).
 */
export function withoutColorReplanEvents<T extends Record<string, unknown>>(row: T): T {
  const from = colorReplanFrom(row);
  if (!from) return row;
  const out: Record<string, unknown> = {};
  Object.entries(row).forEach(([k, v]) => {
    const m = k.match(EVENT_KEY_RE) || k.match(NYCV_RE);
    if (m && m[1] >= from) return;
    out[k] = v;
  });
  return out as T;
}

// "FR-S" -> "FR", "PPS|P" -> "PPS", "REAP/FCHP-S" -> "REAP/FCHP".
const eventBase = (v: string) => v.split("|")[0].trim().toUpperCase().replace(/-(S|F|T|PASS|FAIL)$/i, "");

/**
 * A colour-approval run only goes up to PPS. NY and everything after it (NYC, post-NY tests like
 * DTC-3010, MAST, REAP/FCHP, PLSD, PLSA) is not needed. Takes a freshly scheduled plan's bare date
 * keys -> values and returns the date keys to keep. The run is cut on the first NY/NYC day. If the
 * flow has no NY step (Branding/Trial, the no-NY fabric flow), it is cut after the last PPS day
 * instead. A flow with neither (Fit Functionals' PPS-FF) is returned whole.
 */
export function colorReplanKeptKeys(plan: Record<string, unknown>): string[] {
  const keys = Object.keys(plan)
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && String(plan[k] ?? "").trim())
    .sort();
  const firstNy = keys.find((k) => ["NY", "NYC"].includes(eventBase(String(plan[k]))));
  if (firstNy) return keys.filter((k) => k < firstNy);
  const lastPps = [...keys].reverse().find((k) => eventBase(String(plan[k])) === "PPS");
  if (lastPps) return keys.filter((k) => k <= lastPps);
  return keys;
}

/**
 * Markers ("cpr:<date>" keys) whose run no longer has any event on/after it — e.g. the planner
 * cleared that run. Callers set these to "" so the server drops them.
 */
export function orphanedColorReplanMarkers(row: Record<string, unknown>): string[] {
  const eventDates = Object.keys(row)
    .map((k) => (String(row[k] ?? "").trim() ? k.match(EVENT_KEY_RE)?.[1] : undefined))
    .filter((d): d is string => !!d);
  return getColorReplanStarts(row)
    .filter((start) => !eventDates.some((d) => d >= start))
    .map((start) => `${COLOR_REPLAN_PREFIX}${start}`);
}
