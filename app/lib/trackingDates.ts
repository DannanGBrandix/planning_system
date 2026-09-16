// Shared date-extraction helpers for the 1st/2nd Strike-Off AWB (Tracking Details) columns and
// the drop date buried in Strike-Off Comment text. Used both at import time (page.tsx writes the
// resolved ISO dates onto awb1Date/awb2Date/dropDate so future page loads don't have to
// re-parse) and by Summary of Graphics (which falls back to parsing live for any row imported
// before those fields existed).
import type { EmbellishmentRow } from "./db";
import { nearestYearIso, rowRefIso } from "./nycVerdict";

const MD_RE = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/g;

// The 1st/2nd Strike-Off AWB (Tracking Details) columns each carry a courier + date string, e.g.
// "DHL 04/24\r\n2454754584(NY Office)" or "Victoria - 9/9 - 2816301880" — the date sent is simply
// the first M/D-shaped token in that text.
export function extractDateFromTrackingText(raw: unknown, refIso: string | null): string | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const matches = Array.from(text.matchAll(MD_RE));
  if (matches.length === 0) return null;
  const m = matches[0];
  const mo = parseInt(m[1], 10);
  const da = parseInt(m[2], 10);
  if (!(mo >= 1 && mo <= 12 && da >= 1 && da <= 31)) return null;

  const yearTok = m[3];
  const iso = yearTok
    ? `${yearTok.length <= 2 ? 2000 + parseInt(yearTok, 10) : parseInt(yearTok, 10)}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`
    : nearestYearIso(mo, da, refIso);

  const t = Date.parse(iso + "T00:00:00");
  return Number.isNaN(t) ? null : iso;
}

// There is no dedicated "drop date" column anywhere in the data — per the planner, the drop date
// lives inside the freeform 1st/2nd Strike-Off Comment text, e.g. "AD 9/11 DROP". Mirrors the
// lead-date parsing parseCommentVerdict (lib/nycVerdict.ts) uses for NYC-A/NYC-R, but looks for a
// date near a drop/reallocate/moved word instead of a verdict word.
// Character-distance based rather than token-index based: real comments put the date and the
// drop word right next to each other with no space at all ("AD 9/04-DROPPED"), so splitting on
// whitespace first and walking token offsets misses those. Scanning the raw string for both
// patterns and pairing each drop word with its nearest date handles any spacing/punctuation.
// Prefix-shaped so real typos survive ("Droppped", "droped") without also matching an unrelated
// word like "Dropping" (as in "...Dropping heart cut out from AW...", not a status drop).
const DROP_WORD_RE = /\b(?:DROPP{0,2}E?D?|REALLOCAT\w*|MOVED)\b/gi;
const MAX_DROP_DATE_DISTANCE = 20; // characters between the drop word and its date

export function extractDropDateIso(row: EmbellishmentRow): string | null {
  const refIso = rowRefIso(row);
  const candidates: { iso: string; t: number }[] = [];

  [row.col22, row.col34].forEach((raw) => {
    const text = String(raw || "");
    const dropMatches = Array.from(text.matchAll(DROP_WORD_RE));
    if (dropMatches.length === 0) return;
    const dateMatches = Array.from(text.matchAll(MD_RE));
    if (dateMatches.length === 0) return;

    dropMatches.forEach((dm) => {
      const dropPos = dm.index ?? -1;
      if (dropPos < 0) return;

      let best: { m: RegExpMatchArray; dist: number } | null = null;
      for (const dateM of dateMatches) {
        const datePos = dateM.index ?? -1;
        if (datePos < 0) continue;
        const dist =
          dropPos > datePos ? dropPos - (datePos + dateM[0].length) : datePos - (dropPos + dm[0].length);
        if (dist > MAX_DROP_DATE_DISTANCE) continue;
        if (!best || dist < best.dist) best = { m: dateM, dist };
      }
      if (!best) return;

      const mo = parseInt(best.m[1], 10);
      const da = parseInt(best.m[2], 10);
      if (!(mo >= 1 && mo <= 12 && da >= 1 && da <= 31)) return;

      const yearTok = best.m[3];
      const iso = yearTok
        ? `${yearTok.length <= 2 ? 2000 + parseInt(yearTok, 10) : parseInt(yearTok, 10)}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`
        : nearestYearIso(mo, da, refIso);

      const t = Date.parse(iso + "T00:00:00");
      if (Number.isNaN(t)) return;
      candidates.push({ iso, t });
    });
  });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.t - a.t);
  return candidates[0].iso;
}
