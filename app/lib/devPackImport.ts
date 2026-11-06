// HO27 "Dev PACK TRACKER" import (added 2026-10-14).
//
// A different workbook from the VS/PINK graphic charts: one row per Reference # (the DEV graphic,
// e.g. "H27_DEV_011") + Option/Combo, with the plant in "Vendor & Supplier", the DHL number(s) in
// "Tracking #" and the plant's feasibility comments in "Concerns / Limitation". It never creates
// rows — every DEV graphic is already in the plan (VS AE / VSX, HO27) — it only attaches the
// tracker's data to the matching row.
//
// Only the Sri Lanka sheet ("SL Dev pack") is read. The "VN Dev PACKS" sheet lists the SAME
// graphic numbers developed in parallel by Vietnam vendors (HANSAE, PARAWIN, REGINA…); importing
// it onto the same rows would overwrite the Brandix DHL numbers with theirs. "MGF" is empty.
//
// Where the data lands:
//   col24  DHL/Stickoff Tracking — normalised to "DHL 10/8 1114779190" (courier, date, number) so
//          hasStrikeOffSubmission / isRowSent and the DHL→NY logic read it like a tracking chart.
//   col52+ the tracker's own fields (below). Kept OUT of col22/col34 on purpose: getRowStatus reads
//          those for "dropped"/"approved"/"resub" words, and plant concerns are full of "drop",
//          "approval", "not recommended"… which would silently flip the row's status.
import * as XLSX from "xlsx";
import type { EmbellishmentRow } from "./db";
import { encodeEventValue, parseEventValue } from "./eventCodes";
import { nearestYearIso } from "./nycVerdict";

export const DEV_PACK_COLS = {
  concerns: "col52",
  remark: "col53",
  cost: "col54",
  readyDate: "col55",
  passOffDate: "col56",
  reviewed: "col57",
  size: "col58",
  perDayOutput: "col59",
  rmLeadTime: "col60",
  washRecommendation: "col61",
  plant: "col62",
  syncedAt: "col63",
} as const;

export const DEV_PACK_COL_LABELS: Record<string, string> = {
  col52: "Dev Pack Concerns / Limitation",
  col53: "Dev Pack Remark",
  col54: "Dev Pack Cost",
  col55: "Dev Pack Ready Date",
  col56: "Dev Pack Pass Off Date",
  col57: "Dev Pack Reviewed w/ Graphics Team",
  col58: "Dev Pack Size",
  col59: "Dev Pack Per Day Output",
  col60: "Dev Pack RM Lead Time",
  col61: "Dev Pack Wash Recommendation",
  col62: "Dev Pack Vendor & Supplier",
  col63: "Dev Pack Synced",
};

type DevPackField = keyof typeof DEV_PACK_COLS | "graphic" | "combo" | "tracking" | "technique" | "color" | "fabric";

// Normalised header (upper-case, letters/digits only) → field. Exact match on purpose: the
// sheet's headers are short and generic ("COLOR", "SIZE", "COST") so prefix matching would collide.
const HEADER_FIELDS: Record<string, DevPackField> = {
  REFERENCE: "graphic",
  OPTIONCOMBO: "combo",
  VENDORSUPPLIER: "plant",
  TRACKING: "tracking",
  CONCERNSLIMITATION: "concerns",
  REMARK: "remark",
  COST: "cost",
  READYDATE: "readyDate",
  PASSOFFDATE: "passOffDate",
  REVIEWEDWGRAPHICSTEAM: "reviewed",
  FRANCESCAINTERNALREVIEWEDWGRAPHICSTEAM: "reviewed",
  SIZE: "size",
  PERDAYOUTPOUT: "perDayOutput",
  PERDAYOUTPUT: "perDayOutput",
  RMLEADTIMESAMPLEBULK: "rmLeadTime",
  WASHRECCOMANDATIONVSCOSTDPASSFAIL: "washRecommendation",
  WASHRECOMMENDATIONVSCOSTDPASSFAIL: "washRecommendation",
  TECHNIQUE: "technique",
  COLOR: "color",
  FABRICFB: "fabric",
};

const normHeader = (h: unknown) => String(h ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const clean = (v: unknown) =>
  String(v ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");

export interface DevPackTracking {
  carrier: string;
  number: string;
  dateIso: string | null; // date the parcel left, when the cell carries one
  note: string; // e.g. "(FB#22693)" / "(MRC)"
}

export interface DevPackItem {
  sheet: string;
  excelRow: number;
  graphic: string; // as written, e.g. "H27_DEV_005 (Opt1)"
  graphicKey: string; // "H27_DEV_005"
  combo: string; // "C1"
  fields: Partial<Record<DevPackField, string>>;
  tracking: DevPackTracking[];
  trackingText: string; // normalised col24 value ("" when the cell has no tracking number)
  dropped: boolean;
}

export const devGraphicKey = (g: unknown) =>
  String(g ?? "").toUpperCase().replace(/\(.*?\)/g, "").replace(/\s+/g, "").trim();

// Only the Sri Lanka sheet — see the header comment.
export const isDevPackSheet = (name: string) => /(^|[^A-Z])SL([^A-Z]|$)/i.test(name) && /DEV/i.test(name);

// "DHL#\n1114779190\n10/8", "DHL#\n4465626303\n10/12\n(MRC)", two parcels in one cell
// ("DHL# 8581337645 9/29 (FB#22693) DHL# 3385983322 9/30 (FB#19920/FB#18059)"), or the VN style
// "To NY Fedex awb#878568693920". Each 7–14 digit run is one parcel; the courier is the nearest
// DHL/FEDEX/UPS/TNT word before it, the date the first M/D after it, the note a "(...)" after it.
export function parseTrackingCell(raw: unknown, refIso: string): DevPackTracking[] {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const nums = Array.from(text.matchAll(/\b\d{7,14}\b/g));
  return nums.map((m, i) => {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const nextStart = i + 1 < nums.length ? nums[i + 1].index ?? text.length : text.length;
    const before = text.slice(0, start);
    const after = text.slice(end, nextStart);
    const carriers = Array.from(before.matchAll(/\b(DHL|FEDEX|UPS|TNT|ARAMEX|VIETTEL)\b/gi));
    const carrier = carriers.length ? carriers[carriers.length - 1][1].toUpperCase() : "DHL";
    const dm = after.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    let dateIso: string | null = null;
    if (dm) {
      const mo = +dm[1];
      const da = +dm[2];
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
        dateIso = dm[3]
          ? `${dm[3].length <= 2 ? 2000 + +dm[3] : +dm[3]}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`
          : nearestYearIso(mo, da, refIso);
      }
    }
    const note = (after.match(/\([^)]*\)/) || [""])[0];
    return { carrier, number: m[0], dateIso, note };
  });
}

const fmtMd = (iso: string) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;

export function formatTracking(t: DevPackTracking[]): string {
  return t
    .map((p) => [p.carrier, p.dateIso ? fmtMd(p.dateIso) : "", p.number, p.note].filter(Boolean).join(" "))
    .join("\n");
}

export function parseDevPackWorkbook(
  wb: XLSX.WorkBook,
  refIso: string,
): { items: DevPackItem[]; sheetsRead: string[]; sheetsSkipped: string[] } {
  const items: DevPackItem[] = [];
  const sheetsRead: string[] = [];
  const sheetsSkipped: string[] = [];
  for (const name of wb.SheetNames) {
    if (!isDevPackSheet(name)) {
      sheetsSkipped.push(name);
      continue;
    }
    sheetsRead.push(name);
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "", raw: false });
    const headerIdx = grid.findIndex((r) => r.some((c) => normHeader(c) === "REFERENCE"));
    if (headerIdx < 0) continue;
    const colOf = new Map<DevPackField, number>();
    grid[headerIdx].forEach((h, i) => {
      const f = HEADER_FIELDS[normHeader(h)];
      if (f && !colOf.has(f)) colOf.set(f, i);
    });
    for (let r = headerIdx + 1; r < grid.length; r++) {
      const row = grid[r];
      const fields: Partial<Record<DevPackField, string>> = {};
      colOf.forEach((i, f) => {
        const v = clean(row[i]);
        if (v) fields[f] = v;
      });
      const graphicKey = devGraphicKey(fields.graphic);
      if (!graphicKey) continue;
      const tracking = parseTrackingCell(row[colOf.get("tracking") ?? -1], refIso);
      items.push({
        sheet: name,
        excelRow: r + 1,
        graphic: fields.graphic || "",
        graphicKey,
        combo: String(fields.combo || "").toUpperCase().replace(/\s+/g, ""),
        fields,
        tracking,
        trackingText: formatTracking(tracking),
        dropped: /^DROP/i.test(fields.reviewed || ""),
      });
    }
  }
  return { items, sheetsRead, sheetsSkipped };
}

// ── Matching ────────────────────────────────────────────────────────────────
const plantTokens = (s: unknown) =>
  new Set(
    String(s ?? "")
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/HIEMB|CKT/g, "HIEMB")
      .replace(/REGALIMAGE|REGAL/g, "REGAL")
      .split(/[/+>,&]+/)
      .filter(Boolean),
  );

// Reference # + Option/Combo. When several current rows share that (e.g. a re-allocated twin),
// the one whose Plant overlaps the tracker's Vendor & Supplier wins, then the non-dropped one.
export function matchDevPackRow(item: DevPackItem, rows: EmbellishmentRow[]): EmbellishmentRow | null {
  const cands = rows.filter(
    (r) =>
      r.is_current !== false &&
      devGraphicKey(r.col7) === item.graphicKey &&
      String(r.col6 || "").toUpperCase().replace(/\s+/g, "") === item.combo,
  );
  if (cands.length <= 1) return cands[0] || null;
  const want = plantTokens(item.fields.plant);
  const score = (r: EmbellishmentRow) => {
    const have = plantTokens(r.col11);
    const overlap = [...want].some((p) => have.has(p)) ? 2 : 0;
    const live = /DROP/i.test(String(r.col1 || "")) ? 0 : 1;
    return overlap + live;
  };
  return [...cands].sort((a, b) => score(b) - score(a))[0];
}

// ── Applying ────────────────────────────────────────────────────────────────
export interface DevPackChange {
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
}

const DHL_NY_MATCH_MAX_DAYS = 5; // same window as the tracking-chart import (page.tsx)

// Returns the updated row + the list of changed fields. Blank-tolerant: a blank tracker cell never
// clears what the row already has. Never touches Plant (col11) — a plant swap on a planned row
// triggers a replan elsewhere; the tracker's vendor is kept in col62 instead.
export function applyDevPackItem(
  row: EmbellishmentRow,
  item: DevPackItem,
  todayIso: string,
): { row: EmbellishmentRow; changes: DevPackChange[] } {
  const next: EmbellishmentRow = { ...row };
  const changes: DevPackChange[] = [];
  const set = (col: string, label: string, value: string) => {
    const old = String(row[col] ?? "").trim();
    if (!value || old === value) return;
    next[col] = value;
    changes.push({ field: col, label, oldValue: old, newValue: value });
  };

  set("col24", "DHL/Stickoff Tracking", item.trackingText);
  (Object.keys(DEV_PACK_COLS) as (keyof typeof DEV_PACK_COLS)[]).forEach((f) => {
    if (f === "syncedAt") return;
    const col = DEV_PACK_COLS[f];
    set(col, DEV_PACK_COL_LABELS[col], String(item.fields[f] || ""));
  });
  if (item.dropped && !/DROP/i.test(String(row.col1 || ""))) set("col1", "Status", "Dropped");

  // Sent to NY: turn the row's own planned NY green when a parcel left within 5 days of it
  // (bare plan and each "<date>_<PLANT>" leg plan separately) — mirrors the tracking chart.
  const sentDates = item.tracking.map((t) => t.dateIso).filter((d): d is string => !!d);
  if (sentDates.length) {
    const groups = new Map<string, string[]>();
    Object.entries(row).forEach(([k, v]) => {
      const m = k.match(/^(\d{4}-\d{2}-\d{2})(_.+)?$/);
      if (!m || typeof v !== "string") return;
      const ev = parseEventValue(v);
      if (ev?.code.toUpperCase() !== "NY" || ev.status !== "planned") return;
      groups.set(m[2] || "", [...(groups.get(m[2] || "") || []), k]);
    });
    // On a multi-plant row only the legs the tracker's vendor names sent this parcel
    // (H27_DEV_015 is MRC/HI EMB, but the tracker row is HIEMB — the MRC leg's NY stays open).
    const vendor = plantTokens(item.fields.plant);
    groups.forEach((keys, leg) => {
      if (leg && vendor.size && ![...plantTokens(leg.slice(1))].some((p) => vendor.has(p))) return;
      let best: { k: string; gap: number } | null = null;
      for (const k of keys)
        for (const d of sentDates) {
          const gap = Math.abs(Date.parse(k.slice(0, 10)) - Date.parse(d)) / 86_400_000;
          if (!best || gap < best.gap) best = { k, gap };
        }
      if (best && best.gap <= DHL_NY_MATCH_MAX_DAYS) {
        const val = encodeEventValue("NY", "pass");
        changes.push({ field: best.k, label: `NY ${best.k}`, oldValue: String(row[best.k] ?? ""), newValue: val });
        next[best.k] = val;
      }
    });
  }

  if (changes.length) next[DEV_PACK_COLS.syncedAt] = todayIso;
  return { row: next, changes };
}
