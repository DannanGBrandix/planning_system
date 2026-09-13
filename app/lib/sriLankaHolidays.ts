// Sri Lanka public / bank / mercantile holiday calendar, used by the auto-scheduler
// (addWorkingDays / subtractWorkingDays in planningFlows.ts) so planning events land on an
// actual working day — never a weekend AND never a Sri Lankan public holiday — and by the
// planning calendar (Table.tsx) to flag holiday date columns the same way it already flags
// Saturday/Sunday.
//
// Sources (cross-checked, both agree): govt.sl official holiday calendar and utils.lk, both
// fetched 2026-08-23.
//   - https://govt.sl/en-us/public-holidays.php
//   - https://www.utils.lk/holidays
//
// Sri Lanka's calendar includes a Poya (full moon) holiday every month, plus Sinhala/Tamil New
// Year, Vesak, Id-Ul-Fitr, Id-Ul-Alha, Deepavali, Christmas, etc. — most of these are set by
// lunar/religious observance and shift every year, so this list has to be refreshed annually
// once the next year's gazette is published (usually in December of the preceding year).
//
// TO ADD A NEW YEAR: append its dates to SRI_LANKA_HOLIDAYS below, in "YYYY-MM-DD": "Name" form.
// Nothing else needs to change — every helper here reads from this one map.

export const SRI_LANKA_HOLIDAYS: Record<string, string> = {
  // ── 2026 ──────────────────────────────────────────────────────────────────
  "2026-01-03": "Duruthu Full Moon Poya Day",
  "2026-01-15": "Tamil Thai Pongal Day",
  "2026-02-01": "Navam Full Moon Poya Day",
  "2026-02-04": "Independence Day",
  "2026-02-15": "Maha Sivarathri Day",
  "2026-03-02": "Medin Full Moon Poya Day",
  "2026-03-21": "Id-Ul-Fitr (Ramazan Festival Day)",
  "2026-04-01": "Bak Full Moon Poya Day",
  "2026-04-03": "Good Friday",
  "2026-04-13": "Day Prior to Sinhala & Tamil New Year",
  "2026-04-14": "Sinhala & Tamil New Year Day",
  "2026-05-01": "May Day / Vesak Full Moon Poya Day",
  "2026-05-02": "Day Following Vesak Full Moon Poya Day",
  "2026-05-28": "Id-Ul-Alha (Hadji Festival Day)",
  "2026-05-30": "Adhi Poson Full Moon Poya Day",
  "2026-06-29": "Poson Full Moon Poya Day",
  "2026-07-29": "Esala Full Moon Poya Day",
  "2026-08-26": "Milad-Un-Nabi (Holy Prophet's Birthday)",
  "2026-08-27": "Nikini Full Moon Poya Day",
  "2026-09-26": "Binara Full Moon Poya Day",
  "2026-10-25": "Vap Full Moon Poya Day",
  "2026-11-08": "Deepavali Festival Day",
  "2026-11-24": "Il Full Moon Poya Day",
  "2026-12-23": "Unduvap Full Moon Poya Day",
  "2026-12-25": "Christmas Day",
};

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True if the given Date falls on a Sri Lankan public holiday (compared in local time). */
export function isSriLankaHoliday(date: Date): boolean {
  return Object.prototype.hasOwnProperty.call(SRI_LANKA_HOLIDAYS, toDateKey(date));
}

/** The holiday's name for the given Date, or undefined if it isn't one. */
export function getSriLankaHolidayName(date: Date): string | undefined {
  return SRI_LANKA_HOLIDAYS[toDateKey(date)];
}
