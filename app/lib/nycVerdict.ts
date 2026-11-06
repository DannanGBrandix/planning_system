// ============================================================
// NYC approval verdict (NYC-A / NYC-R)
// ============================================================
// `NYC` = "NY comments received" (an ordinary planning milestone). It is NOT an
// approval. Once the comments are in hand the graphic gets a verdict:
//   NYC-A  = NY approved
//   NYC-R  = NY rejected / re-strike required
//
// Where the verdict comes from:
//   - VS / PINK: the strike-off comment columns (col22 = 1st, col34 = 2nd) already
//     carry the wording + date, e.g. "AD 8/27 - S/O DATED 8/19/26 APPROVED LAYOUT..."
//     -> parseCommentVerdict reads it automatically (the date right after the
//     initials is the verdict date, NOT the later "S/O DATED x").
//   - CK: no such wording, so a person sets it by hand (grid event picker writes a
//     real "<date>" NYC-A/NYC-R cell; Daily Events Excel and the Score Card
//     drill-down call markNycVerdict, which writes a "nycv:<date>" key).
//
// Storage: derived verdicts live on "nycv:<YYYY-MM-DD>" keys (value "NYC-A"/"NYC-R").
// A manually set one is suffixed with "*" ("NYC-A*") so deriveNycVerdict never
// overwrites it. "nycv:" keys do NOT match /^\d{4}-\d{2}-\d{2}$/, so they are
// invisible to the auto-scheduler, every export, and every other date-key path —
// they still persist because server/db.js routes any non-col*/non-top-level key
// into the schedule JSONB.

import { parseEventValue } from "./eventCodes";
import { extractValidDate, seasonAoqKey, seasonBase } from "./triggerUtils";

export const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const NYCV_RE = /^nycv:(\d{4}-\d{2}-\d{2})$/;

// ── shared date helpers (also used by ScoreCardDashboard) ────────────

// "4.7/4.28" -> [[4,7],[4,28]] · "3/17" -> [[3,17]] · "5.26" -> [[5,26]] · Excel serial -> [[m,d]]
export function parseTriggerMD(trigger: string): [number, number][] {
  const t = String(trigger || "").trim();
  if (!t) return [];
  if (/^\d{4,6}$/.test(t)) {
    const n = parseInt(t, 10);
    if (n > 20000 && n < 80000) {
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      return [[d.getUTCMonth() + 1, d.getUTCDate()]];
    }
    return [];
  }
  const hasDot = t.includes(".");
  const tokens = hasDot ? t.split("/") : [t];
  const out: [number, number][] = [];
  for (let tok of tokens) {
    tok = tok.trim().replace(/\s*drop\s*/i, "");
    const m = tok.match(/^(\d{1,2})[./](\d{1,2})$/);
    if (!m) continue;
    const mo = parseInt(m[1], 10);
    const da = parseInt(m[2], 10);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) out.push([mo, da]);
  }
  return out;
}

// A bare month/day ("8/27") has no year — pick whichever of ref±1 year lands closest
// to `refIso` (the row's own NY/NYC/PPS event dates).
export function nearestYearIso(month: number, day: number, refIso: string | null): string {
  const refYear = refIso ? parseInt(refIso.slice(0, 4), 10) : new Date().getFullYear();
  let best = "";
  let bestDiff = Infinity;
  for (const y of [refYear - 1, refYear, refYear + 1]) {
    const iso = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const diff = refIso ? Math.abs(Date.parse(iso) - Date.parse(refIso)) : 0;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = iso;
    }
  }
  return best;
}

// Latest NYC / NY / PPS dated-event ISO on the row — the neighbourhood a bare month/day
// verdict/trigger date most likely belongs to. Scans flattened keys + the schedule JSON.
export function rowRefIso(row: Record<string, unknown>): string | null {
  const cands: { iso: string; prio: number }[] = [];
  const scan = (k: string, v: unknown) => {
    if (typeof v !== "string" || !v.trim()) return;
    const m = k.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!m) return;
    const b = v.split("|")[0].trim().toUpperCase().split("-")[0];
    const prio = b === "NYC" ? 3 : b === "NY" ? 2 : b === "PPS" ? 1 : 0;
    cands.push({ iso: m[1], prio });
  };
  Object.entries(row).forEach(([k, v]) => scan(k, v));
  const sched = (row as { schedule?: unknown }).schedule;
  if (sched && typeof sched === "object") {
    Object.entries(sched as Record<string, unknown>).forEach(([k, v]) => scan(k, v));
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.prio - a.prio || b.iso.localeCompare(a.iso));
  return cands[0].iso;
}

// ── comment verdict parsing ────────────────────────────────────────────────

export interface CommentVerdict {
  kind: "A" | "R";
  iso: string;
}

// Each comment line is "<initials> <M/D>[/YY] [:|-] <text>". The <M/D> right after the
// initials is when that note was made; the text carries the verdict word. Ignores any
// later "S/O DATED 8/19/26" style date on the same line.
const LEAD_DATE_RE = /^\s*[A-Za-z][A-Za-z.\/&]{0,4}\s+(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s*[:\-]?/;
// "approved on 8/25" / "approved by victoria on 8/25" anywhere in a line without a lead date.
const APPROVED_ON_RE = /\bAPPROVED\s+(?:BY\s+[A-Za-z.'\- ]{1,30}?\s+)?ON\s+(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/i;

export function parseCommentVerdict(
  col22?: unknown,
  col34?: unknown,
  refIso?: string | null,
): CommentVerdict | null {
  const lines: string[] = [];
  [col22, col34].forEach((c) => {
    String(c ?? "").split(/\r?\n/).forEach((ln) => {
      const t = ln.trim();
      if (t) lines.push(t);
    });
  });

  let best: (CommentVerdict & { t: number }) | null = null;
  for (const line of lines) {
    const m = line.match(LEAD_DATE_RE);
    if (!m) {
      // Free-text approvals with no leading initials+date: "Based on digital Approved by
      // victoria on 8/25 (...)" — the date after "approved [by <name>] on" is the approval.
      if (/\b(?:NOT|TO\s+BE|PENDING)\s+APPROVED\b/i.test(line)) continue;
      const a = line.match(APPROVED_ON_RE);
      if (!a) continue;
      const mo = parseInt(a[1], 10);
      const da = parseInt(a[2], 10);
      if (!(mo >= 1 && mo <= 12 && da >= 1 && da <= 31)) continue;
      const iso = a[3]
        ? `${a[3].length <= 2 ? 2000 + parseInt(a[3], 10) : parseInt(a[3], 10)}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`
        : nearestYearIso(mo, da, refIso ?? null);
      const t = Date.parse(iso + "T00:00:00");
      if (Number.isNaN(t)) continue;
      if (!best || t >= best.t) best = { kind: "A", iso, t };
      continue;
    }
    const mo = parseInt(m[1], 10);
    const da = parseInt(m[2], 10);
    if (!(mo >= 1 && mo <= 12 && da >= 1 && da <= 31)) continue;

    const text = line.slice(m[0].length);
    if (/\bDROP|\bREALLOCAT|\bMOVED\b/i.test(text)) continue; // drop -> handled by getRowStatus, not here

    let kind: "A" | "R" | null = null;
    if (/\bRE-?\s?SUB|\bRE-?\s?STRIKE|\bREJECT/i.test(text)) kind = "R";
    else if (/\bAPPROVED\b/i.test(text)) kind = "A"; // past tense only — "to approve" / "region to approve" don't count
    if (!kind) continue;

    let iso: string;
    if (m[3]) {
      const yr = m[3].length <= 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
      iso = `${yr}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    } else {
      iso = nearestYearIso(mo, da, refIso ?? null);
    }
    const t = Date.parse(iso + "T00:00:00");
    if (Number.isNaN(t)) continue;
    if (!best || t >= best.t) best = { kind, iso, t }; // latest note wins
  }

  return best ? { kind: best.kind, iso: best.iso } : null;
}

// ── verdict read / write ───────────────────────────────────────────────────

export interface NycVerdict {
  kind: "A" | "R";
  iso: string;
  source: "cell" | "manual" | "derived" | "comment";
}

// The graphic's NY verdict, in priority order:
//   1. a real "<date>" NYC-A / NYC-R cell (placed by hand in the grid picker)
//   2. a "nycv:<date>" key — "*" suffix = manual (Daily Events / drill-down), else derived
//   3. parse the strike-off comments on the fly (nothing materialised yet)
export function readNycVerdict(row: Record<string, unknown>): NycVerdict | null {
  let cell: { kind: "A" | "R"; iso: string } | null = null;
  let nycv: { kind: "A" | "R"; iso: string; manual: boolean } | null = null;

  for (const [k, v] of Object.entries(row)) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (ISO_RE.test(k)) {
      const c = (parseEventValue(s)?.code || "").toUpperCase();
      if (c === "NYC-A" && (!cell || k < cell.iso)) cell = { kind: "A", iso: k };
      else if (c === "NYC-R" && (!cell || k > cell.iso)) cell = { kind: "R", iso: k };
      continue;
    }
    const m = k.match(NYCV_RE);
    if (!m) continue;
    const kind = s.startsWith("NYC-A") ? "A" : s.startsWith("NYC-R") ? "R" : null;
    if (kind) nycv = { kind, iso: m[1], manual: s.endsWith("*") };
  }

  if (cell) return { ...cell, source: "cell" };
  if (nycv) return { kind: nycv.kind, iso: nycv.iso, source: nycv.manual ? "manual" : "derived" };
  const cv = parseCommentVerdict(row.col22, row.col34, rowRefIso(row));
  return cv ? { ...cv, source: "comment" } : null;
}

// Reconcile a row's derived "nycv:" keys from its strike-off comments. Idempotent.
// Leaves a manual ("*") verdict or a real NYC-A/NYC-R grid cell untouched.
export function deriveNycVerdict<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row } as Record<string, unknown>;

  const nycvKeys = Object.keys(out).filter((k) => NYCV_RE.test(k));
  const isManual = (k: string) => String(out[k] ?? "").trim().endsWith("*");
  const hasManual = nycvKeys.some(isManual);
  const hasRealCell = Object.entries(out).some(([k, v]) => {
    if (!ISO_RE.test(k)) return false;
    const c = (parseEventValue(String(v ?? ""))?.code || "").toUpperCase();
    return c === "NYC-A" || c === "NYC-R";
  });

  if (hasManual || hasRealCell) {
    // human verdict wins — drop only the auto-derived keys (blank, not delete: the
    // server merges schedule fields, so "" clears, an absent key leaves the old value)
    nycvKeys.forEach((k) => {
      if (!isManual(k) && String(out[k] ?? "").trim()) out[k] = "";
    });
    return out as T;
  }

  const v = parseCommentVerdict(out.col22, out.col34, rowRefIso(out));
  const wantKey = v ? "nycv:" + v.iso : null;
  const wantVal = v ? (v.kind === "A" ? "NYC-A" : "NYC-R") : null;

  nycvKeys.forEach((k) => {
    if (k !== wantKey && String(out[k] ?? "").trim()) out[k] = "";
  });
  if (wantKey && String(out[wantKey] ?? "").trim() !== wantVal) out[wantKey] = wantVal as string;

  return out as T;
}

// ── AOQ deadline + graphic-level approval verdict (shared by Score Card + Plant Performance) ──

// A Trigger Manager catalog entry, structurally — accepts db.ts's TriggerCatalogEntry (which has
// more fields, e.g. `id`) without importing db.ts into this file.
export interface TriggerCatalogLike {
  name: string;
  category?: string;
  season?: string;
  aoqIso?: string;
}

// The SAME named Trigger ("KNIT", "LOUNGE", "COMPLETE", …) recurs every season with its OWN AOQ
// deadline — KNIT in SU27 is not KNIT in SP27. Matches the catalog on name + Category + Season
// first; a catalog entry saved with no Category (season-wide) still matches on name + Season
// alone. NEVER matches a same-name entry from a DIFFERENT season — that was the bug: the old
// name-only match (Table.tsx's col2 auto-fill) could silently stamp one season's KNIT date onto
// another season's row, whichever catalog entry happened to come first.
export function findTriggerCatalogAoq(
  row: Record<string, unknown>,
  triggerCatalog: TriggerCatalogLike[] | undefined,
): string | null {
  const name = String(row.col2 || "").trim().toLowerCase();
  if (!name || !triggerCatalog?.length) return null;
  const category = String(row.col3 || "").trim().toUpperCase();
  const season = seasonBase(row.col4);
  const sameName = triggerCatalog.filter((t) => t.name.trim().toLowerCase() === name);
  const exact = sameName.find(
    (t) => (t.category || "").trim().toUpperCase() === category && seasonBase(t.season) === season,
  );
  const seasonOnly = exact ?? sameName.find((t) => !(t.category || "").trim() && seasonBase(t.season) === season);
  return seasonOnly?.aoqIso ? extractValidDate(seasonOnly.aoqIso) : null;
}

// AOQ deadline for a row: a real date in col20, else this row's Trigger looked up in the Trigger
// Manager catalog by name + Category + Season (see findTriggerCatalogAoq), else the trigger's own
// month/day code (parseTriggerMD + year resolved from the row's own events, nearestYearIso), else
// the row's Category+Season AOQ date set on the Trigger Manager page (a Trigger like "KNIT" /
// "COMPLETE" / "RECEIVE" names a process stage, not a deadline — this is the final catch-all for
// when no per-Trigger catalog entry exists yet). Multiple dates on one trigger -> the latest.
export function getRowAoqIso(
  row: Record<string, unknown>,
  seasonAoqMap: Record<string, string>,
  triggerCatalog?: TriggerCatalogLike[],
): string | null {
  const col20 = extractValidDate(row.col20);
  if (col20) return col20;
  const catalogDate = findTriggerCatalogAoq(row, triggerCatalog);
  if (catalogDate) return catalogDate;
  const mds = parseTriggerMD(String(row.col2 || ""));
  if (mds.length) {
    const ref = rowRefIso(row);
    const isos = mds.map(([m, d]) => nearestYearIso(m, d, ref)).filter(Boolean).sort();
    if (isos.length) return isos[isos.length - 1];
  }
  const seasonDate = seasonAoqMap[seasonAoqKey(row.col3, seasonBase(row.col4))];
  return seasonDate ? extractValidDate(seasonDate) : null;
}

export type AoqVerdict = "onTime" | "late" | "rejected" | "pending" | "unscored";

export interface GraphicAoqResult {
  aoqIso: string | null;
  approvalIso: string | null;
  rejectedIso: string | null;
  verdict: AoqVerdict;
  daysVsAoq: number | null; // (aoq + grace) - approval; >= 0 == on time
  estimated: boolean; // verdict parsed live from a comment (not materialised), or a dateless approval
}

function addAoqDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// whole days from `a` to `b` (b - a). Positive => b is later.
function aoqDayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00") - Date.parse(a + "T00:00:00")) / 86_400_000);
}

/**
 * A graphic's AOQ-approval verdict, resolved from ALL of its rows (a graphic is often several
 * combo/style rows) — the same state machine Score Card's "AOQ Approval" page scores plants with.
 * Plant Performance's "approved before AOQ" half of its composite score reuses this so the two
 * pages can never disagree about the same graphic's verdict.
 *
 * `entries` pairs each row with its already-computed getRowStatus() result (kept as a plain string
 * here rather than importing db.ts's getRowStatus into this file — both callers already call it
 * for their own row filtering anyway).
 */
export function resolveGraphicAoqVerdict(
  entries: { row: Record<string, unknown>; status: string }[],
  seasonAoqMap: Record<string, string>,
  opts: { graceDays?: number; useFallback?: boolean; triggerCatalog?: TriggerCatalogLike[] } = {},
): GraphicAoqResult {
  const graceDays = opts.graceDays ?? 1;
  const useFallback = opts.useFallback ?? true;

  let aoqIso: string | null = null;
  let approvalIso: string | null = null;
  let rejectedIso: string | null = null;
  let anyEstimated = false;
  let lastNycIso: string | null = null;
  let anyApprovedStatus = false;
  let anyResubmitStatus = false;

  entries.forEach(({ row: r, status }) => {
    if (status === "approved") anyApprovedStatus = true;
    if (status === "resubmit") anyResubmitStatus = true;

    const rowAoq = getRowAoqIso(r, seasonAoqMap, opts.triggerCatalog);
    if (rowAoq && (!aoqIso || rowAoq > aoqIso)) aoqIso = rowAoq; // latest wins = lenient

    const scan = (k: string, v: unknown) => {
      if (typeof v !== "string" || !v.trim() || !/^\d{4}-\d{2}-\d{2}/.test(k)) return;
      const iso = k.slice(0, 10);
      const p = parseEventValue(v);
      if (!p) return;
      const bc = (p.code || "").split("-")[0].toUpperCase();
      if ((bc === "NYC" || bc === "NY") && (!lastNycIso || iso > lastNycIso)) lastNycIso = iso;
    };
    Object.entries(r).forEach(([k, v]) => scan(k, v));
    const sched = (r as { schedule?: unknown }).schedule;
    if (sched && typeof sched === "object") {
      Object.entries(sched as Record<string, unknown>).forEach(([k, v]) => scan(k, v));
    }

    // NY approval verdict: real NYC-A/NYC-R cell -> manual "nycv:" -> derived "nycv:" -> parse
    // the strike-off comment on the fly.
    const rv = readNycVerdict(r);
    if (rv) {
      if (rv.source === "comment") anyEstimated = true;
      if (rv.kind === "A") {
        if (!approvalIso || rv.iso < approvalIso) approvalIso = rv.iso;
      } else if (!rejectedIso || rv.iso > rejectedIso) {
        rejectedIso = rv.iso;
      }
    }
  });

  let verdict: AoqVerdict;
  let daysVsAoq: number | null = null;
  let estimated = anyEstimated;
  let effApprovalIso: string | null = approvalIso;
  let effRejected = Boolean(rejectedIso && (!approvalIso || rejectedIso > approvalIso));

  // Last-resort fallback for a row that is Approved / Resubmit by getRowStatus but whose
  // comment carries no parseable "AD M/D" line-date.
  if (!approvalIso && !rejectedIso && useFallback && (anyApprovedStatus || anyResubmitStatus)) {
    estimated = true;
    if (anyApprovedStatus) effApprovalIso = lastNycIso; // may be null -> "unscored"
    else effRejected = true;
  }

  if (effApprovalIso && !effRejected) {
    if (!aoqIso) {
      verdict = "unscored";
    } else {
      daysVsAoq = aoqDayDiff(effApprovalIso, addAoqDays(aoqIso, graceDays)); // deadline - approval
      verdict = daysVsAoq >= 0 ? "onTime" : "late";
    }
  } else if (effRejected) {
    verdict = "rejected";
  } else if (anyApprovedStatus && !effApprovalIso) {
    // approved, but no date anywhere to place it — count it as approved, timing unknown
    verdict = "unscored";
  } else {
    verdict = "pending";
  }

  return {
    aoqIso,
    approvalIso: effApprovalIso,
    rejectedIso: effRejected ? (rejectedIso || null) : null,
    verdict,
    daysVsAoq,
    estimated,
  };
}

// Write a manual verdict (Daily Events Excel, Score Card drill-down).
export function markNycVerdict<T extends Record<string, unknown>>(
  row: T,
  kind: "A" | "R",
  iso: string,
): T {
  const out = { ...row } as Record<string, unknown>;
  Object.keys(out).forEach((k) => {
    if (NYCV_RE.test(k) && String(out[k] ?? "").trim()) out[k] = "";
  });
  out["nycv:" + iso] = (kind === "A" ? "NYC-A" : "NYC-R") + "*";
  return out as T;
}
