"use client";
import React, { useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { EmbellishmentRow, getRowStatus, getGroupStatus, hasColorApproval } from "../lib/db";
import { categorySheetName } from "../lib/reportCategories";

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
  const [busy, setBusy] = useState<"approved" | "notApproved" | null>(null);

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
        return !g.memberRows.some(hasColorApproval);
      }),
    [groups],
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
    </div>
  );
}
