"use client";
import React, { useEffect, useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import {
  EmbellishmentRow, getRowStatus, getGroupStatus, hasColorApproval,
  getSeasonAoqConfig, SeasonAoqMap, getTriggerCatalog, TriggerCatalogEntry,
  groupRowsByCombo, isExcludedFromAdvancedAnalytics,
} from "../lib/db";
import { categorySheetName } from "../lib/reportCategories";
import { resolveGraphicAoqVerdict, GraphicAoqResult } from "../lib/nycVerdict";
import { formatDateDDMMYYYY } from "../lib/triggerUtils";

interface ReportsViewProps {
  rows: EmbellishmentRow[];
}

type GraphicStyleGroup = {
  graphic: string;
  style: string;
  category: string;
  season: string;
  combos: Set<string>;
  memberRows: EmbellishmentRow[];
};

// Splits a Style cell that names more than one style number ("10356620/ 10354597") into
// individual tokens, each becoming its own Graphic+Style row.
function splitStyles(raw: string): string[] {
  return String(raw || "")
    .split(/[\/\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// A handful of approved rows carry a COST ("$0.48 (2420 St)") in the Graphic column instead of a
// real graphic code — there's no reliable way to recover the actual code from a cost figure, so
// these are skipped rather than exported under a fake "graphic".
function looksLikeCost(graphic: string): boolean {
  return /^\$/.test(graphic.trim());
}

function statusLabel(s: ReturnType<typeof getGroupStatus>): string {
  switch (s) {
    case "approved":
      return "Approved";
    case "c+p":
      return "C+P";
    case "sent-pending":
      return "Comments Pending";
    case "resubmit":
      return "Resubmit";
    case "hold":
      return "Hold";
    case "dropped":
      return "Dropped";
    default:
      return "Pending";
  }
}

// AOQ outcome of one Graphic+Style, from resolveGraphicAoqVerdict (the same resolver Score Card
// and Plant Performance use, 1-day grace). "pending" is split by whether the AOQ deadline has
// already passed: a graphic still awaiting NY with its AOQ in the future isn't a miss yet, so it
// stays out of the rate's denominator.
type AoqOutcome = "onTime" | "late" | "rejected" | "missed" | "notDue" | "noDate" | "noAoq";
const AOQ_GRACE_DAYS = 1;
const AOQ_OUTCOME_LABEL: Record<AoqOutcome, string> = {
  onTime: "Approved by AOQ",
  late: "Approved after AOQ",
  rejected: "Rejected (NYC-R)",
  missed: "AOQ passed, not approved",
  notDue: "Awaiting - AOQ not due",
  noDate: "Approved - no approval date",
  noAoq: "No AOQ date",
};

type AoqGroup = GraphicStyleGroup & {
  aoq: GraphicAoqResult;
  outcome: AoqOutcome;
  status: ReturnType<typeof getGroupStatus>;
};

type AoqCounts = Record<AoqOutcome, number> & { total: number };
const emptyAoqCounts = (): AoqCounts => ({
  onTime: 0, late: 0, rejected: 0, missed: 0, notDue: 0, noDate: 0, noAoq: 0, total: 0,
});
// Due = AOQ already passed or a verdict already in — the base for both rates.
const aoqDue = (c: AoqCounts) => c.onTime + c.late + c.rejected + c.missed;
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const fmtPct = (v: number | null) => (v === null ? "—" : `${v}%`);

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function CheckboxPill({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
        checked
          ? "bg-blue-600/20 border-blue-500 text-blue-300"
          : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500"
      }`}
    >
      {label}
    </button>
  );
}

export default function ReportsView({ rows }: ReportsViewProps) {
  const [selectedSeasons, setSelectedSeasons] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"approved" | "notApproved" | "aoq" | null>(null);
  // AOQ deadline sources (Trigger Manager catalog + Category/Season fallback) — same as Score Card.
  const [seasonAoqMap, setSeasonAoqMap] = useState<SeasonAoqMap>({});
  const [triggerCatalog, setTriggerCatalog] = useState<TriggerCatalogEntry[]>([]);
  useEffect(() => {
    getSeasonAoqConfig().then(setSeasonAoqMap).catch(() => {});
    getTriggerCatalog().then(setTriggerCatalog).catch(() => {});
  }, []);

  // Season/Category pickers list every value in the data, dropped/hold rows included — narrowing
  // by category shouldn't hide a season or category just because everything under it happens to
  // be dropped right now.
  const allSeasons = useMemo(
    () => Array.from(new Set(rows.map((r) => String(r.col4 || "").trim()).filter(Boolean))).sort(),
    [rows],
  );
  const allCategories = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => categorySheetName(String(r.col3 || ""), String(r.col2 || "")))))
        .sort(),
    [rows],
  );

  const toggleIn = (set: Set<string>, setter: (s: Set<string>) => void, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  // Blank selection == every value — narrowing is opt-in, not required.
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const season = String(r.col4 || "").trim();
      if (selectedSeasons.size > 0 && !selectedSeasons.has(season)) return false;
      const category = categorySheetName(String(r.col3 || ""), String(r.col2 || ""));
      if (selectedCategories.size > 0 && !selectedCategories.has(category)) return false;
      return true;
    });
  }, [rows, selectedSeasons, selectedCategories]);

  // Unique-by-Graphic+Style grouping — Combo # and Ground are ignored; the same graphic on the
  // same style is ONE entry regardless of how many combos/grounds it was allocated under. Every
  // matching row (Dropped/Hold included) is kept as a group member so getGroupStatus below can
  // apply the exact same "a live verdict on any row wins" precedence Advanced Analytics uses —
  // filtering dropped/hold out up front would make a group with one dropped leg and one approved
  // leg resolve differently here than it does there.
  const groups = useMemo(() => {
    const map = new Map<string, GraphicStyleGroup>();
    filteredRows.forEach((row) => {
      const graphic = String(row.col7 || "").trim();
      if (!graphic || looksLikeCost(graphic)) return;
      const category = categorySheetName(String(row.col3 || ""), String(row.col2 || ""));
      const season = String(row.col4 || "").trim();
      const combo = String(row.col6 || "").trim();

      splitStyles(String(row.col5 || "")).forEach((style) => {
        const key = `${graphic.toUpperCase()}||${style.toUpperCase()}`;
        let g = map.get(key);
        if (!g) {
          g = { graphic, style, category, season, combos: new Set(), memberRows: [] };
          map.set(key, g);
        }
        if (combo) g.combos.add(combo);
        g.memberRows.push(row);
      });
    });
    return Array.from(map.values());
  }, [filteredRows]);

  // TWO INDEPENDENT AXES, matching Advanced Analytics' Tech & Layout vs. Color Approval cards:
  //  - Overall approval = getGroupStatus (a live verdict on ANY member row wins) === 'approved'.
  //    This is the Tech & Layout number — it does NOT require color approval.
  //  - Color approval = ANY member row's 1st/2nd Strike-Off Comment says "APPROVED FOR COLOR",
  //    counted only among ACTIVE groups (status not Dropped/Hold — those are paused, not
  //    "awaiting color approval"). A group can be Approved overall and STILL be missing color
  //    approval; the two lists are allowed to overlap.
  const approvedGroups = useMemo(
    () => groups.filter((g) => getGroupStatus(g.memberRows) === "approved"),
    [groups],
  );
  const notColorApprovedGroups = useMemo(
    () =>
      groups.filter((g) => {
        const status = getGroupStatus(g.memberRows);
        if (status === "dropped" || status === "hold") return false;
        // Branding graphics (Graphic Type col19, e.g. VV-15066) never go through colour approval —
        // keep them off this list.
        if (g.memberRows.some((r) => /branding/i.test(String(r.col19 || "")))) return false;
        return !g.memberRows.some(hasColorApproval);
      }),
    [groups],
  );

  // ── AOQ approval rate ────────────────────────────────────────────────────
  // Counted in the SAME unit as Advanced Analytics' "Active Combos" so the two pages reconcile:
  // groupRowsByCombo (Style | Graphic | Combo | Ground), Branding / Trial graphic types dropped
  // (isExcludedFromAdvancedAnalytics), Dropped / Hold combos out of the running. Only a combo's
  // live member rows feed the verdict.
  const aoqGroups = useMemo<AoqGroup[]>(() => {
    const today = todayIso();
    const out: AoqGroup[] = [];
    groupRowsByCombo(filteredRows.filter((r) => !isExcludedFromAdvancedAnalytics(r))).forEach((memberRows) => {
      const first = memberRows[0];
      const g: GraphicStyleGroup = {
        graphic: String(first.col7 || "").trim(),
        style: String(first.col5 || "").trim(),
        category: categorySheetName(String(first.col3 || ""), String(first.col2 || "")),
        season: String(first.col4 || "").trim(),
        combos: new Set([String(first.col6 || "").trim()].filter(Boolean)),
        memberRows,
      };
      const status = getGroupStatus(g.memberRows);
      if (status === "dropped" || status === "hold") return;
      const entries = g.memberRows
        .map((r) => ({ row: r as unknown as Record<string, unknown>, status: getRowStatus(r) }))
        .filter((e) => e.status !== "dropped" && e.status !== "hold");
      if (entries.length === 0) return;
      const aoq = resolveGraphicAoqVerdict(entries, seasonAoqMap, {
        graceDays: AOQ_GRACE_DAYS,
        useFallback: true,
        triggerCatalog,
      });
      let outcome: AoqOutcome;
      if (aoq.verdict === "onTime") outcome = "onTime";
      else if (aoq.verdict === "late") outcome = "late";
      else if (aoq.verdict === "rejected") outcome = "rejected";
      else if (aoq.verdict === "pending" && aoq.aoqIso) outcome = aoq.aoqIso < today ? "missed" : "notDue";
      // "unscored" with an AOQ date = approved, but no approval date anywhere to time it against.
      else if (aoq.aoqIso) outcome = "noDate";
      else outcome = "noAoq";
      out.push({ ...g, aoq, outcome, status });
    });
    return out;
  }, [filteredRows, seasonAoqMap, triggerCatalog]);

  const aoqTotals = useMemo(() => {
    const c = emptyAoqCounts();
    aoqGroups.forEach((g) => { c[g.outcome]++; c.total++; });
    return c;
  }, [aoqGroups]);

  const aoqBreakdown = useMemo(() => {
    const map = new Map<string, { season: string; category: string; c: AoqCounts }>();
    aoqGroups.forEach((g) => {
      const key = `${g.season}|||${g.category}`;
      let e = map.get(key);
      if (!e) {
        e = { season: g.season, category: g.category, c: emptyAoqCounts() };
        map.set(key, e);
      }
      e.c[g.outcome]++;
      e.c.total++;
    });
    return Array.from(map.values()).sort(
      (a, b) => a.season.localeCompare(b.season) || a.category.localeCompare(b.category),
    );
  }, [aoqGroups]);

  // Which table cell's combos are listed below the AOQ table (rowKey null = the TOTAL row).
  const [aoqDrill, setAoqDrill] = useState<{ outcome: AoqOutcome; rowKey: string | null } | null>(null);
  const aoqDrillList = useMemo(
    () =>
      aoqDrill
        ? aoqGroups
            .filter(
              (g) =>
                g.outcome === aoqDrill.outcome &&
                (aoqDrill.rowKey === null || `${g.season}|||${g.category}` === aoqDrill.rowKey),
            )
            .sort((a, b) => a.graphic.localeCompare(b.graphic) || a.style.localeCompare(b.style))
        : [],
    [aoqGroups, aoqDrill],
  );

  const seasonsLabel = () =>
    selectedSeasons.size > 0 ? Array.from(selectedSeasons).sort().join("_") : "AllSeasons";

  const buildSummarySheet = (workbook: ExcelJS.Workbook, label: string, list: GraphicStyleGroup[]) => {
    const summary = workbook.addWorksheet("Summary");
    summary.columns = [
      { header: "Category", key: "category", width: 20 },
      { header: label, key: "count", width: 24 },
    ];
    summary.getRow(1).font = { bold: true };
    const byCat = new Map<string, number>();
    list.forEach((g) => byCat.set(g.category, (byCat.get(g.category) || 0) + 1));
    Array.from(byCat.keys())
      .sort()
      .forEach((c) => summary.addRow({ category: c, count: byCat.get(c) }));
    summary.addRow({});
    const totalRow = summary.addRow({ category: "GRAND TOTAL", count: list.length });
    totalRow.font = { bold: true };
  };

  const exportApproved = async () => {
    if (approvedGroups.length === 0) {
      window.alert("No approved Graphic+Style combinations match this filter.");
      return;
    }
    setBusy("approved");
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Approved");
      sheet.columns = [
        { header: "Category", key: "category", width: 16 },
        { header: "Season", key: "season", width: 10 },
        { header: "Graphic", key: "graphic", width: 20 },
        { header: "Style", key: "style", width: 16 },
        { header: "Combos", key: "combos", width: 10 },
        { header: "Approval Date(s)", key: "dates", width: 24 },
      ];
      sheet.getRow(1).font = { bold: true };
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } };
      approvedGroups
        .slice()
        .sort(
          (a, b) =>
            a.category.localeCompare(b.category) ||
            a.graphic.localeCompare(b.graphic) ||
            a.style.localeCompare(b.style),
        )
        .forEach((g) => {
          // Only the specific rows that individually carry the "approved" verdict — not every
          // member row — so a stray col39 value on an unrelated resubmit/pending leg in the same
          // group never lands in the Approval Date(s) cell.
          const dates = new Set(
            g.memberRows
              .filter((r) => getRowStatus(r) === "approved")
              .map((r) => String(r.col39 || "").trim())
              .filter(Boolean),
          );
          sheet.addRow({
            category: g.category,
            season: g.season,
            graphic: g.graphic,
            style: g.style,
            combos: g.combos.size,
            dates: Array.from(dates).sort().join(", "),
          });
        });

      buildSummarySheet(workbook, "Approved Graphic+Style", approvedGroups);

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `Approved_Graphics_${seasonsLabel()}.xlsx`,
      );
    } finally {
      setBusy(null);
    }
  };

  const exportNotColorApproved = async () => {
    if (notColorApprovedGroups.length === 0) {
      window.alert("Every active Graphic+Style combination in this filter already has color approval.");
      return;
    }
    setBusy("notApproved");
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Not Color Approved");
      sheet.columns = [
        { header: "Category", key: "category", width: 16 },
        { header: "Season", key: "season", width: 10 },
        { header: "Graphic", key: "graphic", width: 20 },
        { header: "Style", key: "style", width: 16 },
        { header: "Combos", key: "combos", width: 10 },
        { header: "Status", key: "status", width: 14 },
        { header: "Latest Strike-Off Comment", key: "comment", width: 40 },
      ];
      sheet.getRow(1).font = { bold: true };
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };
      notColorApprovedGroups
        .slice()
        .sort(
          (a, b) =>
            a.category.localeCompare(b.category) ||
            a.graphic.localeCompare(b.graphic) ||
            a.style.localeCompare(b.style),
        )
        .forEach((g) => {
          const comment = g.memberRows
            .map((r) => String(r.col34 || r.col22 || "").trim())
            .find(Boolean);
          sheet.addRow({
            category: g.category,
            season: g.season,
            graphic: g.graphic,
            style: g.style,
            combos: g.combos.size,
            status: statusLabel(getGroupStatus(g.memberRows)),
            comment: comment || "",
          });
        });

      buildSummarySheet(workbook, "Not Color Approved", notColorApprovedGroups);

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `Not_Color_Approved_${seasonsLabel()}.xlsx`,
      );
    } finally {
      setBusy(null);
    }
  };

  const exportAoqReport = async () => {
    if (aoqGroups.length === 0) {
      window.alert("No active combos match this filter.");
      return;
    }
    setBusy("aoq");
    try {
      const workbook = new ExcelJS.Workbook();

      const summary = workbook.addWorksheet("Rates by Season-Category");
      summary.columns = [
        { header: "Season", key: "season", width: 12 },
        { header: "Category", key: "category", width: 18 },
        { header: "Active Combos", key: "total", width: 14 },
        { header: "Due (AOQ passed / verdict in)", key: "due", width: 18 },
        { header: "Approved by AOQ", key: "onTime", width: 14 },
        { header: "Approved after AOQ", key: "late", width: 14 },
        { header: "Rejected", key: "rejected", width: 10 },
        { header: "AOQ passed, not approved", key: "missed", width: 16 },
        { header: "AOQ not due", key: "notDue", width: 12 },
        { header: "Approved, no date", key: "noDate", width: 14 },
        { header: "No AOQ date", key: "noAoq", width: 12 },
        { header: "On-time Approval %", key: "onTimePct", width: 14 },
        { header: "Total Approval %", key: "approvedPct", width: 14 },
      ];
      summary.getRow(1).font = { bold: true };
      const addCountsRow = (season: string, category: string, c: AoqCounts) => {
        const due = aoqDue(c);
        return summary.addRow({
          season, category, total: c.total, due,
          onTime: c.onTime, late: c.late, rejected: c.rejected, missed: c.missed,
          notDue: c.notDue, noDate: c.noDate, noAoq: c.noAoq,
          onTimePct: fmtPct(pct(c.onTime, due)),
          approvedPct: fmtPct(pct(c.onTime + c.late, due)),
        });
      };
      aoqBreakdown.forEach((b) => addCountsRow(b.season, b.category, b.c));
      summary.addRow({});
      addCountsRow("GRAND TOTAL", "", aoqTotals).font = { bold: true };

      const detailColumns: Partial<ExcelJS.Column>[] = [
        { header: "Season", key: "season", width: 12 },
        { header: "Category", key: "category", width: 16 },
        { header: "Graphic", key: "graphic", width: 20 },
        { header: "Style", key: "style", width: 16 },
        { header: "Combo", key: "combo", width: 10 },
        { header: "Ground", key: "ground", width: 16 },
        { header: "AOQ Date", key: "aoq", width: 12 },
        { header: "NY Approval Date", key: "approval", width: 14 },
        { header: "NY Rejected Date", key: "rejected", width: 14 },
        { header: "Days vs AOQ (+ = early)", key: "days", width: 14 },
        { header: "AOQ Outcome", key: "outcome", width: 24 },
        { header: "Status", key: "status", width: 16 },
        { header: "Estimated", key: "estimated", width: 10 },
        { header: "Latest Strike-Off Comment", key: "comment", width: 40 },
      ];
      const addDetailSheet = (name: string, list: AoqGroup[]) => {
        const sheet = workbook.addWorksheet(name);
        sheet.columns = detailColumns;
        sheet.getRow(1).font = { bold: true };
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: detailColumns.length } };
        list
          .slice()
          .sort(
            (a, b) =>
              a.season.localeCompare(b.season) ||
              a.category.localeCompare(b.category) ||
              a.graphic.localeCompare(b.graphic) ||
              a.style.localeCompare(b.style),
          )
          .forEach((g) => {
            const comment = g.memberRows.map((r) => String(r.col34 || r.col22 || "").trim()).find(Boolean);
            sheet.addRow({
              season: g.season,
              category: g.category,
              graphic: g.graphic,
              style: g.style,
              combo: String(g.memberRows[0].col6 || "").trim(),
              ground: String(g.memberRows[0].col8 || "").trim(),
              aoq: formatDateDDMMYYYY(g.aoq.aoqIso) || "",
              approval: formatDateDDMMYYYY(g.aoq.approvalIso) || "",
              rejected: formatDateDDMMYYYY(g.aoq.rejectedIso) || "",
              days: g.aoq.daysVsAoq ?? "",
              outcome: AOQ_OUTCOME_LABEL[g.outcome],
              status: statusLabel(g.status),
              estimated: g.aoq.estimated ? "Yes" : "",
              comment: comment || "",
            });
          });
      };
      addDetailSheet("Approved by AOQ", aoqGroups.filter((g) => g.outcome === "onTime"));
      addDetailSheet(
        "Not Approved by AOQ",
        aoqGroups.filter((g) => g.outcome === "late" || g.outcome === "rejected" || g.outcome === "missed"),
      );
      addDetailSheet(
        "Not Due or Untimed",
        aoqGroups.filter((g) => g.outcome === "notDue" || g.outcome === "noDate" || g.outcome === "noAoq"),
      );

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `AOQ_Approval_Rate_${seasonsLabel()}.xlsx`,
      );
    } finally {
      setBusy(null);
    }
  };

  const dueTotal = aoqDue(aoqTotals);
  const aoqCards: { label: string; value: string | number; sub?: string; color: string }[] = [
    { label: "On-time approval rate", value: fmtPct(pct(aoqTotals.onTime, dueTotal)), sub: `${aoqTotals.onTime} of ${dueTotal} due`, color: "text-emerald-500" },
    { label: "Approved by AOQ", value: aoqTotals.onTime, color: "text-emerald-500" },
    { label: "Approved after AOQ", value: aoqTotals.late, color: "text-amber-500" },
    { label: "Rejected", value: aoqTotals.rejected, color: "text-rose-500" },
    { label: "AOQ passed, not approved", value: aoqTotals.missed, color: "text-rose-400" },
    { label: "AOQ not due yet", value: aoqTotals.notDue, color: "text-zinc-400" },
    { label: "Approved, no date", value: aoqTotals.noDate, color: "text-zinc-400" },
    { label: "No AOQ date", value: aoqTotals.noAoq, color: "text-zinc-500" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xl mb-6">
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight mb-1">
          Approval Reports
        </h1>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Pick a Season and Category, then export the Graphic+Style approval breakdown for that
          selection. Leave a group blank to include every value. &ldquo;Approved Graphics&rdquo;
          is the overall Tech &amp; Layout verdict; &ldquo;Not Color-Approved&rdquo; is a separate,
          later step read from the 1st / 2nd Strike-Off Comments — the same two independent
          numbers Advanced Analytics shows, so a graphic can appear on both exports.
        </p>
      </div>

      <div className="bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xl mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wide">
            Season
          </h2>
          {selectedSeasons.size > 0 && (
            <button
              onClick={() => setSelectedSeasons(new Set())}
              className="text-xs font-semibold text-blue-500 hover:text-blue-400"
            >
              Clear ({selectedSeasons.size})
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {allSeasons.length === 0 && (
            <span className="text-xs text-zinc-500">No rows with a Season value.</span>
          )}
          {allSeasons.map((s) => (
            <CheckboxPill
              key={s}
              label={s}
              checked={selectedSeasons.has(s)}
              onChange={() => toggleIn(selectedSeasons, setSelectedSeasons, s)}
            />
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xl mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wide">
            Category
          </h2>
          {selectedCategories.size > 0 && (
            <button
              onClick={() => setSelectedCategories(new Set())}
              className="text-xs font-semibold text-blue-500 hover:text-blue-400"
            >
              Clear ({selectedCategories.size})
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {allCategories.map((c) => (
            <CheckboxPill
              key={c}
              label={c}
              checked={selectedCategories.has(c)}
              onChange={() => toggleIn(selectedCategories, setSelectedCategories, c)}
            />
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xl">
        <h2 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wide mb-4">
          Export
        </h2>
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={exportApproved}
            disabled={busy !== null}
            className="flex-1 flex items-center justify-between gap-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-3 px-5 rounded-xl transition-all shadow-md active:scale-[0.98]"
          >
            <span>{busy === "approved" ? "Exporting…" : "Export Approved Graphics"}</span>
            <span className="text-xs font-semibold bg-black/20 rounded-full px-2 py-0.5">
              {approvedGroups.length}
            </span>
          </button>
          <button
            onClick={exportNotColorApproved}
            disabled={busy !== null}
            className="flex-1 flex items-center justify-between gap-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold py-3 px-5 rounded-xl transition-all shadow-md active:scale-[0.98]"
          >
            <span>{busy === "notApproved" ? "Exporting…" : "Export Not Color-Approved"}</span>
            <span className="text-xs font-semibold bg-black/20 rounded-full px-2 py-0.5">
              {notColorApprovedGroups.length}
            </span>
          </button>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-4">
          Counts are unique Graphic+Style combinations (combo # and ground color collapsed) across{" "}
          {filteredRows.length} row{filteredRows.length === 1 ? "" : "s"} matching the current
          filter.
        </p>
      </div>

      <div className="bg-white dark:bg-[#0f1115] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xl mt-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wide">
              AOQ Approval Rate
            </h2>
            <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
              Active combos — same count as Advanced Analytics (Style + Graphic + Combo + Ground; Branding / Trial, Dropped / Hold excluded) — scored against their AOQ
              date with a {AOQ_GRACE_DAYS}-day grace, using the same NY verdict as Score Card. Rates
              are over combos that are <em>due</em> — AOQ already passed or a verdict already in.
            </p>
          </div>
          <button
            onClick={exportAoqReport}
            disabled={busy !== null}
            className="shrink-0 flex items-center gap-3 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold py-2.5 px-4 rounded-xl transition-all shadow-md active:scale-[0.98]"
          >
            <span>{busy === "aoq" ? "Exporting…" : "Export AOQ Report"}</span>
            <span className="text-xs font-semibold bg-black/20 rounded-full px-2 py-0.5">{aoqTotals.total}</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-5">
          {aoqCards.map((c) => (
            <div key={c.label} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 leading-tight">
                {c.label}
              </div>
              <div className={`text-xl font-black mt-1 ${c.color}`}>{c.value}</div>
              {c.sub && <div className="text-[10px] text-zinc-500">{c.sub}</div>}
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <th className="text-left py-2 pr-3">Season</th>
                <th className="text-left py-2 pr-3">Category</th>
                <th className="text-center py-2 px-2">Active</th>
                <th className="text-center py-2 px-2">Due</th>
                <th className="text-center py-2 px-2 text-emerald-500">By AOQ</th>
                <th className="text-center py-2 px-2 text-amber-500">Late</th>
                <th className="text-center py-2 px-2 text-rose-500">Rejected</th>
                <th className="text-center py-2 px-2 text-rose-400">Missed</th>
                <th className="text-center py-2 px-2">Not due</th>
                <th className="text-center py-2 px-2">Approved, no date</th>
                <th className="text-center py-2 px-2">No AOQ</th>
                <th className="text-center py-2 px-2">On-time %</th>
                <th className="text-center py-2 pl-2">Approved %</th>
              </tr>
            </thead>
            <tbody>
              {aoqBreakdown.length === 0 && (
                <tr>
                  <td colSpan={13} className="py-4 text-center text-zinc-500">
                    No active combos in this filter.
                  </td>
                </tr>
              )}
              {aoqBreakdown.length > 0 &&
                [...aoqBreakdown, { season: "TOTAL", category: "", c: aoqTotals }].map((b, i, arr) => {
                  const due = aoqDue(b.c);
                  const isTotal = i === arr.length - 1;
                  return (
                    <tr
                      key={isTotal ? "__total" : `${b.season}|${b.category}`}
                      className={`border-b border-zinc-100 dark:border-zinc-900 text-zinc-700 dark:text-zinc-300 ${isTotal ? "font-black" : ""}`}
                    >
                      <td className="py-2 pr-3">{b.season}</td>
                      <td className="py-2 pr-3">{b.category}</td>
                      <td className="text-center py-2 px-2">{b.c.total}</td>
                      <td className="text-center py-2 px-2">{due}</td>
                      {(
                        [
                          ["onTime", "text-emerald-500 font-bold"],
                          ["late", "text-amber-500"],
                          ["rejected", "text-rose-500"],
                          ["missed", "text-rose-400"],
                          ["notDue", "text-zinc-500"],
                          ["noDate", "text-zinc-400"],
                          ["noAoq", "text-zinc-500"],
                        ] as [AoqOutcome, string][]
                      ).map(([o, cls]) => {
                        const rowKey = isTotal ? null : `${b.season}|||${b.category}`;
                        const active = aoqDrill?.outcome === o && aoqDrill.rowKey === rowKey;
                        return (
                          <td key={o} className={`text-center py-2 px-2 ${cls}`}>
                            {b.c[o] > 0 ? (
                              <button
                                type="button"
                                onClick={() => setAoqDrill(active ? null : { outcome: o, rowKey })}
                                title={`Show the ${AOQ_OUTCOME_LABEL[o]} combos`}
                                className={`underline decoration-dotted underline-offset-2 hover:opacity-80 ${active ? "rounded bg-zinc-200 dark:bg-zinc-800 px-1.5" : ""}`}
                              >
                                {b.c[o]}
                              </button>
                            ) : (
                              b.c[o]
                            )}
                          </td>
                        );
                      })}
                      <td className="text-center py-2 px-2 font-bold">{fmtPct(pct(b.c.onTime, due))}</td>
                      <td className="text-center py-2 pl-2">{fmtPct(pct(b.c.onTime + b.c.late, due))}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {aoqDrill && (
          <div className="mt-5 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-black uppercase tracking-wide text-zinc-900 dark:text-white">
                {AOQ_OUTCOME_LABEL[aoqDrill.outcome]}
                {aoqDrill.rowKey ? ` — ${aoqDrill.rowKey.split("|||").join(" ")}` : " — all"} ({aoqDrillList.length})
              </h3>
              <button
                type="button"
                onClick={() => setAoqDrill(null)}
                className="text-xs font-semibold text-blue-500 hover:text-blue-400"
              >
                Close
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-zinc-500 border-b border-zinc-200 dark:border-zinc-800 text-left">
                    <th className="py-2 pr-3">Graphic</th>
                    <th className="py-2 pr-3">Style</th>
                    <th className="py-2 pr-3">Combo</th>
                    <th className="py-2 pr-3">Ground</th>
                    <th className="py-2 pr-3">Trigger</th>
                    <th className="py-2 pr-3">Approval / Dropped col</th>
                    <th className="py-2 pr-3">AOQ Used</th>
                    <th className="py-2 pr-3">NY Approved</th>
                    <th className="py-2 pr-3">NY Rejected</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Latest Strike-Off Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {aoqDrillList.map((g, i) => {
                    const r = g.memberRows[0];
                    const comment = g.memberRows.map((x) => String(x.col34 || x.col22 || "").trim()).find(Boolean);
                    const col20s = Array.from(
                      new Set(g.memberRows.map((x) => String(x.col20 || "").trim()).filter(Boolean)),
                    ).join(" / ");
                    return (
                      <tr
                        key={`${g.graphic}|${g.style}|${i}`}
                        className="border-b border-zinc-100 dark:border-zinc-900 text-zinc-700 dark:text-zinc-300 align-top"
                      >
                        <td className="py-2 pr-3 font-semibold">{g.graphic}</td>
                        <td className="py-2 pr-3">{g.style}</td>
                        <td className="py-2 pr-3">{String(r.col6 || "")}</td>
                        <td className="py-2 pr-3">{String(r.col8 || "")}</td>
                        <td className="py-2 pr-3">{String(r.col2 || "") || "—"}</td>
                        <td className="py-2 pr-3">{col20s || "—"}</td>
                        <td className="py-2 pr-3">{formatDateDDMMYYYY(g.aoq.aoqIso) || "—"}</td>
                        <td className="py-2 pr-3">{formatDateDDMMYYYY(g.aoq.approvalIso) || "—"}</td>
                        <td className="py-2 pr-3">{formatDateDDMMYYYY(g.aoq.rejectedIso) || "—"}</td>
                        <td className="py-2 pr-3">{statusLabel(g.status)}</td>
                        <td className="py-2 max-w-xs truncate" title={comment || ""}>{comment || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
