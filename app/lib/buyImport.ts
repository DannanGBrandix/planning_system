// "Import Buy Graphics" (sidebar). A one-column buy list, one line per buy:
//   GPS27-079 C1 ( 10356620 )            graphic, combo, ( style )
//   GVU27-087 Graphic C011 74DH - 8HHC   no style: matches every style of that graphic + combo
//
// The planner picks Regional or BABL in the dialog — the file itself doesn't say. It only updates
// rows already in the plan and only ever ADDS a buy: col48 becomes "Y" and the picked type joins
// whatever `buyType` the row already had, so one graphic can hold both.
import * as XLSX from "xlsx";
import { BuyType, EmbellishmentRow, buyTypeLabel, getBuyTypes, getRowStatus } from "./db";

export interface BuyLine {
  excelRow: number;
  raw: string;
  graphicKey: string; // "GPS27-079"
  combo: string; // "C1" (C001 / C01 / C1 all normalise to this)
  style: string; // "" when the line doesn't carry one
}

export interface ParsedBuyFile {
  sheet: string;
  lines: BuyLine[];
  unreadable: { excelRow: number; raw: string }[]; // no combo on the line, so nothing safe to match
  duplicates: number; // same graphic + combo + style listed again further down
  hiddenSkipped: number; // rows hidden by an Excel filter — not part of what the planner sees
}

const graphicKeyOf = (v: unknown) =>
  String(v ?? "").toUpperCase().replace(/\(.*?\)/g, "").replace(/\s+/g, "");

const normCombo = (token: string) => token.toUpperCase().replace(/^C0*(?=\d)/, "C");

// A row's Combo can hold several ("C1/C20") or carry another reference ("GPU27-382 C01").
const rowCombos = (v: unknown) => String(v ?? "").split(/[\s/,+&]+/).filter(Boolean).map(normCombo);

const styleTokens = (v: unknown) => String(v ?? "").toUpperCase().split(/[\s/,]+/).filter(Boolean);

export function parseBuyLine(text: string): Omit<BuyLine, "excelRow" | "raw"> | null {
  const brackets = text.match(/\(([^)]*)\)/);
  const tokens = text.replace(/\([^)]*\)/g, " ").trim().split(/\s+/);
  const graphic = tokens[0] || "";
  const combo = tokens.slice(1).find((t) => /^C\d+[A-Z]?$/i.test(t));
  if (!/\d/.test(graphic) || !combo) return null;
  return {
    graphicKey: graphicKeyOf(graphic),
    combo: normCombo(combo),
    style: brackets ? brackets[1].trim().toUpperCase() : "",
  };
}

export function parseBuyWorkbook(wb: XLSX.WorkBook): ParsedBuyFile {
  const sheet = wb.SheetNames[0];
  const ws = wb.Sheets[sheet];
  const out: ParsedBuyFile = { sheet, lines: [], unreadable: [], duplicates: 0, hiddenSkipped: 0 };
  if (!ws || !ws["!ref"]) return out;
  const firstRow = XLSX.utils.decode_range(ws["!ref"]).s.r;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
  const hidden = ws["!rows"] || [];
  const seen = new Set<string>();
  let headerPassed = false;
  grid.forEach((cells, i) => {
    const rowIdx = firstRow + i;
    const raw = String(cells.find((c) => String(c ?? "").trim()) ?? "").replace(/\s+/g, " ").trim();
    if (!raw) return;
    if (hidden[rowIdx]?.hidden) {
      out.hiddenSkipped++;
      return;
    }
    const excelRow = rowIdx + 1;
    const parsed = parseBuyLine(raw);
    if (!parsed) {
      // The first filled line of a list like this is its "GRAPHICS" heading.
      if (headerPassed || /\d/.test(raw)) out.unreadable.push({ excelRow, raw });
      headerPassed = true;
      return;
    }
    headerPassed = true;
    const key = `${parsed.graphicKey}|${parsed.combo}|${parsed.style}`;
    if (seen.has(key)) {
      out.duplicates++;
      return;
    }
    seen.add(key);
    out.lines.push({ excelRow, raw, ...parsed });
  });
  return out;
}

export type BuyLineStatus = "update" | "already" | "dropped" | "style-differs" | "not-found";

export interface BuyRowUpdate {
  row: EmbellishmentRow;
  updated: EmbellishmentRow;
  oldLabel: string;
  newLabel: string;
}

export interface BuyPreviewEntry {
  line: BuyLine;
  status: BuyLineStatus;
  note: string;
  matched: number; // live plan rows this line lands on
  updates: BuyRowUpdate[];
}

export function buildBuyPreview(lines: BuyLine[], rows: EmbellishmentRow[], type: BuyType): BuyPreviewEntry[] {
  const current = rows.filter((r) => r.is_current !== false);
  return lines.map((line) => {
    const sameGraphic = current.filter((r) => graphicKeyOf(r.col7) === line.graphicKey);
    const sameCombo = sameGraphic.filter((r) => rowCombos(r.col6).includes(line.combo));
    const base = { line, matched: 0, updates: [] as BuyRowUpdate[] };
    if (!sameCombo.length) {
      const combos = [...new Set(sameGraphic.map((r) => String(r.col6 || "").trim()).filter(Boolean))];
      const note = combos.length ? `Graphic is in the plan, but only with ${combos.join(", ")}` : "Graphic is not in the plan";
      return { ...base, status: "not-found", note };
    }
    // A blank Style on the plan row can't rule it out.
    const sameStyle = line.style
      ? sameCombo.filter((r) => {
          const tokens = styleTokens(r.col5);
          return !tokens.length || tokens.includes(line.style);
        })
      : sameCombo;
    if (!sameStyle.length) {
      const styles = [...new Set(sameCombo.map((r) => String(r.col5 || "").trim()))];
      return { ...base, status: "style-differs", note: `Plan has this combo on style ${styles.join(", ")}` };
    }
    const live = sameStyle.filter((r) => getRowStatus(r) !== "dropped");
    if (!live.length) return { ...base, status: "dropped", note: "Dropped in the plan" };

    const updates: BuyRowUpdate[] = live
      .filter((r) => !getBuyTypes(r).includes(type))
      .map((row) => {
        const before = getBuyTypes(row);
        const newLabel = buyTypeLabel([...before, type]);
        return {
          row,
          updated: { ...row, col48: "Y", buyType: newLabel, change_reason: `Buy list import (${type})` },
          oldLabel: buyTypeLabel(before),
          newLabel,
        };
      });
    return {
      ...base,
      status: updates.length ? "update" : "already",
      note: "",
      matched: live.length,
      updates,
    };
  });
}
