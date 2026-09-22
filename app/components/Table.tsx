import React, { useState, useRef, useEffect } from "react";

// Format a Date as a local YYYY-MM-DD string (never via toISOString, which shifts to UTC
// and can roll the date back a day for timezones west of UTC).
function toLocalDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Parse a YYYY-MM-DD string as a local calendar date. `new Date("2026-08-31")` is parsed as
// UTC midnight, so getDate()/getMonth() then read back the previous day in any negative-offset
// timezone — this keeps the day the user actually picked.
function parseLocalDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

function getMondayOfCurrentWeek(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return toLocalDateStr(monday);
}
import { EmbellishmentRow, ColumnMapping, getRowStatus, getTriggerCatalog, TriggerCatalogEntry } from "../lib/db";
import { isCkFamilyCategory } from "../lib/ckCategories";
import RowDetailsModal from "./RowDetailsModal";
import EventStatusPanel from "./EventStatusPanel";
import HistoryModal from "./HistoryModal";
import { parseEventValue } from "../lib/eventCodes";
import { findTriggerCatalogAoq } from "../lib/nycVerdict";
import { calculateTargetSendDate, parseCrossDevGroups, legPlantFlow } from "../lib/plantUtils";
import { isSriLankaHoliday, getSriLankaHolidayName } from "../lib/sriLankaHolidays";
import DailyEventsExport from "./DailyEventsExport";
import EmbellishmentPlanExport from "./EmbellishmentPlanExport";

// Helper to parse multi-line or multi-entry DHL tracking strings into clean array items
export function parseDhlTrackingItems(val: string): string[] {
  if (!val || !val.trim()) return [];
  const rawLines = val.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const items: string[] = [];
  
  rawLines.forEach(line => {
    // If a line contains multiple DHL items (e.g. "DHL 7/16 1142760345(NY Office) DHL7/16 463415740..."), split before each "DHL" boundary
    const parts = line.split(/(?=\bDHL\s*\d|\bDHL-|\bDHL\b)/i).map(s => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      parts.forEach(p => {
        const formatted = !/^dhl|^fb/i.test(p) ? `DHL ${p}` : p;
        items.push(formatted);
      });
    } else {
      const formatted = !/^dhl|^fb/i.test(line) ? `DHL ${line}` : line;
      items.push(formatted);
    }
  });

  return items;
}

// Helper to expand single-letter status codes (e.g. D -> Dropped, A -> Approved, C -> Confirmed, H -> On Hold, I -> In Progress, P -> Pending, R -> Rejected)
export function formatStatusValue(val: unknown): string {
  if (val === null || val === undefined) return "Active";
  const trimmed = String(val).trim();
  const upper = trimmed.toUpperCase();

  switch (upper) {
    case "D":
    case "DROP":
    case "DROPPED":
      return "Dropped";
    case "A":
    case "APPROVE":
    case "APPROVED":
      return "Approved";
    case "C":
    case "CONFIRM":
    case "CONFIRMED":
      return "Confirmed";
    case "H":
    case "HOLD":
    case "ON HOLD":
      return "On Hold";
    case "I":
    case "IN PROGRESS":
    case "IN-PROGRESS":
      return "In Progress";
    case "P":
    case "PENDING":
    case "ACTIVE":
      return "Active";
    case "R":
    case "REJECT":
    case "REJECTED":
      return "Rejected";
    case "RESUBMIT":
    case "RESUBMIT NEEDED":
    case "RESUBMISSION NEEDED":
    case "RESUBMIT REQUIRED":
    case "RESUB":
    case "RESUB NEEDED":
      return "Resubmit Needed";
    case "COMPLETED":
      return "Completed";
    case "C+P":
    case "C + P":
      return "C+P";
    default:
      return trimmed;
  }
}

// The Status column previously showed raw col1 text only, which drifts from a row's true
// state whenever the Aesthetic Approval column (col20), a dropped/approved cell fill color,
// or a RESUBMIT flag disagrees with col1 — e.g. col1 still says "Active" while col20 says
// "Dropped" or "Resubmit Needed". Use the same getRowStatus() logic the dashboards use to
// compute Total/DHL Sent/Remaining, so the badge a person reads in the table always matches
// what gets counted (Approved / Dropped / Resubmit Needed / Pending).
export function getDisplayStatus(row: EmbellishmentRow): string {
  const status = getRowStatus(row);
  switch (status) {
    case "dropped":
      return "Dropped";
    case "approved":
      return "Approved";
    case "c+p":
      // CK-family has no "C+P" step — its "CP" S/off code means "Comments Pending"
      // (NY reviewed the strike-off and returned comments). Only VS/PINK say "C+P".
      return isCkFamilyCategory(String(row.col3 || "")) ? "Comments Pending" : "C+P";
    case "hold":
      return "Hold";
    case "resubmit":
      return "Resubmit Needed";
    default:
      return formatStatusValue(row.col1);
  }
}

export function formatAoqDateDisplay(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  
  const lower = s.toLowerCase();
  if (['approved', 'active', 'pending', 'dropped', 'none', 'n/a', '-', 'null', 'undefined'].includes(lower)) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [p1, p2, y] = s.split("/");
    // If p1 > 12 it's already DD/MM/YYYY, else convert MM/DD/YYYY -> DD/MM/YYYY
    const dStr = parseInt(p1, 10) > 12 ? p1 : p2;
    const mStr = parseInt(p1, 10) > 12 ? p2 : p1;
    return `${dStr.padStart(2, '0')}/${mStr.padStart(2, '0')}/${y}`;
  }

  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) {
    const [d, m, y] = s.split("-");
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  const dObj = new Date(s);
  if (!isNaN(dObj.getTime())) {
    const m = String(dObj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dObj.getUTCDate()).padStart(2, '0');
    const y = dObj.getUTCFullYear();
    if (y > 2000 && y < 2100) {
      return `${d}/${m}/${y}`;
    }
  }

  return null;
}

// Event codes are now managed centrally in app/lib/eventCodes.ts

import { detectMatchingFlow, calculateAutoSchedule, autoScheduleEmbellishmentRow, autoScheduleAnchoredToEvent, autoScheduleForwardFromEvent, clearEventForward, nextUnscheduledMilestone, getApplicableFlows } from "../lib/planningFlows";

function getEventCellStyle(rawValue: string) {
  if (!rawValue || !rawValue.trim()) return null;
  const parsed = parseEventValue(rawValue);
  if (!parsed) return null;
  if (parsed.status === "pass") {
    return {
      cell: "bg-emerald-950/70 border-emerald-900/50",
      badge: "bg-emerald-500/25 text-emerald-200 border-emerald-500/40 font-black shadow-xs",
      dot: "bg-emerald-400",
      label: parsed.code,
      tooltip: `PASS (Confirmed at Plant): ${parsed.code}`,
    };
  }
  if (parsed.status === "fail") {
    return {
      cell: "bg-rose-950/80 border-rose-900/60",
      badge: "bg-rose-500/30 text-rose-200 border-rose-500/50 font-black shadow-xs animate-pulse",
      dot: "bg-rose-500 animate-ping",
      label: parsed.code,
      tooltip: `FAIL / DELAYED: ${parsed.code}${parsed.reasonLabel ? ` — ${parsed.reasonLabel}` : ''}${parsed.responsible ? ` (${parsed.responsible})` : ''}`,
    };
  }
  // Default planned = WHITE / Neutral badge. A planner-locked ("|X") milestone gets a pin marker
  // and a subtle ring so it reads as "fixed here, won't be auto-moved".
  if (parsed.isPinned) {
    return {
      cell: "bg-zinc-900/30 border-zinc-700/30",
      badge: "bg-slate-800/90 text-white border-sky-500/60 ring-1 ring-sky-500/40 font-extrabold shadow-xs",
      dot: "bg-sky-300",
      label: `📌 ${parsed.code}`,
      tooltip: `LOCKED to this date by planner: ${parsed.code}`,
    };
  }
  return {
    cell: "bg-zinc-900/30 border-zinc-700/30",
    badge: "bg-slate-800/90 text-white border-slate-600/70 font-extrabold shadow-xs",
    dot: "bg-white",
    label: parsed.code,
    tooltip: `PLANNED: ${parsed.code}`,
  };
}

interface TableProps {
  rows: EmbellishmentRow[];
  allRows?: EmbellishmentRow[];
  columns: ColumnMapping;
  onUpdateRow: (row: EmbellishmentRow) => void;
  onDeleteRow: (id: string) => void;
  onDeleteMultipleRows: (ids: string[]) => void;
  onDuplicateRow: (row: EmbellishmentRow) => void;
  onForceReplan?: (rowId: string) => void;
  onClearRowPlan?: (rowId: string, legPlant?: string) => void | Promise<boolean | void>;
  onSetPlanStartDate?: (rowId: string, startDateKey: string, legPlant?: string) => void;
  onApplyPlanFlow?: (rowId: string, dateKey: string, flowId: number) => void | Promise<void>;
  onAddRow: () => void;
  onPublishRow: (row: EmbellishmentRow) => void;
  selectedGraphicFilter: string;
  setSelectedGraphicFilter: (filter: string) => void;
  currentRole: string;
}

export default function Table({
  rows,
  allRows,
  columns,
  onUpdateRow,
  onDeleteRow,
  onDeleteMultipleRows,
  onDuplicateRow,
  onForceReplan,
  onClearRowPlan,
  onSetPlanStartDate,
  onApplyPlanFlow,
  onAddRow,
  onPublishRow,
  selectedGraphicFilter,
  setSelectedGraphicFilter,
  currentRole,
}: TableProps) {
  // Trigger catalog (planner-defined Triggers with their own AOQ date + Category/Season) —
  // powers the col2 "Trigger" cell's autocomplete below and, on pick, auto-fills col20 (AOQ)
  // with that trigger's date. Defined on the Season AOQ Dates page (TriggerManagementView).
  const [triggerCatalog, setTriggerCatalog] = useState<TriggerCatalogEntry[]>([]);
  useEffect(() => {
    getTriggerCatalog().then(setTriggerCatalog);
  }, []);

  // Selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  // Row Expansion for multiple plant flows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  
  const toggleRowExpansion = (rowId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };
  
  // Row Details View
  const [viewRow, setViewRow] = useState<EmbellishmentRow | null>(null);
  
  // Status filter state
  const [statusFilter, setStatusFilter] = useState<string>("");

  // Start date state for calendar rolling window (default to 2026-07-03)
  const [startDateStr, setStartDateStr] = useState<string>(getMondayOfCurrentWeek());

  // Event Status Panel state
  const [eventPanel, setEventPanel] = useState<{
    rowId: string;
    dateKey: string;
    dateLabel: string;
    rawValue: string;
    plant: string;
    style?: string;
    graphic?: string;
    // For an empty cell: the next flow milestone with no date yet, pre-selected in the panel so
    // re-placing a just-deleted event is one click.
    suggestedCode?: string;
  } | null>(null);

  // History Modal state
  const [historySharedId, setHistorySharedId] = useState<string | null>(null);

  // "Replan from a chosen date" flow: set to a row's id right after its planning events have
  // been cleared (see the calendar-icon Actions button below), while we're waiting for the user
  // to click the date cell that becomes the new plan's start date. Cleared back to null once
  // that date is picked, or if the button is pressed again to cancel.
  const [replanAnchorRowId, setReplanAnchorRowId] = useState<string | null>(null);
  // When the pending replan is scoped to a single cross-dev plant leg, its name is held here;
  // null means "the whole row".
  const [replanAnchorLeg, setReplanAnchorLeg] = useState<string | null>(null);

  // Let Escape cancel an in-progress "pick a start date" instead of leaving the row stuck
  // waiting for a click that may never come.
  useEffect(() => {
    if (!replanAnchorRowId) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setReplanAnchorRowId(null); setReplanAnchorLeg(null); }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [replanAnchorRowId]);

  // Columns affecting the auto-planning process (protected from inline double-click edits)
  const AUTO_PLANNING_COLUMNS = React.useMemo(() => new Set([
    "col3",  // Category
    "col7",  // Graphic
    "col8",  // Ground
    "col9",  // Technique(s)
    "col10", // Process
    "col11", // Plant
    "col12", // Plant Flow
    "col13", // Fabric Reference
    "col14", // Fabric In Date / IH Date
    "col15", // Application Form
    "col16", // Alternative Fabric
    "col18", // Technique Category
    "col27", // S-Off Requirement
    "col49", // 2nd Submission Fabric
  ]), []);

  // Enforce role-based cell editing rules
  // isApproved: when true, Planner cannot edit planning date columns (row is already approved)
  const isCellEditable = (colKey: string, role: string, isDraft?: boolean, isApproved?: boolean): boolean => {
    // Columns affecting auto-planning CANNOT be edited using double click directly in standard table view
    if (AUTO_PLANNING_COLUMNS.has(colKey)) {
      return false;
    }

    // Daily planning process date cells (starting with YYYY-MM-DD date keys)
    if (colKey.match(/^\d{4}-\d{2}-\d{2}/)) {
      if (role === "Planner") {
        return !isApproved; // red cells (not approved) = editable; green cells (approved) = read-only
      }
      return false;
    }

    // Draft rows: Team members can edit all other cells
    if (isDraft && role.startsWith("Team")) {
      return true;
    }

    // All other columns CAN be edited using double click
    return true;
  };

  // Generate 90 planning dates starting from selected startDateStr
  const planningDates = React.useMemo(() => {
    const dates = [];
    let start = parseLocalDateStr(startDateStr);
    // Guard against a half-typed / invalid picker value so the grid never silently freezes on
    // an unparseable date — fall back to this week's Monday.
    if (isNaN(start.getTime())) start = parseLocalDateStr(getMondayOfCurrentWeek());
    for (let i = 0; i < 90; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const formatted = toLocalDateStr(d);
      const label = d.toLocaleDateString("en-US", { day: "numeric", month: "short" }).toUpperCase();
      const dayOfWeek = d.getDay(); // 0 = Sun, 6 = Sat
      const dayName = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isSaturday = dayOfWeek === 6;
      const isSunday = dayOfWeek === 0;
      const isHoliday = isSriLankaHoliday(d);
      const holidayName = isHoliday ? getSriLankaHolidayName(d) : undefined;
      dates.push({ key: formatted, label, dayName, dayOfWeek, isWeekend, isSaturday, isSunday, isHoliday, holidayName });
    }
    return dates;
  }, [startDateStr]);
  
  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ rowId: string; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  // Sorting state
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(10);

  // Reset page to 1 when filter or page size changes
  const [prevFilter, setPrevFilter] = useState(selectedGraphicFilter);
  const [prevStatusFilter, setPrevStatusFilter] = useState(statusFilter);
  const [prevItemsPerPage, setPrevItemsPerPage] = useState(itemsPerPage);

  if (
    selectedGraphicFilter !== prevFilter || 
    statusFilter !== prevStatusFilter || 
    itemsPerPage !== prevItemsPerPage
  ) {
    setPrevFilter(selectedGraphicFilter);
    setPrevStatusFilter(statusFilter);
    setPrevItemsPerPage(itemsPerPage);
    setCurrentPage(1);
  }

  // Filter dropdown state
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState<boolean>(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  // Close filter dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setIsFilterDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Autofocus input when editing starts
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [editingCell]);

  // Unique Statuses (col1) for filter list normalized to expanded full words
  const uniqueStatuses = React.useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => {
      const status = getDisplayStatus(row);
      if (status) set.add(status);
    });
    return Array.from(set).sort();
  }, [rows]);

  const statusCounts = React.useMemo(() => {
    return rows.reduce((acc, row) => {
      const status = getDisplayStatus(row);
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [rows]);

  // Handle Sort
  const handleSort = (key: string) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  // Natural alphanumeric sort helper (e.g. GVH < GVS < GVU, and 184 < 185 < 186 < 190)
  const compareAlphanumeric = (aStr: string, bStr: string) => {
    return aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: "base" });
  };

  // Row ids that have any event scheduled on today's date (incl. plant-split "_PLANT" keys) —
  // used to float those rows to the top of the default (unsorted) view so a planner sees what
  // needs attention today first, without needing a separate banner.
  const rowsWithEventToday = React.useMemo(() => {
    const d = new Date();
    const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const re = new RegExp(`^${todayKey}(?:_.+)?$`);
    const ids = new Set<string>();
    rows.forEach((row) => {
      for (const k of Object.keys(row)) {
        if (re.test(k) && typeof row[k] === "string" && String(row[k]).trim()) {
          ids.add(row.id);
          break;
        }
      }
    });
    return ids;
  }, [rows]);

  // A freshly-created blank planning row — added via "Add Planning Row", tagged manual_entry, and
  // not yet given a Style / Combo / Graphic. These pin to the very top of the table (see
  // sortedRows) so the planner can actually see and fill in the row they just made, instead of it
  // sorting to "" and landing hundreds of pages deep under an active column sort or below every
  // today's-event row.
  const isFreshBlankRow = React.useCallback((r: EmbellishmentRow) => {
    return (
      String(r.manual_entry ?? "") === "1" &&
      !String(r.col5 ?? "").trim() &&
      !String(r.col6 ?? "").trim() &&
      !String(r.col7 ?? "").trim()
    );
  }, []);

  // Jump back to page 1 whenever a new blank planning row appears, so it's on screen right away.
  const prevBlankCountRef = useRef(0);
  React.useEffect(() => {
    const blankCount = rows.filter(isFreshBlankRow).length;
    if (blankCount > prevBlankCountRef.current) setCurrentPage(1);
    prevBlankCountRef.current = blankCount;
  }, [rows, isFreshBlankRow]);

  // Sort rows
  const sortedRows = React.useMemo(() => {
    const sortableRows = [...rows];

    sortableRows.sort((a, b) => {
      // Brand-new blank planning rows always come first — above today's-event rows and any
      // explicit column sort — so a just-added row is never lost off the bottom of the list.
      const aBlank = isFreshBlankRow(a) ? 0 : 1;
      const bBlank = isFreshBlankRow(b) ? 0 : 1;
      if (aBlank !== bBlank) return aBlank - bBlank;

      // Default view only (no explicit column sort chosen): today's-event rows come first.
      if (sortConfig === null) {
        const aToday = rowsWithEventToday.has(a.id) ? 0 : 1;
        const bToday = rowsWithEventToday.has(b.id) ? 0 : 1;
        if (aToday !== bToday) return aToday - bToday;
      }

      if (sortConfig !== null) {
        const aVal = String(a[sortConfig.key] ?? "");
        const bVal = String(b[sortConfig.key] ?? "");
        
        // Handle pure numeric sorting if applicable
        const aNum = parseFloat(aVal);
        const bNum = parseFloat(bVal);
        
        let comp = 0;
        if (!isNaN(aNum) && !isNaN(bNum) && aVal.trim() !== "" && bVal.trim() !== "") {
          comp = sortConfig.direction === "asc" ? aNum - bNum : bNum - aNum;
        } else {
          const res = compareAlphanumeric(aVal, bVal);
          comp = sortConfig.direction === "asc" ? res : -res;
        }

        if (comp !== 0) return comp;
      }

      // Default / Secondary Sort: Group naturally by Graphic (col7), then Style (col5)
      const aGraphic = String(a.col7 ?? "");
      const bGraphic = String(b.col7 ?? "");
      const graphicComp = compareAlphanumeric(aGraphic, bGraphic);
      if (graphicComp !== 0) return graphicComp;

      const aStyle = String(a.col5 ?? "");
      const bStyle = String(b.col5 ?? "");
      return compareAlphanumeric(aStyle, bStyle);
    });

    return sortableRows;
  }, [rows, sortConfig, rowsWithEventToday, isFreshBlankRow]);

  // Filter rows
  const filteredRows = React.useMemo(() => {
    let result = sortedRows;
    if (selectedGraphicFilter) {
      result = result.filter((row) => row.col7 === selectedGraphicFilter || row.col5 === selectedGraphicFilter);
    }
    if (statusFilter) {
      result = result.filter((row) => getDisplayStatus(row) === statusFilter);
    }
    return result;
  }, [sortedRows, selectedGraphicFilter, statusFilter]);

  // Paginated rows
  const paginatedRows = React.useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredRows.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredRows, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredRows.length / itemsPerPage);

  // Handle cell edit trigger
  const startEditing = (rowId: string, colKey: string, currentValue: string) => {
    setEditingCell({ rowId, colKey });
    if (colKey === "col20") {
      if (currentValue && !/^\d{4}-\d{2}-\d{2}$/.test(currentValue)) {
        const formatted = formatAoqDateDisplay(currentValue);
        if (formatted) {
          const [m, d, y] = formatted.split("/");
          setEditValue(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
        } else {
          setEditValue("");
        }
      } else {
        setEditValue(currentValue || "");
      }
    } else {
      setEditValue(currentValue);
    }
  };

  // Handle cell save
  const saveCell = () => {
    if (!editingCell) return;
    const { rowId, colKey } = editingCell;
    const row = rows.find((r) => r.id === rowId);
    if (row && row[colKey] !== editValue) {
      let updatedRow: EmbellishmentRow = { ...row, [colKey]: editValue };
      // Picking (or typing an exact match for) a known Trigger auto-fills its AOQ date onto
      // col20 — but only when col20 is still blank, so this never overwrites an AOQ date/verdict
      // someone already set by hand. Matched by name + Category + Season (findTriggerCatalogAoq,
      // shared with the AOQ scoring engine) — the SAME Trigger name recurs every season with a
      // different deadline ("KNIT" in SU27 isn't "KNIT" in SP27), so name alone was wrong here:
      // it silently grabbed whichever same-named catalog entry happened to come first, regardless
      // of this row's own season.
      if (colKey === "col2" && !String(row.col20 || "").trim()) {
        const aoqIso = findTriggerCatalogAoq(updatedRow as unknown as Record<string, unknown>, triggerCatalog);
        if (aoqIso) {
          updatedRow.col20 = aoqIso;
        }
      }
      if (colKey.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const parsedNew = parseEventValue(editValue);
        // Same rule as the Event Status Panel: a "Planned" value typed onto a date pins that
        // milestone there and the flow is re-derived around it, rather than recomputed back.
        updatedRow = (parsedNew && parsedNew.status === "planned")
          ? autoScheduleAnchoredToEvent(updatedRow, parsedNew.code, colKey)
          : autoScheduleEmbellishmentRow(updatedRow);
      }
      updatedRow.change_reason = `Inline edit to ${columns[colKey] || colKey}`;
      onUpdateRow(updatedRow);
    }
    setEditingCell(null);
  };

  // Normalizes an approval cell to one of "Y" / "N" / "". col42 ("Placement Approval") can also
  // carry the tracking chart's free text ("Approved") straight from import — treat that as a tick
  // so the cell isn't shown as still-pending.
  const normApprovalMark = (raw: unknown): "Y" | "N" | "" => {
    const s = String(raw ?? "").trim().toUpperCase();
    if (!s || s === "Y" || s === "N") return (s as "Y" | "N" | "");
    if (/APPROV|CONFIRM/.test(s)) return "Y";
    if (/DROP|REJECT|\bNOT\b|\bNO\b/.test(s)) return "N";
    return "";
  };

  // Tick/cross approval toggle used by Layout/Color/Placement Approval columns.
  // Cycles: blank (pending) -> Y (tick / approved) -> N (cross / not approved) -> blank
  const toggleApprovalMark = (row: EmbellishmentRow, colKey: string) => {
    const current = normApprovalMark(row[colKey]);
    const next = current === "Y" ? "N" : current === "N" ? "" : "Y";
    const updatedRow: EmbellishmentRow = {
      ...row,
      [colKey]: next,
      change_reason: `Inline edit to ${columns[colKey] || colKey}`,
    };
    onUpdateRow(updatedRow);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      saveCell();
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  // Checkbox Selection Helpers
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(paginatedRows.map((r) => r.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (e: React.ChangeEvent<HTMLInputElement>, id: string) => {
    if (e.target.checked) {
      setSelectedIds((prev) => [...prev, id]);
    } else {
      setSelectedIds((prev) => prev.filter((item) => item !== id));
    }
  };

  const handleBulkDelete = () => {
    if (window.confirm(`Are you sure you want to delete ${selectedIds.length} selected items?`)) {
      onDeleteMultipleRows(selectedIds);
      setSelectedIds([]);
    }
  };

  // AWR (col26 — see db.ts COLUMN_LABELS, ActionCenterView's KEY_DATE_COLS, and the Excel
  // import's "AWR"/"AWR DATE" aliases) is a manual field: the planner picks a date and applies
  // it to every selected graphic at once. It must never be derived from the AWB/DHL tracking
  // text — that string only tells us when the strike-off was SENT to NY, not when the
  // artwork/graphic itself was received.
  const [bulkAwrDate, setBulkAwrDate] = useState<string>("");
  const handleBulkSetAwrDate = () => {
    if (!bulkAwrDate) return;
    rows.forEach((r) => {
      if (!selectedIds.includes(r.id)) return;
      onUpdateRow({ ...r, col26: bulkAwrDate });
    });
    setSelectedIds([]);
    setBulkAwrDate("");
  };

  // Helper to determine the input field type for inline editing
  const renderEditInput = (colKey: string) => {
    // col1 is Status
    if (colKey === "col1") {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={formatStatusValue(editValue)}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveCell}
          onKeyDown={handleKeyDown}
          className="w-full h-full px-2 py-1 text-xs bg-[#0b0f19] border border-blue-500 focus:outline-none rounded text-slate-100 font-semibold"
        >
          <option value="Active">Active</option>
          <option value="Approved">Approved</option>
          <option value="C+P">C+P</option>
          <option value="Confirmed">Confirmed</option>
          <option value="Dropped">Dropped</option>
          <option value="In Progress">In Progress</option>
          <option value="On Hold">On Hold</option>
          <option value="Completed">Completed</option>
        </select>
      );
    }

    // col20 is AOQ/Graphic Approval (Date)
    if (colKey === "col20") {
      return (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="date"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveCell}
          onKeyDown={handleKeyDown}
          className="w-full h-full px-2 py-1 text-xs bg-zinc-100 dark:bg-zinc-800 border border-blue-500 focus:outline-none rounded font-semibold text-zinc-900 dark:text-zinc-100"
        />
      );
    }

    // col33 is Approved Status
    if (colKey === "col33") {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveCell}
          onKeyDown={handleKeyDown}
          className="w-full h-full px-2 py-1 text-xs bg-zinc-100 dark:bg-zinc-800 border border-blue-500 focus:outline-none rounded font-semibold text-zinc-900 dark:text-zinc-100"
        >
          <option value="Active" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">Active</option>
          <option value="Approved" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">Approved</option>
          <option value="C+P" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">C+P</option>
          <option value="Reject" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">Reject</option>
        </select>
      );
    }

    // col17 is Risk Factor (LOW / HIGH / MEDIUM)
    if (colKey === "col17") {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveCell}
          onKeyDown={handleKeyDown}
          className="w-full h-full px-2 py-1 text-xs bg-zinc-100 dark:bg-zinc-800 border border-blue-500 focus:outline-none rounded font-semibold text-zinc-900 dark:text-zinc-100"
        >
          <option value="LOW" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">LOW</option>
          <option value="HIGH" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">HIGH</option>
          <option value="MEDIUM" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">MEDIUM</option>
        </select>
      );
    }

    // col29, col30, col31 are YES/NO fields
    if (colKey === "col29" || colKey === "col30" || colKey === "col31") {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveCell}
          onKeyDown={handleKeyDown}
          className="w-full h-full px-2 py-1 text-xs bg-zinc-100 dark:bg-zinc-800 border border-blue-500 focus:outline-none rounded font-semibold text-zinc-900 dark:text-zinc-100"
        >
          <option value="NO" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">NO</option>
          <option value="YES" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">YES</option>
        </select>
      );
    }

    // col32 is Fabric IH (IH, etc.)
    if (colKey === "col32") {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveCell}
          onKeyDown={handleKeyDown}
          className="w-full h-full px-2 py-1 text-xs bg-zinc-100 dark:bg-zinc-800 border border-blue-500 focus:outline-none rounded font-semibold text-zinc-900 dark:text-zinc-100"
        >
          <option value="IH" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">IH</option>
          <option value="PENDING" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">PENDING</option>
          <option value="N/A" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">N/A</option>
        </select>
      );
    }

    // col37 is Submission Status (round 1-5)
    if (colKey === "col37") {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveCell}
          onKeyDown={handleKeyDown}
          className="w-full h-full px-2 py-1 text-xs bg-zinc-100 dark:bg-zinc-800 border border-blue-500 focus:outline-none rounded font-semibold text-zinc-900 dark:text-zinc-100"
        >
          <option value="" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">—</option>
          <option value="1" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">1st Submission</option>
          <option value="2" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">2nd Submission</option>
          <option value="3" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">3rd Submission</option>
          <option value="4" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">4th Submission</option>
          <option value="5" className="bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">5th Submission</option>
        </select>
      );
    }

    // col14, col23, col36, col38, col39 are Dates
    if (colKey === "col14" || colKey === "col23" || colKey === "col36" || colKey === "col38" || colKey === "col39") {
      return (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="date"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveCell}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          data-lpignore="true"
          className="w-full h-full px-2 py-1 text-xs bg-transparent border border-blue-500 focus:outline-none rounded text-zinc-900 dark:text-zinc-100"
        />
      );
    }

    // col2 is Trigger — suggest from the planner-defined trigger catalog (Season AOQ Dates page)
    // as the user types; picking (or typing an exact match for) one auto-fills col20 above.
    if (colKey === "col2") {
      return (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          list="trigger-catalog-datalist"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveCell}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          data-lpignore="true"
          className="w-full h-full px-2 py-1 text-xs bg-transparent border border-blue-500 focus:outline-none rounded text-zinc-900 dark:text-zinc-100"
        />
      );
    }

    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={saveCell}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        data-lpignore="true"
        className="w-full h-full px-2 py-1 text-xs bg-transparent border border-blue-500 focus:outline-none rounded text-zinc-900 dark:text-zinc-100"
      />
    );
  };

  // Helper for status badge styling
  const getStatusBadge = (status: string) => {
    const formatted = formatStatusValue(status);
    switch (formatted) {
      case "Completed":
      case "Approved":
      case "Confirmed":
        return "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 font-bold";
      case "C+P":
        return "bg-teal-500/25 text-teal-300 border border-teal-500/40 font-bold";
      case "In Progress":
        return "bg-amber-500/25 text-amber-300 border border-amber-500/40 font-bold";
      case "Dropped":
        return "bg-slate-700/90 text-slate-300 border border-slate-600/60 font-bold";
      case "On Hold":
        return "bg-purple-500/25 text-purple-300 border border-purple-500/40 font-bold";
      case "Rejected":
        return "bg-rose-500/25 text-rose-300 border border-rose-500/40 font-bold";
      case "Reactivated":
        return "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 font-bold";
      case "Resubmit Needed":
        return "bg-orange-500/30 text-orange-300 border border-orange-500/50 font-bold";
      case "Active":
      default:
        return "bg-slate-700/60 text-slate-200 border border-slate-600/60 font-medium";
    }
  };


  // Helper for quality badge styling
  const getQualityBadge = (status: string) => {
    const formatted = formatStatusValue(status);
    switch (formatted) {
      case "Approved":
      case "Confirmed":
      case "Completed":
        return "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 font-bold";
      case "Rejected":
      case "Dropped":
        return "bg-rose-500/25 text-rose-300 border border-rose-500/40 font-bold";
      case "Reactivated":
        return "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 font-bold";
      case "Active":
      default:
        return "bg-slate-700/60 text-slate-200 border border-slate-600/60 font-medium";
    }
  };

  // Helper function to resolve row comment status for row coloring (dropped = grey, confirmed = green)
  const getRowCommentStatus = (row: EmbellishmentRow): 'dropped' | 'confirmed' | 'normal' => {
    const c1 = formatStatusValue(row.col1).toLowerCase();
    const c20 = (String(String(String(String(row.col20 || ''))))).trim().toLowerCase();
    const c33 = (String(String(String(String(row.col33 || ''))))).trim().toLowerCase();
    const col34 = (String(String(String(String(row.col34 || ''))))).trim().toLowerCase();
    const col22 = (String(String(String(String(row.col22 || ''))))).trim().toLowerCase();
    const combinedComments = `${col34} ${col22}`;
    const isDroppedComment = /\b(dropped|drop|reallocated|moved)\b/i.test(combinedComments);
    const isDroppedStatus = c1 === 'dropped' || c1 === 'd' || c20 === 'dropped' || c20 === 'drop' || c20 === 'd' || c33 === 'dropped';
    if (isDroppedComment || isDroppedStatus) {
      return 'dropped';
    }

    // Check Confirmed / Approved (strict word boundary regex on comments or explicit status)
    const isConfirmedComment = /\b(confirmed|confirm|approved|approve|aesthetic approval)\b/i.test(combinedComments);
    const isConfirmedStatus = c1 === 'approved' || c1 === 'completed' || c1 === 'confirmed' || c20 === 'approved' || c20 === 'confirmed' || c20 === 'a' || c20 === 'c' || c33 === 'approved' || c33 === 'confirmed';
    if (isConfirmedComment || isConfirmedStatus) {
      return 'confirmed';
    }

    return 'normal';
  };

  // Sort column keys numerically (col1, col2, col3, ...) and place col24 (DHL Tracking) directly after col8 (Ground),
  // then col22 (Comment — 1st & 2nd) right after col24 for immediate visibility!
  const sortedColKeys = React.useMemo(() => {
    // Layout Approval (col40) is dropped from this grid entirely — Color Approval (col41)'s
    // green tick / red cross is the one signal the planner wants at a glance here. col40 itself
    // is untouched in the data (still written by the import auto-derive and the Advanced
    // Dashboard's Sync Approval Cols button) and still editable from the Edit Row modal.
    const keys = Object.keys(columns)
      .filter((k) => k !== "col40")
      .sort((a, b) => {
        const numA = parseInt(a.replace("col", "")) || 0;
        const numB = parseInt(b.replace("col", "")) || 0;
        return numA - numB;
      });

    // Move col24 (DHL Tracking) right after col8 (Ground), then col22 (Comment) right after col24
    const toReorder = ["col24", "col22"];
    const filtered = keys.filter((k) => !toReorder.includes(k));
    const col8Idx = filtered.indexOf("col8");
    if (col8Idx !== -1) {
      // Insert col24, then col22 right after col8
      const insertCols = toReorder.filter((c) => keys.includes(c));
      filtered.splice(col8Idx + 1, 0, ...insertCols);
      return filtered;
    }

    return keys;
  }, [columns]);

  return (
    <div className="flex flex-col gap-4 text-slate-100">
      <datalist id="trigger-catalog-datalist">
        {triggerCatalog.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>

      {/* Table Toolbar */}
      <div className="sticky left-0 w-[calc(100vw-64px)] flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border border-slate-800 rounded-2xl shadow-xl bg-[#141c2e] text-slate-200 z-20">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          {selectedIds.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  // Only rows with NO schedule at all are eligible here — re-running
                  // autoScheduleEmbellishmentRow on an already-planned row re-detects the flow
                  // from scratch and can land a DIFFERENT flow (e.g. one starting at PPS/NY
                  // instead of FS/FR), silently overwriting real events — including confirmed
                  // Pass/Fail verdicts — with the wrong milestone codes. A row that already has
                  // any planning event must be replanned deliberately (Replan / Clear + pick a
                  // start date / the Event Status panel's flow picker), never by this bulk action.
                  const alreadyPlannedIds: string[] = [];
                  rows.forEach((r) => {
                    if (!selectedIds.includes(r.id)) return;
                    const hasExistingPlan = Object.keys(r).some(
                      (k) => /^\d{4}-\d{2}-\d{2}(_.+)?$/.test(k) && String(r[k as keyof EmbellishmentRow] ?? "").trim() !== "",
                    );
                    if (hasExistingPlan) {
                      alreadyPlannedIds.push(r.id);
                      return;
                    }
                    onUpdateRow(autoScheduleEmbellishmentRow(r));
                  });
                  if (alreadyPlannedIds.length > 0) {
                    alert(
                      `Skipped ${alreadyPlannedIds.length} row(s) that already have planning events — ` +
                      `Auto-Schedule only applies to rows with no plan yet. Use Replan / the Event Status ` +
                      `panel's flow picker to re-time an already-planned row.`,
                    );
                  }
                  setSelectedIds([]);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-500/20 hover:bg-emerald-500/30 rounded-lg transition-all border border-emerald-500/30 shadow-xs"
                title="Auto-calculate planning flow event milestones for selected rows (rows with no plan yet only)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Auto-Schedule Selected ({selectedIds.length})
              </button>
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-300 bg-rose-500/20 hover:bg-rose-500/30 rounded-lg transition-all border border-rose-500/30 shadow-xs"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete Selected ({selectedIds.length})
              </button>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-sky-500/30 bg-sky-500/10">
                <input
                  type="date"
                  value={bulkAwrDate}
                  onChange={(e) => setBulkAwrDate(e.target.value)}
                  className="bg-transparent text-xs text-sky-200 outline-hidden [color-scheme:dark]"
                  title="Artwork (AWR) Received Date to apply"
                />
                <button
                  onClick={handleBulkSetAwrDate}
                  disabled={!bulkAwrDate}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-sky-300 bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-all"
                  title="Set the Artwork (AWR) Received Date on every selected graphic"
                >
                  Set AWR Date ({selectedIds.length})
                </button>
              </div>
            </div>
          )}
          
          {selectedGraphicFilter && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-300 bg-blue-500/20 rounded-lg border border-blue-500/30">
              <span>Filtered Code: <b className="text-white">{selectedGraphicFilter}</b></span>
              <button 
                onClick={() => setSelectedGraphicFilter("")}
                className="text-blue-400 hover:text-white font-bold ml-1"
                title="Clear Graphic Filter"
              >
                &times;
              </button>
            </div>
          )}
          {statusFilter && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-300 bg-amber-500/20 rounded-lg border border-amber-500/30">
              <span>Filtered Status: <b className="text-white">{statusFilter}</b></span>
              <button 
                onClick={() => setStatusFilter("")}
                className="text-amber-400 hover:text-white font-bold ml-1"
                title="Clear Status Filter"
              >
                &times;
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 ml-auto flex-wrap">
          {/* Calendar start date selector */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-300 font-semibold">Calendar Start:</span>
            <input
              type="date"
              value={startDateStr}
              onChange={(e) => setStartDateStr(e.target.value)}
              className="bg-[#0b0f19] border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-100 shadow-xs"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
            <span>Show</span>
            <select
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(Number(e.target.value))}
              className="bg-[#0b0f19] border border-slate-700 rounded-lg px-2 py-1 text-xs font-semibold text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>rows</span>
          </div>

          {currentRole === "Planner" && (
            <DailyEventsExport rows={allRows || rows} onUpdateRow={onUpdateRow} />
          )}

          {currentRole === "Planner" && (
            <EmbellishmentPlanExport rows={allRows || rows} />
          )}

          {currentRole !== "Plant Department" && currentRole !== "Management" && (
            <button
              onClick={onAddRow}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-md active:scale-[0.98]"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {currentRole === "Planner" ? "Add Planning Row" : "Add Row"}
            </button>
          )}
        </div>
      </div>

      {/* Responsive Table Container (Page Handles Scrolling) */}
      <div className="relative min-h-[300px] rounded-xl shadow-2xl border border-slate-700/50 bg-[#0b0f19] inline-block min-w-full">
        <table className="w-full text-left border-collapse bg-[#0b0f19]">
          {/* Table Header */}
          <thead className="sticky top-[97px] z-30 text-[11px] font-extrabold text-slate-300 uppercase tracking-wider bg-[#162032] border-b border-slate-700/80 shadow-xs">
            <tr className="align-top">
              {/* Checkbox Frozen Header */}
              <th className="w-[50px] p-4 text-center sticky left-0 top-[97px] z-40 bg-[#162032] border-r border-slate-700/80 text-slate-300">
                <input
                  type="checkbox"
                  onChange={handleSelectAll}
                  checked={paginatedRows.length > 0 && paginatedRows.every((r) => selectedIds.includes(r.id))}
                  className="w-4 h-4 rounded text-blue-500 border-slate-600 bg-[#0b0f19] focus:ring-blue-500/20"
                />
              </th>

              {/* Status (col1) Frozen Header */}
              <th className="w-[100px] min-w-[100px] p-4 text-center sticky left-[50px] top-[97px] z-40 bg-[#162032] border-r border-slate-700/80 text-slate-300">
                <div className="flex items-center justify-between gap-1 group">
                  <div 
                    onClick={() => handleSort("col1")}
                    className="flex items-center gap-1 cursor-pointer select-none flex-1 whitespace-normal break-words"
                    title={`Sort by ${columns.col1}`}
                  >
                    <span>{columns.col1}</span>
                    {sortConfig?.key === "col1" ? (
                      sortConfig.direction === "asc" ? " ⬆" : " ⬇"
                    ) : (
                      <span className="opacity-0 group-hover:opacity-40"> ⇅</span>
                    )}
                  </div>

                </div>
              </th>

              {/* Style (col5) Frozen Header */}
              {columns.col5 && (
                <th
                  onClick={() => handleSort("col5")}
                  className="w-[120px] min-w-[120px] p-4 text-left sticky left-[150px] top-[97px] z-40 bg-[#162032] border-r border-slate-700/80 text-slate-300 cursor-pointer select-none group"
                  title={`Sort by ${columns.col5}`}
                >
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-slate-200 truncate">{columns.col5}</span>
                    {sortConfig?.key === "col5" ? (
                      <span className="shrink-0">{sortConfig.direction === "asc" ? " ⬆" : " ⬇"}</span>
                    ) : (
                      <span className="opacity-0 group-hover:opacity-40 shrink-0"> ⇅</span>
                    )}
                  </div>
                </th>
              )}

              {/* Graphic (col7) Frozen Header */}
              {columns.col7 && (
                <th
                  onClick={() => handleSort("col7")}
                  className="w-[190px] min-w-[190px] p-4 text-left sticky left-[270px] top-[97px] z-40 bg-[#162032] border-r border-slate-700/80 text-slate-300 shadow-[6px_0_16px_-4px_rgba(0,0,0,0.5)] cursor-pointer select-none group"
                  title={`Sort by ${columns.col7} (includes ${columns.col6})`}
                >
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-slate-200 truncate">{columns.col7}</span>
                    {sortConfig?.key === "col7" ? (
                      <span className="shrink-0">{sortConfig.direction === "asc" ? " ⬆" : " ⬇"}</span>
                    ) : (
                      <span className="opacity-0 group-hover:opacity-40 shrink-0"> ⇅</span>
                    )}
                  </div>
                </th>
              )}

              {/* Dynamic Headers (excluding frozen col1, col5, col7) */}
              {sortedColKeys
                .filter((key) => key !== "col1" && key !== "col5" && key !== "col7")
                .map((key) => (
                  <th
                    key={key}
                    onClick={() => handleSort(key)}
                    className="min-w-[130px] max-w-[200px] p-3 cursor-pointer select-none group border-b border-slate-700/80 hover:bg-slate-700/50 transition-colors align-top text-slate-200 font-bold"
                    title={`Sort by ${columns[key]}`}
                  >
                    <div className="flex items-start gap-1">
                      <span className="font-bold text-slate-200 whitespace-normal break-words leading-tight">{columns[key]}</span>
                      {sortConfig?.key === key ? (
                        <span className="shrink-0">{sortConfig.direction === "asc" ? " ⬆" : " ⬇"}</span>
                      ) : (
                        <span className="opacity-0 group-hover:opacity-40 shrink-0"> ⇅</span>
                      )}
                    </div>
                  </th>
                ))}

              {/* Split Column Header */}
              <th className="w-[60px] p-4 text-center border-b border-slate-700/80 bg-[#1e293b] text-blue-300 font-extrabold">
                Split
              </th>

              {/* Daily Planning Date columns */}
              {planningDates.map((date) => (
                <th
                  key={date.key}
                  title={date.isHoliday ? `${date.holidayName} — no planning events scheduled here` : undefined}
                  className={`w-[110px] p-3 text-center border-b border-slate-700/80 font-extrabold transition-colors ${
                    date.isHoliday
                      ? "bg-[#2a1830] text-purple-300 border-x border-x-purple-500/40"
                      : date.isSaturday
                      ? "bg-[#2d1e12] text-amber-300 border-x border-x-amber-500/40"
                      : date.isSunday
                      ? "bg-[#2e181d] text-rose-300 border-x border-x-rose-500/40"
                      : "bg-[#1e293b] text-blue-300 border-x border-x-slate-800/40"
                  }`}
                >
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider shadow-xs ${
                        date.isHoliday
                          ? "bg-purple-500/30 text-purple-200 border border-purple-500/60 shadow-purple-500/20"
                          : date.isSaturday
                          ? "bg-amber-500/30 text-amber-200 border border-amber-500/60 shadow-amber-500/20"
                          : date.isSunday
                          ? "bg-rose-500/30 text-rose-200 border border-rose-500/60 shadow-rose-500/20"
                          : "text-blue-400 font-semibold"
                      }`}
                    >
                      {date.isHoliday ? "HOLIDAY 🎌" : date.isSaturday ? "SAT 🏖️" : date.isSunday ? "SUN 🏖️" : date.dayName}
                    </span>
                    <span className="font-mono text-xs font-black tracking-tight text-slate-100">
                      {date.label}
                    </span>
                  </div>
                </th>
              ))}

              {/* Sticky Actions Header */}
              <th className="w-[130px] p-4 text-center sticky right-0 top-[97px] z-40 bg-[#162032] border-l border-slate-700/80 shadow-[-6px_0_16px_-4px_rgba(0,0,0,0.5)] text-slate-200 font-bold">
                Actions
              </th>
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="text-xs font-medium divide-y divide-slate-800/60 bg-[#0b0f19]">
            {paginatedRows.length === 0 ? (
              <tr>
                <td 
                  colSpan={sortedColKeys.length + 2} 
                  className="p-12 text-center text-slate-400"
                >
                  <div className="flex flex-col items-center justify-center gap-2">
                    <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0a2 2 0 01-2 2H6a2 2 0 01-2-2m16 0l-3.586-3.586a2 2 0 00-2.828 0L16 11m-2 2v1.586a1 1 0 01-.293.707l-2 2a1 1 0 01-1.414 0l-2-2A1 1 0 018 15.586V13m0 0l-3-3m0 0l3-3m-3 3h12.5" />
                    </svg>
                    <span>No planning items found. Add a row to get started.</span>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedRows.map((row, idx) => {
                const isDraft = row.id.startsWith("draft_");
                const commentStatus = getRowCommentStatus(row);
                
                // The Split row UI exists for genuine CROSS-DEVELOPMENT only: Plant column (col11)
                // "/" notation ("Antler+Leema/RC+MRC" = two parallel, simultaneously-run
                // locations, each needing its own independently-tracked schedule). A Plant Flow
                // (col12) chain like "Antler>>Leema" or "Antler => Leema" is NOT cross-dev — it's
                // ONE sequential process moving through both plants (same business rule as
                // parseCrossDevGroups / detectMatchingFlow: ">>" / "->" / "=>" separate stages,
                // not parallel locations) — so it must render as a single normal row carrying the
                // full flow's events (e.g. FS, FR, PPSES, PPS...), never split into per-plant legs.
                // Reported directly: a chain row split into an "ANTLER" leg holding the real
                // schedule and a "LEEMA" leg showing nothing, when it should have been one row.
                // parseCrossDevGroups tags EVERY stage it returns with isCrossDev, true only when
                // col11's top-level "/" split actually had more than one branch — a purely
                // sequential value like "ANTLER => LEEMA" still comes back as 2 entries (one per
                // ">>"/">" stage) but both tagged isCrossDev: false, so filtering on that flag
                // (not just array length) is what keeps a sequential chain out of the Split view.
                const crossDevGroups = parseCrossDevGroups(String(row.col11 || "")).filter((g) => g.isCrossDev);
                // Used below to let every cross-dev plant's row start out mirroring the same base
                // plan (same schedule, tracked independently from here), instead of starting blank.
                const isCrossDevSplit = crossDevGroups.length > 1;
                const rawPlantFlows = isCrossDevSplit ? crossDevGroups.map((g) => g.name) : ["Flow"];

                const isDyeWashPlantName = (p: string) => {
                  const u = (p || "").toUpperCase();
                  return (
                    u.includes("BFL") ||
                    u.includes("MARTEX") ||
                    u.includes("DYNAWASH") ||
                    u.includes("DYE") ||
                    u.includes("WASH")
                  );
                };

                // How many cross-dev legs a row has is decided ONLY by col11's "/" split (the
                // planner's rule: "always use the PLANT column to identify how many plants"). A
                // dye/wash step named in the PLANT FLOW (col12 "BFL (WA01055) >> ANTLER/REGAL/EXPO")
                // or in the PROCESS text ("send to dye") sets the FLOW — the PPSDS -> RDPS steps,
                // via detectMatchingFlow — but does NOT reduce the leg count. Only suppress the
                // split when a dye/wash vendor is itself one of col11's "/" legs (e.g.
                // "LEEMA / BFL" = send-to-BFL-and-back round-trip, not two parallel locations).
                const isDyeWashRow = rawPlantFlows.some(isDyeWashPlantName);

                const plantFlows = isDyeWashRow
                  ? [rawPlantFlows[0] || "Flow"]
                  : rawPlantFlows.length > 0
                  ? rawPlantFlows
                  : ["Flow"];

                const hasMultipleFlows = !isDyeWashRow && plantFlows.length > 1;
                const isExpanded = expandedRows.has(row.id);
                const rowSpanCount = hasMultipleFlows && isExpanded ? plantFlows.length : 1;

                // Per-plant-leg "clear + replan just this plant" control shown beside each plant
                // badge in the expanded split view. Clears only that leg's own schedule, then
                // arms the row so the next date cell clicked on that leg becomes its new start.
                const legReplanControl = (legPlant: string) => {
                  if (!onClearRowPlan || !onSetPlanStartDate) return null;
                  const armed = replanAnchorRowId === row.id && replanAnchorLeg === legPlant;
                  return (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (armed) { setReplanAnchorRowId(null); setReplanAnchorLeg(null); return; }
                        if (!window.confirm(
                          `Clear ${legPlant}'s planning events only (other plants untouched)? ` +
                          `You'll then click a date on ${legPlant}'s row to set its new start.`,
                        )) return;
                        onClearRowPlan(row.id, legPlant);
                        setReplanAnchorRowId(row.id);
                        setReplanAnchorLeg(legPlant);
                      }}
                      title={armed ? `Click a date on ${legPlant}'s row (click again to cancel)` : `Clear + replan ${legPlant} only`}
                      className={`text-[8px] leading-none px-1 py-0.5 rounded border font-black transition-colors ${
                        armed
                          ? "bg-amber-500/30 text-amber-200 border-amber-500 animate-pulse"
                          : "bg-slate-800 text-slate-400 border-slate-600 hover:text-amber-300 hover:border-amber-500/60"
                      }`}
                    >
                      ⌫
                    </button>
                  );
                };

                // Determine row-level background, border, and sticky cell classes for rich dark theme
                let rowBgClass = idx % 2 === 1 ? "bg-[#0f172a] text-slate-100 hover:bg-[#1c273c] transition-colors" : "bg-[#0d1424] text-slate-100 hover:bg-[#1c273c] transition-colors";
                let stickyBgClass = idx % 2 === 1 ? "bg-[#0f172a] text-slate-100" : "bg-[#0d1424] text-slate-100";
                let stickyHoverClass = "group-hover/row:bg-[#1c273c]";

                if (isDraft) {
                  rowBgClass = "bg-amber-950/60 text-amber-100 font-semibold border-l-4 border-l-amber-500 hover:bg-amber-900/70 transition-colors";
                  stickyBgClass = "bg-[#331b05] text-amber-100";
                  stickyHoverClass = "group-hover/row:bg-[#4a2707]";
                } else if (commentStatus === "dropped") {
                  // GREY row styling for dropped items (Full row rich dark slate grey)
                  rowBgClass = "bg-slate-800/90 text-slate-300 font-medium border-l-4 border-l-slate-400 hover:bg-slate-700/80 transition-colors";
                  stickyBgClass = "bg-[#1e293b] text-slate-300";
                  stickyHoverClass = "group-hover/row:bg-[#334155]";
                } else if (commentStatus === "confirmed") {
                  // GREEN row styling for confirmed / approved items (Full row rich glowing emerald green)
                  rowBgClass = "bg-emerald-950/80 text-emerald-100 font-semibold border-l-4 border-l-emerald-500 hover:bg-emerald-900/90 transition-colors";
                  stickyBgClass = "bg-[#042e23] text-emerald-100";
                  stickyHoverClass = "group-hover/row:bg-[#064e3b]";
                }

                return (
                  <React.Fragment key={`${row.id}_${idx}`}>
                    <tr
                      className={`transition-colors group/row ${rowBgClass} ${
                        replanAnchorRowId === row.id ? "outline outline-2 outline-amber-400/70 -outline-offset-2" : ""
                      }`}
                    >
                    {/* Checkbox Frozen Cell */}
                    <td rowSpan={rowSpanCount} className={`p-4 text-center sticky left-0 z-10 border-r border-slate-800/80 transition-colors ${stickyBgClass} ${stickyHoverClass}`}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(row.id)}
                        onChange={(e) => handleSelectRow(e, row.id)}
                        className="w-4 h-4 rounded text-blue-500 border-slate-700 bg-[#0b0f19] focus:ring-blue-500/20"
                      />
                    </td>

                    {/* Status (col1) Frozen Cell */}
                    <td 
                      rowSpan={rowSpanCount}
                      onDoubleClick={() => {
                        if (isCellEditable("col1", currentRole, isDraft) && !isDraft) {
                          startEditing(row.id, "col1", String(row.col1 ?? ""));
                        }
                      }}
                      className={`p-4 sticky left-[50px] z-10 border-r border-slate-800/80 transition-colors ${stickyBgClass} ${stickyHoverClass} ${
                        isCellEditable("col1", currentRole, isDraft) && !isDraft
                          ? "cursor-pointer hover:brightness-125"
                          : "cursor-not-allowed opacity-90"
                      }`}
                    >
                      {editingCell?.rowId === row.id && editingCell?.colKey === "col1" ? (
                        renderEditInput("col1")
                      ) : (
                        <span className={`px-3 py-1 rounded-full text-[11px] font-bold inline-block shadow-xs ${
                          isDraft
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            : getStatusBadge(getDisplayStatus(row))
                        }`} title={isDraft ? "Draft" : (isCellEditable("col1", currentRole, isDraft) ? "Double click to edit" : "Read-only")}>
                          {isDraft ? "Draft" : getDisplayStatus(row)}
                        </span>
                      )}
                    </td>

                    {/* Style (col5) Frozen Cell */}
                    {columns.col5 && (
                      <td
                        rowSpan={rowSpanCount}
                        onDoubleClick={() => {
                          if (isCellEditable("col5", currentRole, isDraft)) {
                            startEditing(row.id, "col5", String(row.col5 ?? ""));
                          }
                        }}
                        className={`p-3 sticky left-[150px] z-10 border-r border-slate-800/80 font-mono font-bold text-slate-100 whitespace-nowrap truncate max-w-[120px] transition-colors ${stickyBgClass} ${stickyHoverClass} ${
                          isCellEditable("col5", currentRole, isDraft) ? "cursor-pointer hover:bg-white/5" : "cursor-not-allowed"
                        }`}
                        title={String(row.col5 ?? "")}
                      >
                        {editingCell?.rowId === row.id && editingCell?.colKey === "col5" ? (
                          renderEditInput("col5")
                        ) : (
                          <div className="flex items-center gap-2">
                            <span>{row.col5 || "-"}</span>
                            {row.version_number && row.version_number > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setHistorySharedId(row.shared_id || row.id);
                                }}
                                className="text-[9px] px-1.5 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded font-bold hover:bg-blue-500 hover:text-white transition-colors"
                                title="View Revision History"
                              >
                                v{row.version_number}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}

                    {/* Graphic (col7) Frozen Cell — shows the Graphi-Combo# (col6) alongside the graphic code
                        so a combo like "C22" is visible and searchable right from the Graphic column,
                        e.g. "GPF26-335 C22" */}
                    {columns.col7 && (
                      <td
                        rowSpan={rowSpanCount}
                        onDoubleClick={() => {
                          if (isCellEditable("col7", currentRole, isDraft)) {
                            startEditing(row.id, "col7", String(row.col7 ?? ""));
                          }
                        }}
                        className={`p-3 sticky left-[270px] z-10 border-r border-slate-800/80 whitespace-nowrap truncate max-w-[190px] transition-colors shadow-[6px_0_16px_-4px_rgba(0,0,0,0.5)] ${stickyBgClass} ${stickyHoverClass} ${
                          isCellEditable("col7", currentRole, isDraft) ? "cursor-pointer hover:bg-white/5" : "cursor-not-allowed"
                        }`}
                        title={row.col6 ? `${row.col7 || ""} ${row.col6}` : String(row.col7 ?? "")}
                      >
                        {editingCell?.rowId === row.id && editingCell?.colKey === "col7" ? (
                          renderEditInput("col7")
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="font-mono font-bold text-amber-300">{row.col7 || "-"}</span>
                            {row.col6 && (
                              <span className="font-mono text-[10px] font-bold text-amber-200/70 bg-amber-500/10 border border-amber-500/20 rounded px-1 py-0.5 shrink-0">
                                {row.col6}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                    )}

                  {/* Dynamic Columns (excluding frozen col1, col5, col7) */}
                  {sortedColKeys
                    .filter((key) => key !== "col1" && key !== "col5" && key !== "col7")
                    .map((key) => {
                      const isEditing = editingCell?.rowId === row.id && editingCell?.colKey === key;
                      const value = String(row[key] ?? "");
                      const isEditable = isCellEditable(key, currentRole, isDraft);
                      
                      // Custom rendering for DHL tracking
                      if (key === "col24") {
                        const hasDhl = !!value && value.trim().length > 0;
                        const hasComment = (!!row.col22 && String(String(String(String(row.col22 || "")))).trim().length > 0) || (!!row.col34 && String(String(String(String(row.col34 || "")))).trim().length > 0);
                        const isApproved = (String(String(String(String(row.col20 || ""))))).toLowerCase() === "approved";
                        const showAsSent = hasDhl || hasComment || isApproved;
                        
                        const dhlItems = parseDhlTrackingItems(value);

                        let compactSummary = "";
                        if (hasDhl && dhlItems.length > 0) {
                          const detailedLines = dhlItems.filter(item => /\d|office/i.test(item));
                          const rawSummary = (detailedLines.length > 0 ? detailedLines : dhlItems).join(" • ");
                          if (!/^dhl|^fb/i.test(rawSummary)) {
                            compactSummary = `DHL ${rawSummary}`;
                          } else {
                            compactSummary = rawSummary;
                          }
                        } else if (!hasDhl && (hasComment || isApproved)) {
                          compactSummary = "Sent (See Comments)";
                        }

                        return (
                          <td
                            key={key}
                            rowSpan={rowSpanCount}
                            onDoubleClick={() => {
                              if (isEditable) {
                                startEditing(row.id, key, value);
                              }
                            }}
                            className={`p-3 border-b border-slate-800/60 transition-all ${
                              isEditable 
                                ? "cursor-pointer hover:bg-white/5" 
                                : "cursor-not-allowed"
                            }`}
                          >
                            {isEditing ? (
                              renderEditInput(key)
                            ) : showAsSent && compactSummary ? (
                              <div className="flex items-center gap-1.5">
                                <div
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] font-mono font-bold whitespace-nowrap max-w-[190px] truncate shadow-xs"
                                  title={`DHL Tracking Details:\n${value || "No Tracking (Inferred Sent from Comments)"}\n\nSubmission: ${row.col35 === "2nd" ? "2nd Strike-Off (Column [25])" : "1st Strike-Off (Column [21])"}`}
                                >
                                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                                  <span className="truncate">{compactSummary}</span>
                                </div>
                                <span 
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider shrink-0 border ${
                                    row.col35 === "2nd" || (!row.col35 && !!row.col34)
                                      ? "bg-purple-500/25 text-purple-300 border-purple-500/40"
                                      : "bg-blue-500/25 text-blue-300 border-blue-500/40"
                                  }`}
                                  title={row.col35 === "2nd" || (!row.col35 && !!row.col34) ? "2nd Strike-Off" : "1st Strike-Off"}
                                >
                                  {row.col35 === "2nd" || (!row.col35 && !!row.col34) ? "2nd S/O" : "1st S/O"}
                                </span>
                              </div>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-md border bg-rose-500/20 text-rose-300 border-rose-500/40 border-dashed"
                                title={isEditable ? "Double click to edit" : "Read-only"}
                              >
                                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                                <span>NO DHL</span>
                              </span>
                            )}
                          </td>
                        );
                      }

                      // Custom rendering for Combined Comment (col22)
                      if (key === "col22") {
                        const comment1 = String(String(String(row.col22 || "")));
                        const comment2 = String(String(String(row.col34 || "")));
                        return (
                          <td
                            key={key}
                            rowSpan={rowSpanCount}
                            onDoubleClick={() => { if (isEditable) startEditing(row.id, key, comment1); }}
                            className={`p-3 border-b border-slate-800/60 transition-all max-w-[250px] ${
                              isEditable
                                ? "cursor-pointer hover:bg-white/5"
                                : "cursor-not-allowed opacity-90"
                            }`}
                          >
                            {isEditing ? (
                              renderEditInput(key)
                            ) : (
                              <div className="flex flex-col gap-1.5">
                                {comment2 && (
                                  <div className="flex items-start gap-1 text-[10px] px-2 py-1 rounded-md border w-fit max-w-full shadow-xs bg-purple-500/10 text-purple-200 border-purple-500/30" title={comment2}>
                                    <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 bg-purple-400" />
                                    <span className="line-clamp-2"><span className="font-bold mr-1 opacity-75">[2nd]</span>{comment2}</span>
                                  </div>
                                )}
                                {comment1 && (
                                  <div className="flex items-start gap-1 text-[10px] px-2 py-1 rounded-md border w-fit max-w-full shadow-xs bg-blue-500/10 text-blue-200 border-blue-500/30" title={comment1}>
                                    <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 bg-blue-400" />
                                    <span className="line-clamp-2"><span className="font-bold mr-1 opacity-75">[1st]</span>{comment1}</span>
                                  </div>
                                )}
                                {!comment1 && !comment2 && (
                                  <span className="text-[10px] text-slate-500 italic">No comments</span>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      }

                      // Custom rendering for Strike-Off Comment (col34)
                      if (key === "col34") {
                        const hasComment = !!value;
                        const commentLower = value.toLowerCase();
                        const isApproved = commentLower.includes("approved") || commentLower.includes("approve") || commentLower.includes("confirmed") || commentLower.includes("confirm");
                        const isRejected = commentLower.includes("reject") || commentLower.includes("drop");
                        const badgeClass = !hasComment
                          ? "bg-slate-800/40 text-slate-500 border-dashed border-slate-700"
                          : isApproved
                          ? "bg-emerald-500/25 text-emerald-200 border-emerald-500/40 font-semibold"
                          : isRejected
                          ? "bg-slate-700/80 text-slate-300 border-slate-600/60 font-semibold"
                          : "bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold";
                        const dotClass = !hasComment
                          ? "bg-slate-500"
                          : isApproved
                          ? "bg-emerald-400"
                          : isRejected
                          ? "bg-slate-400"
                          : "bg-amber-400";
                        return (
                          <td
                            key={key}
                            rowSpan={rowSpanCount}
                            onDoubleClick={() => { if (isEditable) startEditing(row.id, key, value); }}
                            className={`p-3 border-b border-slate-800/60 transition-all max-w-[200px] ${
                              isEditable
                                ? "cursor-pointer hover:bg-white/5"
                                : "cursor-not-allowed"
                            }`}
                            title={value || "No comment"}
                          >
                            {isEditing ? (
                              renderEditInput(key)
                            ) : (
                              <span className={`flex items-start gap-1 text-[10px] px-2.5 py-1 rounded-md border w-fit max-w-full shadow-xs ${badgeClass}`}>
                                <span className={`w-1.5 h-1.5 rounded-full mt-0.5 shrink-0 ${dotClass}`} />
                                <span className="truncate">{hasComment ? value : "No Comment"}</span>
                              </span>
                            )}
                          </td>
                        );
                      }

                      // Custom rendering for Strike-Off Submission # (col35)
                      if (key === "col35") {
                        const is2nd = value === "2nd";
                        const is1st = value === "1st";
                        return (
                          <td
                            key={key}
                            rowSpan={rowSpanCount}
                            onDoubleClick={() => { if (isEditable) startEditing(row.id, key, value); }}
                            className={`p-4 border-b border-slate-800/60 transition-all ${
                              isEditable
                                ? "cursor-pointer hover:bg-white/5"
                                : "cursor-not-allowed"
                            }`}
                          >
                            {isEditing ? (
                              renderEditInput(key)
                            ) : value ? (
                              <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border w-fit shadow-xs ${
                                is2nd
                                  ? "bg-purple-500/25 text-purple-300 border-purple-500/40"
                                  : is1st
                                  ? "bg-blue-500/25 text-blue-300 border-blue-500/40"
                                  : "bg-slate-800 text-slate-400 border-slate-700"
                              }`}>
                                {value}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-500">—</span>
                            )}
                          </td>
                        );
                      }

                      // Custom rendering for 1st S/OFF Date & Target Send Date (col23 & col28)
                      if (key === "col23" || key === "col28") {
                        const targetInfo = calculateTargetSendDate(value);
                        return (
                          <td
                            key={key}
                            rowSpan={rowSpanCount}
                            onDoubleClick={() => { if (isEditable) startEditing(row.id, key, value); }}
                            className={`p-3 border-b border-slate-800/60 transition-all ${
                              isEditable
                                ? "cursor-pointer hover:bg-white/5"
                                : "cursor-not-allowed"
                            }`}
                            title={targetInfo ? `1st S/OFF: ${targetInfo.soffDateFormatted} | Must Send By: ${targetInfo.targetSendDateFormatted} (-4 days lead time)` : (value || "No S/OFF date")}
                          >
                            {isEditing ? (
                              renderEditInput(key)
                            ) : targetInfo ? (
                              <div className="flex flex-col gap-1 w-fit">
                                <span className="text-xs font-black text-blue-300">
                                  {targetInfo.soffDateFormatted}
                                </span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border flex items-center gap-1 ${
                                  targetInfo.daysRemaining <= 0
                                    ? "bg-red-500/20 text-red-300 border-red-500/40"
                                    : targetInfo.daysRemaining <= 3
                                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                    : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                }`}>
                                  🚀 Send: {targetInfo.targetSendDateFormatted}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-300">{value || "—"}</span>
                            )}
                          </td>
                        );
                      }

                      // Custom rendering for AOQ / Graphic Approval Date (col20)
                      if (key === "col20") {
                        const aoqDateStr = formatAoqDateDisplay(String(value || ""));
                        return (
                          <td
                            key={key}
                            rowSpan={rowSpanCount}
                            onDoubleClick={() => {
                              if (isEditable) {
                                startEditing(row.id, key, String(value || ""));
                              }
                            }}
                            className={`p-3 border-b border-slate-800/60 transition-all ${
                              isEditable
                                ? "cursor-pointer hover:bg-white/5"
                                : "cursor-not-allowed opacity-90"
                            }`}
                            title={aoqDateStr ? `AOQ Date: ${aoqDateStr}` : (isEditable ? "Double click to set AOQ Date" : "No AOQ Date")}
                          >
                            {isEditing ? (
                              renderEditInput(key)
                            ) : aoqDateStr ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] font-mono font-bold shadow-xs">
                                <span className="text-[10px]">📅</span> {aoqDateStr}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-500 italic">—</span>
                            )}
                          </td>
                        );
                      }

                      // Custom rendering for Artwork Date / Final Edit Meeting / Approve Date (col36, col38, col39)
                      if (key === "col36" || key === "col38" || key === "col39") {
                        const dateStr = formatAoqDateDisplay(String(value || ""));
                        const badgeColor = key === "col39"
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                          : key === "col38"
                          ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                          : "bg-sky-500/20 text-sky-300 border-sky-500/40";
                        return (
                          <td
                            key={key}
                            rowSpan={rowSpanCount}
                            onDoubleClick={() => { if (isEditable) startEditing(row.id, key, String(value || "")); }}
                            className={`p-3 border-b border-slate-800/60 transition-all ${
                              isEditable ? "cursor-pointer hover:bg-white/5" : "cursor-not-allowed opacity-90"
                            }`}
                            title={dateStr ? `${columns[key]}: ${dateStr}` : (isEditable ? `Double click to set ${columns[key]}` : `No ${columns[key]}`)}
                          >
                            {isEditing ? (
                              renderEditInput(key)
                            ) : dateStr ? (
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-mono font-bold shadow-xs ${badgeColor}`}>
                                <span className="text-[10px]">📅</span> {dateStr}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-500 italic">—</span>
                            )}
                          </td>
                        );
                      }

                      // Custom rendering for Submission Status (col37) — current submission round 1-5
                      if (key === "col37") {
                        const round = String(value || "").trim();
                        const ordinal = round === "1" ? "1st" : round === "2" ? "2nd" : round === "3" ? "3rd" : round === "4" ? "4th" : round === "5" ? "5th" : "";
                        return (
                          <td
                            key={key}
                            rowSpan={rowSpanCount}
                            onDoubleClick={() => { if (isEditable) startEditing(row.id, key, round); }}
                            className={`p-4 border-b border-slate-800/60 transition-all ${
                              isEditable ? "cursor-pointer hover:bg-white/5" : "cursor-not-allowed opacity-90"
                            }`}
                            title={isEditable ? "Double click to set submission round" : "Read-only"}
                          >
                            {isEditing ? (
                              renderEditInput(key)
                            ) : ordinal ? (
                              <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border bg-indigo-500/25 text-indigo-300 border-indigo-500/40 w-fit shadow-xs">
                                {ordinal} Submission
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-500">—</span>
                            )}
                          </td>
                        );
                      }

                      // Custom rendering for Buy (col48) — two-state Has Buy / No Buy toggle
                      if (key === "col48") {
                        const yes = String(value ?? "").trim().toUpperCase() === "Y";
                        return (
                          <td
                            key={key}
                            rowSpan={rowSpanCount}
                            onClick={() => {
                              if (!isEditable) return;
                              onUpdateRow({
                                ...row,
                                col48: yes ? "N" : "Y",
                                change_reason: `Inline edit to ${columns[key] || "Buy"}`,
                              });
                            }}
                            className={`p-3 text-center border-b border-slate-800/60 transition-all ${
                              isEditable ? "cursor-pointer hover:bg-white/5" : "cursor-not-allowed opacity-90"
                            }`}
                            title={
                              isEditable
                                ? `Click to toggle: currently ${yes ? "Has Buy" : "No Buy"}`
                                : yes ? "Has Buy" : "No Buy"
                            }
                          >
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border shadow-xs ${
                                yes
                                  ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/50"
                                  : "bg-slate-800/60 text-slate-400 border-slate-600"
                              }`}
                            >
                              {yes ? "Has Buy" : "No Buy"}
                            </span>
                          </td>
                        );
                      }

                      // Custom rendering for Layout / Color / Placement Approval (col40, col41, col42) — tick/cross toggle
                      if (key === "col40" || key === "col41" || key === "col42") {
                        const mark = normApprovalMark(value);
                        return (
                          <td
                            key={key}
                            rowSpan={rowSpanCount}
                            onClick={() => { if (isEditable) toggleApprovalMark(row, key); }}
                            className={`p-3 text-center border-b border-slate-800/60 transition-all ${
                              isEditable ? "cursor-pointer hover:bg-white/5" : "cursor-not-allowed opacity-90"
                            }`}
                            title={
                              isEditable
                                ? `Click to toggle: ${mark === "Y" ? "Approved" : mark === "N" ? "Not Approved" : "Pending"} (click again to change)`
                                : (mark === "Y" ? "Approved" : mark === "N" ? "Not Approved" : "Pending")
                            }
                          >
                            {mark === "Y" ? (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/25 text-emerald-300 border border-emerald-500/50 font-black shadow-xs">
                                ✓
                              </span>
                            ) : mark === "N" ? (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-rose-500/25 text-rose-300 border border-rose-500/50 font-black shadow-xs">
                                ✗
                              </span>
                            ) : (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-800/60 text-slate-500 border border-dashed border-slate-600 text-[10px]">
                                —
                              </span>
                            )}
                          </td>
                        );
                      }

                      return (
                        <td
                          key={key}
                          rowSpan={rowSpanCount}
                          onDoubleClick={() => {
                            if (isEditable) {
                              startEditing(row.id, key, value);
                            }
                          }}
                          className={`p-4 border-b border-slate-800/60 transition-all truncate ${
                            isEditable 
                              ? "cursor-pointer hover:bg-white/5" 
                              : "cursor-not-allowed opacity-90"
                          } ${
                            key === "col10" || key === "col22" 
                              ? "max-w-xs" 
                              : (key === "col8" || key === "col9" || key === "col12" || key === "col13" ? "max-w-[160px]" : "max-w-[120px]")
                          }`}
                          title={value ? String(value) + (isEditable ? " (Double click to edit)" : "") : (isEditable ? "Double click to edit" : "Read-only")}
                        >
                          {isEditing ? (
                            renderEditInput(key)
                          ) : (
                            <>
                              {value === "NY" || value === "NYC" ? (
                                (() => {
                                  // Default NY is green (emerald) because it indicates it was successfully sent
                                  let colorClass = "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"; 
                                  if (value === "NYC") {
                                    const commentStr = String(row.col34 || row.col22 || "").toLowerCase();
                                    const isApproved = commentStr.includes("approved") || commentStr.includes("approve") || commentStr.includes("c+p") || commentStr.includes("c + p");
                                    const isRejected = commentStr.includes("reject") || commentStr.includes("drop") || commentStr.includes("fail");
                                    
                                    if (isApproved) {
                                      colorClass = "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
                                    } else if (isRejected) {
                                      colorClass = "bg-red-500/20 text-red-400 border-red-500/40";
                                    } else {
                                      colorClass = "bg-amber-500/20 text-amber-400 border-amber-500/40";
                                    }
                                  }
                                  return (
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider border shadow-sm ${colorClass}`}>
                                      {value}
                                    </span>
                                  );
                                })()
                              ) : (
                                <span className="truncate block">{value || "-"}</span>
                              )}
                            </>
                          )}
                        </td>
                      );
                    })}

                  {/* Split Action Cell */}
                  <td 
                    rowSpan={rowSpanCount} 
                    className={`p-2 text-center border-b border-slate-800/60 transition-all ${stickyBgClass} ${stickyHoverClass} border-l border-slate-700/80`}
                  >
                    {hasMultipleFlows ? (
                      <button onClick={(e) => { e.stopPropagation(); toggleRowExpansion(row.id); }} className="px-2 py-1 bg-blue-500/20 text-blue-300 hover:bg-blue-500/40 rounded text-[10px] font-bold shadow-sm border border-blue-500/50 whitespace-nowrap">
                        {isExpanded ? "▲ Hide" : "▼ Split"}
                      </button>
                    ) : row.__isSplitProcess ? (
                      <span className="text-amber-400 text-[10px] font-black tracking-widest uppercase">SPLIT</span>
                    ) : (
                      <span className="text-slate-600 text-[10px] font-bold">-</span>
                    )}
                  </td>

                  {/* Daily Planning Cells */}
                  {planningDates.map((date, colIndex) => {
                    const dateKey = hasMultipleFlows ? `${date.key}_${plantFlows[0]}` : date.key;
                    let rawVal = row[dateKey];
                    // Only mirror the shared (bare-key) plan while this leg hasn't been given its
                    // own schedule via a per-plant clear/replan (_leg_<plant> marker).
                    if (!rawVal && hasMultipleFlows && row[date.key] && !row[`_leg_${plantFlows[0]}`]) {
                      rawVal = row[date.key]; // Fallback to legacy data
                    }
                    const value = String(rawVal ?? "");
                    // NY approval verdict (NYC-A / NYC-R) — a separate "nycv:<date>" key so it can
                    // sit next to the NYC (comments) pill in the same day. "*" = set manually.
                    const nycvVal = String(row[`nycv:${date.key}`] ?? "").trim();
                    const isEditing = editingCell?.rowId === row.id && editingCell?.colKey === dateKey;
                    const isApproved = row.col33 === "Approved";
                    const isEditable = isCellEditable(dateKey, currentRole, isDraft, isApproved);

                    // New 3-state color system with weekend/holiday column highlighting
                    const eventStyle = value ? getEventCellStyle(value) : null;
                    const cellBgClass = eventStyle
                      ? eventStyle.cell + (date.isHoliday ? " border-x border-purple-900/30" : date.isWeekend ? " border-x border-amber-900/30" : " border-x")
                      : date.isHoliday
                      ? "bg-purple-950/20 border-x border-purple-900/25 hover:bg-purple-950/40"
                      : date.isSaturday
                      ? "bg-amber-950/20 border-x border-amber-900/25 hover:bg-amber-950/40"
                      : date.isSunday
                      ? "bg-rose-950/20 border-x border-rose-900/25 hover:bg-rose-950/40"
                      : "border-x border-slate-800/40 hover:bg-white/5";

                    return (
                      <td
                        key={dateKey}
                        onClick={() => {
                          if (replanAnchorRowId === row.id) {
                            onSetPlanStartDate?.(row.id, date.key, replanAnchorLeg ?? undefined);
                            setReplanAnchorRowId(null);
                            setReplanAnchorLeg(null);
                            return;
                          }
                          if (isEditable) {
                            setEventPanel({
                              rowId: row.id,
                              dateKey,
                              dateLabel: date.label,
                              rawValue: String(value || ""),
                              plant: String(String(String(row.col11 || ""))),
                              style: String(String(String(row.col5 || ""))),
                              graphic: String(String(String(row.col7 || ""))),
                              suggestedCode: String(value || "").trim()
                                ? ""
                                : nextUnscheduledMilestone(row as unknown as Record<string, unknown>),
                            });
                          }
                        }}
                        className={`relative p-0 align-top transition-colors ${
                          replanAnchorRowId === row.id
                            ? "cursor-pointer hover:brightness-125 ring-1 ring-inset ring-amber-400/60"
                            : isEditable
                            ? "cursor-pointer hover:brightness-110"
                            : "cursor-not-allowed"
                        } ${cellBgClass}`}
                        title={
                          replanAnchorRowId === row.id
                            ? `Click to set ${date.label} as the new plan start date`
                            : eventStyle?.tooltip || (isEditable ? "Click to set event status" : "Read-only")
                        }
                      >
                        {hasMultipleFlows && isExpanded && colIndex === 0 && (
                          <span className="absolute left-1 top-1 z-20 flex items-center gap-0.5">
                            <span className="text-[8px] bg-slate-800 text-slate-300 px-1 rounded font-bold shadow-xs border border-slate-600">{plantFlows[0]}</span>
                            {legReplanControl(plantFlows[0])}
                          </span>
                        )}
                        <div className="w-full h-full min-h-[36px] flex flex-col items-center justify-center gap-0.5 p-1">
                          {value && eventStyle && (
                            <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black shadow-xs whitespace-nowrap border ${eventStyle.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${eventStyle.dot}`} />
                              {eventStyle.label}
                            </span>
                          )}
                          {nycvVal && (
                            <span
                              title={`NY ${nycvVal.startsWith("NYC-A") ? "approved" : "rejected"} — ${nycvVal.endsWith("*") ? "set manually" : "from the strike-off comment"}`}
                              className={`px-2 py-0.5 rounded text-[10px] font-black whitespace-nowrap border ${nycvVal.startsWith("NYC-A") ? "bg-emerald-500/25 text-emerald-200 border-emerald-500/40" : "bg-rose-500/25 text-rose-200 border-rose-500/40"}`}
                            >
                              {nycvVal.replace("*", "")}{nycvVal.endsWith("*") ? " •" : ""}
                            </span>
                          )}
                          {!value && !nycvVal && (
                            <span className="text-[10px] font-bold opacity-20 text-zinc-400">+</span>
                          )}
                        </div>
                      </td>
                    );
                  })}


                  {/* Actions Sticky Cell */}
                  <td rowSpan={rowSpanCount} className={`p-4 text-center sticky right-0 z-10 border-l border-slate-800/80 shadow-[-6px_0_16px_-4px_rgba(0,0,0,0.5)] transition-colors ${stickyBgClass} ${stickyHoverClass}`}>
                    {isDraft ? (
                      <div className="flex items-center justify-center gap-3">
                        <button
                          onClick={() => setViewRow(row)}
                          className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-emerald-950/40 rounded-md transition-colors"
                          title="View Details"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onPublishRow(row)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold shadow-sm transition-all"
                          title="Publish to Planner's Dashboard"
                        >
                          Publish
                        </button>
                      </div>
                    ) : currentRole === "Planner" ? (
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setViewRow(row)}
                          className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-emerald-950/40 rounded-md transition-colors"
                          title="View Details"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onDuplicateRow(row)}
                          className="p-1 text-slate-400 hover:text-blue-400 hover:bg-blue-950/40 rounded-md transition-colors"
                          title="Duplicate Row"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setViewRow(row)}
                          className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-emerald-950/40 rounded-md transition-colors"
                          title="Edit / View Details"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        {onForceReplan && (
                          <button
                            onClick={() => onForceReplan(row.id)}
                            className="p-1 text-slate-400 hover:text-amber-400 hover:bg-amber-950/40 rounded-md transition-colors"
                            title="Replan (Same Data) — e.g. after C+P / Resubmission: re-runs the schedule from today, keeping this item's data as-is"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>
                        )}
                        {onClearRowPlan && onSetPlanStartDate && (
                          <button
                            onClick={async () => {
                              if (replanAnchorRowId === row.id) {
                                // Already waiting for a date on this row — press again to cancel.
                                setReplanAnchorRowId(null);
                                setReplanAnchorLeg(null);
                                return;
                              }
                              // Any dated event ANYWHERE on the row — not just in the visible
                              // calendar window. A C+P row's stale plan often sits weeks before
                              // the days on screen; gating on the visible window let "clean" no-op
                              // silently, leaving the old plan to collide with the new one.
                              const hasAnyPlanningEvent = Object.keys(row).some(
                                (k) => /^\d{4}-\d{2}-\d{2}(_.+)?$/.test(k) && String(row[k] ?? "").trim(),
                              );
                              // handleClearRowPlan handles all confirmation itself — including the
                              // "which planning cycle?" prompt when the row has more than one.
                              // Only arm "pick a new start date" if it actually cleared something.
                              const cleared = hasAnyPlanningEvent ? await onClearRowPlan(row.id) : true;
                              if (cleared === false) return;
                              setReplanAnchorRowId(row.id);
                              setReplanAnchorLeg(null);
                            }}
                            className={`p-1 rounded-md transition-colors ${
                              replanAnchorRowId === row.id
                                ? "text-amber-300 bg-amber-500/20 animate-pulse"
                                : "text-slate-400 hover:text-amber-400 hover:bg-amber-950/40"
                            }`}
                            title={
                              replanAnchorRowId === row.id
                                ? "Click a date on this row to set the new start date (click again to cancel)"
                                : "Clear planning events, then pick a new start date — replans automatically from that date onward"
                            }
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 12.75l4.5 4.5m0-4.5l-4.5 4.5" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (window.confirm("Are you sure you want to delete this planning item?")) {
                              onDeleteRow(row.id);
                            }
                          }}
                          className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-md transition-colors"
                          title="Delete Row"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setViewRow(row)}
                        className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-emerald-950/40 rounded-md transition-colors"
                        title="View Details"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
                {/* Sub-rows for additional plant flows */}
                {hasMultipleFlows && isExpanded && plantFlows.slice(1).map((plant: string, pIdx: number) => (
                  <tr key={`${row.id}_sub_${pIdx}`} className={`transition-colors group/row ${rowBgClass}`}>
                    {planningDates.map((date, colIndex) => {
                      // Mirrors the main row's own cell exactly (same setEventPanel modal, same
                      // getEventCellStyle badge) — this used to be a separate, older plain-text-input
                      // editor with its own crude pass/fail color guess (anything containing the
                      // letter "s" anywhere in the value counted as "pass" and got a green badge,
                      // even a plain "-S" sign-off marker), so a split row's second-and-later plants
                      // looked and behaved differently from its first plant and from every
                      // single-plant row. Reported directly: "we cant set colors like the other,
                      // make sure all should be same format."
                      const dateKey = `${date.key}_${plant}`;
                      let rawVal = row[dateKey];
                      // Cross-dev plants start out mirroring the shared base plan — but stop once
                      // this leg has been cleared / replanned on its own (_leg_<plant> marker).
                      if (!rawVal && isCrossDevSplit && row[date.key] && !row[`_leg_${plant}`]) {
                        rawVal = row[date.key];
                      }
                      const value = String(rawVal ?? "");
                      const isApproved = row.col33 === "Approved";
                      const isEditable = isCellEditable(dateKey, currentRole, isDraft, isApproved);

                      const eventStyle = value ? getEventCellStyle(value) : null;
                      const cellBgClass = eventStyle
                        ? eventStyle.cell + (date.isHoliday ? " border-x border-purple-900/30" : date.isWeekend ? " border-x border-amber-900/30" : " border-x")
                        : date.isHoliday
                        ? "bg-purple-950/20 border-x border-purple-900/25 hover:bg-purple-950/40"
                        : date.isSaturday
                        ? "bg-amber-950/20 border-x border-amber-900/25 hover:bg-amber-950/40"
                        : date.isSunday
                        ? "bg-rose-950/20 border-x border-rose-900/25 hover:bg-rose-950/40"
                        : "border-x border-slate-800/40 hover:bg-white/5";

                      return (
                        <td
                          key={dateKey}
                          onClick={() => {
                            if (replanAnchorRowId === row.id) {
                              onSetPlanStartDate?.(row.id, date.key, replanAnchorLeg ?? undefined);
                              setReplanAnchorRowId(null);
                              setReplanAnchorLeg(null);
                              return;
                            }
                            if (isEditable) {
                              setEventPanel({
                                rowId: row.id,
                                dateKey,
                                dateLabel: date.label,
                                rawValue: value,
                                plant,
                                style: String(String(String(row.col5 || ""))),
                                graphic: String(String(String(row.col7 || ""))),
                                suggestedCode: value.trim()
                                  ? ""
                                  : nextUnscheduledMilestone(row as unknown as Record<string, unknown>),
                              });
                            }
                          }}
                          className={`relative p-0 align-top transition-colors ${
                            replanAnchorRowId === row.id
                              ? "cursor-pointer hover:brightness-125 ring-1 ring-inset ring-amber-400/60"
                              : isEditable
                              ? "cursor-pointer hover:brightness-110"
                              : "cursor-not-allowed"
                          } ${cellBgClass}`}
                          title={
                            replanAnchorRowId === row.id
                              ? `Click to set ${date.label} as the new plan start date`
                              : eventStyle?.tooltip || (isEditable ? "Click to set event status" : "Read-only")
                          }
                        >
                          {colIndex === 0 && (
                            <span className="absolute left-1 top-1 z-20 flex items-center gap-0.5">
                              <span className="text-[8px] bg-slate-800 text-slate-300 px-1 rounded font-bold shadow-xs border border-slate-600">{plant}</span>
                              {legReplanControl(plant)}
                            </span>
                          )}
                          <div className="w-full h-full min-h-[36px] flex items-center justify-center p-1">
                            {value && eventStyle ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black shadow-xs whitespace-nowrap border ${eventStyle.badge}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${eventStyle.dot}`} />
                                  {eventStyle.label}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[10px] font-bold opacity-20 text-zinc-400">+</span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {filteredRows.length > 0 && (
        <div className="sticky bottom-0 z-50 w-full border-t border-slate-800 bg-[#141c2e] shadow-[0_-10px_20px_rgba(0,0,0,0.3)]">
          <div className="sticky left-0 w-[calc(100vw-100px)] lg:w-[calc(100vw-120px)] flex flex-col sm:flex-row items-center justify-between gap-4 p-4 pr-8 text-xs text-slate-300 font-medium">
          <div>
            Showing{" "}
            <span className="font-bold text-white">
              {Math.min((currentPage - 1) * itemsPerPage + 1, filteredRows.length)}
            </span>{" "}
            to{" "}
            <span className="font-bold text-white">
              {Math.min(currentPage * itemsPerPage, filteredRows.length)}
            </span>{" "}
            of{" "}
            <span className="font-bold text-white">
              {filteredRows.length}
            </span>{" "}
            items
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 bg-[#0b0f19] border border-slate-700 hover:bg-slate-800 text-slate-200 font-semibold rounded-lg shadow-xs disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((page) => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1)
              .map((page, index, arr) => {
                const prevPage = arr[index - 1];
                const showEllipsis = prevPage && page - prevPage > 1;
                
                return (
                  <React.Fragment key={page}>
                    {showEllipsis && <span className="px-1 text-slate-500">...</span>}
                    <button
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-1.5 rounded-lg transition-colors shadow-xs ${
                        currentPage === page
                          ? "bg-blue-600 text-white font-bold"
                          : "bg-[#0b0f19] border border-slate-700 hover:bg-slate-800 text-slate-200 font-semibold"
                      }`}
                    >
                      {page}
                    </button>
                  </React.Fragment>
                );
              })}

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 bg-[#0b0f19] border border-slate-700 hover:bg-slate-800 text-slate-200 font-semibold rounded-lg shadow-xs disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
        </div>
      )}

      {/* Row Details Modal */}
      <RowDetailsModal 
        isOpen={viewRow !== null} 
        onClose={() => setViewRow(null)} 
        row={viewRow} 
        columns={columns} 
        onUpdateRow={(updatedRow) => {
          if (onUpdateRow) onUpdateRow(updatedRow);
          setViewRow(updatedRow);
        }}
      />

      {/* Event Status Panel */}
      <EventStatusPanel
        isOpen={eventPanel !== null}
        onClose={() => setEventPanel(null)}
        rowId={eventPanel?.rowId || ""}
        dateKey={eventPanel?.dateKey || ""}
        dateLabel={eventPanel?.dateLabel || ""}
        rawValue={eventPanel?.rawValue || ""}
        plant={eventPanel?.plant || ""}
        style={eventPanel?.style}
        graphic={eventPanel?.graphic}
        suggestedCode={eventPanel?.suggestedCode}
        applicableFlows={(() => {
          const r = rows.find((x) => x.id === eventPanel?.rowId);
          if (!r) return [];
          return getApplicableFlows(r as unknown as Record<string, unknown>).map((f) => ({
            id: f.id,
            title: f.title,
            description: f.description,
            sequence: f.sequence,
            totalLeadTimeDays: f.totalLeadTimeDays,
          }));
        })()}
        onApplyFlow={
          onApplyPlanFlow
            ? async (rowId, dateKey, flowId) => {
                await onApplyPlanFlow(rowId, dateKey, flowId);
              }
            : undefined
        }
        onSave={async (rowId, dateKey, newValue) => {
          const row = rows.find(r => r.id === rowId);
          if (!row) return;
          const parsedNew = parseEventValue(newValue);
          const isClear = !newValue || !newValue.trim();

          // A "<date>_<PLANT>" key means the planner edited (or is clearing) ONE cross-dev leg.
          // That leg's schedule must reschedule/clear on its own — the shared/bare plan and every
          // other leg stay put. This must run BEFORE the bare-key "Clear Event" branch below:
          // clearEventForward only ever wipes bare (unsuffixed) date keys, so calling it directly
          // on a "<date>_<PLANT>" key cleared the one cell but left every downstream event on that
          // same leg untouched (they live under "<other-date>_<PLANT>" keys it never looks at).
          const legMatch = dateKey.match(/^(\d{4}-\d{2}-\d{2})_(.+)$/);
          if (legMatch) {
            const legDate = legMatch[1];
            const legPlant = legMatch[2];
            const esc = legPlant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const legRe = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})_${esc}$`);
            const mirrorsShared = !row[`_leg_${legPlant}`];

            // Single-plant view of the row: this leg's own dated pills (or, while it still mirrors
            // the shared plan, the bare plan) mapped onto plain date keys, with the new value set.
            const legBare: Record<string, unknown> = {
              ...row,
              col11: legPlant,
              col12: legPlantFlow(row.col12, legPlant),
            };
            Object.keys(legBare).forEach(k => {
              if (/^\d{4}-\d{2}-\d{2}(_.*)?$/.test(k)) delete legBare[k];
            });
            Object.entries(row).forEach(([k, v]) => {
              const m = k.match(legRe);
              if (m && String(v ?? "").trim()) legBare[m[1]] = v;
            });
            if (mirrorsShared) {
              // Seed from the shared plan's milestone DATES only — strip the first leg's own
              // pass/fail verdicts back to a plain "-S" so this leg starts from a clean plan and
              // then diverges on its own result.
              Object.entries(row).forEach(([k, v]) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || k in legBare) return;
                const s = String(v ?? "").trim();
                if (!s) return;
                const base = s.split("|")[0].replace(/-(?:S|F|PASS|FAIL)$/i, "");
                legBare[k] = `${base}-S`;
              });
            }
            // "Clear Event" on one leg: wipe that leg's downstream plan (every planned "-S" pill
            // after it, on THIS leg only) the same way the shared-plan clear below does, just
            // scoped to legBare's own bare-date view so the other leg(s) never get touched.
            let scheduled: Record<string, unknown>;
            if (isClear) {
              scheduled = clearEventForward(legBare, legDate);
            } else {
              legBare[legDate] = newValue;
              // "planned" AND "pass" both anchor on the picked date and reschedule only what's
              // downstream — see the shared-plan branch below for why "pass" must NOT fall through
              // to the full rebuild (it silently un-pins a moved-then-passed milestone and
              // duplicates it). "fail" still takes the full rebuild for its auto-retry scheduling.
              scheduled = (parsedNew && (parsedNew.status === "planned" || parsedNew.status === "pass"))
                ? autoScheduleForwardFromEvent(legBare, parsedNew.code, legDate)
                : autoScheduleEmbellishmentRow(legBare);
            }

            // Write the fresh dates back onto this leg's "<date>_<PLANT>" keys only; mark it diverged.
            const outRow: EmbellishmentRow = {
              ...row,
              [`_leg_${legPlant}`]: "1",
              change_reason: isClear ? "Event cleared via Event Status Panel" : "Updated via Event Status Panel",
            } as EmbellishmentRow;
            Object.keys(outRow).forEach(k => {
              if (legRe.test(k)) (outRow as Record<string, unknown>)[k] = "";
            });
            Object.entries(scheduled).forEach(([k, v]) => {
              if (/^\d{4}-\d{2}-\d{2}$/.test(k) && String(v ?? "").trim()) {
                (outRow as Record<string, unknown>)[`${k}_${legPlant}`] = v;
              }
            });
            await onUpdateRow(outRow);
            return;
          }

          // "Clear Event" on the shared/bare plan — delete this milestone AND wipe the whole
          // downstream plan (every planned "-S" pill after it), leaving a clean slate from here on.
          // Everything before it, and any real Pass/Fail verdict, is kept. Do NOT run the normal
          // auto-scheduler — it rebuilds the flow from the earliest date and immediately
          // regenerates the milestone that was just cleared, which made "Clear Event" a no-op.
          // Downstream rebuilds when the planner drops the milestone on its new date
          // (autoScheduleForwardFromEvent).
          if (isClear) {
            const cleared = clearEventForward({ ...row }, dateKey) as EmbellishmentRow;
            cleared.change_reason = "Event cleared via Event Status Panel";
            await onUpdateRow(cleared);
            return;
          }

          const rawRow: Record<string, unknown> = { ...row, [dateKey]: newValue };
          const plainDate = dateKey.match(/^(\d{4}-\d{2}-\d{2})$/)?.[1];
          // A planner setting a "Planned" event on a specific day means "put this milestone HERE
          // and re-plan forward from it". autoScheduleForwardFromEvent pins the picked event on the
          // picked date, leaves every earlier milestone exactly as recorded (FS/FR that already
          // happened don't move), and cascades only the events AFTER it. For the first milestone in
          // the flow it falls back to the whole-flow rebuild.
          //
          // A "pass" verdict takes the SAME anchored path, not the full rebuild — a Pass/Fail value
          // is never marked "|X" locked (encodeEventValue only locks a "planned" value), so once a
          // manually-moved milestone (e.g. PPS dropped on a later date, "|X") gets marked done, the
          // lock disappears and the full rebuild has nothing anchoring it to that real date any
          // more. It then recomputes the WHOLE flow by pure lead-time math from scratch, and every
          // milestone that doesn't land back on its exact original formula date — which a
          // deliberately moved one never will — gets a brand-new duplicate pill written next to the
          // real one (confirmed: move PPS out, mark it done -> phantom FS/FR/PPS pills reappear
          // ahead of the real PPS date). "fail" still takes the full rebuild: it needs
          // calculateAutoSchedule's failedEventsMap to auto-schedule the next-working-day retry.
          const scheduledRow = (parsedNew && (parsedNew.status === "planned" || parsedNew.status === "pass") && plainDate)
            ? autoScheduleForwardFromEvent(rawRow, parsedNew.code, plainDate)
            : autoScheduleEmbellishmentRow(rawRow);
          scheduledRow.change_reason = "Updated via Event Status Panel";
          await onUpdateRow(scheduledRow as EmbellishmentRow);
        }}
      />

      {historySharedId && (
        <HistoryModal
          sharedId={historySharedId}
          onClose={() => setHistorySharedId(null)}
          allRows={allRows || rows} // rows containing both current and historic versions
          columns={columns}
        />
      )}
    </div>
  );
}
