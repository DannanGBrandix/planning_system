import React, { useMemo, useState } from "react";
import { EmbellishmentRow, getRowStatus, isRowSent, getGroupStatus, groupRowsByCombo, hasColorApproval, hasPlacementApproval, hasStrikeOffSubmission } from "../lib/db";
import ComboListModal from "./ComboListModal";
import { isCkFamilyCategory } from "../lib/ckCategories";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { FilterSelections } from "./AdvancedSidebarFilters";
import { extractValidDate, formatDateDDMMYYYY } from "../lib/triggerUtils";

interface AdvancedDashboardProps {
  rows: EmbellishmentRow[];
  onAutoApprove?: (rowIds: string[]) => void;
  selections?: FilterSelections;
  onUpdateRow?: (updatedRow: EmbellishmentRow) => void | Promise<void>;
}

// Helper: detect if a row has "C+P SP" style comment in strike-off fields
function hasCpSpComment(r: EmbellishmentRow): boolean {
  const c22 = String(String(String(String(r.col22 || ""))))
    .trim()
    .toLowerCase();
  const c34 = String(String(String(String(r.col34 || ""))))
    .trim()
    .toLowerCase();
  return (
    c22.includes("c+p sp") ||
    c34.includes("c+p sp") ||
    c22.includes("c+p") ||
    c34.includes("c+p")
  );
}

export default function AdvancedDashboard({
  rows: allRows,
  onAutoApprove,
  selections,
  onUpdateRow,
}: AdvancedDashboardProps) {
  const [showCpSpModal, setShowCpSpModal] = useState(false);
  // Which approval-gap list the "Tech & Layout" / "Color Approval" cards are showing, if any —
  // clicking a card opens the popup listing exactly which active combos are still missing that
  // approval (previously the card only showed a bare count with no way to see which items it
  // referred to).
  const [approvalGapModal, setApprovalGapModal] = useState<"color" | "placementNeeded" | "layoutTech" | "cp" | "commentsPending" | null>(null);
  const [editingTriggerKey, setEditingTriggerKey] = useState<string | null>(
    null,
  );
  const [editDateValue, setEditDateValue] = useState<string>("");
  const [triggerPage, setTriggerPage] = useState<number>(1);
  const [isAoqHidden, setIsAoqHidden] = useState<boolean>(false);
  // Toggles between the analytics charts and the Graphic/Combo search board,
  // without navigating away from the Advanced Dashboard page.
  const [advancedTab, setAdvancedTab] = useState<"chart" | "search">("chart");

  // APPROVAL COLUMN SYNC — writes the derived Tech & Layout / Color approval
  // verdicts back into the actual col40 (Layout Approval) / col41 (Color
  // Approval) database columns, so other views (e.g. the Graphic/Combo search
  // cards) reflect them too. This is a deliberate, user-triggered action
  // (never automatic) since it's a bulk write across potentially hundreds of
  // rows and creates an audit-log entry per changed field.
  const [syncStatus, setSyncStatus] = useState<
    "idle" | "confirm" | "running" | "done"
  >("idle");
  const [syncPlan, setSyncPlan] = useState<
    Array<{ row: EmbellishmentRow; col40: string; col41: string }>
  >([]);
  const [syncProgress, setSyncProgress] = useState<{
    done: number;
    failed: number;
  }>({ done: 0, failed: 0 });

  const handleSaveTriggerAoqDate = (triggerKey: string, newDateStr: string) => {
    if (!onUpdateRow || !newDateStr) {
      setEditingTriggerKey(null);
      return;
    }

    const targetKey = triggerKey.trim().toUpperCase();

    // Match all rows belonging to this trigger or sub-category drop group
    const matchingRows = allRows.filter((r) => {
      if (r.is_current === false || String(r.is_current) === "false")
        return false;
      const rawSeason = String(r.col4 || "")
        .trim()
        .toUpperCase();
      const rawTrigger = String(r.col2 || "")
        .trim()
        .toUpperCase();

      let subCatName = rawSeason;
      if (rawTrigger && rawTrigger !== "N/A") {
        subCatName = rawTrigger;
      } else {
        const parts = rawSeason.split(/\s+/);
        if (parts.length > 1) {
          subCatName = parts.slice(1).join(" ");
        }
      }

      return (
        subCatName === targetKey ||
        rawTrigger === targetKey ||
        rawSeason === targetKey ||
        rawSeason.includes(targetKey) ||
        rawTrigger.includes(targetKey)
      );
    });

    if (matchingRows.length > 0) {
      matchingRows.forEach((r) => {
        onUpdateRow({
          ...r,
          col20: newDateStr,
        });
      });
    }
    setEditingTriggerKey(null);
  };

  // ONLY count current versions for charts and totals!
  const rows = useMemo(
    () =>
      allRows.filter(
        (r) => r.is_current !== false && String(r.is_current) !== "false",
      ),
    [allRows],
  );

  // Scan only rows that are already Approved (col20) and work out which ones
  // have a col40/col41 value that doesn't match what the data actually says.
  // Everything else (Comments Pending, Submission Pending, C+P, Resubmit,
  // Hold, Dropped, ...) is left completely alone — the planner only wants
  // this sync to answer "did the Approved ones actually get a colour
  // sign-off", not to stamp a blanket N on every row that isn't there yet.
  const prepareApprovalSync = () => {
    const plan: Array<{ row: EmbellishmentRow; col40: string; col41: string }> =
      [];
    rows.forEach((r) => {
      if (getRowStatus(r) !== "approved") return;
      const desiredCol40 = "Y";
      const desiredCol41 = hasColorApproval(r) ? "Y" : "N";
      const currentCol40 = String(r.col40 || "").trim().toUpperCase();
      const currentCol41 = String(r.col41 || "").trim().toUpperCase();
      if (currentCol40 !== desiredCol40 || currentCol41 !== desiredCol41) {
        plan.push({ row: r, col40: desiredCol40, col41: desiredCol41 });
      }
    });
    setSyncPlan(plan);
    setSyncStatus("confirm");
  };

  const approvedRowsCount = useMemo(
    () => rows.filter((r) => getRowStatus(r) === "approved").length,
    [rows],
  );

  const cancelApprovalSync = () => {
    setSyncPlan([]);
    setSyncStatus("idle");
  };

  const runApprovalSync = async () => {
    if (!onUpdateRow || syncPlan.length === 0) {
      setSyncStatus("idle");
      return;
    }
    setSyncStatus("running");
    setSyncProgress({ done: 0, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const item of syncPlan) {
      try {
        await onUpdateRow({
          ...item.row,
          col40: item.col40,
          col41: item.col41,
        });
        done++;
      } catch {
        failed++;
      }
      setSyncProgress({ done, failed });
    }
    setSyncStatus("done");
  };

  const stats = useMemo(() => {
    // =========================================================
    // COUNTING RULES:
    //  - COMBO COUNT:    each row = 1 combo (rows are the atomic unit)
    //  - GRAPHIC COUNT:  count unique col7 values (e.g. "GVS27-456" = 1 graphic,
    //                    regardless of how many combo rows share that graphic code)
    //  - Approval status for a GRAPHIC is derived per-graphic:
    //    A graphic is "Approved" if ANY of its rows have approved status.
    //    A graphic is "Dropped" only if ALL its rows are dropped.
    //    Otherwise it is "Pending".
    // =========================================================

    // Group rows by unique graphic (col7)
    const graphicMap = new Map<string, EmbellishmentRow[]>();
    rows.forEach((r) => {
      const g = String(String(String(String(r.col7 || "")))).trim();
      if (!g) return;
      if (!graphicMap.has(g)) graphicMap.set(g, []);
      graphicMap.get(g)!.push(r);
    });

    // Group rows by unique item combo (col5 + col7 + col6 + col8). Uses the shared
    // groupRowsByCombo so DashboardStats on the standard Dashboard counts combos the
    // exact same way this page does.
    const comboMap = groupRowsByCombo(rows);

    const graphicTotal = graphicMap.size; // unique col7 values
    const comboTotal = comboMap.length; // one entry per combo

    // A graphic/combo is "Hold" (CK's `H` code — CROSS DEVELOPMENT) when it has no live outcome
    // (not Approved / C+P) and every one of its rows is either Hold or Dropped, with at least one
    // Hold. Held items are neither dropped nor a live submission, so — like Dropped — they are
    // excluded from the active denominator and from "Submission Pending", and shown on their own.
    const isHoldGroup = (statuses: ReturnType<typeof getRowStatus>[]) =>
      !statuses.some((s) => s === "approved" || s === "c+p") &&
      statuses.some((s) => s === "hold") &&
      statuses.every((s) => s === "hold" || s === "dropped");

    // ONE exclusive status bucket per graphic and per combo, via the shared getGroupStatus
    // (app/lib/db.ts). This is what makes the numbers reconcile:
    //   Approved + C+P + Comments Pending + Resubmit + Submission Pending  = active
    //   active   + Hold + Dropped                                          = total
    // getGroupStatus delegates to getRowStatus, so CK rows (A/D/SP/CP/H letter codes) and VS/PINK
    // rows (col20 + strike-off comment cascade) keep their own classification — this only decides
    // how a multi-row group collapses to one value. Two adjacent "sent to NY, awaiting sign-off"
    // buckets:
    //   "C+P"              ('c+p')          — VS/PINK only: a row explicitly carries a C+P note.
    //   "Comments Pending" ('sent-pending') — VS/PINK with no verdict but the strike-off has gone
    //                                          out (DHL number or a strike-off comment), PLUS every
    //                                          CK-family group whose status is CP — CK's "CP" code
    //                                          means "Comments Pending", so CK never lands in "C+P".
    // "Submission Pending" ('pending') = strike-off NOT sent to NY yet. Full dispatch/"NY Sent"
    // (isRowSent, which also counts col20) is still a separate axis handled below. DashboardStats
    // card #5 uses the same getGroupStatus so the two screens agree for the same Category/Season.
    let graphicApproved = 0, graphicCP = 0, graphicSentPending = 0, graphicResubmit = 0,
      graphicPending = 0, graphicHold = 0, graphicDropped = 0;
    graphicMap.forEach((gRows) => {
      switch (getGroupStatus(gRows)) {
        case "approved": graphicApproved++; break;
        case "c+p": graphicCP++; break;
        case "sent-pending": graphicSentPending++; break;
        case "resubmit": graphicResubmit++; break;
        case "hold": graphicHold++; break;
        case "dropped": graphicDropped++; break;
        default: graphicPending++;
      }
    });

    let comboApproved = 0, comboCP = 0, comboSentPending = 0, comboResubmit = 0,
      comboPending = 0, comboHold = 0, comboDropped = 0;
    comboMap.forEach((cRows) => {
      switch (getGroupStatus(cRows)) {
        case "approved": comboApproved++; break;
        case "c+p": comboCP++; break;
        case "sent-pending": comboSentPending++; break;
        case "resubmit": comboResubmit++; break;
        case "hold": comboHold++; break;
        case "dropped": comboDropped++; break;
        default: comboPending++;
      }
    });

    // APPROVAL SPLIT — per the actual workflow: the "Strike off Aesthetic
    // Approval / Dropped" column (col20) is only ever set to "Approved" once
    // Tech & Layout has been signed off, so Tech & Layout Approved ALWAYS
    // equals the overall Approved count exactly — it is not a separate,
    // independently-derived number.
    //
    // Color approval is a later, independent step: it's only counted when the
    // 1st/2nd Strike-Off Comments explicitly say "APPROVED FOR COLOR", and it
    // is not implied by the overall Approved status.
    // Color and Placement approval are both independent later steps, each with its own source
    // (color: "APPROVED FOR COLOR" in the Strike-Off Comments; placement: the tracking chart's
    // "Placment Approval Status" column, now landing in col42). Counted the same way — active
    // combos / graphics only, ANY member row carrying the sign-off wins — so each card's
    // "X / Y active" and its drill-down list always agree.
    const comboLayoutTechApproved = comboApproved;
    const graphicLayoutTechApproved = graphicApproved;
    let comboColorApproved = 0;
    let graphicColorApproved = 0;
    let comboPlacementApproved = 0;
    let graphicPlacementApproved = 0;

    comboMap.forEach((cRows) => {
      const statuses = cRows.map(getRowStatus);
      if (statuses.every((s) => s === "dropped") || isHoldGroup(statuses)) return; // only active combos, matching the hero metrics
      if (cRows.some(hasColorApproval)) comboColorApproved++;
      if (cRows.some(hasPlacementApproval)) comboPlacementApproved++;
    });

    graphicMap.forEach((gRows) => {
      const statuses = gRows.map(getRowStatus);
      if (statuses.every((s) => s === "dropped") || isHoldGroup(statuses)) return;
      if (gRows.some(hasColorApproval)) graphicColorApproved++;
      if (gRows.some(hasPlacementApproval)) graphicPlacementApproved++;
    });

    // STRIKE-OFF COMMENT ANALYTICS (col34, col22, col35)
    let strikeApproved = 0;
    let strikeCP = 0;
    let strikeRevision = 0;
    let strikeRejected = 0;
    let strikePending = 0;
    let firstSubCount = 0;
    let secondSubCount = 0;
    let cpSpCount = 0;

    rows.forEach((r) => {
      const comment2 = String(String(String(String(r.col34 || ""))))
        .trim()
        .toLowerCase();
      const comment1 = String(String(String(String(r.col22 || ""))))
        .trim()
        .toLowerCase();
      const latestComment = comment2 || comment1;
      const sub = String(String(String(String(r.col35 || "")))).toLowerCase();

      // Count C+P SP items
      if (hasCpSpComment(r)) cpSpCount++;

      if (sub === "2nd" || latestComment.includes("2nd") || comment2)
        secondSubCount++;
      else if (
        sub === "1st" ||
        r.col24 ||
        latestComment.includes("1st") ||
        comment1
      )
        firstSubCount++;

      const isResub =
        latestComment.includes("re-strike") ||
        latestComment.includes("restrike") ||
        latestComment.includes("revision") ||
        latestComment.includes("correction") ||
        latestComment.includes("resubmit") ||
        latestComment.includes("specpack update");

      if (getRowStatus(r) === "approved") {
        strikeApproved++;
      } else if (getRowStatus(r) === "c+p") {
        strikeCP++;
      } else if (isResub) {
        strikeRevision++;
      } else if (
        latestComment.includes("reject") ||
        latestComment.includes("drop") ||
        latestComment.includes("fail")
      ) {
        strikeRejected++;
      } else {
        strikePending++;
      }
    });

    // DHL TRACKING / SENT METRICS (col24) — Evaluated against ACTIVE items, i.e. Total minus
    // Dropped minus Hold. A held (CROSS DEVELOPMENT) item is not a live submission any more than a
    // dropped one is, so it must not sit in the "active" denominator or inflate "not yet sent".
    let droppedRows = 0;
    let holdRows = 0;
    rows.forEach((r) => {
      const s = getRowStatus(r);
      if (s === "dropped") droppedRows++;
      else if (s === "hold") holdRows++;
    });

    const activeRows = Math.max(0, rows.length - droppedRows - holdRows);
    const activeCombos = Math.max(0, comboTotal - comboDropped - comboHold);
    const activeGraphics = Math.max(0, graphicTotal - graphicDropped - graphicHold);

    // "Sent" determination lives in app/lib/db.ts (isRowSent) so this dashboard, DashboardStats,
    // and the Table's Status column all agree on what counts as dispatched.
    let activeSentRows = 0;
    rows.forEach((r) => {
      if (isRowSent(r)) {
        activeSentRows++;
      }
    });

    let activeSentGraphics = 0;
    graphicMap.forEach((gRows) => {
      const statuses = gRows.map(getRowStatus);
      const isInactive = statuses.every((s) => s === "dropped") || isHoldGroup(statuses);
      if (!isInactive && gRows.some(isRowSent)) {
        activeSentGraphics++;
      }
    });

    let activeSentCombos = 0;
    comboMap.forEach((cRows) => {
      const statuses = cRows.map(getRowStatus);
      const isInactive = statuses.every((s) => s === "dropped") || isHoldGroup(statuses);
      if (!isInactive && cRows.some(isRowSent)) {
        activeSentCombos++;
      }
    });

    const dhlSentRate =
      activeCombos > 0
        ? Math.round((activeSentCombos / activeCombos) * 100)
        : 0;

    // Approval rates — use ACTIVE (non-dropped) as denominator for consistency
    const graphicApprovalRate =
      activeGraphics > 0
        ? Math.round((graphicApproved / activeGraphics) * 100)
        : 0;
    const comboApprovalRate =
      activeCombos > 0
        ? Math.round((comboApproved / activeCombos) * 100)
        : 0;
    const strikeApprovalRate =
      activeRows > 0 ? Math.round((strikeApproved / activeRows) * 100) : 0;

    const comboLayoutTechRate =
      activeCombos > 0
        ? Math.round((comboLayoutTechApproved / activeCombos) * 100)
        : 0;
    const comboColorRate =
      activeCombos > 0
        ? Math.round((comboColorApproved / activeCombos) * 100)
        : 0;
    const comboPlacementRate =
      activeCombos > 0
        ? Math.round((comboPlacementApproved / activeCombos) * 100)
        : 0;
    const graphicPlacementRate =
      activeGraphics > 0
        ? Math.round((graphicPlacementApproved / activeGraphics) * 100)
        : 0;
    const graphicLayoutTechRate =
      activeGraphics > 0
        ? Math.round((graphicLayoutTechApproved / activeGraphics) * 100)
        : 0;
    const graphicColorRate =
      activeGraphics > 0
        ? Math.round((graphicColorApproved / activeGraphics) * 100)
        : 0;

    return {
      dhl: {
        sentRows: activeSentRows,
        activeRows: activeRows,
        totalRows: rows.length,
        droppedRows: droppedRows,
        sentGraphics: activeSentGraphics,
        activeGraphics: activeGraphics,
        totalGraphics: graphicTotal,
        droppedGraphics: graphicDropped,
        sentCombos: activeSentCombos,
        activeCombos: activeCombos,
        totalCombos: comboTotal,
        droppedCombos: comboDropped,
        holdCombos: comboHold,
        holdGraphics: graphicHold,
        holdRows: holdRows,
        rate: dhlSentRate,
      },
      graphic: {
        total: activeGraphics,
        totalAll: graphicTotal,
        approved: graphicApproved,
        cp: graphicCP,
        sentPending: graphicSentPending,
        hold: graphicHold,
        resubmit: graphicResubmit,
        // Exclusive status buckets (getGroupStatus). approved+cp+sentPending+resubmit+pending
        // == active, and +hold+dropped == totalAll. "pending" = Submission Pending = no approval
        // verdict yet (status), never a dispatch check — "sent" below is the separate dispatch axis.
        pending: graphicPending,
        dropped: graphicDropped,
        sent: activeSentGraphics,
        rate: graphicApprovalRate,
        layoutTechApproved: graphicLayoutTechApproved,
        layoutTechRate: graphicLayoutTechRate,
        colorApproved: graphicColorApproved,
        colorRate: graphicColorRate,
        placementApproved: graphicPlacementApproved,
        placementRate: graphicPlacementRate,
      },
      combo: {
        total: activeCombos,
        totalAll: comboTotal,
        approved: comboApproved,
        cp: comboCP,
        sentPending: comboSentPending,
        resubmit: comboResubmit,
        // See the matching comment on `graphic.pending` above — same exclusive-bucket model.
        pending: comboPending,
        dropped: comboDropped,
        hold: comboHold,
        sent: activeSentCombos,
        rate: comboApprovalRate,
        layoutTechApproved: comboLayoutTechApproved,
        layoutTechRate: comboLayoutTechRate,
        colorApproved: comboColorApproved,
        colorRate: comboColorRate,
        placementApproved: comboPlacementApproved,
        placementRate: comboPlacementRate,
      },
      strikeOff: {
        total: activeRows,
        approved: strikeApproved,
        cp: strikeCP,
        revision: strikeRevision,
        rejected: strikeRejected,
        pending: strikePending,
        firstSub: firstSubCount,
        secondSub: secondSubCount,
        rate: strikeApprovalRate,
        cpSp: cpSpCount,
      },
    };
  }, [rows]);

  // The actual combos behind the Tech & Layout / Color Approval cards' counts above — grouped
  // the same way (Style + Graphic + Combo + Ground, active combos only) so "X / Y active" and
  // "here are the Y minus X combos still missing it" always agree with each other. Recomputed
  // independently of `stats` rather than threaded out of that closure, since it's a much smaller,
  // separate concern (a list to show on click, not a count baked into the dashboard's numbers).
  const approvalGapLists = useMemo(() => {
    const comboMap = new Map<string, EmbellishmentRow[]>();
    rows.forEach((r) => {
      const s = String(String(String(String(r.col5 || "")))).trim();
      const g = String(String(String(String(r.col7 || "")))).trim();
      const c = String(String(String(String(r.col6 || "")))).trim();
      const col = String(String(String(String(r.col8 || "")))).trim();
      const comboKey = `${s}|${g}|${c}|${col}`;
      if (!comboKey || comboKey === "|||") return;
      if (!comboMap.has(comboKey)) comboMap.set(comboKey, []);
      comboMap.get(comboKey)!.push(r);
    });

    const color: EmbellishmentRow[] = [];
    // Placement's drill-down is the actionable work list: combos that have already cleared Tech &
    // Layout approval (the prerequisite step) but do NOT yet have placement sign-off — i.e. "these
    // are ready for you to chase placement approval on".
    const placementNeeded: EmbellishmentRow[] = [];
    const layoutTech: EmbellishmentRow[] = [];
    // The combos behind the "C+P" and "Comments Pending" MiniStats — the exact same
    // getGroupStatus buckets the counters use, so each drill-down list and its number
    // always agree.
    //   cp             = getGroupStatus 'c+p'          — VS/PINK row explicitly carries a C+P note.
    //   commentsPending = getGroupStatus 'sent-pending' — VS/PINK sent w/ no verdict, OR any CK "CP".
    // Surface the row that carries the trace (the C+P verdict, or the first row with a
    // submission trace) so its comment / DHL text shows in the list.
    const cp: EmbellishmentRow[] = [];
    const commentsPending: EmbellishmentRow[] = [];
    comboMap.forEach((cRows) => {
      const isDropped = cRows.every((r) => getRowStatus(r) === "dropped");
      if (isDropped) return; // matches the cards' own "active combos" denominator
      if (!cRows.some(hasColorApproval)) color.push(cRows[0]);
      const statuses = cRows.map(getRowStatus);
      const techLayoutApproved = statuses.some((s) => s === "approved");
      if (!techLayoutApproved) layoutTech.push(cRows[0]);
      if (techLayoutApproved && !cRows.some(hasPlacementApproval)) {
        placementNeeded.push(
          cRows.find((r) => getRowStatus(r) === "approved") ?? cRows[0],
        );
      }
      const groupStatus = getGroupStatus(cRows);
      if (groupStatus === "c+p") {
        cp.push(cRows.find((r) => getRowStatus(r) === "c+p") ?? cRows[0]);
      } else if (groupStatus === "sent-pending") {
        // Match getGroupStatus's own evidence rule: prefer a non-dropped row carrying the
        // DHL/comment trace over a superseded dropped leg's stale evidence (see db.ts).
        commentsPending.push(
          cRows.find((r) => getRowStatus(r) !== "dropped" && hasStrikeOffSubmission(r)) ??
            cRows.find(hasStrikeOffSubmission) ??
            cRows[0],
        );
      }
    });

    const byGraphicThenCombo = (a: EmbellishmentRow, b: EmbellishmentRow) => {
      const ga = String(a.col7 || ""), gb = String(b.col7 || "");
      if (ga !== gb) return ga.localeCompare(gb);
      return String(a.col6 || "").localeCompare(String(b.col6 || ""));
    };
    color.sort(byGraphicThenCombo);
    placementNeeded.sort(byGraphicThenCombo);
    layoutTech.sort(byGraphicThenCombo);
    cp.sort(byGraphicThenCombo);
    commentsPending.sort(byGraphicThenCombo);

    return { color, placementNeeded, layoutTech, cp, commentsPending };
  }, [rows]);

  // Donut data — the 6 exclusive combo status buckets, so the ring is a true
  // partition of Total Combos (slices sum to stats.combo.totalAll). Same units
  // as the MiniStats and hero cards beside it. "NY Sent" is deliberately NOT a
  // slice here — dispatch is a separate axis shown in its own hero card.
  const COMBO_STATUS_SLICES = [
    { name: "Approved", value: stats.combo.approved, color: "#22c55e" },
    { name: "C+P", value: stats.combo.cp, color: "#0ea5e9" },
    { name: "Comments Pending", value: stats.combo.sentPending, color: "#14b8a6" },
    { name: "Resubmission Needed", value: stats.combo.resubmit, color: "#f97316" },
    { name: "Submission Pending", value: stats.combo.pending, color: "#eab308" },
    { name: "Hold", value: stats.combo.hold, color: "#a855f7" },
    { name: "Dropped", value: stats.combo.dropped, color: "#6b7280" },
  ];
  const graphicData = COMBO_STATUS_SLICES.filter((d) => d.value > 0);

  // Fallback: if all zero show a placeholder slice
  const graphicDataDisplay =
    graphicData.length > 0
      ? graphicData
      : [{ name: "No Data", value: 1, color: "#27272a" }];

  // Technique / Risk / Plant breakdown for the currently filtered rows (which are already
  // scoped to whatever Season the sidebar has selected — this component never re-filters by
  // season itself, it just visualizes whatever `rows` it's handed). One bar per distinct
  // Technique (col9), stacked by Risk Factor (col17) so risk is visible at a glance, with the
  // full plant breakdown (col11) surfaced in the tooltip since a technique is often split
  // across several plants.
  const techniqueChartData = useMemo(() => {
    const map = new Map<
      string,
      { technique: string; high: number; medium: number; low: number; unspecified: number; plants: Map<string, number> }
    >();

    rows.forEach((r) => {
      const technique = String(r.col9 || "").trim();
      if (!technique) return;

      if (!map.has(technique)) {
        map.set(technique, {
          technique,
          high: 0,
          medium: 0,
          low: 0,
          unspecified: 0,
          plants: new Map(),
        });
      }
      const entry = map.get(technique)!;

      const risk = String(r.col17 || "").trim().toUpperCase();
      if (risk.includes("HIGH")) entry.high += 1;
      else if (risk.includes("MED")) entry.medium += 1;
      else if (risk.includes("LOW")) entry.low += 1;
      else entry.unspecified += 1;

      const plant = String(r.col11 || "").trim() || "Unassigned";
      entry.plants.set(plant, (entry.plants.get(plant) || 0) + 1);
    });

    // Technique names in this file are long compound strings (e.g. "SELF APPLIQUE/COLUMN
    // STITCH/RUNNING STITCH/PIGMENT WASH") — shown in full only on hover. The axis label is a
    // short truncated version with the item count appended right on the label, so volume reads
    // at a glance without needing to hover every bar.
    const truncate = (s: string, max: number) =>
      s.length > max ? `${s.slice(0, max - 1).trim()}…` : s;

    return Array.from(map.values())
      .map((e) => {
        const total = e.high + e.medium + e.low + e.unspecified;
        return {
          technique: `${truncate(e.technique, 26)} (${total})`,
          fullTechnique: e.technique,
          high: e.high,
          medium: e.medium,
          low: e.low,
          unspecified: e.unspecified,
          total,
          plantList: Array.from(e.plants.entries()).sort((a, b) => b[1] - a[1]),
        };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 12); // keep the chart simple to read — top 12 techniques by volume
  }, [rows]);

  // Compute Trigger & Sub-Category AOQ Date details for current filtered rows
  const subCategoryDetails = useMemo(() => {
    const map = new Map<
      string,
      {
        subCatName: string;
        fullSeason: string;
        aoqDates: Set<string>;
        rows: EmbellishmentRow[];
      }
    >();

    const isValidTrigger = (s: string): boolean => {
      if (!s) return false;
      const str = s.trim().toUpperCase();
      return str !== "" && str !== "N/A" && str !== "-";
    };

    rows.forEach((r) => {
      const rawSeason = String(r.col4 || "").trim();
      const rawTrigger = String(r.col2 || "").trim();
      if (!rawSeason && !rawTrigger) return;

      let triggerCode = "";
      if (isValidTrigger(rawTrigger)) {
        triggerCode = rawTrigger;
      } else if (rawSeason) {
        const bracketMatch = rawSeason.match(/\[([0-9\/\.\s\-DROPdrop]+)\]/);
        if (bracketMatch && /\d/.test(bracketMatch[1])) {
          triggerCode = bracketMatch[1].trim();
        } else {
          const dateMatch = rawSeason.match(
            /(\d{1,2}[\/\.]\d{1,2}(?:[\/\.]\d{1,2})*(?:\/\d{1,2}[\/\.]\d{1,2})?\s*(?:DROP)?)/i,
          );
          if (dateMatch) {
            triggerCode = dateMatch[1].trim();
          } else {
            // No Trigger AND no bracketed/date drop code embedded in Season either — fall back to
            // the Season itself as the grouping key (same "season minus its first token"
            // convention handleSaveTriggerAoqDate below already uses to match rows back when
            // saving), rather than silently dropping this row from ever getting an AOQ card. A row
            // with a real Season should still be able to have and edit an AOQ date even when it
            // has no Trigger and its Season text has no recognizable drop code in it.
            const seasonParts = rawSeason.split(/\s+/);
            triggerCode = seasonParts.length > 1 ? seasonParts.slice(1).join(" ") : rawSeason;
          }
        }
      }

      // Ignore empty or invalid triggers from generating AOQ cards
      if (!triggerCode || !isValidTrigger(triggerCode)) return;

      const subCatName = triggerCode;
      const displaySeason = rawSeason
        ? `${rawSeason} • ${subCatName}`
        : subCatName;

      if (!map.has(subCatName)) {
        map.set(subCatName, {
          subCatName,
          fullSeason: displaySeason,
          aoqDates: new Set<string>(),
          rows: [],
        });
      }

      const group = map.get(subCatName)!;
      group.rows.push(r);

      const d20 = extractValidDate(r.col20);
      if (d20) {
        group.aoqDates.add(d20);
      }
    });

    const results: Array<{
      subCatName: string;
      fullSeason: string;
      aoqDateStr: string;
      activeCombos: number;
      activeGraphics: number;
      approvedGraphics: number;
      pendingGraphics: number;
      droppedGraphics: number;
    }> = [];

    map.forEach((group) => {
      const formattedDates = Array.from(group.aoqDates)
        .map((d) => formatDateDDMMYYYY(d))
        .filter(Boolean);
      let aoqDateStr = formattedDates.join(", ");
      if (!aoqDateStr) {
        const validCol20 = group.rows.find((r) =>
          extractValidDate(r.col20),
        )?.col20;
        const validDate = validCol20 ? extractValidDate(validCol20) : null;
        aoqDateStr = validDate
          ? formatDateDDMMYYYY(validDate) || "Not Set"
          : "Not Set";
      }

      results.push({
        subCatName: group.subCatName,
        fullSeason: group.fullSeason,
        aoqDateStr,
        activeCombos: 0,
        activeGraphics: 0,
        approvedGraphics: 0,
        pendingGraphics: 0,
        droppedGraphics: 0,
      });
    });

    return results;
  }, [rows]);

  return (
    <div className="relative flex-1 bg-[#09111c] p-6 pb-24 text-white min-h-screen font-sans overflow-y-auto custom-scrollbar">
      {/* VIEW TAB SWITCHER — toggles between the Chart view and the Search view
          in-place, without navigating away from the Advanced Dashboard page. */}
      <div className="inline-flex items-center bg-zinc-900/80 border border-zinc-700 rounded-lg p-1 gap-1 mb-4">
        <button
          onClick={() => setAdvancedTab("chart")}
          className={`px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
            advancedTab === "chart"
              ? "bg-[#00ffd5] text-black shadow"
              : "text-zinc-400 hover:text-white hover:bg-zinc-800"
          }`}
        >
          📊 Chart View
        </button>
        <button
          onClick={() => setAdvancedTab("search")}
          className={`px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
            advancedTab === "search"
              ? "bg-[#00ffd5] text-black shadow"
              : "text-zinc-400 hover:text-white hover:bg-zinc-800"
          }`}
        >
          🔍 Search Graphic / Combo
        </button>
      </div>

      {advancedTab === "search" ? (
        <GraphicComboSearchPanel rows={rows} />
      ) : (
        <>
      {/* PAGE HEADER — title + global controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h3 className="text-white font-bold text-sm tracking-wide uppercase leading-none">
              {[selections?.category?.join(", "), selections?.season?.join(", ")]
                .filter(Boolean)
                .join(" - ") || "NY"}{" "}
              Tracking &amp; Dispatch Summary
            </h3>
            <span className="text-[10px] text-zinc-500 font-mono">
              {stats.dhl.sentCombos} / {stats.dhl.activeCombos} active combos sent ({stats.dhl.rate}%)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onUpdateRow && syncStatus === "idle" && (
            <button
              onClick={prepareApprovalSync}
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-[#3b82f6] transition-colors cursor-pointer"
              title="For Approved rows only: write the derived Color approval verdict (from Strike-Off Comments) into the Layout Approval / Color Approval columns"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span className="text-[10px] font-bold uppercase tracking-wider">
                Sync Approval Cols
              </span>
            </button>
          )}

          <button
            onClick={() => setIsAoqHidden((h) => !h)}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-[#00ffd5] transition-colors cursor-pointer"
            title={
              isAoqHidden
                ? "Show Trigger & AOQ Dates Section"
                : "Hide Trigger & AOQ Dates Section"
            }
          >
            {isAoqHidden ? (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                />
              </svg>
            )}
            <span className="text-[10px] font-bold uppercase tracking-wider">
              AOQ
            </span>
          </button>
        </div>
      </div>

      {/* APPROVAL COLUMN SYNC — confirm / progress / done banner */}
      {syncStatus === "confirm" && (
        <div className="bg-[#0b1622] border border-blue-500/40 rounded-lg p-3.5 mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-zinc-300">
            {syncPlan.length === 0 ? (
              <span>
                Layout Approval &amp; Color Approval columns already match the
                Strike-Off Comments for all {approvedRowsCount} Approved
                rows — nothing to sync.
              </span>
            ) : (
              <span>
                This will update{" "}
                <span className="text-[#3b82f6] font-bold">
                  {syncPlan.length}
                </span>{" "}
                of {approvedRowsCount}{" "}
                Approved rows&apos; Layout Approval / Color Approval columns to
                match the Strike-Off Comments (rows that aren&apos;t Approved
                yet are left untouched).
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {syncPlan.length > 0 && (
              <button
                onClick={runApprovalSync}
                className="px-3 py-1.5 bg-[#3b82f6] text-white text-xs font-bold rounded hover:bg-[#3b82f6]/80 transition-colors cursor-pointer"
              >
                Confirm &amp; Sync
              </button>
            )}
            <button
              onClick={cancelApprovalSync}
              className="px-3 py-1.5 bg-zinc-800 text-zinc-300 text-xs font-bold rounded hover:bg-zinc-700 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {syncStatus === "running" && (
        <div className="bg-[#0b1622] border border-blue-500/40 rounded-lg p-3.5 mb-4 flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-[#3b82f6] animate-pulse shrink-0" />
          <span className="text-xs text-zinc-300">
            Syncing approval columns… {syncProgress.done + syncProgress.failed}{" "}
            / {syncPlan.length}
            {syncProgress.failed > 0 && (
              <span className="text-red-400">
                {" "}
                ({syncProgress.failed} failed)
              </span>
            )}
          </span>
        </div>
      )}
      {syncStatus === "done" && (
        <div className="bg-[#0b1622] border border-emerald-500/40 rounded-lg p-3.5 mb-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-zinc-300">
            Synced{" "}
            <span className="text-emerald-400 font-bold">
              {syncProgress.done}
            </span>{" "}
            row{syncProgress.done === 1 ? "" : "s"}
            {syncProgress.failed > 0 && (
              <span className="text-red-400">
                {" "}
                ({syncProgress.failed} failed)
              </span>
            )}
            .
          </span>
          <button
            onClick={() => {
              setSyncPlan([]);
              setSyncStatus("idle");
            }}
            className="px-2 py-1 bg-zinc-800 text-zinc-300 text-xs rounded hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* HERO METRICS — the three numbers that matter most at a glance */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <HeroStat
          label="Total Combos"
          value={stats.combo.totalAll}
          icon="📦"
          accent="#94a3b8"
          sub={`${stats.combo.dropped} dropped · ${stats.combo.hold} hold`}
        />
        <HeroStat
          label="Active Combos"
          value={stats.combo.total}
          icon="🧩"
          accent="#00ffd5"
          sub={`${stats.combo.approved} approved · ${stats.combo.pending} submission pending`}
        />
        <HeroStat
          label="NY Sent"
          value={stats.combo.sent}
          icon="🚀"
          accent="#34d399"
          sub={`${stats.dhl.rate}% dispatched — independent of approval`}
        />
        <HeroStat
          label="Approved"
          value={stats.combo.approved}
          icon="✅"
          accent="#22c55e"
          sub={`${stats.combo.rate}% of active combos`}
        />
      </div>

      {/* TRIGGER & SUB-CATEGORY AOQ DATE METRICS CARD */}
      {!isAoqHidden &&
        subCategoryDetails.length > 0 &&
        (() => {
          const CARDS_PER_PAGE = 6;
          const totalPages =
            Math.ceil(subCategoryDetails.length / CARDS_PER_PAGE) || 1;
          const currentPage = Math.min(Math.max(1, triggerPage), totalPages);
          const startIndex = (currentPage - 1) * CARDS_PER_PAGE;
          const paginatedTriggers = subCategoryDetails.slice(
            startIndex,
            startIndex + CARDS_PER_PAGE,
          );

          return (
            <div className="bg-[#0b1622] border border-[#00ffd5]/40 rounded-lg p-3.5 mb-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-3 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#00ffd5] animate-pulse"></span>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#00ffd5]">
                    Trigger & Sub-Category AOQ Dates
                  </h4>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-zinc-400 font-mono">
                    Showing {startIndex + 1}-
                    {Math.min(
                      startIndex + CARDS_PER_PAGE,
                      subCategoryDetails.length,
                    )}{" "}
                    of {subCategoryDetails.length} triggers
                  </span>

                  {totalPages > 1 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        disabled={currentPage <= 1}
                        onClick={() =>
                          setTriggerPage((p) => Math.max(1, p - 1))
                        }
                        className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-200 text-xs font-bold rounded transition-colors cursor-pointer"
                        title="Previous Page"
                      >
                        ← Prev
                      </button>
                      <span className="text-zinc-300 font-mono text-xs font-bold px-1">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        disabled={currentPage >= totalPages}
                        onClick={() =>
                          setTriggerPage((p) => Math.min(totalPages, p + 1))
                        }
                        className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-200 text-xs font-bold rounded transition-colors cursor-pointer"
                        title="Next Page"
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {paginatedTriggers.map((sc) => (
                  <div
                    key={sc.subCatName}
                    className="bg-zinc-900/90 border border-zinc-700/80 rounded-md p-3.5 hover:border-[#00ffd5]/50 transition-colors shadow-inner flex items-center justify-between gap-3"
                  >
                    <div>
                      <span className="text-sm font-black text-white tracking-wide block">
                        {sc.subCatName}
                      </span>
                      <span className="text-[11px] text-zinc-400 font-medium">
                        {sc.fullSeason}
                      </span>
                    </div>
                    {/* AOQ DATE DISPLAY & INLINE EDITING */}
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] text-zinc-400 uppercase font-bold tracking-wider mb-1">
                        AOQ Date
                      </span>
                      {editingTriggerKey === sc.subCatName ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="date"
                            value={editDateValue}
                            onChange={(e) => setEditDateValue(e.target.value)}
                            className="bg-zinc-950 border border-[#00ffd5] text-[#00ffd5] text-xs font-mono px-2 py-1 rounded outline-none shadow-sm"
                          />
                          <button
                            onClick={() =>
                              handleSaveTriggerAoqDate(
                                sc.subCatName,
                                editDateValue,
                              )
                            }
                            className="px-2.5 py-1 bg-[#00ffd5] text-black text-xs font-bold rounded hover:bg-[#00ffd5]/80 transition-colors cursor-pointer"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingTriggerKey(null)}
                            className="px-2 py-1 bg-zinc-800 text-zinc-300 text-xs rounded hover:bg-zinc-700 transition-colors cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingTriggerKey(sc.subCatName);
                            const raw =
                              sc.aoqDateStr && sc.aoqDateStr !== "Not Set"
                                ? sc.aoqDateStr.split(",")[0].trim()
                                : "";
                            let formatted = "";
                            if (raw.match(/^\d{4}-\d{2}-\d{2}$/)) {
                              formatted = raw;
                            } else if (raw.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
                              const [d, m, y] = raw.split("/");
                              formatted = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
                            }
                            setEditDateValue(formatted);
                          }}
                          title="Click to set AOQ Date for all items in this drop group"
                          className="bg-[#00ffd5]/10 border border-[#00ffd5]/40 text-[#00ffd5] hover:bg-[#00ffd5]/20 hover:border-[#00ffd5] text-xs font-mono font-extrabold px-3 py-1 rounded shadow-xs transition-all flex items-center gap-1.5 cursor-pointer group"
                        >
                          <span>{sc.aoqDateStr}</span>
                          <svg
                            className="w-3 h-3 opacity-60 group-hover:opacity-100 transition-opacity"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-3 mt-3 border-t border-zinc-800/80 text-xs">
                  <span className="text-zinc-400 font-mono">
                    Showing {startIndex + 1}-
                    {Math.min(
                      startIndex + CARDS_PER_PAGE,
                      subCategoryDetails.length,
                    )}{" "}
                    of {subCategoryDetails.length} triggers
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      disabled={currentPage <= 1}
                      onClick={() => setTriggerPage((p) => Math.max(1, p - 1))}
                      className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-200 font-bold rounded transition-colors cursor-pointer"
                    >
                      ← Previous
                    </button>

                    <span className="text-zinc-300 font-mono font-bold px-2">
                      Page {currentPage} of {totalPages}
                    </span>

                    <button
                      disabled={currentPage >= totalPages}
                      onClick={() =>
                        setTriggerPage((p) => Math.min(totalPages, p + 1))
                      }
                      className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-200 font-bold rounded transition-colors cursor-pointer"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

      {/* Top Section */}
      <div className="flex flex-col xl:flex-row gap-4 mb-4">
        {/* COMBO APPROVAL STATUS */}
        <div className="flex-1 bg-[#101b27] border border-zinc-800 p-4 rounded flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <h3 className="text-[#00ffd5] font-bold text-sm tracking-widest mb-4">
              COMBO APPROVAL STATUS
            </h3>
            <div className="flex flex-col items-center h-full w-full">
              <div className="w-full max-w-100 aspect-square relative mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={graphicDataDisplay}
                      cx="50%"
                      cy="50%"
                      innerRadius="70%"
                      outerRadius="90%"
                      paddingAngle={0}
                      dataKey="value"
                      stroke="none"
                    >
                      {graphicDataDisplay.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-5xl font-bold">
                    {stats.combo.rate}%
                  </span>
                  <span className="text-[9px] text-zinc-400 uppercase tracking-wider mt-1">
                    combos approved
                  </span>
                </div>
              </div>

              {/* Legend — driven by the same slice list as the donut so labels always match */}
              <div className="flex flex-wrap gap-3 mt-2 self-start">
                {COMBO_STATUS_SLICES.map((item) => (
                  <div key={item.name} className="flex items-center gap-1">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-[9px] text-zinc-400 uppercase">
                      {item.name}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 mt-3 self-start">
                <div className="flex flex-col justify-center text-[10px] font-bold text-[#bfa15f] border border-[#bfa15f] p-2 bg-[#09111c] min-w-30">
                  <span className="text-lg text-[#ffff00]">
                    {stats.combo.rate}%
                  </span>
                  <span>COMBO APPROVAL %</span>
                </div>
                <div className="flex flex-col justify-center text-[10px] font-bold text-zinc-400 border border-zinc-700 p-2 bg-[#09111c] min-w-30">
                  <span className="text-lg text-zinc-200">
                    {stats.graphic.rate}%
                  </span>
                  <span>GRAPHIC APPROVAL %</span>
                </div>
              </div>
            </div>
          </div>

          <div className="w-px bg-zinc-800 hidden md:block mx-2"></div>

          {/* STATUS + APPROVAL SPLIT — moved here beside the donut so the
              chart and its supporting numbers read as one unit. Tech &
              Layout always matches the overall Approved count (Strike off
              Aesthetic Approval/Dropped = "Approved" implies layout/tech was
              signed off first). Color is independent, sourced from the 1st &
              2nd Strike-Off Comments explicitly saying "APPROVED FOR COLOR".
              A combo can be Tech/Layout-approved without Color yet — never
              the other way around. */}
          <div className="w-full md:w-80 shrink-0 flex flex-col gap-4 justify-center">
            <div className="grid grid-cols-1 gap-2.5">
              {/* Exclusive combo status buckets (getGroupStatus in lib/db.ts). Together with the
                  "Approved" hero card these partition every combo:
                    Approved + C+P + Comments Pending + Submission Pending + Resubmission Needed
                      = Active Combos
                    Active Combos + Hold + Dropped = Total Combos
                  Two adjacent "sent to NY, awaiting sign-off" buckets:
                    "C+P"              = a row explicitly carries a C+P note.
                    "Comments Pending" = VS/PINK, no verdict yet, but the strike-off has gone out
                                         (DHL number or a strike-off comment).
                  "Submission Pending" = strike-off NOT sent to NY yet (no DHL number and both
                  Strike-Off Comment columns blank). (CK keeps Submission Pending straight from
                  its SP letter code.) DashboardStats card #5 on the standard Dashboard uses the
                  same getGroupStatus, so the two screens agree. */}
              <MiniStat
                label="C+P"
                value={stats.combo.cp}
                color="#0ea5e9"
                icon="💬"
                onClick={() => setApprovalGapModal("cp")}
              />
              <MiniStat
                label="Comments Pending"
                value={stats.combo.sentPending}
                color="#14b8a6"
                icon="🧷"
                onClick={() => setApprovalGapModal("commentsPending")}
              />
              <MiniStat
                label="Submission Pending"
                value={stats.combo.pending}
                color="#eab308"
                icon="📤"
              />
              <MiniStat label="Resubmission Needed" value={stats.combo.resubmit} color="#f97316" icon="🔁" />
              <MiniStat label="Hold (Cross Dev)" value={stats.combo.hold} color="#a855f7" icon="⏸️" />
              <MiniStat label="Dropped" value={stats.combo.dropped} color="#71717a" icon="🗑️" />
            </div>

            <ApprovalSplitCard
              title="Tech &amp; Layout Approval"
              hint="= Approved count · from Strike off Aesthetic Approval/Dropped"
              value={stats.combo.layoutTechApproved}
              total={stats.combo.total}
              rate={stats.combo.layoutTechRate}
              accent="#3b82f6"
              icon="📐"
              onClick={() => setApprovalGapModal("layoutTech")}
            />
            <ApprovalSplitCard
              title="Color Approval"
              hint="from Strike-Off Comments · “APPROVED FOR COLOR”"
              value={stats.combo.colorApproved}
              total={stats.combo.total}
              rate={stats.combo.colorRate}
              accent="#ec4899"
              icon="🎨"
              onClick={() => setApprovalGapModal("color")}
            />
            <ApprovalSplitCard
              title="Placement Approval"
              hint="from the tracking chart · “Placment Approval Status”"
              value={stats.combo.placementApproved}
              total={stats.combo.total}
              rate={stats.combo.placementRate}
              accent="#f59e0b"
              icon="📍"
              footer={`${approvalGapLists.placementNeeded.length} to approve — click to view →`}
              tooltip={`Click to see the ${approvalGapLists.placementNeeded.length} combo${approvalGapLists.placementNeeded.length === 1 ? "" : "s"} that are Tech & Layout approved and now need placement sign-off`}
              onClick={() => setApprovalGapModal("placementNeeded")}
            />
          </div>
        </div>
      </div>

      {/* TECHNIQUE / RISK / PLANT BREAKDOWN */}
      <div className="bg-[#101b27] border border-zinc-800 p-4 rounded mb-12">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
          <h3 className="text-white font-bold text-sm tracking-widest uppercase">
            Techniques In Season — Risk &amp; Plant Breakdown
          </h3>
          <div className="flex items-center gap-3">
            <LegendDot color="#ef4444" label="High Risk" />
            <LegendDot color="#eab308" label="Medium Risk" />
            <LegendDot color="#22c55e" label="Low Risk" />
            <LegendDot color="#3f4a58" label="Unrated" />
          </div>
        </div>
        <p className="text-[10px] text-zinc-500 mb-3">
          Top techniques for the current season by volume — the count next to each name is total
          items. Bright color = risk factor; the faint tail is items with no risk factor set yet.
          Hover a bar to see which plants are running that technique.
        </p>
        {techniqueChartData.length === 0 ? (
          <div className="text-zinc-600 text-xs italic py-8 text-center">
            No technique data for the current filter.
          </div>
        ) : (
          <div style={{ width: "100%", height: Math.max(360, techniqueChartData.length * 42) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={techniqueChartData}
                margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
                barCategoryGap="30%"
              >
                <XAxis type="number" stroke="#666" fontSize={10} allowDecimals={false} />
                <YAxis
                  dataKey="technique"
                  type="category"
                  stroke="#a1a1aa"
                  fontSize={11}
                  fontWeight={600}
                  width={210}
                  interval={0}
                />
                <Tooltip
                  content={<TechniqueTooltip />}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                />
                <Bar dataKey="high" stackId="risk" fill="#ef4444" name="High Risk" barSize={22} />
                <Bar dataKey="medium" stackId="risk" fill="#eab308" name="Medium Risk" barSize={22} />
                <Bar dataKey="low" stackId="risk" fill="#22c55e" name="Low Risk" barSize={22} />
                <Bar
                  dataKey="unspecified"
                  stackId="risk"
                  fill="#3f4a58"
                  fillOpacity={0.45}
                  name="Unrated"
                  barSize={22}
                  radius={[0, 3, 3, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
        </>
      )}

      {approvalGapModal && (
        <ComboListModal
          title={
            approvalGapModal === "color"
              ? "Missing Color Approval"
              : approvalGapModal === "placementNeeded"
                ? "Needs Placement Approval"
                : approvalGapModal === "cp"
                  ? "C+P"
                  : approvalGapModal === "commentsPending"
                    ? "Comments Pending"
                    : "Missing Tech & Layout Approval"
          }
          subtitle={
            approvalGapModal === "cp"
              ? `${approvalGapLists.cp.length} active combo${approvalGapLists.cp.length === 1 ? "" : "s"} at C+P — NY reviewed the strike-off and returned "C+P" (comments pending) on a row`
              : approvalGapModal === "commentsPending"
                ? `${approvalGapLists.commentsPending.length} active combo${approvalGapLists.commentsPending.length === 1 ? "" : "s"} — strike-off gone out to NY (DHL / comment) with no verdict yet`
                : approvalGapModal === "placementNeeded"
                  ? `${approvalGapLists.placementNeeded.length} combo${approvalGapLists.placementNeeded.length === 1 ? "" : "s"} — Tech & Layout approved, placement sign-off still pending`
                  : undefined
          }
          rows={
            approvalGapModal === "color"
              ? approvalGapLists.color
              : approvalGapModal === "placementNeeded"
                ? approvalGapLists.placementNeeded
                : approvalGapModal === "cp"
                  ? approvalGapLists.cp
                  : approvalGapModal === "commentsPending"
                    ? approvalGapLists.commentsPending
                    : approvalGapLists.layoutTech
          }
          onClose={() => setApprovalGapModal(null)}
          onUpdateRow={onUpdateRow}
        />
      )}
    </div>
  );
}

// Big top-of-page hero metric card — Active Combos / NY Sent / Approved.
function HeroStat({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: string;
  accent: string;
}) {
  return (
    <div
      className="relative bg-[#101b27] border rounded-lg p-4 overflow-hidden shadow-lg"
      style={{ borderColor: `${accent}40` }}
    >
      <div
        className="absolute -top-6 -right-6 w-24 h-24 rounded-full pointer-events-none"
        style={{ backgroundColor: accent, opacity: 0.12, filter: "blur(28px)", zIndex: 0 }}
      />
      <div className="relative flex items-center gap-3" style={{ zIndex: 1 }}>
        <div
          className="w-11 h-11 rounded-lg flex items-center justify-center text-xl shrink-0"
          style={{ backgroundColor: `${accent}1a`, border: `1px solid ${accent}40` }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widest text-zinc-400 truncate">
            {label}
          </div>
          <div
            className="text-3xl font-mono font-extrabold leading-tight"
            style={{ color: accent }}
          >
            {value.toLocaleString()}
          </div>
        </div>
      </div>
      {sub && (
        <div className="relative text-[10px] text-zinc-500 mt-2 font-medium">
          {sub}
        </div>
      )}
    </div>
  );
}

// Small pill-style stat used in the secondary status strip.
function MiniStat({
  label,
  value,
  color,
  icon,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  icon: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-[#101b27] border border-zinc-800 rounded-lg px-3 py-2.5 flex items-center gap-2.5 hover:border-zinc-700 transition-colors ${
        onClick ? "cursor-pointer hover:bg-[#132133]" : ""
      }`}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <span className="text-base shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-lg font-mono font-extrabold leading-tight text-white">
          {value.toLocaleString()}
        </div>
        <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 leading-tight">
          {label}
          {onClick && <span className="ml-1 text-zinc-600">▸</span>}
        </div>
      </div>
    </div>
  );
}

// Small colored-dot + label used in chart legends.
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[9px] text-zinc-400 uppercase font-bold whitespace-nowrap">
        {label}
      </span>
    </div>
  );
}

// Custom tooltip for the Technique/Risk/Plant chart — the stacked bar itself only shows
// Technique + Risk; the Plant breakdown (which plants run this technique, and how often) only
// fits in the hover detail without cluttering the chart itself.
function TechniqueTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: {
      technique: string;
      fullTechnique: string;
      high: number;
      medium: number;
      low: number;
      unspecified: number;
      total: number;
      plantList: [string, number][];
    };
  }>;
}) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#101b27] border border-zinc-700 rounded p-2.5 max-w-70 shadow-lg">
      <div className="text-[#00ffd5] font-bold text-[11px] mb-1.5 break-words">
        {d.fullTechnique}
      </div>
      <div className="text-[10px] text-zinc-300 mb-2">
        Total: <span className="font-bold text-white">{d.total}</span>
        {d.high > 0 && <span className="text-red-400 ml-2">High {d.high}</span>}
        {d.medium > 0 && <span className="text-yellow-400 ml-2">Med {d.medium}</span>}
        {d.low > 0 && <span className="text-green-400 ml-2">Low {d.low}</span>}
        {d.unspecified > 0 && (
          <span className="text-zinc-500 ml-2">Unrated {d.unspecified}</span>
        )}
      </div>
      <div className="text-[8px] text-zinc-500 font-bold uppercase mb-1">Plants</div>
      <div className="flex flex-col gap-0.5">
        {d.plantList.slice(0, 8).map(([plant, count]) => (
          <div key={plant} className="flex items-center justify-between text-[10px] text-zinc-200">
            <span className="truncate mr-2">{plant}</span>
            <span className="font-mono text-zinc-400 shrink-0">{count}</span>
          </div>
        ))}
        {d.plantList.length > 8 && (
          <div className="text-[9px] text-zinc-600 italic">
            +{d.plantList.length - 8} more
          </div>
        )}
      </div>
    </div>
  );
}

// Tech/Layout vs Color approval card — a count + rate bar sourced from the
// strike-off comment text.
function ApprovalSplitCard({
  title,
  hint,
  value,
  total,
  rate,
  accent,
  icon,
  onClick,
  footer,
  tooltip,
}: {
  title: string;
  hint: string;
  value: number;
  total: number;
  rate: number;
  accent: string;
  icon: string;
  onClick?: () => void;
  // By default the click-through lists the combos still MISSING this approval, and the footer
  // reflects that count. Pass `footer` / `tooltip` to describe a different drill-down (Placement
  // opens the "cleared Tech & Layout, now needs placement sign-off" work list).
  footer?: string;
  tooltip?: string;
}) {
  const missing = Math.max(0, total - value);
  const footerText = footer ?? `${missing} missing — click to view →`;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={
        onClick
          ? tooltip ?? `Click to see the ${missing} combo${missing === 1 ? "" : "s"} still missing this`
          : undefined
      }
      className={`w-full text-left bg-[#101b27] border border-zinc-800 rounded-lg p-4 transition-colors ${
        onClick ? "cursor-pointer hover:border-zinc-600" : "cursor-default"
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0"
            style={{ backgroundColor: `${accent}1a`, border: `1px solid ${accent}40` }}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-white font-bold text-sm truncate">{title}</div>
            <div className="text-[9px] text-zinc-500 leading-snug" title={hint}>
              {hint}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-mono font-extrabold" style={{ color: accent }}>
            {value}
          </div>
          <div className="text-[9px] text-zinc-500 font-mono">/ {total} active</div>
        </div>
      </div>
      <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, rate)}%`, backgroundColor: accent }}
        />
      </div>
      <div className="flex items-center justify-between mt-1">
        {onClick && (
          <span className="text-[10px] text-zinc-500">
            {footerText}
          </span>
        )}
        <span className="text-[10px] font-bold ml-auto" style={{ color: accent }}>
          {rate}% approved
        </span>
      </div>
    </button>
  );
}


// =========================================================================
// SEARCH VIEW — search by Graphic Number or Combo # and pull up its full
// status board (Artwork Date, Submission Status, Final Edit Meeting,
// Approve Date, AOQ Date, Tech Lay / Color / Placement Sample approval).
// All of these fields already live on the row (col36-col42, col20) — this
// panel just fetches and surfaces them, it doesn't add new data.
// =========================================================================

function GraphicComboSearchPanel({ rows }: { rows: EmbellishmentRow[] }) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return rows.filter((r) => {
      const graphic = String(r.col7 || "").toLowerCase();
      const combo = String(r.col6 || "").toLowerCase();
      return graphic.includes(q) || combo.includes(q);
    });
  }, [rows, query]);

  return (
    <div className="flex flex-col gap-4">
      {/* SEARCH BAR */}
      <div className="bg-[#101b27] border border-zinc-800 rounded p-4">
        <label className="text-[#00ffd5] font-bold text-sm tracking-widest mb-2 block">
          SEARCH BY GRAPHIC NUMBER OR COMBO
        </label>
        <div className="relative max-w-lg">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. GVU27-057 or C02"
            className="w-full bg-zinc-950 border border-zinc-700 focus:border-[#00ffd5] text-white text-sm font-mono px-4 py-2.5 rounded-lg outline-none transition-colors"
            autoFocus
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white text-xs cursor-pointer"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        <span className="text-[10px] text-zinc-500 mt-2 block">
          {query
            ? `${results.length} match${results.length === 1 ? "" : "es"} found`
            : "Type a Graphic Number (e.g. GVU27-057) or Combo (e.g. C02) to pull up its status board."}
        </span>
      </div>

      {/* RESULTS */}
      {query && results.length === 0 && (
        <div className="bg-[#101b27] border border-zinc-800 rounded p-8 text-center text-zinc-500 text-sm">
          No graphic or combo matches &quot;{query}&quot;.
        </div>
      )}

      {results.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {results.map((r, i) => (
            <GraphicComboResultCard key={`${r.id}_${i}`} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function GraphicComboResultCard({ row: r }: { row: EmbellishmentRow }) {
  const status = getRowStatus(r);
  // CK-family has no "C+P" step — its "CP" S/off code means "Comments Pending".
  const statusText =
    status === "c+p" && isCkFamilyCategory(String(r.col3 || ""))
      ? "Comments Pending"
      : status;
  const statusStyle =
    status === "approved"
      ? "bg-emerald-950 text-emerald-300 border-emerald-800/50"
      : status === "dropped"
        ? "bg-zinc-800 text-zinc-400 border-zinc-700"
        : status === "c+p"
          ? "bg-teal-950 text-teal-300 border-teal-800/50"
          : status === "resubmit"
            ? "bg-orange-950 text-orange-300 border-orange-800/50"
            : status === "hold"
              ? "bg-purple-950 text-purple-300 border-purple-800/50"
              : "bg-red-950/60 text-red-300 border-red-800/50";

  const submissionRound = String(r.col37 || "").trim();
  const submissionLabel =
    submissionRound === "1"
      ? "1st Submission"
      : submissionRound === "2"
        ? "2nd Submission"
        : submissionRound === "3"
          ? "3rd Submission"
          : submissionRound === "4"
            ? "4th Submission"
            : submissionRound === "5"
              ? "5th Submission"
              : "—";

  // Only ever render an actual parsed date here — col20 (AOQ) in particular
  // often holds a status word ("Approved"/"Pending"/"Dropped") instead of a
  // date, and that status must never be shown in a date field.
  const dateField = (val: unknown) =>
    formatDateDDMMYYYY(extractValidDate(val)) || "Not Set";

  const approvalMark = (val: unknown) => {
    // col42 can carry the tracking chart's free text ("Approved") as well as the Y/N tick.
    const raw = String(val || "").trim().toUpperCase();
    const mark = raw === "Y" || /APPROV|CONFIRM/.test(raw)
      ? "Y"
      : raw === "N" || /DROP|REJECT/.test(raw)
        ? "N"
        : "";
    if (mark === "Y")
      return (
        <span className="text-emerald-400 font-extrabold">✓ Approved</span>
      );
    if (mark === "N")
      return <span className="text-rose-400 font-extrabold">✗ Not Approved</span>;
    return <span className="text-zinc-500">Pending</span>;
  };

  const fields: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Artwork Date", value: dateField(r.col36) },
    { label: "Submission Status", value: submissionLabel },
    { label: "Final Edit Meeting", value: dateField(r.col38) },
    { label: "Approve Date", value: dateField(r.col39) },
    { label: "AOQ Date", value: dateField(r.col20) },
    { label: "Tech Lay Approved", value: approvalMark(r.col40) },
    { label: "Color Approved", value: approvalMark(r.col41) },
    { label: "Placement Approved", value: approvalMark(r.col42) },
  ];

  return (
    <div className="bg-[#101b27] border border-zinc-800 rounded-lg p-4 hover:border-[#00ffd5]/40 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3 pb-3 border-b border-zinc-800">
        <div>
          <div className="text-[#00ffd5] font-mono font-bold text-sm">
            {r.col7 || "—"}
          </div>
          <div className="text-zinc-400 text-xs mt-0.5">
            Combo: <span className="text-white font-semibold">{r.col6 || "—"}</span>
            {r.col5 && (
              <span className="ml-2 text-zinc-500">• Style {r.col5}</span>
            )}
          </div>
        </div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase border shrink-0 ${statusStyle}`}
        >
          {statusText}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {fields.map((f) => (
          <div key={f.label} className="flex flex-col gap-0.5">
            <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">
              {f.label}
            </span>
            <span className="text-xs text-white font-mono">{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
