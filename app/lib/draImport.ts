// "Import DRA" (sidebar) — the weekly Development Risk Assessment workbook (DRA-NEW1.xlsx).
//
// Reads ONLY the "Data" sheet (Summery / Tech Category / Sheet1-3 are the planner's own pivots and
// scratch lists). Each line is one graphic (+ combo, + style) with its risk verdict and the action
// that closes it: What / Who / When / Comments. It only updates rows already in the plan, never
// creates one, and skips rows that are Dropped in the plan (planner, 2026-11-20).
//
// Matching:
//   VS / PINK  Graphic + Combo (+ Style when the line has one). "CO1" / "C01" / "c1" / "C 2" all
//              read as C1 / C2, and "C1/C2" is two combos. A blank combo = every combo.
//   CK family  The DRA's COMBO column holds the graphic code itself (no combo / ground), and CK
//              rows are one per ground colour — so a CK line lands on every row of that graphic.
//   Season     Same-season rows are preferred when the graphic also exists in another season.
// Two DRA lines landing on the same plan row: the one with the latest DRA Date wins (then the
// lower one in the sheet).
//
// What it writes (replace, not append — a newer DRA replaces the old action):
//   col17  Risk Factor  "High" / "Low"   (overwrites; a blank Risk leaves col17 alone)
//   col18  Technique Category            (ONLY when the plan row's is blank)
//   col80-col87  DRA_COLUMNS below
// Hidden rows (an Excel filter, e.g. "Risk = High Risk") are NOT skipped: the file is the whole
// assessment, and a leftover filter must not silently import only part of it.
import * as XLSX from "xlsx";
import { EmbellishmentRow, getRowStatus } from "./db";
import { isCkFamilyCategory } from "./ckCategories";
import { seasonBase } from "./triggerUtils";

// Plan columns the DRA fills. col80+ sit well clear of the slots earlier imports minted for
// unknown headers (col64-col72) and, being in DEFAULT_COLUMNS, push any future minting past them.
export const DRA_COLUMNS = {
  riskCategory: "col80",
  what: "col81",
  who: "col82",
  when: "col83",
  comment: "col84",
  date: "col85",
  weekly: "col86",
  review3w: "col87",
} as const;

export interface DraLine {
  excelRow: number;
  graphic: string;
  graphicKey: string;
  style: string;
  comboRaw: string;
  combos: string[]; // normalised ("C1"); empty = every combo of the graphic
  season: string; // seasonBase ("SU27")
  category: string;
  isCk: boolean;
  risk: "High" | "Low" | "";
  riskCategory: string;
  techniqueCategory: string;
  what: string;
  who: string;
  when: string;
  comment: string;
  date: string; // ISO when parseable, else the text
  weekly: string;
  review3w: string;
}

export interface ParsedDraFile {
  sheet: string;
  lines: DraLine[];
  skipped: { excelRow: number; reason: string }[];
}

const graphicKeyOf = (v: unknown) =>
  String(v ?? "").toUpperCase().replace(/\(.*?\)/g, "").replace(/\s+/g, "");

// "CO1" (letter O) / "C01" / "c 1" -> "C1"
const normCombo = (token: string) =>
  token.toUpperCase().replace(/\s+/g, "").replace(/^CO(?=\d)/, "C").replace(/^C0*(?=\d)/, "C");
const isComboToken = (t: string) => /^C\d+[A-Z]?$/.test(t);

// A plan row's Combo can hold several ("C1/C20") or carry another reference ("GPU27-382 C01").
const rowCombos = (v: unknown) =>
  String(v ?? "").split(/[\s/,+&]+/).filter(Boolean).map(normCombo);
const styleTokens = (v: unknown) => String(v ?? "").toUpperCase().split(/[\s/,]+/).filter(Boolean);

const text = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isoOf(v);
  return String(v).replace(/\r/g, "").trim();
};
function isoOf(d: Date): string {
  // SheetJS cellDates gives local-midnight dates; read them back in local time.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const HEADERS: Record<string, keyof DraLine | "graphicRaw" | "comboRaw"> = {
  DATE: "date",
  "3WREVIEW": "review3w",
  WEEKLYDRA: "weekly",
  CUSTOMERCATEGORY: "category",
  SEASON: "season",
  GRAPHIC: "graphicRaw",
  STYLE: "style",
  COMBO: "comboRaw",
  TECHNIQUECATEGORY: "techniqueCategory",
  RISK: "risk",
  RISKCATEGORY: "riskCategory",
  WHAT: "what",
  WHO: "who",
  WHEN: "when",
  COMMENTS: "comment",
  COMMENT: "comment",
};
const headerKey = (h: unknown) => String(h ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function parseDraWorkbook(wb: XLSX.WorkBook): ParsedDraFile {
  const sheet = wb.SheetNames.find((n) => n.trim().toUpperCase() === "DATA") ?? wb.SheetNames[0];
  const out: ParsedDraFile = { sheet, lines: [], skipped: [] };
  const ws = wb.Sheets[sheet];
  if (!ws || !ws["!ref"]) return out;
  const firstRow = XLSX.utils.decode_range(ws["!ref"]).s.r;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });

  const headerIdx = grid.findIndex((cells) => {
    const keys = cells.map(headerKey);
    return keys.includes("GRAPHIC") && keys.includes("RISK");
  });
  if (headerIdx < 0) return out;
  const colOf = new Map<string, number>();
  grid[headerIdx].forEach((h, i) => {
    const field = HEADERS[headerKey(h)];
    if (field && !colOf.has(field)) colOf.set(field, i);
  });
  const cell = (cells: unknown[], field: string) => {
    const i = colOf.get(field);
    return i === undefined ? "" : text(cells[i]);
  };

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const cells = grid[i];
    const excelRow = firstRow + i + 1;
    const graphic = cell(cells, "graphicRaw");
    if (!graphic) {
      if (cells.some((c) => text(c))) out.skipped.push({ excelRow, reason: "No graphic on this line" });
      continue;
    }
    const category = cell(cells, "category");
    const isCk = /\bCK/i.test(category);
    const comboRaw = cell(cells, "comboRaw");
    const graphicKey = graphicKeyOf(graphic);
    const combos = graphicKeyOf(comboRaw) === graphicKey
      ? [] // CK: COMBO holds the graphic code
      : comboRaw.split(/[/,&+]/).map(normCombo).filter(isComboToken);
    const riskRaw = cell(cells, "risk").toUpperCase();
    out.lines.push({
      excelRow,
      graphic,
      graphicKey,
      style: cell(cells, "style").toUpperCase(),
      comboRaw,
      combos,
      season: seasonBase(cell(cells, "season").replace(/\s+/g, "")),
      category,
      isCk,
      risk: riskRaw.includes("HIGH") ? "High" : riskRaw.includes("LOW") ? "Low" : "",
      riskCategory: cell(cells, "riskCategory"),
      techniqueCategory: cell(cells, "techniqueCategory"),
      what: cell(cells, "what"),
      who: cell(cells, "who"),
      when: cell(cells, "when"),
      comment: cell(cells, "comment"),
      date: cell(cells, "date"),
      weekly: cell(cells, "weekly"),
      review3w: cell(cells, "review3w"),
    });
  }
  return out;
}

export type DraLineStatus = "update" | "already" | "dropped" | "style-differs" | "not-found" | "superseded";

export interface DraRowUpdate {
  row: EmbellishmentRow;
  updated: EmbellishmentRow;
  changes: { field: string; oldValue: string; newValue: string }[];
}

export interface DraPreviewEntry {
  line: DraLine;
  status: DraLineStatus;
  note: string;
  matched: number; // live plan rows this line lands on (after the newer-line rule)
}

export interface DraPreview {
  entries: DraPreviewEntry[];
  updates: DraRowUpdate[];
}

function matchRows(line: DraLine, current: EmbellishmentRow[]): { rows: EmbellishmentRow[]; status?: DraLineStatus; note: string } {
  let same = current.filter((r) => graphicKeyOf(r.col7) === line.graphicKey);
  if (!same.length) return { rows: [], status: "not-found", note: "Graphic is not in the plan" };
  const inSeason = same.filter((r) => seasonBase(r.col4) === line.season);
  if (inSeason.length) same = inSeason;

  const ckGraphic = line.isCk || same.every((r) => isCkFamilyCategory(String(r.col3 || "")));
  let byCombo = same;
  if (!ckGraphic && line.combos.length) {
    byCombo = same.filter((r) => rowCombos(r.col6).some((c) => line.combos.includes(c)));
    if (!byCombo.length) {
      const combos = [...new Set(same.map((r) => String(r.col6 || "").trim()).filter(Boolean))];
      return { rows: [], status: "not-found", note: `Plan has this graphic only with ${combos.join(", ")}` };
    }
  }
  // A blank Style on the plan row can't rule it out. "10352038 / 10330473" on either side matches
  // on any shared style.
  const lineStyles = styleTokens(line.style);
  const byStyle = lineStyles.length
    ? byCombo.filter((r) => {
        const t = styleTokens(r.col5);
        return !t.length || t.some((s) => lineStyles.includes(s));
      })
    : byCombo;
  if (!byStyle.length) {
    const styles = [...new Set(byCombo.map((r) => String(r.col5 || "").trim()))];
    return { rows: [], status: "style-differs", note: `Plan has this combo on style ${styles.join(", ")}` };
  }
  const live = byStyle.filter((r) => getRowStatus(r) !== "dropped");
  if (!live.length) return { rows: [], status: "dropped", note: "Dropped in the plan" };
  const note = ckGraphic ? `CK — every ground row of ${line.graphic}` : !line.combos.length ? "No combo on the line — every combo" : "";
  return { rows: live, note };
}

const DRA_FIELD_LABELS: Record<string, string> = {
  col17: "Risk Factor",
  col18: "Technique Category",
  col80: "DRA Risk Category",
  col81: "DRA What",
  col82: "DRA Who",
  col83: "DRA When",
  col84: "DRA Comment",
  col85: "DRA Date",
  col86: "DRA Weekly",
  col87: "DRA 3W Review",
};

export function buildDraPreview(lines: DraLine[], rows: EmbellishmentRow[]): DraPreview {
  const current = rows.filter((r) => r.is_current !== false);
  const matches = lines.map((line) => ({ line, ...matchRows(line, current) }));

  // Several lines on one row: latest DRA Date wins, then the lower line in the sheet.
  const winner = new Map<string, DraLine>();
  const newer = (a: DraLine, b: DraLine) => (a.date !== b.date ? a.date > b.date : a.excelRow > b.excelRow);
  matches.forEach((m) => m.rows.forEach((r) => {
    const cur = winner.get(r.id);
    if (!cur || newer(m.line, cur)) winner.set(r.id, m.line);
  }));

  const updates: DraRowUpdate[] = [];
  const changedByLine = new Map<DraLine, number>();
  const wonByLine = new Map<DraLine, number>();
  current.forEach((row) => {
    const line = winner.get(row.id);
    if (!line) return;
    wonByLine.set(line, (wonByLine.get(line) || 0) + 1);
    const next: Record<string, string> = {
      [DRA_COLUMNS.riskCategory]: line.riskCategory,
      [DRA_COLUMNS.what]: line.what,
      [DRA_COLUMNS.who]: line.who,
      [DRA_COLUMNS.when]: line.when,
      [DRA_COLUMNS.comment]: line.comment,
      [DRA_COLUMNS.date]: line.date,
      [DRA_COLUMNS.weekly]: line.weekly,
      [DRA_COLUMNS.review3w]: line.review3w,
    };
    if (line.risk) next.col17 = line.risk;
    if (line.techniqueCategory && !String(row.col18 || "").trim()) next.col18 = line.techniqueCategory;
    const changes = Object.entries(next)
      .map(([k, v]) => ({ field: DRA_FIELD_LABELS[k] || k, key: k, oldValue: String(row[k] ?? "").trim(), newValue: v }))
      .filter((c) => c.oldValue !== c.newValue);
    if (!changes.length) return;
    const updated: EmbellishmentRow = { ...row, change_reason: "DRA import" };
    changes.forEach((c) => { updated[c.key] = c.newValue; });
    updates.push({ row, updated, changes: changes.map(({ field, oldValue, newValue }) => ({ field, oldValue, newValue })) });
    changedByLine.set(line, (changedByLine.get(line) || 0) + 1);
  });

  const entries: DraPreviewEntry[] = matches.map((m) => {
    if (m.status) return { line: m.line, status: m.status, note: m.note, matched: 0 };
    const won = wonByLine.get(m.line) || 0;
    if (!won) return { line: m.line, status: "superseded", note: "A newer DRA line covers the same rows", matched: 0 };
    const changed = changedByLine.get(m.line) || 0;
    return { line: m.line, status: changed ? "update" : "already", note: m.note, matched: won };
  });
  return { entries, updates };
}

// ── Action status, for Advanced Analytics ──────────────────────────────────────────────────

export type DraActionStatus = "done" | "overdue" | "dueSoon" | "open" | "none";
export const DRA_ACTION_LABELS: Record<DraActionStatus, string> = {
  done: "Done",
  overdue: "Overdue",
  dueSoon: "Due in 7 days",
  open: "Open",
  none: "No action",
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// "When" is typed by hand: "2026-09-25", "9/25/2026", "29-Oct", "25-Sep", sometimes with "Done"
// on the next line. A rescheduled action keeps its history ("9/11/2026 ↵ 9/30/2026 ↵ 11/16/2026"),
// so the LAST date in the cell is the current due date. refYear is used when the text has no year.
export function parseDraWhen(raw: string, refYear: number): string | null {
  const s = raw.toUpperCase();
  const found: { at: number; iso: string }[] = [];
  const pad = (n: string | number) => String(n).padStart(2, "0");
  const year = (y: string | undefined) => (!y ? refYear : y.length === 2 ? 2000 + Number(y) : Number(y));
  for (const m of s.matchAll(/(\d{4})-(\d{1,2})-(\d{1,2})/g)) {
    found.push({ at: m.index ?? 0, iso: `${m[1]}-${pad(m[2])}-${pad(m[3])}` });
  }
  for (const m of s.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g)) {
    found.push({ at: m.index ?? 0, iso: `${year(m[3])}-${pad(m[1])}-${pad(m[2])}` });
  }
  for (const m of s.matchAll(/(\d{1,2})[\s-]*([A-Z]{3})[A-Z]*(?:[\s-]*(\d{4}|\d{2}(?!\d)))?/g)) {
    if (MONTHS.includes(m[2])) found.push({ at: m.index ?? 0, iso: `${year(m[3])}-${pad(MONTHS.indexOf(m[2]) + 1)}-${pad(m[1])}` });
  }
  if (!found.length) return null;
  return found.sort((a, b) => a.at - b.at)[found.length - 1].iso;
}

export function draWhenIso(r: EmbellishmentRow): string | null {
  const when = String(r[DRA_COLUMNS.when] ?? "");
  const ref = Number(String(r[DRA_COLUMNS.date] ?? "").slice(0, 4)) || new Date().getFullYear();
  return when ? parseDraWhen(when, ref) : null;
}

const todayIso = () => isoOf(new Date());

export function draActionStatus(r: EmbellishmentRow, today = todayIso()): DraActionStatus {
  const what = String(r[DRA_COLUMNS.what] ?? "").trim();
  const when = String(r[DRA_COLUMNS.when] ?? "").trim();
  const comment = String(r[DRA_COLUMNS.comment] ?? "").trim();
  if (!what && !when) return "none";
  if (/\bDONE\b|COMPLETE|COMPLEATED/i.test(`${when} ${comment}`)) return "done";
  const due = draWhenIso(r);
  if (!due) return "open";
  if (due < today) return "overdue";
  const in7 = new Date(`${today}T00:00:00`);
  in7.setDate(in7.getDate() + 7);
  return due <= isoOf(in7) ? "dueSoon" : "open";
}

// Risk Factor (col17) holds many spellings ("HIGH", "High", "LOW ", "N/A", ...) — one bucket each.
export function riskBucket(r: EmbellishmentRow): "High" | "Low" | "Unrated" {
  const v = String(r.col17 || "").toUpperCase();
  return v.includes("HIGH") ? "High" : v.includes("LOW") ? "Low" : "Unrated";
}
