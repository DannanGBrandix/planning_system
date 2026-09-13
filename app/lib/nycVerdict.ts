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
//     real "<date>" NYC-A/NYC-R cell; Daily Events Excel and the Plant Performance
//     drill-down call markNycVerdict, which writes a "nycv:<date>" key).
//
// Storage: derived verdicts live on "nycv:<YYYY-MM-DD>" keys (value "NYC-A"/"NYC-R").
// A manually set one is suffixed with "*" ("NYC-A*") so deriveNycVerdict never
// overwrites it. "nycv:" keys do NOT match /^\d{4}-\d{2}-\d{2}$/, so they are
// invisible to the auto-scheduler, every export, and every other date-key path —
// they still persist because server/db.js routes any non-col*/non-top-level key
// into the schedule JSONB.

import { parseEventValue } from "./eventCodes";

export const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const NYCV_RE = /^nycv:(\d{4}-\d{2}-\d{2})$/;

// ── shared date helpers (also used by PlantPerformanceDashboard) ────────────

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
    if (!m) continue;
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

// Write a manual verdict (Daily Events Excel, Plant Performance drill-down).
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
