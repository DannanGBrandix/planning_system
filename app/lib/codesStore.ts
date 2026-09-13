// Keeps the in-memory EVENT_CODES / REASON_CODES / EVENT_REASON_PRIORITY in
// app/lib/eventCodes.ts in sync with the Supabase `event_codes` / `reason_codes`
// tables (the single source of truth, seeded by `npm run seed:codes`).
//
// The arrays exported from eventCodes.ts stay the same references — this module
// mutates their *contents* in place, so every existing consumer (and the pure
// helpers like getReasonByCode / getGroupedReasonsForEvent) picks up the live
// list on its next read. If the API is unreachable or returns nothing, the
// values bundled in eventCodes.ts remain as the fallback.

import {
  REASON_CODES,
  EVENT_CODES,
  ALL_EVENT_CODES,
  EVENT_REASON_PRIORITY,
  type ReasonCode,
  type EventCode,
} from "./eventCodes";
import { getReasonCodes, getEventCodes } from "./db";

let loaded = false;
let inflight: Promise<void> | null = null;

function replaceInPlace<T>(target: T[], next: T[]): void {
  target.length = 0;
  for (const item of next) target.push(item);
}

const EVENT_CATEGORIES: EventCode["category"][] = ["internal", "external", "test", "approval"];

export function codesLoaded(): boolean {
  return loaded;
}

export async function loadCodes(force = false): Promise<void> {
  if (loaded && !force) return;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const [reasons, events] = await Promise.all([getReasonCodes(), getEventCodes()]);

      if (reasons.length) {
        const mapped: ReasonCode[] = reasons.map((r) => ({
          code: r.code,
          label: r.label,
          responsible: r.responsible || "",
          ...(r.notes ? { notes: r.notes } : {}),
          ...(r.deprecated ? { deprecated: true } : {}),
        }));
        replaceInPlace(REASON_CODES, mapped);
      }

      if (events.length) {
        const mapped: EventCode[] = events.map((e) => ({
          code: e.code,
          label: e.label,
          description: e.description || "",
          category: EVENT_CATEGORIES.includes(e.category as EventCode["category"])
            ? (e.category as EventCode["category"])
            : "internal",
          hasPassFail: e.has_pass_fail !== false,
        }));
        replaceInPlace(EVENT_CODES, mapped);
        replaceInPlace(ALL_EVENT_CODES, mapped.map((e) => e.code));

        const priority = events
          .filter((e) => Array.isArray(e.recommended_reason_codes) && e.recommended_reason_codes.length)
          .map((e) => ({ events: [e.code], reasonCodes: e.recommended_reason_codes }));
        if (priority.length) replaceInPlace(EVENT_REASON_PRIORITY, priority);
      }

      loaded = reasons.length > 0 || events.length > 0;
    } catch {
      // Keep the bundled fallback values.
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
