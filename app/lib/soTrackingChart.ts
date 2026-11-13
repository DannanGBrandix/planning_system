// "Graphic development tracking chart" export (VS&Co S/O audit workbook) — the
// "2026 Q3 Graphic development tracking chart (AWR kick off v3).xlsx" the planner used to build by
// hand. The Plant Performance page exports it for the selected period (month / fiscal quarter /
// date range): one line per strike-off whose submission (first DHL / AWB date, col24) falls in that
// period, written into a copy of the original workbook (public/templates/so-tracking-chart-template.xlsx)
// so every tab, header colour, dropdown list and audit formula stays exactly as in the source file.
//
// Column map (SO tracking Chart, header row 5, data from row 6):
//   A Kick off date      col26 (AWR), falls back to col14 (Fabric In date)
//   B Brand              PINK* -> "PINK", everything else "VS"
//   C Category           VS: col3 ("VS AE", "VS-SLEEP"); PINK: "PINK-<line>" from col2 (KNIT /
//                        LOUNGE / SPORT / SLEEP), plain "PINK" otherwise
//   D Season             col4
//   E Flex Code          col13 (Fabric Reference)
//   F Supplier Qlty No   looked up from the fabric number (SUPPLIER_QUALITY_BY_FABRIC — the app
//                        doesn't store it; extend the map as new fabrics come in)
//   G Substrate          PINK "Other" (as the source chart), VS blank
//   H Print Name         col9 (Techniques)
//   I Artwork#           col7 (Graphic)
//   J Combo              col6 normalised to "C<n>" ("GPU27-240 C02" -> "C2")
//   K Supplier           first plant of col11, upper-case without spaces (HI EMB -> HIEMBROIDERY)
//   L Color (Ground)     col8
//   M Color (Graphic)    PINK "N/A", VS blank
//   N / O # submissions  from col35 ("1st" -> 1, "2nd" -> 2); 1 when blank — the audit tabs only
//                        count N = 1 (first submission)
//   P Request sub date   the row's planned NY (strike-off to NY) date closest to the submission
//   Q Submission date    first date in col24 (DHL / AWB tracking)
//   R On time            "Yes" when Q <= P (or no planned NY to judge by), else "No"
//   S VS&Co decision     Approved / Rejected (resubmit needed) / Pending — dropped rows are skipped
import ExcelJS from "exceljs";
import type { EmbellishmentRow } from "./db";
import { getRowStatus } from "./db";
import { extractDateFromTrackingText } from "./trackingDates";
import { rowRefIso } from "./nycVerdict";
import { seasonBase } from "./triggerUtils";

export const SO_TRACKING_TEMPLATE_URL = "/templates/so-tracking-chart-template.xlsx";

// Supplier Quality Number per fabric number (digits of "FB # 19920"). Taken from the hand-built
// v3 chart; the app has no column for it.
const SUPPLIER_QUALITY_BY_FABRIC: Record<string, string> = {
  "19920": "BJCO799",
  "17755": "LPSJ200120/R",
  "19859": "FSO68590",
  "20818": "SSO68519",
  "23127": "LPSJ123522/A",
};

// Plant spellings as the chart's Supplier column writes them.
const SUPPLIER_ALIASES: Record<string, string> = {
  HIEMB: "HIEMBROIDERY",
  CKT: "HIEMBROIDERY",
  REGAL: "REGALIMAGE",
  BFFAV: "BFFAV",
  BRANDIXEMB: "AV",
  SCREENLINE: "SCREENLINE",
  RICHCOLOR: "RICHCOLOR",
};

export interface SoTrackingLine {
  kickOff: string | null; // ISO
  brand: string;
  category: string;
  season: string;
  flexCode: string;
  supplierQuality: string;
  substrate: string;
  printName: string;
  artwork: string;
  combo: string;
  supplier: string;
  colorGround: string;
  colorGraphic: string;
  colorSubs: number;
  layoutSubs: number;
  requestDate: string | null; // ISO
  submissionDate: string; // ISO
  onTime: "Yes" | "No";
  decision: "Approved" | "Rejected" | "Pending" | "Dropped";
}

export interface SoTrackingFilter {
  from: string; // ISO, inclusive
  to: string; // ISO, inclusive
  season?: string; // seasonBase value or "all"
  category?: string; // col3 value or "all"
}

const s = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

function toIso(v: unknown): string | null {
  const t = s(v);
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (m) {
    const y = m[3].length <= 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeCombo(v: unknown): string {
  const t = s(v).toUpperCase();
  const m = t.match(/\bC\s*0*(\d+)\b/);
  return m ? `C${m[1]}` : t;
}

function firstSupplier(plant: unknown): string {
  const first = s(plant).split(/\s*(?:\/|\+|,|&|>>|=>)\s*/)[0] || "";
  const key = first.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return SUPPLIER_ALIASES[key] ?? key;
}

function categoryFor(row: EmbellishmentRow, brand: string): string {
  const cat = s(row.col3).toUpperCase();
  if (brand !== "PINK") return s(row.col3);
  const line = s(row.col2).toUpperCase();
  for (const l of ["KNIT", "LOUNGE", "SPORT", "SLEEP"]) {
    if (line.includes(l) || cat.includes(l)) return `PINK-${l}`;
  }
  return "PINK";
}

function submissionCount(v: unknown): number {
  const m = s(v).match(/(\d+)/);
  return m ? Number(m[1]) : 1;
}

// The planned NY ("strike-off to NY") date nearest the actual submission — on any leg key.
function plannedNyNear(row: EmbellishmentRow, submissionIso: string): string | null {
  const subT = Date.parse(submissionIso);
  let best: { iso: string; dist: number } | null = null;
  Object.entries(row as Record<string, unknown>).forEach(([k, v]) => {
    const m = k.match(/^(\d{4}-\d{2}-\d{2})(?:_.+)?$/);
    if (!m || typeof v !== "string" || !v.trim()) return;
    const code = v.split("|")[0].trim().toUpperCase().replace(/-S$/, "");
    if (code !== "NY") return;
    const dist = Math.abs(Date.parse(m[1]) - subT);
    if (!best || dist < best.dist) best = { iso: m[1], dist };
  });
  return (best as { iso: string } | null)?.iso ?? null;
}

function decisionFor(row: EmbellishmentRow): SoTrackingLine["decision"] {
  const st = getRowStatus(row);
  if (st === "approved") return "Approved";
  if (st === "dropped") return "Dropped";
  if (st === "resubmit") return "Rejected";
  return "Pending";
}

export function buildSoTrackingLines(rows: EmbellishmentRow[], f: SoTrackingFilter): SoTrackingLine[] {
  const byKey = new Map<string, { line: SoTrackingLine; dropped: boolean }>();

  rows.forEach((row) => {
    const cat = s(row.col3).toUpperCase();
    if (!cat.startsWith("VS") && !cat.startsWith("PINK")) return;
    if (f.season && f.season !== "all" && seasonBase(row.col4) !== f.season) return;
    if (f.category && f.category !== "all" && s(row.col3) !== f.category) return;

    // Year for a bare "8/10" in the DHL text: the row's own event neighbourhood, else its S/O
    // ready date, else today (nearestYearIso with no reference picks the PREVIOUS year).
    const refIso = rowRefIso(row as Record<string, unknown>) ?? toIso((row as Record<string, unknown>).col28) ?? todayIso();
    const submissionDate = extractDateFromTrackingText(row.col24, refIso);
    if (!submissionDate || submissionDate < f.from || submissionDate > f.to) return;

    const brand = cat.startsWith("PINK") ? "PINK" : "VS";
    const fabricNum = (s(row.col13).match(/\d{5}/) || [""])[0];
    const requestDate = plannedNyNear(row, submissionDate);
    const subs = submissionCount((row as Record<string, unknown>).col35);

    const line: SoTrackingLine = {
      kickOff: toIso(row.col26) ?? toIso(row.col14),
      brand,
      category: categoryFor(row, brand),
      season: s(row.col4),
      flexCode: s(row.col13),
      supplierQuality: SUPPLIER_QUALITY_BY_FABRIC[fabricNum] ?? "",
      substrate: brand === "PINK" ? "Other" : "",
      printName: s(row.col9),
      artwork: s(row.col7),
      combo: normalizeCombo(row.col6),
      supplier: firstSupplier(row.col11),
      colorGround: s(row.col8),
      colorGraphic: brand === "PINK" ? "N/A" : "",
      colorSubs: subs,
      layoutSubs: subs,
      requestDate,
      submissionDate,
      onTime: !requestDate || submissionDate <= requestDate ? "Yes" : "No",
      decision: decisionFor(row),
    };

    // Dropped strike-offs are left out — the hand-built chart never listed them.
    if (line.decision === "Dropped") return;

    // One line per graphic + combo + ground colour (the chart ignores style).
    const key = `${line.artwork.toUpperCase()}|${line.combo}|${line.colorGround.toUpperCase()}`;
    if (!byKey.has(key)) byKey.set(key, { line, dropped: false });
  });

  return Array.from(byKey.values())
    .map((x) => x.line)
    .sort((a, b) =>
      a.brand.localeCompare(b.brand) ||
      a.season.localeCompare(b.season) ||
      a.submissionDate.localeCompare(b.submissionDate) ||
      a.artwork.localeCompare(b.artwork) ||
      a.combo.localeCompare(b.combo, undefined, { numeric: true }));
}

const isoToDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

// Audit tabs: rows 6-25 are five fiscal years × 4 quarters. The source file hard-coded Q1 2021 …
// Q4 2025 (Feb–Apr quarters, US date strings in COUNTIFS) — re-point them to the app's fiscal
// quarters (Q1 Apr–Jun … Q4 Jan–Mar) for the 5 fiscal years ending with the exported one, using
// DATE() so the criteria don't depend on the PC's date locale.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fyQuarter(fy: number, q: number) {
  const startMonth = [4, 7, 10, 1][q - 1];
  const startYear = q === 4 ? fy + 1 : fy;
  const endExclMonth = startMonth + 3;
  const endYear = startYear + (endExclMonth > 12 ? 1 : 0);
  const endMonth = endExclMonth > 12 ? endExclMonth - 12 : endExclMonth;
  const lastMonth = startMonth + 2;
  const yy = (y: number) => String(y).slice(2);
  return {
    label: `Q${q} ${fy}`,
    months: `${MON[startMonth - 1]}${yy(startYear)}-${MON[lastMonth - 1]}${yy(startYear)}`,
    from: `DATE(${startYear},${startMonth},1)`,
    toExcl: `DATE(${endYear},${endMonth},1)`,
  };
}

function rewriteAuditSheet(ws: ExcelJS.Worksheet, lastFy: number) {
  for (let i = 0; i < 20; i++) {
    const r = 6 + i;
    const fy = lastFy - 4 + Math.floor(i / 4);
    const q = fyQuarter(fy, (i % 4) + 1);
    const row = ws.getRow(r);
    row.getCell(2).value = q.label;
    row.getCell(3).value = q.months;
    for (let c = 4; c <= 10; c++) {
      const cell = row.getCell(c);
      const v = cell.value as { formula?: string; result?: unknown } | null;
      if (!v || typeof v !== "object" || typeof v.formula !== "string") continue;
      if (!/">=\d{2}\/\d{2}\/\d{4}"/.test(v.formula)) continue;
      const formula = v.formula
        .replace(/">=\d{2}\/\d{2}\/\d{4}"/, `">="&${q.from}`)
        .replace(/"<\d{2}\/\d{2}\/\d{4}"/, `"<"&${q.toExcl}`);
      cell.value = { formula };
    }
  }
}

export async function buildSoTrackingWorkbook(
  lines: SoTrackingLine[],
  fiscalYear: number,
): Promise<ArrayBuffer> {
  const res = await fetch(SO_TRACKING_TEMPLATE_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Template not found (${res.status})`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());

  const ws = wb.getWorksheet("SO tracking Chart");
  if (!ws) throw new Error("Template is missing the 'SO tracking Chart' sheet");

  // Row 6 of the template carries the data-row formatting (borders, font, date formats).
  const styleRow = ws.getRow(6);
  const styles = Array.from({ length: 22 }, (_, i) => ({ ...styleRow.getCell(i + 1).style }));
  const height = styleRow.height;

  lines.forEach((l, i) => {
    const row = ws.getRow(6 + i);
    const values: (string | number | Date | null)[] = [
      l.kickOff ? isoToDate(l.kickOff) : null,
      l.brand,
      l.category,
      l.season,
      l.flexCode,
      l.supplierQuality,
      l.substrate,
      l.printName,
      l.artwork,
      l.combo,
      l.supplier,
      l.colorGround,
      l.colorGraphic,
      l.colorSubs,
      l.layoutSubs,
      l.requestDate ? isoToDate(l.requestDate) : null,
      isoToDate(l.submissionDate),
      l.onTime,
      l.decision,
      null,
      null,
      null,
    ];
    values.forEach((v, c) => {
      const cell = row.getCell(c + 1);
      cell.value = v;
      cell.style = { ...styles[c] };
      if (c === 0 && !cell.numFmt) cell.numFmt = "mm/dd/yyyy";
      if ((c === 15 || c === 16) && !cell.numFmt) cell.numFmt = "d-mmm-yy";
    });
    if (height) row.height = height;
  });
  ws.autoFilter = `A5:V${Math.max(6, 5 + lines.length)}`;

  ["SO RFT Auditing Chart", "SO ontime Auditing Chart", "RA-QG ontime Auditing Chart"].forEach((n) => {
    const a = wb.getWorksheet(n);
    if (a) rewriteAuditSheet(a, fiscalYear);
  });

  // The audit formulas were rewritten without cached results — have Excel recompute on open.
  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
