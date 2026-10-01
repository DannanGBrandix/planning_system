"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { encodeEventValue, parseEventValue } from "./lib/eventCodes";
import { loadCodes } from "./lib/codesStore";
import {
  getAllRows,
  getArchivedRows,
  saveRow,
  saveMultipleRows,
  deleteRow,
  deleteMultipleRows,
  getColumns,
  saveColumns,
  seedDatabase,
  clearDatabase,
  EmbellishmentRow,
  ColumnMapping,
  AuditLog,
  getAuditLogs,
  saveAuditLog,
  saveMultipleAuditLogs,
  clearAuditLogs,
  getRowStatus,
  hasColorApproval,
  hasFinalStrikeReferenceOrDirective,
  hasFinalReferenceSecondDhl,
  cleanSeason,
  cleanCategory,
  isRowSent,
  withEventClears,
  isPlanningEventKey,
  colorApprovalByCombo,
  comboKeyOf,
  createBackup,
  DEFAULT_COLUMNS,
  listPendingUpdates,
  getCkChartStatus,
  fetchCkChartFile,
  markCkChartsSynced,
  CkChartStatus,
  derivePlanStatus,
  isExcludedFromAdvancedAnalytics,
  groupRowsByCombo,
  getGroupStatus,
  getLastRowsSync,
  RowsSyncInfo,
} from "./lib/db";
import Table from "./components/Table";
import ColumnConfigModal from "./components/ColumnConfigModal";
import Header from "./components/Header";
import FilterControls from "./components/FilterControls";
import DashboardStats from "./components/DashboardStats";
import ManagementView from "./components/ManagementView";
import AuditTrailDrawer from "./components/AuditTrailDrawer";
import AdvancedDashboard from "./components/AdvancedDashboard";
import AdvancedSidebarFilters, {
  FilterSelections,
} from "./components/AdvancedSidebarFilters";
import ImportPreviewModal, {
  ParsedImportItem,
} from "./components/ImportPreviewModal";
import ImportConfigModal from "./components/ImportConfigModal";
import CkSyncButton from "./components/CkSyncButton";
import ActionCenterView from "./components/ActionCenterView";
import GlobalSidebar from "./components/GlobalSidebar";
import PlantSchedulesView from "./components/PlantSchedulesView";
import ScoreCardDashboard from "./components/ScoreCardDashboard";
import PlantPerformanceView from "./components/PlantPerformanceView";
import NewVersionModal, { NewVersionInput } from "./components/NewVersionModal";
import FabricDispatchView from "./components/FabricDispatchView";
import TriggerManagementView from "./components/TriggerManagementView";
import ReportsView from "./components/ReportsView";
import SummaryOfGraphicsView from "./components/SummaryOfGraphicsView";
import EventStatusPanel from "./components/EventStatusPanel";
import SlaWatchlistBar from "./components/SlaWatchlistBar";
import DueTomorrowAlertModal from "./components/DueTomorrowAlertModal";
import BackupsModal from "./components/BackupsModal";
import { autoScheduleEmbellishmentRow, autoScheduleAnchoredToEvent, hasCompleteAllocationContext, detectMatchingFlow, detectPlanCycles } from "./lib/planningFlows";
import { plantFromFlow, legPlantFlow, extractPlants } from "./lib/plantUtils";
import { deriveNycVerdict, readNycVerdict, rowRefIso } from "./lib/nycVerdict";
import { extractDateFromTrackingText, extractDropDateIso } from "./lib/trackingDates";
import { calculateSoffSlaStatus } from "./lib/slaUtils";
import { isHiddenEventTrigger, seasonBase } from "./lib/triggerUtils";
import {
  ckCategoryFromFilename,
  ckCategoryCanonical,
  isCkFamilyCategory,
  ckCategoriesCompatible,
} from "./lib/ckCategories";

// Classify an Excel cell fill color by luminance/hue instead of matching an exact hex
// whitelist. Planning sheets get hand-painted with many slightly different grey ("Dropped")
// and green ("Approved") swatches over time (theme tints, copy-pasted fills, different Excel
// versions), and a small hardcoded list of hex codes misses most of them — those rows then
// silently fall through to "Pending" and skew every downstream count. Plain white / no-fill
// cells must stay neutral (not dropped, not approved).
function classifyFillColor(rgbHex: string): "grey" | "green" | "pink" | "none" {
  if (!rgbHex || rgbHex.length < 6) return "none";
  // Strip the alpha channel if present (ARGB -> RGB)
  const hex = rgbHex.length >= 8 ? rgbHex.slice(-6) : rgbHex;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return "none";

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min; // 0 = perfectly neutral (grey/white/black)
  const brightness = (r + g + b) / 3;

  // GREY: R ≈ G ≈ B across the whole dark-to-light range, but exclude near-white
  // (no fill / a genuinely blank white cell) and near-black (bold text formatting).
  if (spread <= 14 && brightness >= 55 && brightness <= 232) {
    return "grey";
  }

  // GREEN: green channel clearly dominant over red and blue — covers everything from
  // pale mint (C6EFCE) through olive (D7E4BD) to bright green (00FF00 / 92D050).
  if (g - r >= 15 && g - b >= 15) {
    return "green";
  }

  // PINK/MAGENTA: red and blue both clearly higher than green (F261ED, FF00FF, FF69B4, etc.)
  if (r - g >= 25 && b - g >= 10) {
    return "pink";
  }

  return "none";
}

export default function Home() {
  // App states
  const [rows, setRows] = useState<EmbellishmentRow[]>([]);
  // Older versions (is_current = false) — loaded separately, never mixed into `rows` (dashboards,
  // imports and matching only see current versions). Used by Revision History + Plant Performance.
  const [archivedRows, setArchivedRows] = useState<EmbellishmentRow[]>([]);
  const [newVersionRow, setNewVersionRow] = useState<EmbellishmentRow | null>(null);
  useEffect(() => {
    getArchivedRows().then(setArchivedRows);
  }, []);
  const [draftRows, setDraftRows] = useState<EmbellishmentRow[]>([]);
  const [columns, setColumns] = useState<ColumnMapping>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);
  const [isDueTomorrowAlertOpen, setIsDueTomorrowAlertOpen] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<
    "standard" | "advanced" | "actionCenter" | "plantSchedules" | "scoreCard" | "plantPerformance" | "fabricDispatch" | "triggers" | "reports" | "summaryOfGraphics"
  >("standard");
  const [selectedCategoryFilter, setSelectedCategoryFilter] =
    useState<string>("");
  const [selectedSeasonFilter, setSelectedSeasonFilter] = useState<string>("");
  const [selectedTriggerFilter, setSelectedTriggerFilter] = useState<string>("");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<"All" | "Active" | "Dropped" | "Hold" | "Approved" | "C+P" | "Pending" | "Resubmit">("Active");
  // Plan Status (col47) filter — the planning-lifecycle flag, independent of the S/off Status
  // filter above and of anything Advanced Analytics reads.
  const [selectedPlanStatusFilter, setSelectedPlanStatusFilter] = useState<"All" | "Active" | "Dropped" | "Unplanned">("All");
  const [dhlFilter, setDhlFilter] = useState<"all" | "withDhl" | "noDhl">("all");
  // Color Approval filter — combo-level, Approved combos only (same basis as the Advanced
  // Analytics Color Approval card): with a colour sign-off vs. still missing one.
  const [colorFilter, setColorFilter] = useState<"all" | "colorApproved" | "missingColor">("all");
  const [slaFilter, setSlaFilter] = useState<"all" | "overdue" | "dueSoon" | "priority">("all");
  const [advancedSelections, setAdvancedSelections] =
    useState<FilterSelections>({
      category: [],
      season: [],
      subCategory: [],
      plant: [],
      graphicType: [],
      trigger: [],
      technique: [],
      riskFactor: [],
      style: [],
      ground: [],
      comment: [],
      graphic: [],
      combo: [],
      approvalStatus: [],
    });

  // Simulated User Portal Roles
  const [currentRole, setCurrentRole] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string>("");
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isAuditDrawerOpen, setIsAuditDrawerOpen] = useState<boolean>(false);
  const [pendingUpdatesCount, setPendingUpdatesCount] = useState<number>(0);

  // Import Preview Modal states
  const [importPreviewOpen, setImportPreviewOpen] = useState<boolean>(false);
  const [pendingImportData, setPendingImportData] = useState<{
    file: File;
    buffer: ArrayBuffer;
    availableSheets: string[];
    defaultSheets: string[];
    previewHeaders?: string[];
    // True when this came in through the dedicated "Import Planning Sheet" button rather than
    // the general "Import Excel" one — forces skipNewRows on for the whole import, since a
    // planning sheet's job is to fill in dates/events on items the tracking chart already
    // established, never to introduce items of its own (see processImportFile's skipNewRows).
    isPlanningSheetImport?: boolean;
    // True when this came in through the dedicated "CK Tracking Chart" button — forces Category
    // (col3) to "CK" on every row regardless of what the dialog's override dropdown says (see
    // processImportFile), which is the single switch getRowStatus and Advanced Analytics use to
    // decide whether a row follows the S/off Status letter-code logic or the original VS/PINK
    // comment-based logic. Without this, that scoping would silently depend on the user
    // remembering to pick "CK" by hand every time.
    isCkImport?: boolean;
    // The specific CK category this file belongs to ("CKNA Men's" / "CKNA Women's" / "CKP" /
    // "Other Knit"), resolved from the file name. Only set when isCkImport is true. Stamped onto
    // col3 of every row the import touches — new AND matched-existing — which is how the CK sync
    // re-labels the legacy bare-"CK" rows into their real category. Falls back to "CK" when the
    // file name isn't recognisable (keeps the old single-bucket behaviour for stray CK files).
    ckCategory?: string;
  } | null>(null);
  const [importFileName, setImportFileName] = useState<string>("");
  const [parsedImportItems, setParsedImportItems] = useState<
    ParsedImportItem[]
  >([]);
  // ISO date the user picked in the import dialog ("" = schedule from the next working day).
  // Carried from processImportFile to handleConfirmImport, where auto-scheduling runs.
  const [importPlanStartDate, setImportPlanStartDate] = useState<string>("");

  const [isImportSyncing, setIsImportSyncing] = useState<boolean>(false);
  // Mirrors isImportSyncing for the background poll below (setInterval's closure only ever sees
  // the isImportSyncing value from whenever the effect last ran — a plain state check inside
  // refreshRows would read a stale, always-false snapshot for the entire life of that interval,
  // since starting/finishing an import never changes currentRole and so never re-runs that
  // effect). A ref is mutable and always read fresh, regardless of which render's closure is
  // holding it.
  const isImportSyncingRef = useRef(false);
  useEffect(() => {
    isImportSyncingRef.current = isImportSyncing;
  }, [isImportSyncing]);
  const [showCpSpModal, setShowCpSpModal] = useState<boolean>(false);
  const [isBackupsModalOpen, setIsBackupsModalOpen] = useState<boolean>(false);

  // ── CK Charts sync ──────────────────────────────────────────────────────
  // Status of the six CK tracking-chart workbooks in the local OneDrive-synced
  // folder (polled), plus the state machine that drives importing them one by
  // one through the normal processImportFile / handleConfirmImport pipeline.
  const [ckChartStatus, setCkChartStatus] = useState<CkChartStatus | null>(null);
  const [ckSync, setCkSync] = useState<{
    running: boolean;
    done: boolean;
    files: { key: string; label: string; category: string }[];
    index: number;
    log: string[];
  } | null>(null);
  const ckSyncRef = useRef(ckSync);
  ckSyncRef.current = ckSync;
  const ckSyncFedRef = useRef<number>(-1);
  const ckAutoConfirmRef = useRef<boolean>(false);

  useEffect(() => {
    async function fetchUser() {
      try {
        const { createSupabaseClient } =
          await import("./utils/supabase/client");
        const supabase = createSupabaseClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          setUserEmail(session.user.email || "");

          // Fetch role from backend
          // Wait, getAuthHeaders is not exported from db.ts!
          // We can just fetch it directly.
          const authHeaders = {
            Authorization: `Bearer ${session.access_token}`,
          };

          const API_URL =
            process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";
          const res = await fetch(`${API_URL}/auth/me`, {
            headers: authHeaders,
          });
          if (res.ok) {
            const data = await res.json();
            setCurrentRole(data.role);
          } else {
            setCurrentRole("Read-Only");
          }
        }
      } catch (err) {
        console.error("Failed to fetch user role", err);
      }
    }
    fetchUser();
  }, []);

  // Refresh event/reason codes from Supabase (falls back to the bundled list).
  useEffect(() => {
    loadCodes();
  }, []);

  // Poll the pending plant-update count for the sidebar badge (Planner/Admin/Management only).
  useEffect(() => {
    const canSee = !currentRole || ["Planner", "Admin", "Management"].includes(currentRole);
    let cancelled = false;
    const tick = async () => {
      try {
        const items = canSee ? await listPendingUpdates("pending") : [];
        if (!cancelled) setPendingUpdatesCount(items.length);
      } catch {
        /* non-fatal */
      }
    };
    const kickoff = setTimeout(tick, 0);
    const id = canSee ? setInterval(tick, 60000) : null;
    return () => {
      cancelled = true;
      clearTimeout(kickoff);
      if (id) clearInterval(id);
    };
  }, [currentRole]);

  // Load drafts on role change
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Delay execution to avoid synchronous setState warning
      setTimeout(() => {
        const isTeam = currentRole.startsWith("Team");
        if (isTeam) {
          const savedDrafts = localStorage.getItem(`drafts_${currentRole}`);
          if (savedDrafts) {
            setDraftRows(JSON.parse(savedDrafts));
          } else {
            setDraftRows([]);
          }
        } else {
          setDraftRows([]);
        }
      }, 0);
    }
  }, [currentRole]);

  // Active plant filter tab for Plant Department view
  const [activePlantTab, setActivePlantTab] = useState<string>("Plant A");

  // Filtering & Search states
  const [searchQuery, setSearchQuery] = useState<string>(""); // Pre-populate empty to show all items by default
  const [selectedGraphicFilter, setSelectedGraphicFilter] =
    useState<string>("");
  const [selectedTeamFilter, setSelectedTeamFilter] =
    useState<string>("All Teams");

  // How the last load of the table was served (server cache HIT/MISS/STALE, or a failure) — shown as
  // a chip in the header so a stale or failed refresh is never silent.
  const [rowsSync, setRowsSync] = useState<RowsSyncInfo | null>(null);
  const [isRefreshingNow, setIsRefreshingNow] = useState<boolean>(false);

  // Initial database load
  useEffect(() => {
    async function loadData() {
      try {
        setIsLoading(true);

        // Fetch rows, columns and audit logs
        const rawRows = await getAllRows(currentRole);
        setRowsSync(getLastRowsSync());
        const loadedRows = rawRows;
        const loadedCols = await getColumns();

        setRows(loadedRows);
        setColumns(loadedCols);
        
        const logs = await getAuditLogs();
        setAuditLogs(logs);

      } catch (err) {
        console.warn("Failed to load initial data", err);
      } finally {
        setIsLoading(false);
      }
    }
    
    loadData();
  }, [currentRole]);

  // Helper to re-fetch all rows from the database (used after publish + periodic polling).
  // `fresh` = bypass the server's cache and read the database (the header's "Refresh now").
  const loadRowsIntoState = async (fresh: boolean) => {
    try {
      const rawRows = await getAllRows(currentRole, { fresh });
      setRowsSync(getLastRowsSync());
      // An import (or its pre-import backup + post-import re-fetch) can take well over 15
      // seconds against a large database — long enough for this poll to fire mid-import, or for
      // a poll request already in flight to resolve AFTER the import's own, more current, result
      // has just landed in state. Whichever setRows call happens to resolve last normally wins;
      // without this guard that could be this poll's now-stale snapshot, silently reverting a
      // correctly-imported change back to what it was before the import ever started (confirmed
      // as a real incident: a re-import correctly marked a row Dropped, then this poll fired
      // moments later and reverted it back to Active). Checked AFTER the await, not before, so a
      // request that started just before the import began but resolves mid-import is still
      // caught.
      if (isImportSyncingRef.current) return;
      // getAllRows() swallows every failure (network error, Supabase 402 after the quota, server
      // down) and returns [] — indistinguishable from a genuinely empty table. Never let a failed
      // background refresh blank the table the planner is looking at.
      setRows((prev) => (rawRows.length === 0 && prev.length > 0 ? prev : rawRows));
    } catch (err) {
      // Use console.warn instead of console.error to avoid Next.js full-screen error overlays for background network polling issues
      console.warn("Error refreshing rows:", err);
    }
  };
  const refreshRows = () => loadRowsIntoState(false);
  const refreshRowsFresh = async () => {
    setIsRefreshingNow(true);
    try {
      await loadRowsIntoState(true);
    } finally {
      setIsRefreshingNow(false);
    }
  };

  // Planner: auto-poll every 15 seconds to pick up newly published rows from all teams.
  // Skipped while the tab is hidden (nobody is looking at it — a forgotten background tab used to
  // keep pulling the whole table all night); catches up the moment the tab is shown again. The
  // server serves these polls from an in-memory cache (server/db.js), so a visible poll no longer
  // costs Supabase egress either.
  useEffect(() => {
    if (currentRole !== "Planner") return;
    const interval = setInterval(() => {
      if (document.hidden) return;
      refreshRows();
    }, 15000);
    const onVisible = () => {
      if (!document.hidden) refreshRows();
    };
    document.addEventListener("visibilitychange", onVisible);

    // Also do an immediate refresh when switching to Planner role
    // Wrap in async function to avoid synchronous setState warning in effect
    const initRefresh = async () => {
      await refreshRows();
    };
    initRefresh();

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRole]);

  // Auto-approve C+P (Correct and Process) rows on data load
  // Any row with "C+P" in strike-off comments (col22/col34) should be Approved
  useEffect(() => {
    if (rows.length === 0 || isLoading) return;

    // Desired col20 for a row whose strike-off comment mentions "C+P":
    //   - a real approval verdict in the comment ("approved for layout/tech/ex") -> "Approved"
    //   - anything else, INCLUDING "… & send final soff" / "for final record" / a logged
    //     "Final reference" -> "C+P" (the final strike going out is not an approval; the combo
    //     stays at C+P until NY signs off). See hasFinalStrikeReferenceOrDirective in lib/db.ts.
    const desiredCol20For = (r: EmbellishmentRow): 'Approved' | 'C+P' | null => {
      const c22 = String(r.col22 || '').toLowerCase();
      const c34 = String(r.col34 || '').toLowerCase();
      if (!c22.includes('c+p') && !c34.includes('c+p')) return null;
      const hasApproved = c22.includes('approved') || c34.includes('approved');
      // Final strike-off actually sent (2nd DHL marked "Final Reference") -> approved.
      return hasApproved || hasFinalReferenceSecondDhl(r) ? 'Approved' : 'C+P';
    };

    const cpRows = rows.filter(r => {
      const desired = desiredCol20For(r);
      if (!desired) return false;
      const col20Upper = String(r.col20 || '').trim().toUpperCase();
      if (desired === 'Approved') return col20Upper !== 'APPROVED';
      // desired === 'C+P': write it when col20 isn't already C+P AND isn't some other real
      // verdict we shouldn't stomp (Dropped / Resubmit). This also SELF-HEALS the rows an
      // earlier pass wrongly flipped to "Approved" off a "final reference" / "send final soff"
      // note — but only those: a genuine chart "Approved" with no such note is left alone.
      if (col20Upper === 'C+P') return false;
      if (/DROP|REALLOCAT|RESUB|MOVED/.test(col20Upper)) return false;
      if (col20Upper === 'APPROVED') return hasFinalStrikeReferenceOrDirective(r);
      return true;
    });

    if (cpRows.length === 0) return;

    // Figure out the one field each flagged row actually needs (col20), without spreading the
    // rest of `r`. This effect only depends on [rows.length, isLoading], so `r` here can be a
    // `rows` snapshot captured well before an import finishes writing fresher col22/col34 values
    // for these same rows — sending `{ ...r, col20: ... }` would carry that stale col22/col34
    // along and silently revert whatever the import just wrote once this save lands. Sending only
    // `{ id, col20 }` means this effect can never touch a field it didn't mean to, no matter how
    // stale its snapshot of `r` turns out to be. This matches exactly what was observed: a
    // re-import correctly showed 5 rows "APPROVED FOR COLOR", then moments later it dropped back
    // to 2 once this effect's already-in-flight (and by-then-stale) save landed.
    const col20UpdatesById = new Map<string, string>();
    cpRows.forEach(r => {
      const desired = desiredCol20For(r);
      if (desired) col20UpdatesById.set(r.id, desired);
    });

    const rowsToSave: EmbellishmentRow[] = Array.from(col20UpdatesById.entries()).map(
      ([id, col20]) => ({ id, col20 } as EmbellishmentRow),
    );

    // Persist and update state
    (async () => {
      try {
        if (isImportSyncingRef.current) return;
        await saveMultipleRows(rowsToSave);
        if (isImportSyncingRef.current) return;
        // Merge into whatever the CURRENT state is (not the possibly-stale `rows` this effect
        // closed over) so a late-resolving save can only ever update col20, never revert any
        // other field back to what it was when this effect started.
        setRows(prev =>
          prev.map(r => (col20UpdatesById.has(r.id) ? { ...r, col20: col20UpdatesById.get(r.id)! } : r)),
        );
        console.log(`[C+P Auto-Approve] ${cpRows.length} row(s) auto-approved.`);
      } catch (err) {
        console.error('[C+P Auto-Approve] Failed:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, isLoading]);

  // Auto-schedule any rows on load that are missing milestone event dates, or clean rows missing allocation data
  useEffect(() => {
    if (rows.length === 0 || isLoading) return;

    // Only the calendar-date keys (and occasionally col11) actually change between `r` and
    // autoScheduleEmbellishmentRow(r)'s output — everything else on `r`, including col22/col34,
    // passes through untouched. Diffing against the input and saving only what changed (rather
    // than the full returned object) means a stale `r` snapshot — this effect only depends on
    // [rows.length, isLoading], so it can be holding one captured well before an import finishes
    // writing fresher values for these same rows — can never carry its stale col22/col34 back
    // into the database. A key that autoScheduleEmbellishmentRow deletes outright (cleaning a
    // row's dates) is recorded here as "", so the save actually clears it instead of silently
    // leaving whatever was already stored untouched.
    const diffChangedFields = (
      original: EmbellishmentRow,
      updated: EmbellishmentRow,
    ): Record<string, unknown> => {
      const changed: Record<string, unknown> = {};
      const allKeys = new Set([...Object.keys(original), ...Object.keys(updated)]);
      allKeys.forEach((k) => {
        if (k === "id") return;
        const oldVal = original[k];
        const newVal = Object.prototype.hasOwnProperty.call(updated, k) ? updated[k] : "";
        if (oldVal !== newVal) changed[k] = newVal;
      });
      return changed;
    };

    let needsUpdate = false;
    const scheduleDiffs: EmbellishmentRow[] = [];
    // Merge, don't append: a row can be touched by more than one heal below (e.g. Plant recovered
    // AND schedule rebuilt) and saveMultipleRows keeps only the LAST entry per id, so a plain
    // push would let the later change drop the earlier one.
    const pushDiff = (id: string, obj: Record<string, unknown>) => {
      const existing = scheduleDiffs.find((d) => d.id === id);
      if (existing) Object.assign(existing, obj);
      else scheduleDiffs.push({ id, ...obj } as unknown as EmbellishmentRow);
    };
    rows.forEach((r) => {
      // Recover a blank Plant (col11) from the Plant Flow (col12) chain — the allocation chart
      // sometimes leaves col11 empty on rows whose col12 spells out the plants around a wash/dye
      // vendor. Persisted here; the row then plans correctly on the next load with a real Plant.
      const origR = r;
      const recoveredPlant =
        !String(r.col11 || "").trim() && r.col12 ? plantFromFlow(String(r.col12)) : "";
      if (recoveredPlant) {
        needsUpdate = true;
        pushDiff(r.id, { col11: recoveredPlant });
        r = { ...r, col11: recoveredPlant } as EmbellishmentRow;
      }

      // PLANNING-EVENT RULE (2026-09-27): an existing plan is only ever changed or cleared by a
      // MANUAL action (Delete / Clear / move / replan / plant change in Edit) — never by this
      // load-time heal. So a row that already has ANY planning event is left exactly as it is
      // (the server refuses non-manual clears anyway, see server/planningEvents.js; re-timing
      // here would only add duplicate dates next to the kept ones). Only a row with no plan at
      // all gets auto-planned below.
      const hasAnyPlanningEvent = Object.keys(r).some(
        (k) => /^\d{4}-\d{2}-\d{2}(_.+)?$/.test(k) && String(r[k] ?? "").trim() !== "",
      );
      if (hasAnyPlanningEvent) return;

      // STRICT: a row is only eligible for planning events when it has BOTH a real Plant and a
      // real S-Off Requirement (hasCompleteAllocationContext). Process / Plant Flow / App Form /
      // AWR / an existing FR-or-NY pass-fail date are NOT substitutes — no S-Off Requirement means
      // no planning events, and any auto-projected pills already on the row get stripped below.
      const hasAllocation = hasCompleteAllocationContext(r as unknown as Record<string, unknown>);

      if (!hasAllocation) {
        // Lingering planned date keys from a prior import/save on a row that no longer qualifies —
        // autoScheduleEmbellishmentRow strips the auto-projected "-S" pills (real FR/NY events stay).
        const hasPlannedDates = Object.keys(r).some((k) => k.match(/^\d{4}-\d{2}-\d{2}$/));
        if (hasPlannedDates) {
          needsUpdate = true;
          const scheduled = autoScheduleEmbellishmentRow(r); // cleans all YYYY-MM-DD keys when !hasAllocationContext!
          const diff = diffChangedFields(origR, scheduled);
          if (Object.keys(diff).length > 0) pushDiff(r.id, diff);
        }
        return;
      }

      // A row with a planner-LOCKED milestone ("|X") is off-limits to every rebuild/re-anchor
      // heal below — the planner has deliberately placed this plan and it must not be re-timed on
      // load. (The scheduler itself still keeps the locks fixed, but the heals below anchor off
      // stale dates from earlier cycles, so skip them entirely.)
      const hasPinnedEvent = Object.entries(r).some(
        ([k, v]) =>
          /^\d{4}-\d{2}-\d{2}(_.+)?$/.test(k) &&
          typeof v === "string" &&
          parseEventValue(v)?.isPinned,
      );
      if (hasPinnedEvent) return;

      const existingDateValues = Object.entries(r)
        .filter(([k, v]) => k.match(/^\d{4}-\d{2}-\d{2}$/) && Boolean(v))
        .map(([_, v]) => String(v).toUpperCase());

      const hasFS = existingDateValues.some((v) => v.includes("FS"));
      const hasFR = existingDateValues.some((v) => v.includes("FR"));
      const hasPPS = existingDateValues.some((v) => v.includes("PPS"));
      const hasDuplicateFR = existingDateValues.filter((v) => v.includes("FR")).length > 1;

      const hasDyePills = existingDateValues.some((v) => v.includes("PPSDS") || v.includes("RDPS"));
      const processStr = String(String(String(String(String(r.col10 || ""))))).toUpperCase();
      const isActualDye =
        processStr.includes("SEND TO DYE") ||
        processStr.includes("DYE PLANT") ||
        processStr.includes("MARTEX") ||
        processStr.includes("BFL") ||
        processStr.includes("DYNAWASH") ||
        processStr.includes("GARMENT DYE") ||
        processStr.includes("PANEL DYE") ||
        processStr.includes("SEND TO WASH");
      const hasInvalidDyePills = hasDyePills && !isActualDye;

      const hasCSRFPills = existingDateValues.some((v) => v.includes("CSRF") || v.includes("CPS"));
      const appFormStr = String(String(String(String(String(r.col15 || ""))))).toUpperCase();
      const isActualCutPanel = appFormStr.includes("CUT PANEL");
      const hasInvalidCutPanelPills = hasCSRFPills && !isActualCutPanel;

      // Wrong-flow detection: a milestone pill on the row whose base isn't in the row's OWN
      // detected flow sequence at all — a leftover from a plan built on a different flow. Two real
      // cases: a FABRIC s/off planned SEWIN/SEWS->GMT because its App Form said "GMT"
      // ("PANEL>>GMT FORM"); and a stray "FR" wedged in front of SEWIN/SEWS on a Garments+Dye
      // (PILLOW CASES) row whose flow (id 10) has no FR step. Post-NY testing add-ons
      // (CK-TEST / DTC-3010 / LTD-92) and real Pass/Fail verdicts are legitimate and excluded.
      // These keys are cleared and the row replanned so nothing stale is left dangling.
      const POST_NY_ADDONS = new Set(["CK-TEST", "DTC-3010", "LTD-92"]);
      const flowSlots = new Set(detectMatchingFlow(r).sequence.map((s) => s.toUpperCase()));
      const foreignFlowKeys = Object.entries(r)
        .filter(([k, v]) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
          const raw = String(v || "").trim();
          if (!raw) return false;
          const up = raw.toUpperCase();
          if (up.includes("|P") || up.includes("|F") || up.includes("PASS") || up.includes("FAIL")) {
            return false; // real verdict — keep
          }
          const base = up.replace(/-(S|F|T)$/i, "").split("|")[0].trim();
          if (!base || POST_NY_ADDONS.has(base)) return false;
          return !flowSlots.has(base);
        })
        .map(([k]) => k);
      const hasForeignFlowEvent = foreignFlowKeys.length > 0;

      const hasFailedEvent = Object.entries(r).some(
        ([k, v]) =>
          k.match(/^\d{4}-\d{2}-\d{2}$/) &&
          typeof v === "string" &&
          (v.includes("|F|") || v.toUpperCase().includes("FAIL") || v.toUpperCase().includes("REJECT")),
      );

      // Stranded opening milestone: the flow's first milestone (FS / SEWIN/SEWS / CSRF) sits far
      // earlier than its lead time allows before the next milestone — it was placed off a stale
      // anchor (the old backfill that keyed FS to Fabric-In-Date instead of the real FR). The
      // flow's opener → next step is ~1 working day; a gap of several days is the tell. Healed by
      // an ANCHORED replan that pins the first real downstream event and snaps the opener back
      // next to it — NOT the plain replan below, which would re-anchor on the stranded date.
      const datedSorted = Object.entries(r)
        .filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && String(v || "").trim())
        .map(([k, v]) => ({
          k,
          base: String(v).replace(/-(S|F|T)$/i, "").split("|")[0].trim().toUpperCase(),
          isPlanned: /-S$/i.test(String(v).trim()),
        }))
        .sort((a, b) => a.k.localeCompare(b.k));
      const openerSlot = String(detectMatchingFlow(r).sequence[0] || "").toUpperCase();
      const openerBases = openerSlot.split("/").map((s) => s.trim());
      const firstOpener = datedSorted.find((e) => openerBases.includes(e.base));
      const firstDownstream = datedSorted.find((e) => !openerBases.includes(e.base));
      const hasStrandedOpener = Boolean(
        firstOpener &&
          firstOpener.isPlanned &&
          firstDownstream &&
          (Date.parse(firstDownstream.k) - Date.parse(firstOpener.k)) / 86_400_000 > 3,
      );

      // A row can have full allocation data (Process/Plant/AppForm/SoffReq all filled — hasAllocation
      // above) yet literally zero schedule dates of any kind — confirmed as a real incident (3 rows,
      // 2 of them cross-dev "Plant1/Plant2" style). The check below only ever looked for signs of an
      // INCOMPLETE plan (has FR but missing PPS/NY/FS, etc.), so a row with NO plan at all never
      // matched any of those signals and silently never got scheduled, on any page load, ever.
      const hasNoScheduleAtAll = existingDateValues.length === 0;

      if (
        hasStrandedOpener &&
        !hasFailedEvent &&
        !hasForeignFlowEvent &&
        firstDownstream
      ) {
        // Keep the real downstream plan where it is; just pull the opener back next to it.
        needsUpdate = true;
        const scheduled = autoScheduleAnchoredToEvent(r, firstDownstream.base, firstDownstream.k);
        const diff = diffChangedFields(origR, scheduled);
        if (Object.keys(diff).length > 0) pushDiff(r.id, diff);
      } else if (hasForeignFlowEvent) {
        // Clear the out-of-flow milestone pill(s), then replan cleanly.
        needsUpdate = true;
        const cleaned = { ...r } as Record<string, unknown>;
        foreignFlowKeys.forEach((k) => { cleaned[k] = ""; });
        const scheduled = autoScheduleEmbellishmentRow(cleaned) as EmbellishmentRow;
        const diff = diffChangedFields(origR, scheduled);
        if (Object.keys(diff).length > 0) pushDiff(r.id, diff);
      } else if (
        hasFailedEvent ||
        hasNoScheduleAtAll ||
        ((hasFR || r.col14) &&
          (!hasPPS || hasDuplicateFR || !hasFS || hasInvalidDyePills || hasInvalidCutPanelPills))
      ) {
        needsUpdate = true;
        const scheduled = autoScheduleEmbellishmentRow(r);
        const diff = diffChangedFields(origR, scheduled);
        if (Object.keys(diff).length > 0) pushDiff(r.id, diff);
      }
    });

    if (needsUpdate && scheduleDiffs.length > 0) {
      (async () => {
        try {
          // Same stale-snapshot race guarded against in the C+P Auto-Approve effect above and the
          // 15s poll (see their comments) — this effect also only depends on [rows.length,
          // isLoading] and can be holding a `rows` snapshot from before an import finishes writing
          // fresher data for these same rows.
          if (isImportSyncingRef.current) return;
          await saveMultipleRows(scheduleDiffs);
          if (isImportSyncingRef.current) return;
          // Merge into the CURRENT state (not the possibly-stale `rows` this effect closed over)
          // so a late-resolving save can only ever update the date keys it actually changed.
          const diffById = new Map(scheduleDiffs.map((d) => [d.id, d]));
          setRows((prev) =>
            prev.map((r) => (diffById.has(r.id) ? { ...r, ...diffById.get(r.id) } : r)),
          );
        } catch (err) {
          console.error("[Auto-Schedule] Failed to persist scheduled rows:", err);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, isLoading]);

  // Update a row in DB, state, and create automatic audit log entries
  const handleUpdateRow = async (updatedRow: EmbellishmentRow) => {
    try {
      // Reconcile the NY approval verdict (NYC-A / NYC-R) from the strike-off comments before
      // anything else, so the derived "nycv:" keys are part of the audit diff and every save
      // branch below. No-op unless col22/col34 carry an approved/resubmit verdict (or a manual
      // one is already present — that's left untouched). See app/lib/nycVerdict.ts.
      updatedRow = deriveNycVerdict(updatedRow);

      if (updatedRow.id.startsWith("draft_")) {
        const updatedDrafts = draftRows.map((r) =>
          r.id === updatedRow.id ? updatedRow : r,
        );
        setDraftRows(updatedDrafts);
        localStorage.setItem(
          `drafts_${currentRole}`,
          JSON.stringify(updatedDrafts),
        );
        return;
      }

      const originalRow = rows.find((r) => r.id === updatedRow.id);
      if (originalRow) {
        // Compare values to see what changed
        const allKeys = Array.from(
          new Set([...Object.keys(originalRow), ...Object.keys(updatedRow)]),
        );
        for (const key of allKeys) {
          if (key === "id") continue;
          const oldVal = originalRow[key] || "";
          const newVal = updatedRow[key] || "";

          if (oldVal !== newVal) {
            let label = key;
            if (columns[key]) {
              label = columns[key];
            } else if (key.startsWith("20")) {
              // Custom date column header display
              const dateObj = new Date(key);
              label = dateObj.toLocaleDateString("en-US", {
                day: "numeric",
                month: "short",
              });
            }

            const logEntry: AuditLog = {
              id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              timestamp: new Date().toISOString(),
              styleCode: String(String(String(String(updatedRow.col5 || "")))) || "N/A", // col5 is Style Code
              field: label,
              oldValue: String(oldVal),
              newValue: String(newVal),
              userRole: currentRole,
            };

            await saveAuditLog(logEntry);
            setAuditLogs((prev) => [logEntry, ...prev]);
          }
        }

        // Determine if any auto-planning fields or calendar milestone dates changed
        const AUTO_PLANNING_FIELDS = new Set([
          "col3",  // Category
          "col7",  // Graphic
          "col8",  // Ground
          "col9",  // Technique(s)
          "col10", // Process
          "col11", // Plant
          "col12", // Plant Flow
          "col13", // Fabric Reference
          "col14", // Fabric In Date
          "col15", // Application Form
          "col16", // Alternative Fabric
          "col18", // Technique Category
          "col27", // S-Off Requirement
        ]);

        const normalizeStr = (s: unknown) => String(s ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
        
        const isOriginalFullyComplete = Array.from(AUTO_PLANNING_FIELDS).every((f) => {
          return normalizeStr(originalRow[f as keyof EmbellishmentRow]) !== "";
        });

        const isPlanningChange = Array.from(
          new Set([...Object.keys(originalRow), ...Object.keys(updatedRow)])
        ).some((key) => {
          const isPlanningField = AUTO_PLANNING_FIELDS.has(key);
          if (!isPlanningField) return false;
          return normalizeStr(originalRow[key]) !== normalizeStr(updatedRow[key]);
        });

        // Per the planner: once a row has ANY scheduled planning event, changing Plant / Plant
        // Flow / Fabric / Process / etc. must NOT auto-shift the existing dates — the plan is only
        // ever re-timed on purpose, via the Replan / "Clear + pick a start date" tools or the
        // Event Status panel's flow picker. This also fixes the cross-development bug: adding a
        // second plant to an already-planned graphic (col11 "ANTLER" -> "ANTLER/LEEMA") used to
        // drag the first plant's dates. A row with no events yet still auto-schedules on the edit
        // that completes its allocation data, exactly as before.
        const hasExistingPlan = Object.keys(originalRow).some(
          (k) => /^\d{4}-\d{2}-\d{2}(_.+)?$/.test(k) && normalizeStr(originalRow[k]) !== "",
        );

        // PLANT CHANGED IN EDIT (e.g. ANTLER -> LEEMA / REGAL IMAGE) = a new plant = a new plan.
        // This is the ONE case where an existing plan is cleared automatically: every event is
        // cleared (soft — kept in planning_events history) and the item is replanned fresh for the
        // new plant from today. NOT a plant swap, so the plan is kept exactly as it is:
        //   * Plant blanked            -> something broke; the events stay (and still show)
        //   * blank -> a plant         -> a repair, not a new plant
        //   * a leg added / removed    -> cross-dev (ANTLER -> ANTLER/LEEMA): the first plant's plan
        //                                 stays; the new leg is planned from a picked date
        //   * same plant, other spelling / alias (HI EMB vs CKT)
        // (Line breaks folded to spaces first: a chart cell like "Brandix<line break>emb" must read as one
        // plant, not "BRANDIX" + "EMB".)
        const plantSetOf = (v: unknown) => new Set(extractPlants(String(v ?? "").replace(/\s+/g, " ")));
        const oldPlants = plantSetOf(originalRow.col11);
        const newPlants = plantSetOf(updatedRow.col11);
        const isPlantSwap =
          hasExistingPlan &&
          oldPlants.size > 0 &&
          newPlants.size > 0 &&
          ![...oldPlants].every((p) => newPlants.has(p)) &&
          ![...newPlants].every((p) => oldPlants.has(p));

        if (isPlantSwap) {
          const fromPlant = normalizeStr(originalRow.col11);
          const toPlant = normalizeStr(updatedRow.col11);
          const now = new Date();
          const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          if (
            !window.confirm(
              `Plant changed: ${fromPlant} -> ${toPlant}.\n\n` +
                `A new plant needs a new plan: all current planning events on this item will be cleared ` +
                `and it will be replanned for ${toPlant} starting ${todayKey}.\n` +
                `(The cleared events are kept in the planning history.)\n\nContinue?`,
            )
          ) {
            return; // nothing saved — the plant edit is cancelled too
          }
          const cleared: Record<string, unknown> = {
            ...originalRow,
            ...updatedRow,
            id: originalRow.id,
            shared_id: originalRow.shared_id || originalRow.id,
            version_number: Number(originalRow.version_number) || 1,
            is_current: true,
          };
          Object.keys(cleared).forEach((k) => {
            if (isPlanningEventKey(k)) cleared[k] = "";
          });
          const replanned = autoScheduleEmbellishmentRow({ ...cleared }, undefined, todayKey) as EmbellishmentRow;
          const producedDates = Object.keys(replanned).some(
            (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && String(replanned[k] ?? "").trim() !== "",
          );
          const outRow = (producedDates ? replanned : cleared) as EmbellishmentRow;
          await saveRow(withEventClears(outRow, originalRow));
          setRows((prev) => prev.map((r) => (r.id === originalRow.id ? outRow : r)));

          const logEntry: AuditLog = {
            id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            timestamp: new Date().toISOString(),
            styleCode: String(originalRow.col5 || "N/A"),
            field: "System Row Operations",
            oldValue: `Plan for ${fromPlant}`,
            newValue: producedDates
              ? `Plant changed to ${toPlant} — plan cleared and replanned from ${todayKey}`
              : `Plant changed to ${toPlant} — plan cleared (not replanned: needs Plant + S-Off Requirement)`,
            userRole: currentRole,
          };
          await saveAuditLog(logEntry);
          setAuditLogs((prev) => [logEntry, ...prev]);
          if (!producedDates) {
            alert(
              "The old plan was cleared, but a new one couldn't be built yet — the item needs both a " +
                "Plant and an S-Off Requirement. Fill them in, then replan.",
            );
          }
          return;
        }

        if (isPlanningChange && !hasExistingPlan) {
          if (isOriginalFullyComplete) {
            // Changes impact auto-planning AND previously complete -> Soft-archive old version & create new version
            const updatedOldRow = { ...originalRow, is_current: false };
          
          // Wipe existing calendar dates from the updated row to start fresh. Set to "" rather
          // than deleting the key — the server merges a save's schedule fields onto whatever it
          // already has stored (see server/db.js) rather than replacing it outright, so a plain
          // deletion here is just an ABSENT key in what gets saved, meaning "leave the old date
          // alone", not "clear it". Only an explicit "" actually clears it in the database.
          const cleanUpdatedRow = { ...updatedRow };
          Object.keys(cleanUpdatedRow).forEach(k => {
            if (k.match(/^\d{4}-\d{2}-\d{2}$/)) {
              (cleanUpdatedRow as Record<string, unknown>)[k] = "";
            }
          });

          const groundChanged = normalizeStr(originalRow.col8) !== normalizeStr(updatedRow.col8);
          const changeReasonMsg = groundChanged 
            ? `Ground color changed (${originalRow.col8 || 'Default'} -> ${updatedRow.col8 || 'New'}). Re-planning from beginning.`
            : `Planning specification update. Re-calculated schedule.`;

          const newVersionRowBase = {
            ...cleanUpdatedRow,
            id: `row_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            shared_id: originalRow.shared_id || originalRow.id,
            version_number: (Number(originalRow.version_number) || 1) + 1,
            is_current: true,
            change_reason: changeReasonMsg,
            changed_date: new Date().toISOString(),
          };
          
          // Automatically calculate a completely fresh schedule starting from the beginning
          const newVersionRow = autoScheduleEmbellishmentRow(newVersionRowBase);

          // Save both to backend
          await saveMultipleRows([updatedOldRow, newVersionRow]);

          // Update local state
          setRows((prev) => {
            return prev.map((r) => (r.id === originalRow.id ? updatedOldRow : r)).concat(newVersionRow);
          });
          } else {
            // Planning field change, but row wasn't fully complete yet -> Update in place and recalculate schedule.
            // Set to "" rather than deleting: updatedInPlaceRowBase below spreads originalRow FIRST
            // and cleanUpdatedRow second, so a merely-deleted (i.e. absent) key here would never
            // even override originalRow's old date in the object that gets saved — let alone
            // survive the server's schedule merge (see server/db.js), which treats an absent key
            // as "leave whatever's already saved alone", not "clear it".
            const cleanUpdatedRow = { ...updatedRow };
            Object.keys(cleanUpdatedRow).forEach(k => {
              if (k.match(/^\d{4}-\d{2}-\d{2}$/)) {
                (cleanUpdatedRow as Record<string, unknown>)[k] = "";
              }
            });
            const updatedInPlaceRowBase: EmbellishmentRow = {
              ...originalRow,
              ...cleanUpdatedRow,
              id: originalRow.id,
              shared_id: originalRow.shared_id || originalRow.id,
              version_number: Number(originalRow.version_number) || 1,
              is_current: true,
            };
            const updatedInPlaceRow = autoScheduleEmbellishmentRow(updatedInPlaceRowBase);
            await saveRow(withEventClears(updatedInPlaceRow, originalRow));
            setRows((prev) => {
              return prev.map((r) => (r.id === originalRow.id ? updatedInPlaceRow : r));
            });
          }
        } else {
          // Non-planning field change (e.g. AOQ, Comment, DHL) -> Update in place, preserve version_number
          const aoqChanged = normalizeStr(originalRow.col20) !== normalizeStr(updatedRow.col20);

          if (aoqChanged) {
            // Fans an AOQ edit out to every OTHER row sharing this same Trigger — "KNIT" recurs
            // every season with its own real deadline (SU27's KNIT AOQ isn't SP27's), so the key
            // must include Category + Season, not just the Trigger text. Without this, editing
            // AOQ on one season's "KNIT" row silently overwrote every other season's "KNIT" rows
            // too (confirmed: a SU27 row was showing SP27's AOQ date because of exactly this).
            const getDropKey = (r: EmbellishmentRow): string => {
              const col2Val = String(r.col2 || "").trim();
              let triggerPart: string;
              if (col2Val && col2Val.toUpperCase() !== "N/A") {
                triggerPart = col2Val.toUpperCase();
              } else {
                const col4Val = String(r.col4 || "").trim();
                const match = col4Val.match(/(\d{1,2}\.\d{1,2}(?:\/\d{1,2}\.\d{1,2})?\s*(?:DROP)?)/i);
                triggerPart = match ? match[1].trim().toUpperCase() : col4Val.toUpperCase();
              }
              const category = String(r.col3 || "").trim().toUpperCase();
              const season = seasonBase(r.col4);
              return `${triggerPart}|||${category}|||${season}`;
            };

            const targetDrop = getDropKey(originalRow);

            if (targetDrop) {
              const newAoqVal = updatedRow.col20;
              const matchingRows = rows.filter((r) => r.is_current !== false && getDropKey(r) === targetDrop);

              if (matchingRows.length > 0) {
                const updatedDropRows = matchingRows.map((r) => ({
                  ...r,
                  col20: newAoqVal,
                }));

                await saveMultipleRows(updatedDropRows);

                const updatedIdsSet = new Set(updatedDropRows.map((r) => r.id));
                setRows((prev) =>
                  prev.map((r) => (updatedIdsSet.has(r.id) ? { ...r, col20: newAoqVal } : r))
                );
                return;
              }
            }
          }

          const updatedInPlaceRow: EmbellishmentRow = {
            ...originalRow,
            ...updatedRow,
            id: originalRow.id,
            shared_id: originalRow.shared_id || originalRow.id,
            version_number: Number(originalRow.version_number) || 1,
            is_current: true,
          };

          // A manual edit (drag/move, Event Status panel, pass/fail, edit modal) — the events it
          // blanks are the user's own clears, so name them for the server's event guard.
          await saveRow(withEventClears(updatedInPlaceRow, originalRow));

          setRows((prev) => {
            return prev.map((r) => (r.id === originalRow.id ? updatedInPlaceRow : r));
          });
        }

      } else {
        const logEntry: AuditLog = {
          id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          timestamp: new Date().toISOString(),
          styleCode: String(String(String(String(updatedRow.col5 || "")))) || "N/A",
          field: "System Row Operations",
          oldValue: "None",
          newValue: "Created new row for Graphic: " + (updatedRow.col7 || "N/A"),
          userRole: currentRole,
        };
        await saveAuditLog(logEntry);
        setAuditLogs((prev) => [logEntry, ...prev]);

        // Treat as new row (v1)
        const newRow = {
          ...updatedRow,
          shared_id: updatedRow.id, // ID is already new
          version_number: 1,
          is_current: true,
        };
        await saveRow(newRow);
        setRows((prev) => [newRow, ...prev]);
      }
    } catch (err) {
      console.error("Error updating row:", err);
      alert("Failed to save changes. Please try again.");
    }
  };

  // Auto-approve rows with C+P SP strike-off comments
  const handleAutoApproveCpSp = async (rowIds: string[]) => {
    try {
      const updatedRows = rows.map(r => {
        if (rowIds.includes(r.id)) {
          return { ...r, col20: 'C+P' };
        }
        return r;
      });

      const rowsToSave = updatedRows.filter(r => rowIds.includes(r.id));

      // Create audit logs for the auto-approval
      const auditLogs: AuditLog[] = rowsToSave.map(r => ({
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        styleCode: String(String(String(String(r.col5 || "")))) || 'N/A',
        field: 'AOQ',
        oldValue: String(rows.find(orig => orig.id === r.id)?.col20 || 'Pending'),
        newValue: 'C+P',
        userRole: currentRole,
      }));

      await saveMultipleRows(rowsToSave);
      if (auditLogs.length > 0) {
        await saveMultipleAuditLogs(auditLogs);
        setAuditLogs(prev => [...auditLogs, ...prev]);
      }

      setRows(updatedRows);
      alert(`Successfully approved ${rowIds.length} C+P SP item(s).`);
    } catch (err) {
      console.error('Error auto-approving C+P SP rows:', err);
      alert('Failed to auto-approve. Please try again.');
    }
  };

  // Delete a single row & log it
  const handleDeleteRow = async (id: string) => {
    try {
      if (id.startsWith("draft_")) {
        const updatedDrafts = draftRows.filter((r) => r.id !== id);
        setDraftRows(updatedDrafts);
        localStorage.setItem(
          `drafts_${currentRole}`,
          JSON.stringify(updatedDrafts),
        );
        return;
      }

      const originalRow = rows.find((r) => r.id === id);
      if (originalRow) {
        const logEntry: AuditLog = {
          id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          timestamp: new Date().toISOString(),
          styleCode: String(String(String(String(originalRow.col5 || "")))) || "N/A",
          field: "System Row Operations",
          oldValue: "Active style: " + (originalRow.col5 || "N/A"),
          newValue: "Deleted style: " + (originalRow.col5 || "N/A"),
          userRole: currentRole,
        };
        await saveAuditLog(logEntry);
        setAuditLogs((prev) => [logEntry, ...prev]);
      }

      await deleteRow(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error("Error deleting row:", err);
      alert("Failed to delete row.");
    }
  };

  // Delete multiple rows (bulk action)
  const handleDeleteMultipleRows = async (ids: string[]) => {
    try {
      // Filter out and delete local drafts
      const draftIds = ids.filter((id) => id.startsWith("draft_"));
      const dbIds = ids.filter((id) => !id.startsWith("draft_"));

      if (draftIds.length > 0) {
        const updatedDrafts = draftRows.filter((r) => !draftIds.includes(r.id));
        setDraftRows(updatedDrafts);
        localStorage.setItem(
          `drafts_${currentRole}`,
          JSON.stringify(updatedDrafts),
        );
      }

      for (const id of dbIds) {
        const originalRow = rows.find((r) => r.id === id);
        if (originalRow) {
          const logEntry: AuditLog = {
            id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            timestamp: new Date().toISOString(),
            styleCode: String(String(String(String(originalRow.col5 || "")))) || "N/A",
            field: "System Row Operations",
            oldValue: "Active style: " + (originalRow.col5 || "N/A"),
            newValue:
              "Deleted style (Bulk Action): " + (originalRow.col5 || "N/A"),
            userRole: currentRole,
          };
          await saveAuditLog(logEntry);
          setAuditLogs((prev) => [logEntry, ...prev]);
        }
        await deleteRow(id);
      }
      setRows((prev) => prev.filter((r) => !dbIds.includes(r.id)));
    } catch (err) {
      console.error("Error deleting rows:", err);
      alert("Failed to delete selected rows.");
    }
  };


  // Duplicate a row & log it
  const handleDuplicateRow = async (originalRow: EmbellishmentRow) => {
    try {
      const copyStyle = originalRow.col5
        ? `${originalRow.col5}-COPY`
        : "NEW-STYLE";
      const duplicatedRow: EmbellishmentRow = {
        ...originalRow,
        id: `row_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        col5: copyStyle, // Append -COPY to style name
      };

      const logEntry: AuditLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        styleCode: copyStyle,
        field: "System Row Operations",
        oldValue: "Original style: " + (originalRow.col5 || "N/A"),
        newValue: "Duplicated to style: " + copyStyle,
        userRole: currentRole,
      };
      await saveAuditLog(logEntry);
      setAuditLogs((prev) => [logEntry, ...prev]);

      await saveRow(duplicatedRow);

      // Insert duplicate row right after the original row in state
      setRows((prev) => {
        const index = prev.findIndex((r) => r.id === originalRow.id);
        const copy = [...prev];
        copy.splice(index + 1, 0, duplicatedRow);
        return copy;
      });
    } catch (err) {
      console.error("Error duplicating row:", err);
      alert("Failed to duplicate row.");
    }
  };

  // Force a full replan of a row WITHOUT changing any of its data — for cases like a C+P
  // (Correct and Process) or Resubmission where the fabric/plant/technique etc. are staying
  // exactly the same, but the schedule itself needs to start over from scratch.
  //
  // This deliberately does NOT go through handleUpdateRow's isPlanningChange diff — that check
  // only fires a replan when a tracked field's VALUE actually changes, which by definition never
  // happens here (nothing about the item is changing, only the plan). So this bypasses that
  // check entirely and always versions + reschedules, exactly like the Ground-color-changed path
  // does, but explicitly starting from today (not "next working day fallback") since a C+P/
  // Resubmit replan is meant to restart right away.
  // "New Version": the item is being re-developed with a different Application Form / Fabric /
  // Plant after it was already planned and submitted. The current row is archived EXACTLY as it is
  // (every planning event, plant and submission detail kept — visible in Revision History and still
  // counted for its plant in Plant Performance), and version N+1 starts from the edited fields with
  // a fresh plan from the chosen start date. Unlike Replan (handleForceReplan), the planner edits
  // the development fields first, picks the start date, and can reset submission tracking.
  const TRACKING_KEYS_FOR_NEW_VERSION = [
    "col22", "col24", "col34", "col35", "col40", "col41", "col42",
    "awb1", "awb2", "awb1Date", "awb2Date", "dropDate",
  ];
  const handleCreateNewVersion = async (originalRow: EmbellishmentRow, input: NewVersionInput) => {
    try {
      const archivedOldRow: EmbellishmentRow = { ...originalRow, is_current: false };

      const base: EmbellishmentRow = { ...originalRow };
      Object.keys(base).forEach((k) => {
        if (/^\d{4}-\d{2}-\d{2}(_.*)?$/.test(k) || k.startsWith("_leg_")) {
          (base as Record<string, unknown>)[k] = "";
        }
      });
      if (input.clearTracking) {
        TRACKING_KEYS_FOR_NEW_VERSION.forEach((k) => {
          if (k in base) (base as Record<string, unknown>)[k] = "";
        });
        Object.keys(base).forEach((k) => {
          if (k.startsWith("nycv:")) (base as Record<string, unknown>)[k] = "";
        });
        // col20 doubles as the AOQ date — only clear it when it holds an approval VERDICT.
        if (/approv|reject|resubmit|c\s*\+\s*p|drop|hold/i.test(String(base.col20 || ""))) base.col20 = "";
      }

      const newVersionBase: EmbellishmentRow = {
        ...base,
        col15: input.col15.trim(),
        col27: input.col27.trim(),
        col13: input.col13.trim(),
        col11: input.col11.trim(),
        col12: input.col12.trim(),
        id: `row_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        shared_id: originalRow.shared_id || originalRow.id,
        version_number: (Number(originalRow.version_number) || 1) + 1,
        is_current: true,
        change_reason: input.reason.trim(),
        changed_date: new Date().toISOString(),
      };

      const newVersion = autoScheduleEmbellishmentRow(
        newVersionBase,
        undefined,
        input.startDate,
      ) as EmbellishmentRow;
      const producedDates = Object.keys(newVersion).some(
        (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && String((newVersion as Record<string, unknown>)[k] || "").trim(),
      );
      if (!producedDates) {
        alert(
          "Can't build a plan for the new version — it needs both a Plant and an S-Off Requirement. " +
          "Fill those in and try again. Nothing was changed.",
        );
        return;
      }
      newVersion.col47 = derivePlanStatus(newVersion as unknown as Record<string, unknown>);

      const logEntry: AuditLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        styleCode: String(originalRow.col5 || "N/A"),
        field: "System Row Operations",
        oldValue: `v${Number(originalRow.version_number) || 1} archived (App Form: ${originalRow.col15 || "-"}, Fabric: ${originalRow.col13 || "-"})`,
        newValue: `v${newVersion.version_number} planned from ${input.startDate} (App Form: ${newVersion.col15 || "-"}, Fabric: ${newVersion.col13 || "-"}) — ${input.reason.trim()}`,
        userRole: currentRole,
      };

      await saveMultipleRows([archivedOldRow, newVersion]);
      await saveAuditLog(logEntry);

      setRows((prev) => prev.filter((r) => r.id !== originalRow.id).concat(newVersion));
      setArchivedRows((prev) => [...prev.filter((r) => r.id !== originalRow.id), archivedOldRow]);
      setAuditLogs((prev) => [logEntry, ...prev]);
      setNewVersionRow(null);
    } catch (err) {
      console.error("Error creating new version:", err);
      alert("Failed to create the new version. Nothing was changed.");
    }
  };

  const handleForceReplan = async (rowId: string) => {
    try {
      const originalRow = rows.find((r) => r.id === rowId);
      if (!originalRow) return;

      const reason = window.prompt(
        "Reason for replanning (e.g. C+P / Resubmission)?",
        "C+P / Resubmission — replanned from beginning",
      );
      if (reason === null) return; // cancelled
      if (!reason.trim()) {
        alert("Please provide a reason for the replan.");
        return;
      }

      // Archive the current version as-is — its data and dates stay exactly as they were,
      // just marked no longer current (see displayedRows: archived versions still show in the
      // main table for history, they're only excluded from Advanced Analytics rollups).
      const archivedOldRow: EmbellishmentRow = { ...originalRow, is_current: false };

      // New version starts from the SAME data, dates wiped so autoScheduleEmbellishmentRow
      // computes a completely fresh plan instead of layering on top of the old one. Set to ""
      // rather than deleting — see the identical note above; harmless here since this becomes a
      // brand-new row id with nothing stored yet to merge against, but kept consistent so this
      // "wipe dates" pattern is safe wherever it's copied to next.
      const cleanRow: EmbellishmentRow = { ...originalRow };
      Object.keys(cleanRow).forEach((k) => {
        if (k.match(/^\d{4}-\d{2}-\d{2}(_.*)?$/) || k.startsWith("_leg_")) {
          (cleanRow as Record<string, unknown>)[k] = "";
        }
      });

      const newVersionRowBase: EmbellishmentRow = {
        ...cleanRow,
        id: `row_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        shared_id: originalRow.shared_id || originalRow.id,
        version_number: (Number(originalRow.version_number) || 1) + 1,
        is_current: true,
        change_reason: reason.trim(),
        changed_date: new Date().toISOString(),
      };

      const todayISO = new Date().toISOString().split("T")[0];
      const newVersionRow = autoScheduleEmbellishmentRow(
        newVersionRowBase,
        undefined,
        todayISO,
      ) as EmbellishmentRow;

      // The scheduler only projects a plan when the row has complete allocation data — a real
      // Plant (col11) AND a real S-Off Requirement (col27). Without them it returns the row with
      // no date keys, so a replan looks like it silently did nothing. Tell the planner why.
      const producedDates = Object.keys(newVersionRow).some(
        (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && String((newVersionRow as Record<string, unknown>)[k] || "").trim(),
      );
      if (!producedDates) {
        alert(
          "Can't build a plan for this row yet — it needs both a Plant and an S-Off Requirement " +
          "filled in (Process and Application Form help pick the right flow). Open the row's " +
          "details, complete those fields, then replan.",
        );
        return;
      }

      const logEntry: AuditLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        styleCode: String(originalRow.col5 || "N/A"),
        field: "System Row Operations",
        oldValue: `v${Number(originalRow.version_number) || 1} archived`,
        newValue: `v${newVersionRow.version_number} replanned from today — ${reason.trim()}`,
        userRole: currentRole,
      };

      await saveMultipleRows([archivedOldRow, newVersionRow]);
      await saveAuditLog(logEntry);

      setRows((prev) =>
        prev.map((r) => (r.id === originalRow.id ? archivedOldRow : r)).concat(newVersionRow),
      );
      setAuditLogs((prev) => [logEntry, ...prev]);
    } catch (err) {
      console.error("Error force-replanning row:", err);
      alert("Failed to replan row.");
    }
  };

  // First half of the "replan from a chosen date" flow (Table.tsx's calendar-icon Actions
  // button): wipes every YYYY-MM-DD event cell already on the row, in place — no archiving, no
  // new version, unlike handleForceReplan above. Table.tsx then puts the row into "pick a date"
  // mode so the next date cell the user clicks on that row becomes the new plan's start date
  // (see handleSetPlanStartDate).
  // `legPlant` — a cross-dev split's individual plant leg (e.g. "LEEMA"). When given, ONLY that
  // leg's own dated keys ("2026-09-01_LEEMA") are wiped and the leg is marked as diverged
  // ("_leg_LEEMA" = "1") so it stops mirroring the shared plan — the other legs and the shared
  // (bare-key) schedule are left untouched. When omitted, the whole row is cleared.
  //
  // A graphic can carry more than one planning cycle (planned in Sept, finished in Dec, then
  // re-planned in Jan for the same thing). detectPlanCycles splits the row's events into those
  // cycles; when there's more than one and no single leg was targeted, the planner is asked which
  // cycle to clear (or all) so an old-but-still-wanted cycle isn't lost.
  //
  // Returns true when something was actually cleared (Table.tsx then arms "pick a new start
  // date"), false when the planner cancelled the prompt / there was nothing to clear.
  const handleClearRowPlan = async (rowId: string, legPlant?: string): Promise<boolean> => {
    try {
      const originalRow = rows.find((r) => r.id === rowId);
      if (!originalRow) return false;

      // Set to "" rather than deleting the key — this row keeps its EXISTING id, and the server
      // merges a save's schedule fields onto whatever it already has stored for that id (see
      // server/db.js) rather than replacing it outright, so a deleted (i.e. absent) key here just
      // means "leave the old date alone" to the database, not "clear it".
      const clearedRow: EmbellishmentRow = { ...originalRow };
      let clearedSummary = "Cleared — awaiting a new start date";

      if (legPlant) {
        const esc = legPlant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const legRe = new RegExp(`^\\d{4}-\\d{2}-\\d{2}_${esc}$`);
        Object.keys(clearedRow).forEach((k) => {
          if (legRe.test(k)) (clearedRow as Record<string, unknown>)[k] = "";
        });
        (clearedRow as Record<string, unknown>)[`_leg_${legPlant}`] = "1";
        clearedSummary = `Cleared ${legPlant}'s schedule — awaiting a new start date`;
      } else {
        const cycles = detectPlanCycles(originalRow as unknown as Record<string, unknown>);
        let keysToClear: Set<string> | null = null; // null => clear everything

        if (cycles.length > 1) {
          const menu = cycles
            .map((c, i) => `  ${i + 1})  events from ${c.startKey} to ${c.endKey}  (${c.count} event${c.count === 1 ? "" : "s"})`)
            .join("\n");
          const allOption = cycles.length + 1;
          const answer = window.prompt(
            `This item has ${cycles.length} separate planning runs:\n\n${menu}\n  ${allOption})  ALL of them\n\n` +
              `Type the number of the run to delete (only that run's events go — the rest stay):`,
            String(cycles.length), // default to the newest run — usually the one just added
          );
          if (answer === null) return false; // cancelled
          const n = parseInt(answer.trim(), 10);
          if (isNaN(n) || n < 1 || n > allOption) {
            alert("That wasn't one of the listed numbers — nothing was cleared.");
            return false;
          }
          if (n <= cycles.length) {
            keysToClear = new Set(cycles[n - 1].keys);
            clearedSummary = `Cleared planning run ${n} of ${cycles.length} (${cycles[n - 1].startKey} → ${cycles[n - 1].endKey})`;
            // Safety net: if detection lumped everything into the picked run, don't silently wipe
            // the whole plan without saying so.
            const totalEventKeys = Object.keys(originalRow).filter(
              (k) => /^\d{4}-\d{2}-\d{2}(_.*)?$/.test(k) && String(originalRow[k] ?? "").trim() !== "",
            ).length;
            if (
              keysToClear.size >= totalEventKeys &&
              !window.confirm(
                "Heads up: that run covers every planning event on this item, so this will clear the whole plan. Continue?",
              )
            ) {
              return false;
            }
          } else {
            clearedSummary = "Cleared all planning runs — awaiting a new start date";
          }
        } else if (cycles.length === 1) {
          if (
            !window.confirm(
              "Clear all planning events for this item? You'll then click a date to set the new start date.",
            )
          ) {
            return false;
          }
        }

        // A split row stores most plants' events under a plant-suffixed key ("2026-08-31_BABL"),
        // not a plain one — clear both the bare and the "_PLANT" forms. Per-leg divergence
        // markers are only dropped on a full wipe (a single cycle's clear leaves the legs as-is).
        Object.keys(clearedRow).forEach((k) => {
          if (k.match(/^\d{4}-\d{2}-\d{2}(_.*)?$/)) {
            if (!keysToClear || keysToClear.has(k)) {
              (clearedRow as Record<string, unknown>)[k] = "";
            }
          } else if (k.startsWith("_leg_") && !keysToClear) {
            (clearedRow as Record<string, unknown>)[k] = "";
          }
        });
      }

      await saveRow(withEventClears(clearedRow, originalRow));
      setRows((prev) => prev.map((r) => (r.id === rowId ? clearedRow : r)));

      const logEntry: AuditLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        styleCode: String(originalRow.col5 || "N/A"),
        field: "System Row Operations",
        oldValue: "Existing planning schedule",
        newValue: clearedSummary,
        userRole: currentRole,
      };
      await saveAuditLog(logEntry);
      setAuditLogs((prev) => [logEntry, ...prev]);
      return true;
    } catch (err) {
      console.error("Error clearing row plan:", err);
      alert("Failed to clear planning events for this row.");
      return false;
    }
  };

  // Second half of the same flow: the user just clicked a date cell on a row that was awaiting
  // its new start date. Anchors the auto-planning chain's first event on that exact date and
  // projects the rest forward using the same auto-planning logic used everywhere else
  // (autoScheduleEmbellishmentRow) — same data, updated in place, no new version.
  //
  // ADDITIVE: events already scheduled before the picked start date are treated as an earlier
  // planning cycle and kept untouched — only the picked date onward is (re)built. So the same
  // graphic can be planned Sept–Dec, then re-planned again from January without losing the first
  // run. `flowId` (optional) forces a specific PLANNING_FLOWS pathway instead of auto-detecting
  // it — used by the Event Status panel's "Apply a planning flow" picker.
  const handleSetPlanStartDate = async (
    rowId: string,
    startDateKey: string,
    legPlant?: string,
    flowId?: number,
  ) => {
    try {
      const originalRow = rows.find((r) => r.id === rowId);
      if (!originalRow) return;

      let outRow: EmbellishmentRow;

      if (legPlant) {
        // Per-plant-leg replan: schedule THIS leg as a single plant doing the full embellishment
        // (not a stage of the combined chain), off a copy with every dated key stripped so it's a
        // fresh plan from the picked date. Then write it onto the leg's own suffixed keys only and
        // mark the leg diverged — the other legs + the shared plan are left alone.
        const bareInput: Record<string, unknown> = {
          ...originalRow,
          col11: legPlant,
          col12: legPlantFlow(originalRow.col12, legPlant),
        };
        Object.keys(bareInput).forEach((k) => {
          if (/^\d{4}-\d{2}-\d{2}(_.*)?$/.test(k)) delete bareInput[k];
        });
        const scheduled = autoScheduleEmbellishmentRow(bareInput, flowId, startDateKey) as Record<string, unknown>;
        const producedDates = Object.keys(scheduled).some(
          (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && String(scheduled[k] || "").trim(),
        );
        if (!producedDates) {
          alert(
            "Can't build a plan for this row yet — it needs both a Plant and an S-Off Requirement " +
            "filled in. Open the row's details, complete those fields, then replan.",
          );
          return;
        }
        const esc = legPlant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const legRe = new RegExp(`^\\d{4}-\\d{2}-\\d{2}_${esc}$`);
        outRow = { ...originalRow, [`_leg_${legPlant}`]: "1" } as EmbellishmentRow;
        Object.keys(outRow).forEach((k) => {
          if (legRe.test(k)) (outRow as Record<string, unknown>)[k] = "";
        });
        Object.keys(scheduled).forEach((k) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(k) && String(scheduled[k] || "").trim()) {
            (outRow as Record<string, unknown>)[`${k}_${legPlant}`] = scheduled[k];
          }
        });
        // Lock this leg's opening milestone to the picked day (see the whole-row branch below).
        const legOpener = parseEventValue(String(scheduled[startDateKey] ?? ""));
        if (legOpener && legOpener.status === "planned" && !legOpener.isPinned) {
          (outRow as Record<string, unknown>)[`${startDateKey}_${legPlant}`] = encodeEventValue(
            legOpener.code,
            "planned",
            undefined,
            true,
          );
        }
      } else {
        // Whole-row replan: autoScheduleEmbellishmentRow anchors on startDateKey, clears its own
        // "-S" pills, and refreshes col14/col23/col28 as it goes.
        //
        // Snapshot a GENUINELY EARLIER, COMPLETED planning cycle so it survives the replan
        // (autoScheduleEmbellishmentRow clears all "-S" pills across the row, so we re-apply
        // these afterward). "Before the picked start date" is NOT enough on its own: a stray
        // "-S" pill from the very plan being replaced (e.g. an FS-S left on an old date by an
        // earlier buggy schedule) also sits before the start, and preserving it strands that
        // milestone weeks away from the rest of the fresh plan. Use detectPlanCycles and keep
        // only a cycle whose ENTIRE span ends before the picked start — a cycle that straddles
        // the start date IS the plan being replaced and must be rebuilt whole. Confirmed against
        // real data: GVU27-200 / 10356691 kept a lone FS-S on 2026-08-28 while its replanned
        // flow ran from 2026-09-09.
        // Carry through ONLY the real Pass/Fail verdicts recorded before the picked start — the
        // things that genuinely happened. Projected "-S" pills from an earlier run are a stale
        // plan the planner is replacing, not history: resurrecting them collides with the fresh
        // plan (duplicate FR -> the load-time heal then drags everything back onto the old dates,
        // the exact bug behind "my events jumped to July").
        const priorCycle: Record<string, string> = {};
        detectPlanCycles(originalRow as unknown as Record<string, unknown>).forEach((cyc) => {
          if (cyc.endKey >= startDateKey) return;
          cyc.keys.forEach((k) => {
            const raw = String((originalRow as Record<string, unknown>)[k] ?? "").trim();
            if (!raw) return;
            const p = parseEventValue(raw);
            if (p && p.status !== "planned") priorCycle[k] = raw;
          });
        });
        const keepLegMarker = new Set(
          (Object.keys(priorCycle)
            .map((k) => k.match(/^\d{4}-\d{2}-\d{2}_(.+)$/)?.[1])
            .filter(Boolean) as string[]),
        );

        const scheduledRow = autoScheduleEmbellishmentRow(
          { ...originalRow },
          flowId,
          startDateKey,
        ) as EmbellishmentRow;
        const producedDates = Object.keys(scheduledRow).some(
          (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && String((scheduledRow as Record<string, unknown>)[k] || "").trim(),
        );
        if (!producedDates) {
          alert(
            "Can't build a plan for this row yet — it needs both a Plant and an S-Off Requirement " +
            "filled in. Open the row's details, complete those fields, then replan.",
          );
          return;
        }
        // Wipe any lingering per-leg schedule ("2026-..._LEEMA") from the picked start onward, and
        // divergence markers, so every leg mirrors the fresh shared plan — but keep the earlier
        // cycle's per-leg events and their markers intact.
        Object.keys(scheduledRow).forEach((k) => {
          const m = k.match(/^(\d{4}-\d{2}-\d{2})_.+$/);
          if (m && m[1] >= startDateKey) {
            (scheduledRow as Record<string, unknown>)[k] = "";
          } else if (k.startsWith("_leg_") && !keepLegMarker.has(k.slice("_leg_".length))) {
            (scheduledRow as Record<string, unknown>)[k] = "";
          }
        });
        // Re-apply the earlier planning cycle.
        Object.entries(priorCycle).forEach(([k, v]) => {
          (scheduledRow as Record<string, unknown>)[k] = v;
        });

        // LOCK the opening milestone to the exact day the planner picked ("|X"). The planner
        // explicitly said "start planning here" — so this date must not be re-derived or moved by
        // the load-time heal on the next reload (which is why the picked plan kept vanishing).
        // Downstream "-S" milestones stay auto-managed.
        const openerVal = String((scheduledRow as Record<string, unknown>)[startDateKey] ?? "").trim();
        const openerParsed = openerVal ? parseEventValue(openerVal) : null;
        if (openerParsed && openerParsed.status === "planned" && !openerParsed.isPinned) {
          (scheduledRow as Record<string, unknown>)[startDateKey] = encodeEventValue(
            openerParsed.code,
            "planned",
            undefined,
            true,
          );
        }
        outRow = scheduledRow;
      }

      await saveRow(withEventClears(outRow, originalRow));
      setRows((prev) => prev.map((r) => (r.id === rowId ? outRow : r)));

      const logEntry: AuditLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        styleCode: String(originalRow.col5 || "N/A"),
        field: "System Row Operations",
        oldValue: "",
        newValue: legPlant
          ? `Replanned ${legPlant} starting ${startDateKey}`
          : `Replanned starting ${startDateKey}`,
        userRole: currentRole,
      };
      await saveAuditLog(logEntry);
      setAuditLogs((prev) => [logEntry, ...prev]);
    } catch (err) {
      console.error("Error setting plan start date:", err);
      alert("Failed to auto-schedule from the selected date.");
    }
  };

  // Add a new empty row & log it
  const handleAddRow = async () => {
    try {
      const isTeam = currentRole.startsWith("Team");
      if (isTeam) {
        // Create a completely blank draft row
        const newDraftRow: EmbellishmentRow = {
          id: `draft_${Date.now()}`,
          // Hand-created row — imports never merge into it (see processImportFile). Carried through
          // to the published row by handlePublishRow's spread of the draft.
          manual_entry: "1",
        };
        // Initialize all col1 to col33 with empty strings
        for (let i = 1; i <= 33; i++) {
          newDraftRow[`col${i}`] = "";
        }

        const updatedDrafts = [newDraftRow, ...draftRows];
        setDraftRows(updatedDrafts);
        localStorage.setItem(
          `drafts_${currentRole}`,
          JSON.stringify(updatedDrafts),
        );
        return;
      }

      // A genuinely blank planning row — every column empty except the three status fields, which
      // stay "Active" so the row is visible under the default Active filter instead of vanishing
      // the moment it's created. The planner fills in Style/Graphic/Plant/etc. by hand (or via an
      // allocation chart) afterwards.
      const rowId = `row_${Date.now()}`;
      const newRow: EmbellishmentRow = {
        id: rowId,
        shared_id: rowId,
        version_number: 1,
        is_current: true,
        // Marks this as a hand-created row. Tracking-chart / Excel imports only merge into a
        // manual row as a last resort — when no imported row matches (see isManualRow in
        // processImportFile).
        manual_entry: "1",
      };
      for (let i = 1; i <= 35; i++) {
        newRow[`col${i}`] = "";
      }
      newRow.col1 = "Active"; // Status
      newRow.col20 = "Active"; // AOQ
      newRow.col33 = "Active"; // Approved Status
      if (selectedGraphicFilter) newRow.col7 = selectedGraphicFilter; // pre-fill current graphic filter if any

      const generatedStyle = String(newRow.col5 || "(blank)");

      const logEntry: AuditLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        styleCode: generatedStyle,
        field: "System Row Operations",
        oldValue: "",
        newValue: "Created new blank planning row (manual entry)",
        userRole: currentRole,
      };
      await saveAuditLog(logEntry);
      setAuditLogs((prev) => [logEntry, ...prev]);

      await saveRow(newRow);
      setRows((prev) => [newRow, ...prev]); // Add to the top
    } catch (err) {
      console.error("Error adding row:", err);
      alert("Failed to create new row.");
    }
  };

  // Publish a draft row to the database
  const handlePublishRow = async (draftRow: EmbellishmentRow) => {
    try {
      const generatedStyle = `ST-${Math.floor(1000 + Math.random() * 9000)}`;
      const updatedRow: EmbellishmentRow = {
        ...draftRow,
        id: `row_${Date.now()}`, // Give it a real DB row id
        team_owner: currentRole, // Stamp ownership — only this team + Planner will see it
        // Ensure defaults if blank
        col1: draftRow.col1 || "Active",
        col2: draftRow.col2 || `Bulk-${Math.floor(100 + Math.random() * 900)}`,
        col3: draftRow.col3 || "T-Shirt",
        col4: draftRow.col4 || "Fall 2026",
        col5: draftRow.col5 || generatedStyle,
        col11: draftRow.col11 || "Plant A",
        col12: draftRow.col12 || "In-House",
        col17: draftRow.col17 || "LOW",
        col20: draftRow.col20 || "Active",
        col29: draftRow.col29 || "NO",
        col30: draftRow.col30 || "NO",
        col31: draftRow.col31 || "NO",
        col33: draftRow.col33 || "Active",
      };

      // Save to database
      await saveRow(updatedRow);

      // Create Audit Log
      const logEntry: AuditLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        styleCode: String(String(String(String(updatedRow.col5 || "")))),
        field: "System Row Operations",
        oldValue: "Draft",
        newValue: `Published team draft row: ${updatedRow.col5} (${currentRole})`,
        userRole: currentRole,
      };
      await saveAuditLog(logEntry);
      setAuditLogs((prev) => [logEntry, ...prev]);

      // Remove from drafts state and localStorage
      const updatedDrafts = draftRows.filter((r) => r.id !== draftRow.id);
      setDraftRows(updatedDrafts);
      localStorage.setItem(
        `drafts_${currentRole}`,
        JSON.stringify(updatedDrafts),
      );

      // Refresh ALL rows from DB so Planner immediately sees this and all other teams' published rows
      await refreshRows();

      alert(`Successfully published row ${updatedRow.col5} to database!`);
    } catch (err) {
      console.error("Error publishing row:", err);
      alert("Failed to publish row to database.");
    }
  };

  // Save customized columns
  const handleSaveColumns = async (updatedCols: ColumnMapping) => {
    try {
      await saveColumns(updatedCols);
      setColumns(updatedCols);

      const logEntry: AuditLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        styleCode: "SYSTEM",
        field: "Column Mapping",
        oldValue: "Configured columns mapping schema",
        newValue: "Customized columns mapping header names",
        userRole: currentRole,
      };
      await saveAuditLog(logEntry);
      setAuditLogs((prev) => [logEntry, ...prev]);
    } catch (err) {
      console.error("Error saving columns:", err);
      alert("Failed to save column headers.");
    }
  };

  // Wipe database completely to clear all stored rows before re-importing
  const handleResetDatabase = async () => {
    if (
      window.confirm(
        "Are you sure you want to clear the entire database? All stored rows will be deleted from backend storage so you can re-import your Excel file cleanly.",
      )
    ) {
      try {
        setIsLoading(true);
        // Snapshot everything before wiping it, so this can be undone from Backup History.
        try {
          await createBackup(`Before clearing database`, rows, "clear");
        } catch (backupErr) {
          console.error("Pre-clear backup failed:", backupErr);
          const proceedAnyway = window.confirm(
            "Could not save a safety backup before clearing (backend may be unreachable). " +
              "Continuing means this CANNOT be undone.\n\nContinue anyway?"
          );
          if (!proceedAnyway) {
            setIsLoading(false);
            return;
          }
        }
        await clearDatabase();
        setRows([]);
        setSearchQuery("");
        setSelectedGraphicFilter("");
        alert("Database cleared successfully! A backup was saved first, so you can restore it from Backup History if needed. You can now click 'Import / Update' to re-import your Excel file.");
      } catch (err) {
        console.error("Error clearing database:", err);
        alert("Failed to clear database.");
      } finally {
        setIsLoading(false);
      }
    }
  };

  // Reset all audit trail logs
  const handleClearAuditLogs = async () => {
    try {
      await clearAuditLogs();
      setAuditLogs([]);
    } catch (err) {
      console.error("Failed to clear logs:", err);
      alert("Could not clear audit trail logs.");
    }
  };

  // Export to CSV helper
  // Import JSON helper
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);

        if (!Array.isArray(parsed)) {
          throw new Error("Import data must be a JSON array of rows.");
        }

        const isValid = parsed.every(
          (item) => typeof item === "object" && item !== null && "id" in item,
        );

        if (!isValid) {
          throw new Error(
            "Invalid row formats. Each item must have a unique 'id' field.",
          );
        }

        if (
          window.confirm(
            `Found ${parsed.length} rows.\n\n` +
              `✅ SAFE MERGE IMPORT: Existing rows will be UPDATED or NEW rows ADDED.\n` +
              `❌ No rows will be deleted.\n\n` +
              `Do you want to proceed?`,
          )
        ) {
          setIsLoading(true);
          await saveMultipleRows(parsed);
          const loadedRows = await getAllRows();
          setRows(loadedRows);

          const logEntry: AuditLog = {
            id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            timestamp: new Date().toISOString(),
            styleCode: "SYSTEM",
            field: "JSON Import",
            oldValue: "Previous workspace content",
            newValue: `Safe-merged JSON import containing ${parsed.length} rows`,
            userRole: currentRole,
          };
          await saveAuditLog(logEntry);
          setAuditLogs((prev) => [logEntry, ...prev]);

          alert("Import successful!");
        }
      } catch (err) {
        console.error("JSON Import failed:", err);
        const errorMessage =
          err instanceof Error ? err.message : "Invalid file format.";
        alert(`Failed to import JSON: ${errorMessage}`);
      } finally {
        setIsLoading(false);
        e.target.value = ""; // clear file input
      }
    };
    reader.readAsText(file);
  };

  // Import Excel / CSV helper with Interactive Preview Modal. isPlanningSheetImport forces
  // skipNewRows on for the whole import (see the "Import Planning Sheet" sidebar button); isCkImport
  // marks the whole import as a CK Tracking Chart (see the "CK Tracking Chart" sidebar button and
  // the "Sync CK Charts" header button) — this one file-reading/parsing path is shared by all
  // buttons, only these flags differ. ckCategoryOverride, when given, is the exact CK category
  // ("CKNA Men's" / "CKNA Women's" / "CKP" / "Other Knit") the sync already resolved from the file
  // name; otherwise a CK import derives it from the file name itself, falling back to bare "CK".
  // A tracking-chart DHL date turns the row's planned NY green only when it's within this many
  // calendar days of that planned NY (planned 9/28: DHL 9/25 or 9/30 -> green; DHL 9/9 -> not).
  const DHL_NY_MATCH_MAX_DAYS = 5;

  const handleImportExcel = (
    e: React.ChangeEvent<HTMLInputElement>,
    isPlanningSheetImport = false,
    isCkImport = false,
    ckCategoryOverride?: string,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ckCategory = isCkImport
      ? (ckCategoryOverride || ckCategoryFromFilename(file.name) || "CK")
      : undefined;

    // A second import started while an earlier one is still writing to the database would parse
    // this file's matches against a `rows` snapshot that predates the first import's changes —
    // any field the first import just set (a comment, a status, anything) that this file's own
    // row leaves blank would then get silently reverted when this import's blank-tolerant merge
    // writes back its stale copy. Confirmed as a real incident: the exact same file imported
    // twice ~70s apart reverted 3 rows' "APPROVED FOR COLOR" comments back to blank. Block a new
    // import outright until the current one finishes instead of racing it.
    if (isImportSyncingRef.current) {
      window.alert(
        "An import is still being saved to the database. Please wait for it to finish before starting another import.",
      );
      e.target.value = "";
      return;
    }

    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        const workbook = XLSX.read(buffer, { type: "array", codepage: 65001 });
        const allSheets = workbook.SheetNames;

        const keywordMatchedSheets = allSheets.filter((name) => {
          const upper = name.trim().toUpperCase();
          return (
            (upper.includes("BRANDIX") || upper.includes("STANDARD FORMAT") || upper.includes("PLAN")) &&
            !upper.includes("SUMMARY") &&
            !upper.includes("PIVOT") &&
            !upper.includes("MASTER")
          );
        });
        // A file whose sheet(s) don't happen to be named with one of those keywords (confirmed
        // against a real file: a plain, unrenamed "Sheet1") used to leave defaultSheets totally
        // empty — which pre-checks NOTHING in the Import Config dialog's sheet list, so unless the
        // user notices and manually ticks the box, the import silently reads zero rows from a
        // fully valid file (Total Rows: 0, no error, easy to miss the empty checkbox is why).
        // Excluding SUMMARY/PIVOT/MASTER sheets only makes sense once at least one other sheet
        // already matched a real-data keyword; with no match at all, falling back to every sheet
        // is safer than defaulting to nothing.
        const defaultSheets = keywordMatchedSheets.length > 0 ? keywordMatchedSheets : allSheets;

        // Preview the headers of whichever sheet import will default to — falls back to the
        // first sheet in the workbook when nothing matched the keyword heuristic above, so the
        // "Detected Column Headers" box in the import dialog is never silently empty.
        const previewSheetName = defaultSheets[0] || allSheets[0];
        let previewHeaders: string[] = [];
        if (previewSheetName) {
          const ws = workbook.Sheets[previewSheetName];
          const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
          
          const headerRow = rows.find(r => {
            if (!r || !Array.isArray(r)) return false;
            const textCells = r.map(c => String(c || "").trim()).filter(Boolean);
            return textCells.length >= 10;
          }) || rows.find(r => {
            if (!r || !Array.isArray(r)) return false;
            const textCells = r.map(c => String(c || "").trim()).filter(Boolean);
            return textCells.length >= 5;
          }) || rows[0] || [];
          
          previewHeaders = headerRow.map(h => String(h || "").trim()).filter(Boolean);
        }

        setPendingImportData({
          file,
          buffer,
          availableSheets: allSheets,
          defaultSheets,
          previewHeaders,
          isPlanningSheetImport,
          isCkImport,
          ckCategory
        });
      } catch (err) {
        console.error("Failed to parse Excel file:", err);
        alert("Failed to read file.");
      } finally {
        setIsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  // Dedicated "Import Planning Sheet" entry point — same parser as Import Excel, but every row
  // it produces is restricted to items that already exist in the database (matched by Graphic +
  // Combo + Style + Ground + Plant). It only ever fills in blanks and planning events on rows the
  // tracking chart already established; it can never create a new item, so the two buttons can't
  // conflict with each other regardless of upload order.
  const handleImportPlanningSheet = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleImportExcel(e, true);
  };

  // Dedicated "CK Tracking Chart" entry point — same parser as Import Excel (creates and updates
  // rows, same as the plain button), but every row it produces has Category forced to "CK" (see
  // processImportFile), which is what routes it onto the S/off Status letter-code status logic
  // instead of the VS/PINK comment-based logic. Keeps that scoping automatic rather than relying
  // on the user picking "CK" in the import dialog by hand.
  const handleImportCkTrackingChart = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleImportExcel(e, false, true);
  };

  // ── CK Charts sync state machine ────────────────────────────────────────
  // Poll the sync folder for changed files so the header button can show an alert.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await getCkChartStatus();
        if (!cancelled) setCkChartStatus(s);
      } catch {
        /* backend down / folder missing — button just won't show an alert */
      }
    };
    poll();
    const id = setInterval(poll, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Feed ONE chart file into the normal import pipeline. Runs from the effect
  // below (never called directly for file N>0) so it always closes over the
  // post-save `rows` state from the previous file.
  const feedCkChartFile = async (
    i: number,
    files: { key: string; label: string; category: string }[],
  ) => {
    try {
      setCkSync((s) => (s ? { ...s, log: [...s.log, `Importing ${files[i].label}…`] } : s));
      const { buffer, fileName } = await fetchCkChartFile(files[i].key);
      // Category comes from the status list (files[i].category), NOT from a response header —
      // CORS hides custom headers from fetch() unless the server explicitly exposes them, and a
      // silently-missing X-CK-Category made every file import as plain "CK".
      const category = files[i].category;
      const workbook = XLSX.read(buffer, { type: "array", codepage: 65001 });
      const allSheets = workbook.SheetNames;
      const sheet = allSheets[0];
      ckAutoConfirmRef.current = false;
      processImportFile(
        {
          file: new File([buffer], fileName || `${files[i].label}.xlsx`, {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          buffer,
          availableSheets: allSheets,
          defaultSheets: [sheet],
          isCkImport: true,
          ckCategory: category,
          ckSyncAuto: true,
        },
        "",
        "",
        [sheet],
        false,
        false,
      );
    } catch (err) {
      setCkSync((s) =>
        s ? { ...s, running: false, log: [...s.log, `✗ ${files[i].label}: ${String(err)}`] } : s,
      );
    }
  };

  // Advance / finish the sequential sync as the index moves.
  useEffect(() => {
    const st = ckSync;
    if (!st || !st.running) return;
    if (st.index >= st.files.length) {
      (async () => {
        try {
          await markCkChartsSynced();
        } catch {
          /* non-fatal — the alert dot just stays until next successful mark */
        }
        try {
          const s = await getCkChartStatus();
          setCkChartStatus(s);
        } catch {
          /* ignore */
        }
        await refreshRows();
        setCkSync((s) =>
          s ? { ...s, running: false, done: true, log: [...s.log, "✓ All charts synced."] } : s,
        );
      })();
      return;
    }
    if (ckSyncFedRef.current === st.index) return;
    ckSyncFedRef.current = st.index;
    feedCkChartFile(st.index, st.files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ckSync?.running, ckSync?.index]);

  // Auto-confirm the import preview modal while a sync is running.
  useEffect(() => {
    if (!ckSync?.running || !importPreviewOpen) return;
    if (isImportSyncingRef.current || ckAutoConfirmRef.current) return;
    ckAutoConfirmRef.current = true;
    if (parsedImportItems.length === 0) {
      // Nothing parsed from this file — skip straight to the next one.
      setImportPreviewOpen(false);
      setCkSync((s) =>
        s
          ? { ...s, index: s.index + 1, log: [...s.log, `• ${s.files[s.index]?.label ?? "file"}: no rows`] }
          : s,
      );
      return;
    }
    handleConfirmImport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importPreviewOpen, parsedImportItems, ckSync?.running]);

  // Kick off a full sync of every chart present in the folder.
  const runCkChartsSync = async () => {
    if (ckSync?.running || isImportSyncingRef.current) return;
    let status: CkChartStatus;
    try {
      status = await getCkChartStatus();
    } catch (err) {
      alert("Could not read the CK charts folder: " + String(err));
      return;
    }
    setCkChartStatus(status);
    const files = status.charts
      .filter((c) => c.present)
      .map((c) => ({ key: c.key, label: c.label, category: c.category }));
    if (files.length === 0) {
      alert(
        "No CK tracking-chart files found in:\n" +
          status.dir +
          "\n\nMake sure the OneDrive folder is synced to that path (set CK_SYNC_DIR in server/.env).",
      );
      return;
    }
    ckSyncFedRef.current = -1;
    setCkSync({
      running: true,
      done: false,
      files,
      index: 0,
      log: [`Starting CK sync — ${files.length} chart${files.length === 1 ? "" : "s"}.`],
    });
  };

  const processImportFile = (
    data: { file: File; buffer: ArrayBuffer; availableSheets: string[]; defaultSheets: string[]; isPlanningSheetImport?: boolean; isCkImport?: boolean; ckCategory?: string; ckSyncAuto?: boolean },
    overrideCategory: string,
    overrideSeason: string,
    selectedSheets: string[],
    skipNewRows: boolean = false,
    skipAutoSchedule: boolean = false,
    // ISO date (yyyy-mm-dd) the user picked in the import dialog. "" = keep the existing
    // behaviour (auto-schedule from the next working day). When set, every row this import
    // auto-schedules or re-schedules starts its planning events from this date instead.
    planStartDate: string = ""
  ) => {
    // A Planning Sheet import ALWAYS runs update-only, regardless of what the config dialog's
    // checkbox says — this is the whole point of that button existing as a separate entry point
    // from Import Excel, so it can never accidentally create new items.
    const effectiveSkipNewRows = skipNewRows || Boolean(data.isPlanningSheetImport);
    setIsLoading(true);

    try {
      const workbook = XLSX.read(data.buffer, {
        type: "array",
        codepage: 65001,
        raw: true,
        cellStyles: true,
      });
      const rawData: Record<string, unknown>[] = [];

      // Small Levenshtein edit distance, used below to recognize a "Reason" column header
      // even when it's misspelled. Confirmed against a real production file: alongside 49
      // correctly-spelled "Reason" headers it also contains "Reaason" and "Reaon" — real
      // fat-finger typos (one extra letter / one missing letter), both edit-distance 1 from
      // "REASON". The old check (`.includes("REASO")`) only catches typos that happen to still
      // contain "REASO" as a contiguous substring — an inserted letter earlier in the word
      // (like "Reaason") breaks that substring and silently fails, losing that column's data
      // entirely instead of just misspelled text.
      const levenshtein = (a: string, b: string): number => {
        const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
          new Array(b.length + 1).fill(0),
        );
        for (let i = 0; i <= a.length; i++) dp[i][0] = i;
        for (let j = 0; j <= b.length; j++) dp[0][j] = j;
        for (let i = 1; i <= a.length; i++) {
          for (let j = 1; j <= b.length; j++) {
            dp[i][j] =
              a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
          }
        }
        return dp[a.length][b.length];
      };
      // Threshold of 2 catches real single-letter-insertion/deletion/substitution typos while
      // staying far enough from unrelated short event codes that also start "REA-" (e.g. "REAP",
      // "REAP/FCHP" — both distance 3+ from "REASON") to never misfire on those.
      const isReasonHeader = (normalizedHeader: string): boolean =>
        levenshtein(normalizedHeader, "REASON") <= 2;

      const targetSheetNames = selectedSheets;

        for (const sheetName of targetSheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
            header: 1,
            defval: "",
          });
          if (!rows || rows.length === 0) continue;

          // Process merged cells and fill down the values to all cells in the merge range
          if (worksheet["!merges"]) {
            worksheet["!merges"].forEach((merge) => {
              const startRow = merge.s.r;
              const startCol = merge.s.c;
              const endRow = merge.e.r;
              const endCol = merge.e.c;

              if (
                rows[startRow] &&
                rows[startRow][startCol] !== undefined &&
                rows[startRow][startCol] !== ""
              ) {
                const value = rows[startRow][startCol];
                for (let r = startRow; r <= endRow; r++) {
                  if (!rows[r]) rows[r] = [];
                  for (let c = startCol; c <= endCol; c++) {
                    // Only fill empty cells to avoid overwriting existing data if any
                    if (rows[r][c] === undefined || rows[r][c] === "") {
                      rows[r][c] = value;
                    }
                  }
                }
              }
            });
          }

          // Flexible header detection by scoring domain keywords in first 40 rows
          const DOMAIN_KEYWORDS = [
            "GRAPHIC",
            "COMBO",
            "SEASON",
            "STYLE",
            "TECHNIQUE",
            "STATUS",
            "VENDOR",
            "APPROVAL",
            "PASS OFF",
            "AWB",
            "TRACKING",
            "GROUND",
            "FABRIC",
            "PLANT",
            "TRIGGER",
            "CATEGORY",
            "ARTWORK",
            "MILL",
          ];

          let bestHeaderRowIndex = -1;
          let maxMatchScore = 0;

          for (let i = 0; i < Math.min(40, rows.length); i++) {
            const rowStr = (rows[i] || []).join(" ").toUpperCase();
            let score = 0;
            DOMAIN_KEYWORDS.forEach((kw) => {
              if (rowStr.includes(kw)) score += 2;
            });
            // Anchor bonus for core template column headers (Season + Graphic/Combo + Style/Flex/Technique)
            if (
              rowStr.includes("SEASON") &&
              (rowStr.includes("GRAPHIC") || rowStr.includes("COMBO")) &&
              (rowStr.includes("FLEX") ||
                rowStr.includes("STYLE") ||
                rowStr.includes("TECHNIQUE"))
            ) {
              score += 50;
            }
            if (score > maxMatchScore && score >= 2) {
              maxMatchScore = score;
              bestHeaderRowIndex = i;
            }
          }

          if (bestHeaderRowIndex === -1) continue;

          const headerRowIndex = bestHeaderRowIndex;
          const headers: string[] = [];
          
          // Find max columns across the anchor row and 5 rows above it
          let maxCols = 0;
          for (let r = Math.max(0, headerRowIndex - 5); r <= headerRowIndex; r++) {
            maxCols = Math.max(maxCols, (rows[r] || []).length);
          }

          // For each column, check the anchor header row first; fall back to merged rows above if empty
          for (let c = 0; c < maxCols; c++) {
            let headerText = String((rows[headerRowIndex] || [])[c] || "").trim();
            if (!headerText) {
              const colParts: string[] = [];
              for (let r = Math.max(0, headerRowIndex - 5); r < headerRowIndex; r++) {
                const text = String((rows[r] || [])[c] || "").trim();
                if (text) colParts.push(text);
              }
              headerText = colParts.join(" ").trim();
            }
            headers.push(headerText);
          }
          console.log("EXTRACTED HEADERS:", JSON.stringify(headers));

          // Legacy planning files record why a specific date's event failed in a plain "Reason"
          // column placed immediately after that date's own column — but every one of those
          // columns is headered with the exact same literal text "Reason" (a file can have 50+
          // of them). Building the row object below keyed by header text would collide every
          // "Reason" column into one key and silently drop all but the last, so pair each date
          // column with its Reason column POSITIONALLY here, before that collision can happen.
          const looksLikeDateHeader = (h: string): boolean =>
            /^\d{4,6}(\.\d+)?$/.test(h) ||
            /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(h) ||
            /^\d{4}-\d{1,2}-\d{1,2}$/.test(h);
          const reasonColIdxForDateCol = new Map<number, number>(); // date col index -> reason col index
          for (let c = 0; c < headers.length - 1; c++) {
            if (!looksLikeDateHeader(headers[c])) continue;
            const nextNorm = headers[c + 1].replace(/[^A-Z0-9]/ig, "").toUpperCase();
            if (isReasonHeader(nextNorm)) {
              reasonColIdxForDateCol.set(c, c + 1);
            }
          }

          // Some planning events are only ever marked "done" by coloring the cell (a plain "NY"
          // or "FCHP" with no "-S"/"-F" suffix, but filled solid green/yellow in the source) —
          // verified directly against real files: this IS a genuine, reliably-stored static cell
          // fill (not conditional formatting, not a rendering artifact), so it's worth capturing.
          // For every date column, look up its actual fill color per row and, when a cell has a
          // real applied color but no existing status suffix, append "-S" before it's stored —
          // folding the color signal into the same "-S = done, not overdue" text convention
          // everything downstream already understands, rather than inventing a parallel one.
          const colLetter = (n: number): string => {
            let s = "";
            let num = n + 1;
            while (num > 0) {
              const rem = (num - 1) % 26;
              s = String.fromCharCode(65 + rem) + s;
              num = Math.floor((num - 1) / 26);
            }
            return s;
          };
          const dateColLetters = new Map<number, string>(); // date col index -> spreadsheet column letter
          for (let c = 0; c < headers.length; c++) {
            if (looksLikeDateHeader(headers[c])) dateColLetters.set(c, colLetter(c));
          }
          const isCellColored = (cellStyle: { patternType?: string; fgColor?: { rgb?: string; indexed?: number } } | undefined): boolean => {
            if (!cellStyle || cellStyle.patternType !== "solid") return false;
            const fg = cellStyle.fgColor;
            if (!fg) return false;
            if (fg.rgb && ["FFFFFF", "FFFFFFFF"].includes(fg.rgb.toUpperCase())) return false;
            if (!fg.rgb && fg.indexed === 64) return false; // "no fill" sentinel some sheets use
            return true;
          };

          // Find positions of the (usually duplicate) STRIKE OFF AWB# / DHL tracking headers
          // positionally. Match on "AWB" / "WAYBILL" / "TRACKING" appearing ANYWHERE in the
          // header, not just as a suffix: the real headers read "STRIKE OFF AWB# (Tracking
          // Details)", and a stray trailing token ("... 1ST SUBMIT", "... NY") or an odd
          // wrap used to make the old endsWith() checks miss the 1st column entirely — so its
          // DHL number never reached col24 and the combo showed as "Submission Pending"
          // despite having a tracking number. First match = 1st strike-off, second = 2nd.
          const awbIdxs: number[] = [];
          for (let i = 0; i < headers.length; i++) {
            const hNorm = headers[i].replace(/[^A-Z0-9]/ig, "").toUpperCase();
            if (
              hNorm.includes("AWB") ||
              hNorm.includes("WAYBILL") ||
              hNorm.includes("TRACKING")
            ) {
              awbIdxs.push(i);
            }
          }
          const awb1Idx = awbIdxs[0] ?? -1;
          const awb2Idx = awbIdxs[1] ?? -1;
          const comment1Idx = headers.findIndex((h) => {
            const hNorm = h.replace(/[^A-Z0-9]/ig, "").toUpperCase();
            return hNorm.endsWith("1STSTRIKEOFFCOMMENTS") || hNorm.endsWith("1STSTRIKEOFFCOMMENT") || hNorm.endsWith("1STSOFFCOMMENTS");
          });
          const comment2Idx = headers.findIndex((h) => {
            const hNorm = h.replace(/[^A-Z0-9]/ig, "").toUpperCase();
            return hNorm.endsWith("2NDSTRIKEOFFCOMMENTS") || hNorm.endsWith("2NDSTRIKEOFFCOMMENT") || hNorm.endsWith("2NDSOFFCOMMENTS");
          });

          let consecutiveEmpty = 0;
          for (let i = headerRowIndex + 1; i < rows.length; i++) {
            const row = rows[i] as unknown[];
            const isEmpty =
              !row ||
              !row.some(
                (val) =>
                  val !== null &&
                  val !== undefined &&
                  String(val).trim() !== "",
              );
            if (isEmpty) {
              consecutiveEmpty++;
              if (consecutiveEmpty >= 2000) break; // Safe early exit on huge empty Excel grid tail
              continue;
            }
            consecutiveEmpty = 0;

            const obj: Record<string, unknown> = {};
            const excelRowNumber = i + 1; // sheet_to_json's array index matches the sheet's actual row 1:1
            headers.forEach((h, idx) => {
              if (!h) return;
              let cellValue = row[idx];
              const dateColLetter = dateColLetters.get(idx);
              if (dateColLetter && typeof cellValue === "string" && cellValue.trim()) {
                const upper = cellValue.trim().toUpperCase();
                const alreadyMarked = upper.endsWith("-S") || upper.endsWith("-F") || upper.includes("|");
                if (!alreadyMarked) {
                  const cellStyle = worksheet[`${dateColLetter}${excelRowNumber}`]?.s;
                  if (isCellColored(cellStyle)) {
                    cellValue = `${cellValue.trim()}-S`;
                  }
                }
              }
              obj[h] = cellValue;
            });

            // Thread each date column's paired Reason value through under a key namespaced by
            // THAT column's own header text (unique per date) rather than the generic "Reason"
            // text every such column shares — see reasonColIdxForDateCol above.
            reasonColIdxForDateCol.forEach((reasonIdx, dateIdx) => {
              const reasonVal = String(row[reasonIdx] ?? "").trim();
              if (reasonVal) {
                obj[`__reasonFor_${headers[dateIdx]}`] = reasonVal;
              }
            });

            // --- BACKGROUND COLOR LOGIC REMOVED ---
            // The user requested to stop using cell background colors to determine "Dropped"
            // or "Approved" statuses, as it can falsely trigger on column headers or empty spaces.
            const isGreyDropped = false;
            const isColorApproved = false;
            
            obj["__isGreyDropped"] = isGreyDropped;
            obj["__isColorApproved"] = isColorApproved;
            // -------------------------------------------------
            // -------------------------------------------------

            // Capture internal positional fields
            obj["__awb1"] =
              awb1Idx >= 0 ? String(String(String(String(String(row[awb1Idx] || ""))))).trim() : "";
            obj["__awb2"] =
              awb2Idx >= 0 ? String(String(String(String(String(row[awb2Idx] || ""))))).trim() : "";
            obj["__comment1"] =
              comment1Idx >= 0 ? String(String(String(String(String(row[comment1Idx] || ""))))).trim() : "";
            obj["__comment2"] =
              comment2Idx >= 0 ? String(String(String(String(String(row[comment2Idx] || ""))))).trim() : "";
            obj["__sheetName"] = sheetName;
            rawData.push(obj);
          }
        }

        if (!rawData || rawData.length === 0) {
          throw new Error("The Excel/CSV file is empty or invalid.");
        }

        // Build header-to-col mapping: primary map from stored column labels
        const headerToCol = Object.entries(columns).reduce(
          (acc, [colKey, colName]) => {
            acc[colName.toString().toUpperCase().trim()] = colKey;
            return acc;
          },
          {} as Record<string, string>,
        );

        // Comprehensive Alias Map: handle variations in CSV/Excel headers
        // Keys are UPPER-CASED exact or prefix matches (see fuzzy lookup below)
        const HEADER_ALIASES: Record<string, string> = {
          // ── Status ──────────────────────────────────────────────
          STATUS: "col1",
          STATE: "col1",
          // ── Trigger ─────────────────────────────────────────────
          TRIGGER: "col2",
          "TRIGGER DATE": "col2",
          // NOTE: the source charts' "MOVED / REALLOCATED" column is NOT a Trigger — a Trigger is
          // the event that pulls a graphic into the plan (and carries an AOQ deadline). This column
          // is an exit disposition: per the planner, ANY value in it (reallocated, moved out, even
          // "moved from") means the graphic is no longer planned here — a drop. It's aliased into
          // col20 (Strike off Aesthetic Approval / Dropped) so the text shows in the status column;
          // the actual "set Status = Dropped" happens at parse time off the raw cell — see
          // movedReallocatedCell below.
          "MOVED / REALLOCATED": "col20",
          "PARK OFF DATE": "col2",
          "DROP": "col2",
          "DROP WINDOW": "col2",
          // ── Category ────────────────────────────────────────────
          CATEGORY: "col3",
          "PRODUCT CATEGORY": "col3",
          COMMODITY: "col3",
          BRAND: "col3",
          "BRAND GROUP": "col3",
          BRAND_GROUP: "col3",
          // ── Season ──────────────────────────────────────────────
          SEASON: "col4",
          BUY: "col4", // CK Sample/Allocation Plan template names the season column "Buy" (e.g. "FA27")
          "BUY SEASON": "col4",
          // ── Style / Flex ─────────────────────────────────────────
          STYLE: "col5",
          "STYLE #": "col5",
          "STYLE CODE": "col5",
          "BODY STYLE": "col5",
          "GARMENT STYLE": "col5",
          "FLEX #": "col5",
          "FLEX NO": "col5",
          "FLEX CODE": "col5",
          FLEX: "col5",
          // CK Tracking Chart names the Style column "Factory Reference #" (e.g. "CKNA093") — stored
          // as-is, unparsed, so it stays a stable unique key for row matching.
          "FACTORY REFERENCE #": "col5",
          "FACTORY REFERENCE": "col5",
          "FACTORY REF #": "col5",
          "FACTORY REF": "col5",
          // ── Graphic (col7) ───────────────────────────────────────
          "GRAPHIC VVW": "col7", // VS/Brandix Excel format (new)
          "GRAPHIC VW": "col7", // VS/Brandix Excel format
          "GRAPHIC VW#": "col7",
          "GRAPHIC VV#": "col7",
          "GRAPHIC VV": "col7",
          "GRAPHIC #": "col7",
          "GRAPHIC CODE": "col7",
          // CK "CKP" / "Other Knit" tracker layout names the graphic column "Graphic number"
          "GRAPHIC NUMBER": "col7",
          "GRAPHIC NO": "col7",
          GRAPHIC: "col7",
          // CK Tracking Chart's "Category Line" is a distribution channel (ML / OP / OUTLET), NOT
          // the brand/Category field — but "CATEGORYLINE" normalizes to a prefix-match against the
          // generic CATEGORY alias (col3), so without this explicit exact-match entry every CK row
          // would get its Category (col3) silently overwritten with its channel instead of "CK".
          // col43 is a new field — no schema migration needed, any col-number above col33 already
          // routes through the schedule JSONB column automatically (see server/db.js).
          "CATEGORY LINE": "col43",
          // CK "CKP" / "Other Knit" tracker layout calls the same channel field "Product Line"
          // (ML / OP / OUTLET / WOP / OL). Same semantics as the CKNA charts' "Category Line" — it
          // is a genuine part of CK row identity (see categoryLineCompatible below), NOT the
          // brand/Category field, so it must land in col43 like Category Line does.
          "PRODUCT LINE": "col43",
          // CK Tracking Chart's "Dispatch To" (destination, e.g. NY / HK / NK) is a genuinely
          // different thing from "Dispatch Deadline" (col23, a date) — but "DISPATCHTO" normalizes
          // to a prefix-match against the generic DISPATCH alias, so without this explicit entry it
          // silently landed in col23 as garbage. It's captured as a tracked attribute only — per
          // the planner a CK strike-off item is identified by graphic + ground colour (+ channel),
          // and the chart just lists it once per approval route with the same status on each, so
          // Dispatch To is NOT part of row identity (that would double-count every metric).
          "DISPATCH TO": "col44",
          // "Estimated 1st/2nd S/Off Ready Date" both contain "READY DATE" as a substring, which
          // was silently fuzzy-matching the generic "READY DATE" alias (col28) — the exact same
          // column "1ST SUBMIT SENT DATE" is mapped to below, corrupting whichever one lost the
          // first-non-empty-wins race. Explicit exact-match entries give them their own columns.
          "ESTIMATED 1ST S/OFF READY DATE": "col45",
          "ESTIMATED 2ND S/OFF READY DATE": "col46",
          // "AW Reference #" is CK Tracking Chart's own name for the Graphic column — added as an
          // explicit exact-match entry so it wins over "AWR" (col26) accidentally prefix-matching it.
          "AW REFERENCE #": "col7",
          "AW REFERENCE": "col7",
          "AW REF #": "col7",
          "AW REF": "col7",
          // H27 DEV PACK TRACKER format names the Graphic column "Reference #"
          "REFERENCE #": "col7",
          "REFERENCE": "col7",
          // ── Graphic Combo (col6) ─────────────────────────────────
          "GRAPHIC COMBO #": "col6",
          "GRAPHIC COMBO": "col6",
          "GRAPHI-COMBO#": "col6",
          "GRAPHI-COMBO": "col6",
          "GRAPHI COMBO": "col6",
          "GRAPHI - COMBO #": "col6",
          "GRAPHI - COMB O #": "col6",
          "GRAPHI - COMBO": "col6",
          "COMBO #": "col6",
          COMBO: "col6",
          // H27 DEV PACK TRACKER format names this column "Option/Combo"
          "OPTION/COMBO": "col6",
          "OPTION / COMBO": "col6",
          // ── Ground / Colorway ────────────────────────────────────
          GROUND: "col8",
          "GROUND COLOR": "col8",
          "GROUND COLOUR": "col8",
          "GROUND COLOR & GPC": "col8", // prefix — fuzzy match handles "(Colorway Code)" suffix
          "GROUND COLOUR & GPC": "col8",
          "COLORWAY CODE": "col8",
          COLORWAY: "col8",
          GPC: "col8",
          // H27 DEV PACK TRACKER format just calls this "Color" — too generic to leave as a
          // fuzzy prefix/suffix match (would collide with "Color Approval" col41 etc.), so it's
          // an explicit exact-match entry instead.
          COLOR: "col8",
          COLOUR: "col8",
          // ── Technique ────────────────────────────────────────────
          TECHNIQUE: "col9",
          TECHNIQUES: "col9",
          // CK charts name it "Graphic Technique" — explicit exact-match so it can't be pulled
          // toward one of the "GRAPHIC …" -> col7 aliases by the fuzzy matcher.
          "GRAPHIC TECHNIQUE": "col9",
          // ── Process ──────────────────────────────────────────────
          PROCESS: "col10",
          "PROCESS FLOW": "col10",
          // ── Plant / Vendor ───────────────────────────────────────
          PLANT: "col11",
          VENDOR: "col11",
          SUPPLIER: "col11",
          MILL: "col11",
          "GRAPHIC MILL": "col11",
          "GRAPHIC SUPPLIER": "col11", // CK Tracking Chart's name for Graphic Mill (plant)
          // H27 DEV PACK TRACKER format names this column "Vendor & Supplier"
          "VENDOR & SUPPLIER": "col11",
          "VENDOR AND SUPPLIER": "col11",
          // ── Plant Flow ───────────────────────────────────────────
          "PLANT FLOW": "col12",
          // ── Fabric Reference ─────────────────────────────────────
          "FABRIC REFERENCE": "col13",
          "FABRIC REF": "col13",
          "FABRIC NAME & FB #": "col13", // prefix — fuzzy handles any suffix
          "FABRIC NAME": "col13",
          FABRIC: "col13",
          // H27 DEV PACK TRACKER format names this column "Fabric FB #"
          "FABRIC FB #": "col13",
          "FABRIC FB": "col13",
          // ── Fabric IH / Pass Off Date ────────────────────────────
          "PASS OFF DATE": "col14",
          "FABRIC IH DATE": "col14",
          "FABRIC IN DATE": "col14",
          "FABRIC IH": "col32",
          // ── Application Form ─────────────────────────────────────
          // ── Application Form ─────────────────────────────────────
          "APPLICATION FORM": "col15",
          "APPLICATIONFORM": "col15",
          "APP FORM": "col15",
          // ── Embellishment Apply Parts (col25) ────────────────────
          "EMBELLISHMENT APPLY PARTS": "col25",
          "EMBELLISHMENT APPLY PART": "col25",
          "EMBELLISHMENT APPLY": "col25",
          "APPLY PARTS": "col25",
          "APPLY PART": "col25",
          "PARTS": "col25",
          // ── AWR (col26) ──────────────────────────────────────────
          AWR: "col26",
          "AWR DATE": "col26",
          "AWR APPROVAL": "col26",
          // ── Alternative Fabric ───────────────────────────────────
          "ALTERNATIVE FABRIC": "col16",
          // ── Risk Factor ──────────────────────────────────────────
          "RISK FACTOR": "col17",
          "RISH FACTOR": "col17",
          "RISK CATEGORY": "col17",
          "RISK CATEGORIE": "col17",
          // ── Technique Category ───────────────────────────────────
          "TECHNIQUE CATEGORY": "col18",
          "TECH CATEGORY": "col18",
          // ── Graphic Type ─────────────────────────────────────────
          "GRAPHIC TYPE": "col19",
          // ── AOQ / Graphic Approval (col20) ───────────────────────
          "AOQ/GRAPHIC APPROVAL": "col20",
          "AOQ GRAPHIC APPROVAL": "col20",
          "STRIKE OFF AESTHETIC APPROVAL / DROPPED": "col20",
          "STRIKE OFF AESTHETIC APPROVAL/ DROPPED": "col20",
          "STRIKE OFF AESTHETIC APPROVAL/DROPPED": "col20",
          "STRIKE OFF AESTHETIC APPROVAL": "col20",
          "STRIKE OFF AESTHETIC": "col20",
          "APPROVAL DROPPED": "col20",
          "AESTHETIC APPROVAL / DROPPED": "col20",
          "AESTHETIC APPROVAL": "col20",
          "GRAPHIC APPROVAL / DROPPED": "col20",
          "APPROVAL / DROPPED": "col20",
          // ── Technique Type ───────────────────────────────────────
          "TECHNIQUE TYPE": "col21",
          "TECH TYPE": "col21",
          // ── S-Off Requirement ────────────────────────────────────
          "S-OFF REQUIREMENT": "col27",
          "S-OFF REQUIRE MENT": "col27",
          "SOFF REQUIREMENT": "col27",
          "S-OFF REQ": "col27",
          // ── Ready Date (Advance Plan) ────────────────────────────
          "READY DATE": "col28",
          "READY TO DATE": "col28",
          "READYTODATE": "col28",
          "READY": "col28",
          "READY DATE (ADVANCE PLAN)": "col28",
          // Deliberately NOT mapped to col28 (unlike the aliases above). This is the Allocation
          // Chart's own "Ready date IF NEED TO ADVANCE the submission plan" — a conditional field,
          // not a real per-item constraint — and col28 is exactly what autoScheduleEmbellishmentRow
          // (planningFlows.ts) reads to anchor when a fresh schedule is allowed to start. Confirmed
          // against real data: the value in this column was the SAME Excel date serial (46275,
          // ~Sep 2026) on all 13 rows regardless of technique or plant — obvious template
          // boilerplate, not thirteen items that genuinely all become ready the same day — and it
          // was silently pushing every auto-generated schedule out to September instead of
          // starting the next working day, which is the actual requirement. Leaving this header
          // unmapped lets it fall through to the generic "unrecognized header" path, which still
          // captures its raw value on the row for reference — it just never reaches col28, so it
          // can no longer override the schedule's start date.
          // ── Placement Sample ─────────────────────────────────────
          "PLACEMENT SAMPLE": "col29",
          // ── Dev Trial Requirement ────────────────────────────────
          "DEV TRIAL": "col30",
          "DEV TRIAL REQUIREMENT": "col30",
          // ── TC3010 / LTD-92 ──────────────────────────────────────
          "TC3010/LTD-92 REQUIRED": "col31",
          "TC3010 / LTD-92 REQUIRED": "col31",
          // ── Comment ──────────────────────────────────────────────
          COMMENT: "col22",
          COMMENTS: "col22",
          "1ST STRIKE OFF COMMENT": "col22",
          "1ST STRIKE OFF COMMENTS": "col22",
          // ── Dispatch / 1st S/OFF ─────────────────────────────────
          "DISPACH DEADLINE": "col23",
          "DISPATCH DEADLINE": "col23",
          DISPATCH: "col23",
          "DATE 1ST S/OFF": "col28", // VS Excel: Date 1st S/Off
          "DATE 1ST S-OFF": "col28",
          "DATE 1ST S/OFF (SHOULD BE THE SAME DATE ON S/O)": "col28",
          "S/OFF DATE": "col28",
          "STRIKE OFF DATE": "col28",
          // CK Tracking Chart: "1st Submit Sent Date" = the same 1st S/Off sent date as elsewhere
          "1ST SUBMIT SENT DATE": "col28",
          "1ST SUBMIT SENT": "col28",
          // ── DHL / Strike-Off AWB Tracking (col24) ───────────────
          "STRIKE OFF AWB#": "col24", // prefix — fuzzy handles "(Tracking Details)" suffix
          "STRIKE OFF AWB": "col24",
          "AWB#": "col24",
          AWB: "col24",
          "DHL TRACKING": "col24",
          "DHL TRACKING #": "col24",
          "DHL TRACKING NUMBER": "col24",
          "DHL/STICKOFF TRACKING": "col24",
          "STICKOFF TRACKING": "col24",
          TRACKING: "col24",
          "TRACKING #": "col24",
          "TRACKING NUMBER": "col24",
          // CK Tracking Chart: despite the "DATE" in its name, "2nd Submit Sent Date" is where CK
          // actually records the DHL/tracking details for the 2nd submission, not a plain date.
          "2ND SUBMIT SENT DATE": "col24",
          "2ND SUBMIT SENT": "col24",
          // ── Artwork Date (col36) ──────────────────────────────────
          "ARTWORK DATE": "col36",
          ARTWORK: "col36",
          "ART WORK DATE": "col36",
          // CK Tracking Chart's "Receive Date" = the date artwork was received. The real column
          // header is "RECEIVED DATE" (past tense) — confirmed against the actual file; "RECEIVE
          // DATE" alone silently matched nothing at all (not even a fuzzy substring hit, since the
          // extra "D" breaks every prefix/suffix/substring check), which is why this field came up
          // 100% empty on every imported row. Keeping the (D)-less spelling too in case a
          // differently-worded sheet uses it.
          "RECEIVED DATE": "col36",
          "RECEIVE DATE": "col36",
          "AW RECEIVE DATE": "col36",
          "AW RECEIVED DATE": "col36",
          "ARTWORK RECEIVE DATE": "col36",
          "ARTWORK RECEIVED DATE": "col36",
          // ── Submission Status (col37) ─────────────────────────────
          "SUBMISSION STATUS": "col37",
          "SUBMISSION #": "col37",
          "SUBMISSION NUMBER": "col37",
          SUBMISSION: "col37",
          // ── Final Edit Meeting (col38) ────────────────────────────
          "FINAL EDIT MEETING": "col38",
          "FINAL EDIT": "col38",
          // ── Approve Date (col39) ──────────────────────────────────
          "APPROVE DATE": "col39",
          "APPROVAL DATE": "col39",
          // ── Layout Approval (col40) ───────────────────────────────
          "LAYOUT APPROVAL": "col40",
          // ── Color Approval (col41) ────────────────────────────────
          "COLOR APPROVAL": "col41",
          "COLOUR APPROVAL": "col41",
          // ── Placement Approval (col42) ────────────────────────────
          "PLACEMENT APPROVAL": "col42",
          // PINK/VS Graphic Tracking Chart's dedicated "Placment Approval Status" column (note the
          // sheet's own "Placment" typo, plus the "Status" suffix) — the normalized key
          // "PLACMENTAPPROVALSTATUS" matches none of the shorter aliases above (the missing "E"
          // breaks every prefix/substring check), so it needs its own entries or the column is
          // silently minted as an unused dynamic col. Its free-text value ("Approved") lands in
          // col42 and feeds hasPlacementApproval / the Placement Approval card in Advanced Analytics.
          "PLACMENT APPROVAL STATUS": "col42",
          "PLACEMENT APPROVAL STATUS": "col42",
          "PLACMENT APPROVAL": "col42",
        };

        // Helper: parse any date header string or serial to local YYYY-MM-DD ISO string without UTC timezone shifts
        const parseHeaderDateToISO = (rawKey: string): string | null => {
          if (!rawKey) return null;
          const keyStr = String(rawKey).trim();

          // Excel serial number check
          const numVal = Number(keyStr);
          if (!isNaN(numVal) && numVal > 40000 && numVal < 100000 && !keyStr.includes("/") && !keyStr.includes("-")) {
            const d = new Date((Math.floor(numVal) - 25569) * 86400 * 1000);
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, "0");
            const day = String(d.getUTCDate()).padStart(2, "0");
            return `${y}-${m}-${day}`;
          }

          // MM/DD/YYYY or M/D/YYYY
          const m1 = keyStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (m1) {
            const month = m1[1].padStart(2, "0");
            const day = m1[2].padStart(2, "0");
            const year = m1[3];
            return `${year}-${month}-${day}`;
          }

          // YYYY-MM-DD
          const m2 = keyStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
          if (m2) {
            const year = m2[1];
            const month = m2[2].padStart(2, "0");
            const day = m2[3].padStart(2, "0");
            return `${year}-${month}-${day}`;
          }

          // General string date (parse local date components to avoid timezone offset shifts)
          if (keyStr.includes("/") || keyStr.includes("-")) {
            const parsedDate = new Date(keyStr);
            if (!isNaN(parsedDate.getTime())) {
              const y = parsedDate.getFullYear();
              const m = String(parsedDate.getMonth() + 1).padStart(2, "0");
              const day = String(parsedDate.getDate()).padStart(2, "0");
              return `${y}-${m}-${day}`;
            }
          }

          return null;
        };

        const excelSerialToISO = (serial: number): string => {
          const parsed = parseHeaderDateToISO(String(serial));
          if (parsed) return parsed;
          const d = new Date((serial - 25569) * 86400 * 1000);
          return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        };

        const seenFileNewKeysMap = new Map<string, string>();
        const claimedDbIds = new Set<string>();

        // Hand-created planning rows ("Add Planning Row", or a published team draft) are a
        // LAST-RESORT match: every strategy below first runs against imported rows only, and only
        // when none matches does it run again allowing manual rows. So an item that already has an
        // imported twin keeps updating that twin (manual row left alone), but an item that exists
        // ONLY as a hand-added row merges into it instead of being created as a new duplicate —
        // per the planner (2026-09-24): "if it's hand added but matching the tracking chart, no
        // need to import them as new". (Before, manual rows were never matched at all, so deleting
        // the imported twin made every re-import recreate it.)
        const isManualRow = (r: EmbellishmentRow) => String(r.manual_entry || "") === "1";

        // ── Everything below is row-INVARIANT (same for all rows in the file) ──
        // Previously these were declared inside the rawData.map() callback, which
        // meant the entire alias table got rebuilt and re-sorted from scratch on
        // EVERY row. That's fine for a normal-sized sheet but pathological for a
        // wide legacy planning file (e.g. hundreds of one-per-day schedule columns
        // x thousands of rows) — hoisting these out so they're computed once fixes
        // that without changing any matching behavior.

        // normalizeHeaderKey: strips ALL non-alphanumeric characters for bulletproof matching
        const normalizeHeaderKey = (raw: unknown): string =>
          String(raw ?? "").replace(/[^A-Z0-9]/ig, "").toUpperCase();

        // Pre-build alias prefix list ONCE for the whole import
        const ALIAS_PREFIXES = Object.keys(HEADER_ALIASES).map(normalizeHeaderKey).sort(
          (a, b) => b.length - a.length,
        );

        const resolveAlias = (cleanKey: string): string | undefined => {
          if (!cleanKey) return undefined;

          // 1. Direct exact match against normalized aliases
          const exactMatch = Object.entries(HEADER_ALIASES).find(
            ([k]) => normalizeHeaderKey(k) === cleanKey
          );
          if (exactMatch) return exactMatch[1];

          // 2. Suffix match (longest alias first)
          for (const prefix of ALIAS_PREFIXES) {
            if (cleanKey.endsWith(prefix)) {
              const match = Object.entries(HEADER_ALIASES).find(
                ([k]) => normalizeHeaderKey(k) === prefix
              );
              if (match) return match[1];
            }
          }

          // 3. Prefix match
          for (const prefix of ALIAS_PREFIXES) {
            if (cleanKey.startsWith(prefix)) {
              const match = Object.entries(HEADER_ALIASES).find(
                ([k]) => normalizeHeaderKey(k) === prefix
              );
              if (match) return match[1];
            }
          }

          // 4. Substring / Includes match (with min length 4 to prevent short key accidental hits)
          for (const prefix of ALIAS_PREFIXES) {
            if (prefix.length >= 4 && cleanKey.includes(prefix)) {
              const match = Object.entries(HEADER_ALIASES).find(
                ([k]) => normalizeHeaderKey(k) === prefix
              );
              if (match) return match[1];
            }
          }

          return undefined;
        };

        const headerToColNormalized: Record<string, string> = {};
        Object.entries(headerToCol).forEach(([k, v]) => {
          headerToColNormalized[normalizeHeaderKey(k)] = v;
        });

        // Dynamic column registration: a header that matches no known alias and isn't a
        // calendar-event date is real planning-sheet-only data the database schema has never
        // captured before (the sheet has columns our tracking chart doesn't) — previously that
        // value was silently dropped on the floor with no `else` branch to catch it. Mint a
        // fresh colN slot the first time each such header is seen (reused for every later row
        // and every other header that normalizes to the same text) and register it against its
        // own header text as the label, so this data survives the import and shows up in the
        // table/column config like any other field. Any col number above the highest one
        // DEFAULT_COLUMNS defines already routes through the `schedule` JSONB column with no
        // schema migration needed (see the col43-col46 comment in lib/db.ts), so it's always
        // safe to keep incrementing past the current max.
        const existingColNums = Object.keys(columns)
          .map((k) => Number((k.match(/^col(\d+)$/) || [])[1]))
          .filter((n) => !Number.isNaN(n));
        let nextDynamicColNum = (existingColNums.length ? Math.max(...existingColNums) : 0) + 1;
        const dynamicColumnMap = new Map<string, string>(); // normalized header -> assigned col key
        const newDynamicColumns: Record<string, string> = {}; // col key -> label, for saveColumns

        // Headers whose real value is already captured elsewhere under a different key and
        // must NOT also mint a generic dynamic column here. "Reason" (isReasonHeader, defined
        // above — tolerates real misspellings like "Reaason"/"Reaon") is the recurring case:
        // every date column's paired reason cell shares essentially the same header text
        // (a file can have 50+ of them, occasionally with a typo on one), so a plain per-header
        // map would collide them all into one nonsense column, or — for a misspelled one that
        // doesn't collide — mint its own bogus column full of orphaned reason text. The real
        // per-date value already lives under __reasonFor_<dateHeader> and gets folded into the
        // FAIL event code above instead.

        // Per-header lookup cache, keyed by the RAW header string as it appears on each
        // row object. A wide file re-presents the exact same ~700+ header strings on
        // every row, so resolving each header's cleanKey / alias match / date-ness once
        // and reusing it avoids doing that work again per row (was previously the
        // dominant cost on files with hundreds of calendar-date columns).
        const headerResolutionCache = new Map<
          string,
          { mappedColKey?: string; isoDate?: string | null }
        >();
        const resolveHeader = (key: string) => {
          const cached = headerResolutionCache.get(key);
          if (cached) return cached;

          const cleanKey = normalizeHeaderKey(key);
          const directMatch = headerToColNormalized[cleanKey];

          // A real metadata header (Status, Graphic, Technique, ...) never parses as a
          // calendar date once cleaned to alphanumeric-only, so checking date-ness first
          // lets us skip the O(alias-count) resolveAlias scan for every date column —
          // this is what makes wide "one column per planning-event date" sheets fast.
          const isoDate = directMatch ? null : parseHeaderDateToISO(key);
          let mappedColKey = directMatch || (isoDate ? undefined : resolveAlias(cleanKey));

          if (!mappedColKey && !isoDate && cleanKey && !isReasonHeader(cleanKey)) {
            const reused = dynamicColumnMap.get(cleanKey);
            if (reused) {
              mappedColKey = reused;
            } else {
              const newColKey = `col${nextDynamicColNum++}`;
              dynamicColumnMap.set(cleanKey, newColKey);
              newDynamicColumns[newColKey] = String(key).trim();
              mappedColKey = newColKey;
            }
          }

          const result = { mappedColKey, isoDate };
          headerResolutionCache.set(key, result);
          return result;
        };

        // Matched items where this file would REASSIGN the Plant on a row that already has a
        // planned schedule — collected here so we can ask the planner once (after the map) whether
        // to keep the existing Plant (e.g. a hand-made cross-dev "HI EMB / BABL" split) or take the
        // tracking chart's new single-plant value. Only rows with existing planning events qualify.
        const plantChangeConflicts: {
          finalRow: Record<string, unknown>;
          oldPlant: string;
          newPlant: string;
          style: string;
          graphic: string;
          combo: string;
          otherReplanReason: boolean;
        }[] = [];

        const parsedItemsList: ParsedImportItem[] = rawData.map(
          (row, index) => {
            const formattedRow: Partial<EmbellishmentRow> = {};

            // Raw value of the source charts' "MOVED / REALLOCATED" column for this row, captured
            // straight from its own header before it collapses into col20 (which it shares with the
            // "Strike off Aesthetic Approval / Dropped" column). Any non-empty value here = a drop,
            // handled after this loop.
            let movedReallocatedCell = "";

            Object.entries(row).forEach(([key, value]) => {
              if (key.startsWith("__")) return;

              const { mappedColKey, isoDate } = resolveHeader(key);
              const rawVal = value !== null && value !== undefined ? value : "";
              // Normalize cell value line endings too (\r\n → \n)
              const strValue = String(rawVal)
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n")
                .trim();

              const numVal = Number(rawVal);
              let processedValue = strValue;

              // Grab the "MOVED / REALLOCATED" cell from its own header, independent of the
              // first-non-empty race into col20 (see movedReallocatedCell declaration above).
              if (strValue && normalizeHeaderKey(key).startsWith("MOVEDREALLOCATED")) {
                movedReallocatedCell = strValue;
              }

              // Ensure we capture strings that look like "46213.0" just in case
              const isExcelDate = !isNaN(numVal) && numVal > 40000 && numVal < 100000 && !strValue.includes("/") && !strValue.includes("-") && !strValue.includes(" ");

              if (mappedColKey) {
                const dateColumns = ["col14", "col23", "col26", "col28"];
                if (dateColumns.includes(mappedColKey)) {
                  const parsedIso = parseHeaderDateToISO(strValue);
                  if (parsedIso) processedValue = parsedIso;
                }

                if (!formattedRow[mappedColKey]) {
                  formattedRow[mappedColKey] = processedValue;
                }
              } else {
                // Key itself is a calendar date column header (e.g. "8/3/2026", "8/4/2026", "46240")
                // — i.e. a planning-event/schedule date.
                if (isoDate && strValue) {
                  // Legacy Excel convention: "<CODE>-F" = fail (e.g. "PPS-F") — a real, rare signal
                  // (~2.5k occurrences in a sample file) worth re-encoding into the app's own fail
                  // format so it renders red and carries its reason code. "<CODE>-S" ("FS-S",
                  // "MAST-S", ...) is NOT a pass marker — parseEventValue already renders it as an
                  // ordinary neutral "planned" event, never green — but it IS real evidence the
                  // event was actually signed off/submitted, which matters for things like Overdue
                  // detection (a signed-off event isn't still pending). That signal must survive
                  // to storage, so it's kept exactly as-is here rather than stripped to a bare
                  // code — stripping it would make it indistinguishable from an event that never
                  // happened at all. (The row-building step above also appends "-S" onto a bare,
                  // unmarked cell when the source Excel colored it solid instead of writing "-S"
                  // in text — same convention, same reason to preserve it here.)
                  const failMatch = strValue.match(/^(.+)-F$/i);
                  if (failMatch && failMatch[1].trim()) {
                    const baseCode = failMatch[1].trim().toUpperCase();
                    const reasonVal = String((row as Record<string, unknown>)[`__reasonFor_${key}`] || "").trim();
                    formattedRow[isoDate] = encodeEventValue(baseCode, "fail", reasonVal);
                  } else {
                    formattedRow[isoDate] = strValue;
                  }
                }
              }
            });

            // Fabric Reference (col13): the CK Tracking Chart stores the fabric-quality cell as
            // the reference code on the first line followed by the full fabric composition on the
            // lines below — e.g. "SJCS211BA\n95% Better\nCotton\nInitiative\n(BCI)\nCotton, 5%\n
            // Elastane" or "SJCS211A\n200GSM\n95% COTTON & 5% SPANDEX". Only the first line(s) are
            // the actual reference; everything from the first composition line onward (a line with
            // a "%" or an "<n>GSM"/"<n> g/m²" weight) is fabric content, not a reference, and was
            // being stored verbatim in the Fabric Reference field. Keep the lines before the first
            // composition line, collapsed onto one line. A plain multi-line reference with no
            // composition text ("FB # 22693\nLC # 09947") is left untouched.
            if (formattedRow.col13 && /\n/.test(String(formattedRow.col13))) {
              const refLines = String(formattedRow.col13).split("\n").map((l) => l.trim());
              const compIdx = refLines.findIndex(
                (l) => /%/.test(l) || /^\d{2,4}\s*(?:GSM|G\s*\/\s*M2?|G\/M²)\b/i.test(l)
              );
              const keptRefLines = (compIdx === -1 ? refLines : refLines.slice(0, compIdx)).filter(Boolean);
              if (keptRefLines.length) formattedRow.col13 = keptRefLines.join(", ");
            }

            // "GRAPHIC MILL" and "VENDOR" both alias to col11 (Plant), but they are not the
            // same thing: "VENDOR" is often just the managing brand/company name (confirmed on
            // real data — literally "BRANDIX" for every single row in some tracking charts),
            // while "GRAPHIC MILL" is the actual physical plant doing the work (e.g. "HI EMB").
            // The main mapping loop above is first-non-empty-wins, so whichever column appears
            // first in the sheet locks col11 — if VENDOR happens to come first, its generic
            // value permanently blocks the correct GRAPHIC MILL value. Force GRAPHIC MILL to win
            // whenever it's present, regardless of column order.
            for (const [key, value] of Object.entries(row)) {
              if (key.startsWith("__")) continue;
              if (normalizeHeaderKey(key) === "GRAPHICMILL") {
                const millVal = String(value ?? "").trim();
                if (millVal) formattedRow["col11"] = millVal;
                break;
              }
            }

            // CK Tracking Chart's "S/off Status" column uses short codes (A / D / SP / CP / H) rather
            // than the free text the rest of the system stores in Status (col1). Translate them 1:1
            // into the exact words getCkRowStatus() (lib/db.ts) checks for, so a CK import lands on
            // Approved / Dropped / Pending / Comments Pending / Hold exactly — matched by header
            // content (contains "SOFF" + "STATUS" once normalized) rather than a plain alias, since
            // the codes need translating, not just renaming.
            //   H = "Hold" (CROSS DEVELOPMENT) — this is NOT a drop. Mapping it to "Dropped" used to
            //   make ~2 dozen held items per chart vanish from every active/pending count.
            // The S/off Status column is the SINGLE source of truth for a CK row's status, so when
            // it carries a recognised code we also stamp __ckStatusResolved: the generic
            // status-inference / reactivation logic further down must not second-guess it.
            let ckStatusCode = "";
            for (const [key, value] of Object.entries(row)) {
              if (key.startsWith("__")) continue;
              const normKey = normalizeHeaderKey(key);
              if (normKey.includes("SOFF") && normKey.includes("STATUS")) {
                ckStatusCode = String(value ?? "").trim().toUpperCase();
                const CK_STATUS_CODE_MAP: Record<string, string> = {
                  A: "Approved",
                  D: "Dropped",
                  SP: "Pending",
                  CP: "C+P",
                  H: "Hold",
                };
                if (CK_STATUS_CODE_MAP[ckStatusCode]) {
                  formattedRow["col1"] = CK_STATUS_CODE_MAP[ckStatusCode];
                  (row as Record<string, unknown>)["__ckStatusResolved"] = CK_STATUS_CODE_MAP[ckStatusCode];
                }
                break;
              }
            }

            // Strike-Off AWB tracking details: 2nd submission wins over 1st submission for col24
            // (the single "current" tracking value everything else reads), but the 1st and 2nd are
            // ALSO kept separately in awb1/awb2 (non-col* keys persist via the schedule JSONB, same
            // as "nycv:<date>" keys) so Summary of Graphics can show both S/Off dates side by side
            // instead of just whichever one last overwrote col24.
            const awb2 = String(row["__awb2"] || "").trim();
            const awb1 = String(row["__awb1"] || "").trim();
            if (awb1) formattedRow["awb1"] = awb1;
            if (awb2) formattedRow["awb2"] = awb2;
            const latestAwb = awb2 || awb1;
            if (latestAwb) {
              formattedRow["col24"] = latestAwb;
              formattedRow["col35"] = awb2 ? "2nd" : "1st";
            } else if (!formattedRow["col24"]) {
              // Fallback: neither AWB column was located positionally — scan every raw cell for
              // a courier + tracking-number string and use it. The gap class allows the
              // date couriers often prefix ("DHL 9/9  6851806264(NY Office)") so the number
              // isn't required to sit flush against the carrier name.
              for (const [key, value] of Object.entries(row)) {
                if (key.startsWith("__")) continue;
                const strVal = String(value || "").trim();
                if (/(?:DHL|AWB|DTC|LTD|FEDEX|UPS|TNT)\b[\s\d/:#.\-]{0,15}?\d{7,14}\b/i.test(strVal)) {
                  formattedRow["col24"] = strVal;
                  break;
                }
              }
            }

            const c2 = String(row["__comment2"] || "").trim();
            const c1 = String(row["__comment1"] || "").trim();

            if (c1) formattedRow["col22"] = c1;
            if (c2) formattedRow["col34"] = c2;

            // Note: We no longer auto-populate col24 with "Sent (See Comments)" when comments exist.
            // REMAINING count is based on: no fill color AND col20 empty AND col24 empty AND col22 empty AND col34 empty

            // Helper to extract a Trigger value (numeric drop code like 10/28, or a text label like
            // "ICON SHOP") tacked onto the Season column. Excel word-wrap only affects how a cell is
            // *displayed* — a wrapped-but-single-line cell like "SP27 ICON SHOP" has no real line break
            // in the underlying value, so we can't rely on an actual "\n" being present to find it.
            const extractTriggerFromSeasonStr = (sStr: string): string => {
              if (!sStr) return "";
              const str = String(sStr).trim();

              // 1. Bracketed or Parenthesized drop code with digits: HO26 AF [10/28] or (10/28) -> 10/28
              const bracketMatch = str.match(/[\[\(]([0-9\/\.\s\-]+(?:DROP|drop)?)[\]\)]/);
              if (bracketMatch && /\d/.test(bracketMatch[1])) {
                return bracketMatch[1].replace(/drop/i, "").trim();
              }

              // 2. Date pattern with digits and slashes or dots: 10/28, 10/15, 12.02, 6.23/8.18 DROP
              const dateMatch = str.match(/(\d{1,2}[\/\.]\d{1,2}(?:[\/\.]\d{1,2})*(?:\/\d{1,2}[\/\.]\d{1,2})?)/);
              if (dateMatch) {
                return dateMatch[1].trim();
              }

              // 3. Anything left over after the recognizable season code (e.g. "SP27", "HOLIDAY 2026")
              // is treated as a Trigger/channel label — whether it's a real 2nd line (Alt+Enter) or just
              // wrapped after a space on the same line (e.g. "SP27 ICON SHOP", "SP27\nICON SHOP").
              const normalized = str.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
              const seasonCodeMatch = normalized.match(/^([A-Z]{2,})\s*(\d{2,4})/i);
              if (seasonCodeMatch) {
                const rest = normalized
                  .slice(seasonCodeMatch[0].length)
                  .replace(/^[\s,\-/\n]+/, "")
                  .trim();
                if (rest) {
                  return rest.replace(/drop/i, "").trim();
                }
              } else {
                // No recognizable season-code prefix at all — fall back to treating an actual 2nd
                // line (if present) as the trigger.
                const lines = normalized.split("\n");
                if (lines.length > 1) {
                  const secondLine = lines[1].trim();
                  if (secondLine) {
                    return secondLine.replace(/drop/i, "").trim();
                  }
                }
              }

              return "";
            };

            // "MOVED / REALLOCATED" is an exit column on the source charts: per the planner, ANY
            // non-empty value in it means the graphic is no longer being planned here — a drop,
            // regardless of the exact wording ("REALLOCATED TO HANSOLL", "MOVED TO ...", a bare
            // "MOVED", even "MOVED FROM ..."). movedReallocatedCell was captured straight from that
            // column's raw cell above (before it collapsed into col20 with the strike-off column),
            // so this fires even when the strike-off column also had a value and won that race.
            if (movedReallocatedCell && !effectiveSkipNewRows) {
              formattedRow.col1 = "Dropped";
              formattedRow.col20 = movedReallocatedCell; // keep the drop reason visible in the status column
              (row as Record<string, unknown>)["__isGreyDropped"] = true; // don't let the reactivation logic flip it back
            }

            // Auto-extract Trigger drop window strictly from col4 (Season) if col2 is empty or N/A.
            // IMPORTANT: leave it blank (not "N/A") when extraction fails — forcing "N/A" here used
            // to permanently overwrite a perfectly good Trigger value already stored in the database
            // whenever a re-imported Excel file didn't have a recognizable Trigger column for that row.
            // The merge-time fallback below (search for "Smart fallback for Trigger") is the single
            // place allowed to decide the final "N/A", and only after checking the existing DB row.
            if (!formattedRow.col2 || formattedRow.col2 === "N/A" || formattedRow.col2 === "") {
              const seasonStr = String(formattedRow.col4 || "");
              const extractedTrigger = extractTriggerFromSeasonStr(seasonStr);
              formattedRow.col2 = extractedTrigger || "";
            }

            // --- DHL Date to NY Logic ---
            const dhlTrackingStr = String(formattedRow["col24"] || "");

            // 1. Process DHL tracking -> NY
            // The DHL-date NY is only a FALLBACK for rows with no NY of their own: when the matched
            // DB row already has a planned NY, the merge below turns THAT one green instead and
            // drops this key (see dhlNyKey there).
            let dhlNyKey = "";
            let fabricFrKey = ""; // FR derived from the fabric-in date below (same fallback idea)
            if (dhlTrackingStr) {
              // Look for patterns like "DHL 7/16" or "AWB: 07/16"
              const dhlMatch = dhlTrackingStr.match(/(?:DHL|AWB|DTC|LTD)[-\s:]*(\d{1,2})\/(\d{1,2})/i);
              if (dhlMatch) {
                const month = dhlMatch[1].padStart(2, '0');
                const day = dhlMatch[2].padStart(2, '0');
                const year = new Date().getFullYear();
                const dhlDateKey = `${year}-${month}-${day}`; 
                
                // Set to NY because it was sent
                formattedRow[dhlDateKey] = "NY";
                dhlNyKey = dhlDateKey;
              }
            }

            // --- Auto-Populate Fabric Received & S/OFF Target Event Progression ---
            const hasFabricIh = formattedRow.col32 && String(formattedRow.col32).trim().toUpperCase() === "IH";
            const fabricInDate = formattedRow.col14 && String(formattedRow.col14).trim();
            
            // Helper: Format local Date cleanly as YYYY-MM-DD without UTC timezone shifts
            const formatLocalDate = (d: Date): string => {
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, "0");
              const day = String(d.getDate()).padStart(2, "0");
              return `${y}-${m}-${day}`;
            };

            const todayObj = new Date();
            const todayISO = formatLocalDate(todayObj);

            const fabDateStr = fabricInDate || (hasFabricIh ? todayISO : null);

            if (fabDateStr) {
              let fDate: Date | null = null;
              const match = fabDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
              if (match) {
                fDate = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
              } else {
                const p = new Date(fabDateStr);
                if (!isNaN(p.getTime())) fDate = p;
              }

              if (fDate && !isNaN(fDate.getTime())) {
                const fabISO = formatLocalDate(fDate);

                // Set Fabric Received (FR - Default Planned) on fabric arrival date if empty
                if (!formattedRow[fabISO]) {
                  formattedRow[fabISO] = "FR";
                  fabricFrKey = fabISO;
                }
              }
            }

            // --- Auto-confirm (green/pass) key milestone events from corroborating evidence ---
            // A DHL/tracking number, a comment being present, or a full set of approvals are all
            // concrete proof an event actually happened successfully — upgrade the corresponding
            // ALREADY-SCHEDULED event to "pass", the same as an explicit pass marker would. This
            // never creates a new date or a new event (that's exactly the mistake the removed
            // "Comment -> NYC" heuristic below made) — it only confirms an event that's already
            // recorded somewhere in this row's real schedule data (including one the DHL-date
            // heuristic just above may have written).
            const markEventPassIfScheduled = (baseCode: string) => {
              const target = baseCode.toUpperCase();
              Object.keys(formattedRow).forEach((k) => {
                if (!k.match(/^\d{4}-\d{2}-\d{2}$/)) return;
                const val = formattedRow[k];
                if (typeof val !== "string" || !val.trim()) return;
                const parsed = parseEventValue(val);
                if (!parsed || parsed.code.toUpperCase() !== target) return;
                if (parsed.status === "fail") return; // never override a recorded failure
                formattedRow[k] = encodeEventValue(target, "pass");
              });
            };

            if (dhlTrackingStr.trim()) {
              markEventPassIfScheduled("NY");
            }

            const hasCommentText = Boolean(
              String(formattedRow["col34"] || formattedRow["col22"] || "").trim()
            );
            if (hasCommentText) {
              markEventPassIfScheduled("NYC");
            }

            // Three separate approvals — Graphic/Aesthetic (col20), Color (col41), and Placement
            // (col42) — must ALL be marked approved before REAP/FCHP counts as confirmed; any one
            // of them still pending means the milestone isn't actually cleared yet.
            const isApprovedField = (v: unknown): boolean => {
              const s = String(v || "").trim().toLowerCase();
              return s.includes("approve") || s.includes("confirmed");
            };
            if (
              isApprovedField(formattedRow["col20"]) &&
              isApprovedField(formattedRow["col41"]) &&
              isApprovedField(formattedRow["col42"])
            ) {
              markEventPassIfScheduled("REAP/FCHP");
            }

            // "Comment -> NYC" auto-inference used to live here: it scanned the freeform Comment
            // column for ANY "M/D" date-like pattern and fabricated an "NYC" event on that date,
            // regardless of what the comment was actually about. Confirmed as the source of a real
            // phantom event: a comment reading "AD 8/6 - S/O DATED 8/1/26 Per specpack update..."
            // produced a fake "NYC" on Aug 6 that no planning-sheet cell ever recorded — "AD 8/6"
            // almost certainly meant something else entirely (an artwork/approval date reference),
            // not an NYC dispatch. Comments are freeform planner notes, not structured event data,
            // so this heuristic is removed rather than tightened — there's no reliable pattern to
            // anchor on the way the DHL-tracking rule above can anchor on "DHL/AWB/DTC/LTD".

            // Auto-populate Vendor (col11) from sheet name if col11 is missing or blank and sheet name is a specific vendor
            const sheetVendor = String(row["__sheetName"] || "")
              .trim()
              .toUpperCase();
            if (
              !formattedRow["col11"] &&
              sheetVendor &&
              !sheetVendor.includes("SHEET") &&
              !sheetVendor.includes("DO NOT USE") &&
              !sheetVendor.includes("TEMPLATE") &&
              !sheetVendor.includes("STANDARD") &&
              !sheetVendor.includes("FORMAT") &&
              !sheetVendor.includes("TRACKING") &&
              !sheetVendor.includes("SUMMARY") &&
              !sheetVendor.includes("PIVOT") &&
              !sheetVendor.includes("MASTER") &&
              !sheetVendor.includes("VDAY")
            ) {
              formattedRow["col11"] = sheetVendor;
            }

            // A Planning Sheet import only fills in blanks and planning events — it must never
            // change Status, no matter what the file's own status-like columns say. The header
            // mapping above already copied the file's raw STATUS column text into
            // formattedRow.col1 like any other field; drop it here before it can reach the merge
            // step below, and every status-inference block that follows is skipped too.
            if (effectiveSkipNewRows) {
              delete (formattedRow as Record<string, unknown>).col1;
            }

            const col20Value = String(formattedRow["col20"] || "").trim().toLowerCase();

            const isRowTextDropped =
              col20Value.includes("drop") ||
              col20Value.includes("reallocated") ||
              /\bmoved\b/.test(col20Value);

            const isRowTextApproved =
              col20Value.includes("approve") || col20Value.includes("confirmed");

            if (!effectiveSkipNewRows) {
              // Check ONLY col20 (Strike off Aesthetic Approval / Dropped) for status text.
              // col22 (Comment) and col34 (Strike-Off Comment) are freeform planner notes, NOT
              // structured status fields — scanning them for words like "drop"/"moved"/"reallocated"
              // caused Active rows to be wrongly flipped to Dropped whenever a note happened to
              // contain one of those words (e.g. "sample dropped off for review", "date moved to
              // next week"). Status must only ever come from the actual status column.

              // Force Dropped status if the Excel row had a grey background or col20 explicitly says dropped
              if (row["__isGreyDropped"] || isRowTextDropped) {
                formattedRow["col1"] = "Dropped";
                row["__isGreyDropped"] = true; // Ensure this is tracked for the un-drop logic below
              } else if (row["__isColorApproved"]) {
                // Only set Approved from fill color, NOT from text in other columns
                console.log("MARKING AS APPROVED (fill color):", formattedRow["col7"], formattedRow["col5"]);
                formattedRow["col1"] = "Approved";
              } else if (isRowTextApproved) {
                // col20 explicitly says approved
                console.log("MARKING AS APPROVED (col20 text):", formattedRow["col7"], formattedRow["col5"]);
                formattedRow["col1"] = "Approved";
              }
            }

            // Some source files use a different sub-brand name for the same category outright in
            // their own Category column — confirmed against a real file ("CS FALL 27.xlsx") whose
            // Category column literally says "Casual Sleep" for what this app tracks as
            // "VS-SLEEP". This is normalizing a value the file DOES explicitly provide to this
            // app's own spelling — not guessing a value the file never gave at all (see the
            // Smart-fallback-for-Category comment further below for that distinction and why it
            // matters: guessing from an unrelated source is what caused real matching failures;
            // this just recognizes two spellings of the same explicit answer).
            if (formattedRow["col3"]) {
              const rawCat = String(formattedRow["col3"]).toUpperCase().trim();
              if (rawCat === "CASUAL SLEEP" || rawCat.includes("CASUAL SLEEP")) {
                formattedRow["col3"] = "VS-SLEEP";
              }
            }

            // Apply the dialog's Force Override Category / Season to formattedRow NOW, before
            // incomingCategory/incomingSeason (below) — and therefore seasonCategoryCompatible,
            // the row-identity guard every match strategy checks — are computed from it.
            //
            // This USED to be deliberately skipped: those fields defaulted to whatever
            // category/season filter was active on the dashboard, so re-importing the same file
            // under a different filter forced a different Category into the match identity each
            // time and silently created duplicate rows (13 -> 26 on a second Allocation Chart
            // import). The fields now default to BLANK (see ImportConfigModal) — they carry a
            // value only when the user deliberately picked one — so feeding them into matching is
            // exactly what's wanted: an allocation chart that labels its rows "ANGEL ESSENTIALS"
            // can be pointed at the existing "VS AE" database rows by picking "VS AE" here. A
            // blank override changes nothing and stays out of the identity, as before.
            if (overrideCategory) {
              formattedRow["col3"] = overrideCategory;
            }
            if (overrideSeason) {
              formattedRow["col4"] = overrideSeason;
            }

            // Clean Season (col4) — NOT "auto-extract Category from it." This used to also guess
            // Category (col3) from substrings inside the Season text whenever Category came in
            // blank or the generic placeholder "PINK" ("...contains SLEEP" -> "VS-SLEEP",
            // "...contains KNIT or LOUNGE" -> literally "PINK", which was flatly wrong for a
            // genuine KNIT/LOUNGE item) — exactly the kind of silent, unrelated-source guessing
            // that caused real, repeated matching failures elsewhere in this file (see the
            // Smart-fallback-for-Category comment above). If a file doesn't have Category as its
            // own real column value, leave col3 blank; don't infer it from Season text.
            //
            // The one thing kept: recognizing Season is JUST a category name and nothing else
            // (an exact "KNIT"/"LOUNGE"/"PINK" match) is cleanup of redundant noise in Season,
            // not an assumption about Category — it only fires when Category is already known.
            // Best-effort season code from the file name — used only to REPLACE a Season cell
            // that we've already determined isn't a real season (see below).
            const seasonFromFileName = (): string => {
              const f = String(data.file.name || "").toUpperCase();
              if (f.includes("SU27") || f.includes("U27")) return "SU27";
              if (f.includes("SP27") || f.includes("P27")) return "SP27";
              if (f.includes("H26") || f.includes("HO26") || f.includes("HOL26")) return "HO26";
              if (f.includes("FA26") || f.includes("F26")) return "FA26";
              return "";
            };

            if (formattedRow["col4"]) {
              const sUpper = String(formattedRow["col4"]).toUpperCase().trim();
              const currentCat = String(formattedRow["col3"] || "").toUpperCase().trim();

              // Product-line / sub-category words that the PINK/Brandix Graphic Tracking Chart puts
              // in its SEASON column instead of an actual season — the real season lives only in the
              // file name ("U27 PINK APPAREL GRAPHIC TRACKING CHART"). A lone "LOUNGE" in Season is
              // NOT a season: left as-is it becomes part of the row-identity used for matching and
              // never equals the same items' real "SU27" rows, so every re-import silently builds a
              // full DUPLICATE set instead of updating the originals. That's what stranded freshly
              // imported DHL / Strike-Off AWB numbers on brand-new orphan rows while the rows shown
              // in the app still read "NO DHL".
              const LINE_KEYWORDS = new Set([
                "KNIT", "LOUNGE", "PINK", "SPORT", "SLEEP", "APPAREL", "WOVEN",
              ]);
              const seasonIsJustLineWord =
                !/\d/.test(sUpper) &&
                !sUpper.includes(" ") &&
                LINE_KEYWORDS.has(sUpper.replace(/[-/]/g, ""));

              if (currentCat && (sUpper === "KNIT" || sUpper === "LOUNGE" || sUpper === "PINK")) {
                // Category is already known and Season is just that same category name repeated —
                // strip the redundant word, fall back to the file-name season if nothing's left.
                let newSeason = sUpper
                  .replace(/KNIT/g, "").replace(/LOUNGE/g, "").replace(/PINK/g, "").replace(/[-]/g, "").trim();
                if (!newSeason || newSeason.length < 2) newSeason = seasonFromFileName();
                if (newSeason) formattedRow["col4"] = newSeason;
              } else if (seasonIsJustLineWord) {
                // Season cell holds only a line word. Recover the real season from the file name;
                // if the file name has no season either, blank it — a blank Season doesn't block a
                // Style/Graphic/Combo/Ground match, a wrong one does. col3 (Category) is left as-is:
                // the line word is NOT written there, because "LOUNGE" vs an existing row's "PINK"
                // would just reintroduce the same mismatch on Category instead.
                formattedRow["col4"] = seasonFromFileName();
              }
            }

            // Extract Trigger drop window strictly from col4 (Season) BEFORE cleanSeason truncates it
            if (formattedRow["col4"]) {
              const rawSeasonStr = String(formattedRow["col4"]).trim();
              
              if (!formattedRow["col2"] || formattedRow["col2"] === "N/A" || formattedRow["col2"] === "") {
                const extracted = extractTriggerFromSeasonStr(rawSeasonStr);
                if (extracted) {
                  formattedRow["col2"] = extracted;
                }
              }

              formattedRow["col4"] = cleanSeason(rawSeasonStr);
            }

            // NOTE: col2 (Trigger) is deliberately left blank here if it still couldn't be
            // determined from the file. Do NOT default it to "N/A" at parse time — that value
            // would then unconditionally overwrite a real Trigger already saved in the database
            // for this row (see "Apply non-empty imported values" below). The merge-time fallback
            // ("Smart fallback for Trigger") is the only place that's allowed to fall back to "N/A",
            // and only once it has confirmed there's no existing/matching value to preserve.

            // Standardize Graphi-Combo (col6) to ONE canonical stored format, regardless of how
            // the source file wrote it: CO1 -> C1, C01 -> C1, CO2 -> C2, CO12 -> C12 — and, new
            // here, a bare number with no "C" at all (the Tracking Chart/Allocation Chart's own
            // "1", "2", "13") -> "C1", "C2", "C13". normalizeCombo() below already treats these
            // as the identical combo for MATCHING purposes, but until now the STORED value kept
            // whichever spelling the source file happened to use, so the same real item showed
            // up as "1" from one file and "C1" from another — confusing even once matching
            // worked correctly. This only affects brand-new rows: an existing row's col6 is a
            // protected primary key (see "Apply non-empty imported values" below) and is never
            // silently rewritten by a later import, so re-running this on old data won't touch
            // rows that already have a value — use a one-off SQL UPDATE for those instead.
            if (formattedRow["col6"]) {
              const rawCombo = String(formattedRow["col6"]).trim();
              if (/^\d+$/.test(rawCombo)) {
                formattedRow["col6"] = `C${rawCombo.replace(/^0+(?=\d)/, "")}`;
              } else {
                formattedRow["col6"] = rawCombo
                  .replace(/^CO/i, "C")
                  .replace(/^C0+(\d)/i, "C$1");
              }
            }

            // Strict exact composite key matching against existing database rows
            // normalize(): strips leading/trailing whitespace AND normalises all internal
            // line-endings to \n so that "BLACK\r\n54A2" == "BLACK\n54A2"
            const normalize = (v: unknown) =>
              (String(String(String(v || ""))))
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n")
                .trim()
                .toLowerCase();

            // Real data stores combo three different ways depending on the source: the tracking
            // chart keeps col6 as the bare combo ("C2"), the planning sheet's own
            // "GRAPHI-COMBO#" column often combines the graphic name right into the same cell
            // ("GVS27-133 C2", or hyphenated "GVS27-133-C2") — stripping whitespace alone (the old
            // behavior) left that as "gvs27-133c2", which never equals the tracking chart's bare
            // "c2" and failed every match — and the Allocation Chart template writes it as a
            // completely bare number with no "C" at all ("1", "13"). Strip hyphens too, then pull
            // out the TRAILING combo token regardless of whatever graphic-name prefix comes before
            // it, so all three shapes converge to the same "c<n>".
            //
            // A cell that's ENTIRELY digits (no "c" anywhere, e.g. "1", "013") is checked first and
            // treated as if it had that "C" all along — confirmed against real data as the actual
            // cause of a real duplication incident: the Allocation Chart's bare "1".."13" never
            // matched the same items' "C1".."C13" from elsewhere (the old regex below requires a
            // literal "c" to already be present before it'll normalize anything, so a pure number
            // was returned completely unchanged and never compared equal to its "C"-prefixed twin),
            // so every re-import silently created a fresh duplicate set instead of updating.
            const normalizeCombo = (v: unknown) => {
              const raw = (String(String(String(v || ""))))
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n")
                .trim()
                .toLowerCase()
                .replace(/\s+/g, "")
                .replace(/-/g, "");
              if (/^\d+$/.test(raw)) {
                return `c${raw.replace(/^0+(?=\d)/, "")}`;
              }
              const trailing = raw.match(/co?0*(\d+)$/i);
              return trailing ? `c${trailing[1]}` : raw;
            };

            // A CK Sample / Allocation Plan carries no real Combo — its "Graphic - Combo #"
            // column just echoes the graphic code (confirmed against real files: col6 === col7 on
            // every row). Left in place it would be written into the matched DB row's empty Combo
            // field, and a later CK Tracking Chart re-import (whose rows have a genuinely blank
            // Combo) would then fail Strategy 1's exact Combo check against it and duplicate every
            // row. Drop it here when it's just the graphic echoed back on a CK-category row, so it
            // never reaches the merge. col5 is deliberately left as-is: keeping its (equally
            // bogus) value non-blank is what makes Strategy 1 correctly fail for CK instead of
            // over-matching all of a graphic's colorways — see Strategy CK below.
            {
              const ckCat = normalize(formattedRow["col3"] || "").replace(/[^a-z0-9]/g, "");
              const isCkCat = Boolean(data.ckCategory) || ckCat === "ck" || ckCat.startsWith("ckna");
              const col6Norm = normalize(formattedRow["col6"] || "");
              const col7Norm = normalize(formattedRow["col7"] || "");
              if (isCkCat && col6Norm && col7Norm && col6Norm === col7Norm) {
                delete formattedRow["col6"];
              }
              // The "CKP" tracker has a "Category" column holding "Men" / "Women" — that's a
              // product-line qualifier, not the tracked category (CKP is one category). The CK
              // sync already knows the real category from the file name (data.ckCategory), so
              // drop this column now rather than let it pollute col3 / the match identity.
              if (data.ckCategory) {
                delete formattedRow["col3"];
              }
            }

            const incomingStyle = normalize(formattedRow["col5"] || "");
            const incomingCombo = normalizeCombo(formattedRow["col6"] || "");
            const incomingGraphic = normalize(formattedRow["col7"] || "");
            const incomingGround = normalize(formattedRow["col8"] || "");
            const incomingProcess = normalize(formattedRow["col10"] || "");
            const incomingFabricRef = normalize(formattedRow["col13"] || "");
            const incomingAppForm = normalize(formattedRow["col15"] || "");
            // Category + Season MUST be part of row identity. Multiple sheets (different
            // seasons/categories) share the exact same column headers, so a Style+Graphic+
            // Combo+Ground that legitimately repeats across two different seasons/categories
            // (e.g. a carryover graphic reused next season) was being treated as "the same
            // row" and silently merged/overwritten instead of kept as two separate rows —
            // that's what was eating rows during multi-sheet imports.
            // For a CK sync the category is authoritative file-derived data ("CKNA Men's" etc.,
            // from the file name), not a dashboard-filter guess — so unlike overrideCategory it
            // IS folded into the match identity here. This is what stops a CKNA Men's row from
            // blank-tolerantly matching a PINK / VS row that happens to share Graphic+Ground, and
            // what lets it match (and re-label) a legacy bare-"CK" row.
            const incomingCategory = data.ckCategory
              ? normalize(data.ckCategory)
              : normalize(formattedRow["col3"] || "");
            const incomingSeason = normalize(formattedRow["col4"] || "");

            // Guard used by every match strategy below: a candidate DB row is only disqualified
            // by Category/Season when BOTH sides actually have a value and they disagree. If either
            // side is blank (file has no Category/Season column, or the DB row predates it), we
            // don't let that missing data block an otherwise-exact Style/Graphic/Combo/Ground match.
            //
            // Category naming is another case (like Combo, like Fabric Reference) where the
            // tracking chart and the planning sheet use genuinely different conventions for the
            // SAME category — confirmed against real data: the tracking chart stores "VS AE" while
            // the planning sheet's own Category column says "VS-ANGEL ESSENTIALS" for the identical
            // item. That's not a typo, it's an abbreviation: first word kept as-is (the brand code,
            // "VS"), remaining words reduced to their initials ("Angel Essentials" -> "AE"). Reduce
            // both sides through that same rule before comparing, so either form matches the other.
            const categoryCanonical = (v: string): string => {
              // CK sub-brand + gender qualifiers are all the single tracked "CK" category. The
              // CK Tracking Chart import forces col3 to bare "CK" (see data.isCkImport below),
              // but the Allocation / Sample Plan sheet writes the long form in its own Category
              // column — "CKNA Men's", "CKNA Women's", "CK NA", "CK Other Knit", etc. Without
              // collapsing these, the guard sees "CK Other Knit" vs "CK" as a real disagreement
              // and disqualifies every candidate row (and skips Strategy CK, which is gated on
              // this resolving to exactly "CK"), so an allocation-chart import of CK items
              // matches nothing — the "Total Rows: 0" symptom. Nothing else in this domain's
              // Category column starts with "CK", so collapse any "CK…" form to bare "CK".
              const compact = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
              if (compact.startsWith("CK")) return "CK";
              const tokens = v.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
              if (tokens.length <= 1) return tokens.join("");
              const [first, ...rest] = tokens;
              const restForm = rest.length > 1 ? rest.map((t) => t[0]).join("") : rest.join("");
              return first + restForm;
            };
            const seasonCategoryCompatible = (r: EmbellishmentRow) => {
              const dbCategory = normalize(r.col3 || "");
              const dbSeason = normalize(r.col4 || "");
              // When either side is a CK-family category, use the CK rules: legacy bare "CK" is
              // compatible with any of the four specific CK categories (so a sync can re-label an
              // old row), but two DIFFERENT specific CK categories never cross-match, and a CK
              // category is never compatible with a genuine non-CK one (PINK, VS-…). Everything
              // else keeps the existing blank-tolerant + VS-abbreviation behaviour.
              const ckInvolved =
                isCkFamilyCategory(incomingCategory) || isCkFamilyCategory(dbCategory);
              const categoryOk = ckInvolved
                ? ckCategoriesCompatible(incomingCategory, dbCategory)
                : !incomingCategory ||
                  !dbCategory ||
                  incomingCategory === dbCategory ||
                  categoryCanonical(incomingCategory) === categoryCanonical(dbCategory);
              const seasonOk = !incomingSeason || !dbSeason || incomingSeason === dbSeason;
              return categoryOk && seasonOk;
            };

            // Blank-tolerant guard for CK Tracking Chart's Category Line (col43, channel:
            // ML/OP/OUTLET). Different channels of the same Style+Graphic+Ground are separate
            // developments and must not collapse into one database row.
            //
            // "Dispatch To" (col44, destination: NY / HK / NK) is deliberately NOT an identity
            // field. Per the planner, a CK strike-off item IS a graphic + ground colour — the chart
            // simply lists it once per approval route it was sent through, with the same S/off
            // Status on each. Treating those routes as distinct rows double-counted every metric
            // (e.g. 352 "Approved" rows for ~282 real approved items). col44 is still imported as a
            // tracked attribute; it just doesn't split identity anymore. Non-CK imports never
            // populate col43 so this guard is a permanent no-op for them.
            const incomingCategoryLine = normalize(formattedRow["col43"] || "");
            const categoryLineCompatible = (r: EmbellishmentRow) => {
              const dbCategoryLine = normalize(r.col43 || "");
              return (
                !incomingCategoryLine || !dbCategoryLine || incomingCategoryLine === dbCategoryLine
              );
            };

            // BRANDING rows (Graphic Type col19, on either side — the Graphic Development file has
            // no Graphic Type column, so usually it's the DB row that says so): one Style + Graphic
            // + Combo is developed on several body colours, each its own row ("VV-14744" / 10343599
            // / C1 on Pink Cocktail AND on Cheetah). Without Ground in the identity, each file row
            // grabbed whichever same-Style/Graphic/Combo row was still unclaimed and overwrote its
            // Ground. Blank-tolerant, and loose on purpose — grounds are written with and without
            // colour codes / prefixes ("VS Med Htr Grey" vs "VS Med Htr Grey 1NG0"), so it's a match
            // when one compacted value contains the other. Non-branding rows are unaffected.
            const compactGround = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
            const incomingGroundKey = compactGround(formattedRow["col8"]);
            const incomingIsBranding = /branding/i.test(String(formattedRow["col19"] || ""));
            const groundCompatible = (r: EmbellishmentRow) => {
              if (!incomingIsBranding && !/branding/i.test(String(r.col19 || ""))) return true;
              const dbGroundKey = compactGround(r.col8);
              if (!incomingGroundKey || !dbGroundKey) return true;
              return dbGroundKey.includes(incomingGroundKey) || incomingGroundKey.includes(dbGroundKey);
            };

            // Same blank-tolerant guard, for Fabric Reference (col13). A single embellishment item
            // routinely names more than one fabric — a body fabric plus an applique/lace fabric
            // ("FB # 22693, LC # 09947") — and different source sheets list a different subset or a
            // different body-fabric number for the SAME item. Confirmed against real data: the
            // Graphic Chart wrote "FB # 19920, LC # 09947" and the Allocation Chart wrote
            // "FB # 22693, LC # 09947" for style 10356707 / C1 / GVS27-178, and a whole-string
            // equality check split that one item into two rows. So this is compatible when either
            // side is blank, OR the two sides share at least one fabric number — not only when the
            // whole string matches. (Fabric refs get unioned on apply below so no number is lost.)
            const fabricNumsOf = (v: string): Set<string> =>
              new Set((String(v || "").match(/\d{3,7}/g) || []));
            const incomingFabricNums = fabricNumsOf(incomingFabricRef);
            // VS and PINK (VS AE, VS-SLEEP, PINK, PINK-SLEEP, ...) ignore Fabric Reference when
            // matching, per the planner: the same Graphic + Combo + Style + Category + Season is
            // the same item whatever FB number a given chart wrote. Confirmed against real data:
            // the VS AE SU27 Graphic Chart wrote "FB25251" for GVU27-247 / -249 / -251 where the
            // rows already in the database held "FB25152", so the number check turned every one
            // of them into a brand-new duplicate on re-import (and left the DHL number on the twin,
            // so the original still counted as "Submission Pending"). Judged on either side's
            // category so a blank-category file row still matches a VS/PINK database row. The
            // fabric ref itself is still unioned on apply below, so neither number is lost.
            const isVsOrPinkCategory = (v: unknown): boolean =>
              /^(VS|PINK)/.test(String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
            const fabricCompatible = (r: EmbellishmentRow) => {
              if (isVsOrPinkCategory(incomingCategory) || isVsOrPinkCategory(r.col3)) return true;
              if (!incomingFabricNums.size) return true;
              const dbNums = fabricNumsOf(normalize(r.col13 || ""));
              if (!dbNums.size) return true;
              for (const n of incomingFabricNums) if (dbNums.has(n)) return true;
              return false;
            };

            // Merge two Fabric Reference strings into one, unioning their fabric numbers (a body
            // fabric + an applique/lace fabric that arrived on different imports should end up in
            // ONE cell). Each number keeps its own FB/LC prefix; a bare number inherits the last
            // prefix seen, matching how the source sheets write "FB # 22418 22693".
            const mergeFabricRefs = (a: string, b: string): string => {
              const aTrim = String(a || "").trim();
              const bTrim = String(b || "").trim();
              // Only one side actually has a value — there's nothing to union, so keep that
              // side's text exactly as written instead of reconstructing it. Reconstruction
              // below normalizes every number to a bare "PREFIX # NUM", which silently dropped
              // any descriptive detail riding along with it — e.g. "FB22693(APPLIQUE:SOCO
              // SATEEN T2454)" got merged down to just "FB # 22693" on the very first import
              // that touched the row, losing the applique note for good.
              if (!aTrim || !bTrim) return bTrim || aTrim;
              const parse = (s: string): { prefix: string; num: string }[] => {
                const out: { prefix: string; num: string }[] = [];
                let lastPrefix = "FB";
                // The number must stand on its own — not be part of a longer alphanumeric code
                // like "SJCS211BA" or "SSO68178" (CK Tracking Chart references). Without the
                // letter/digit guards on both sides, "SJCS211BA" was parsed as the number "211"
                // and rewritten to "FB # 211", silently destroying the real reference on any
                // re-import that merged it.
                const re = /(FB|LC)?\s*#?\s*(?<![A-Za-z\d])(\d{3,7})(?![A-Za-z\d])/gi;
                let m: RegExpExecArray | null;
                while ((m = re.exec(String(s || "")))) {
                  const prefix = (m[1] || lastPrefix).toUpperCase();
                  lastPrefix = prefix;
                  out.push({ prefix, num: m[2] });
                }
                return out;
              };
              const seen = new Set<string>();
              const merged: string[] = [];
              [...parse(a), ...parse(b)].forEach(({ prefix, num }) => {
                if (seen.has(num)) return;
                seen.add(num);
                merged.push(`${prefix} # ${num}`);
              });
              if (merged.length) {
                // Preserve descriptive detail. If one raw side carries a parenthetical note
                // (applique fabric / colour, e.g. "FB # 22693(APPLIQUE:FB # 22441)") AND already
                // contains every unioned number, return that side VERBATIM rather than the bare
                // "PREFIX # NUM" reconstruction — that reconstruction silently drops the note.
                // The incoming value (b) is preferred over the existing one (a).
                const numsOf = (s: string) =>
                  new Set((String(s).match(/(?<![A-Za-z\d])\d{3,7}(?![A-Za-z\d])/g) || []));
                const unionedNums = merged.map((x) => x.replace(/^.*#\s*/, "").trim());
                for (const side of [bTrim, aTrim]) {
                  if (!side.includes("(")) continue;
                  const sn = numsOf(side);
                  if (unionedNums.every((n) => sn.has(n))) return side;
                }
                // Otherwise still don't lose any parenthetical note that either side had.
                let out = merged.join(", ");
                const notes = Array.from(
                  new Set([
                    ...(String(a).match(/\([^)]*\)/g) || []),
                    ...(String(b).match(/\([^)]*\)/g) || []),
                  ]),
                );
                if (notes.length) out += ` ${notes.join(" ")}`;
                return out;
              }
              // Nothing parsed as an FB/LC-style number — the references are opaque codes
              // (e.g. "SJCS211BA", "SSO68178"). Union them by exact string instead of collapsing.
              const opaque = [String(a || "").trim(), String(b || "").trim()].filter(Boolean);
              const uniqOpaque = Array.from(new Set(opaque));
              return uniqOpaque.join(", ") || (String(b || "").trim() || String(a || "").trim());
            };

            // Ground (fabric color) was tried as part of row identity too, but that broke matching
            // exactly the way Plant did below: a genuine reassignment — the color for this Graphic+
            // Combo+Style actually changes on a later allocation-chart upload — must still match the
            // existing row so it gets updated (and replanned, see __forceReplan above), not be
            // treated as a brand-new item because its ground no longer matches the old one.
            // Combo already disambiguates color within a given Style+Graphic in practice (confirmed
            // against real data: each combo number consistently maps to one specific ground), so
            // Graphic+Combo+Style alone is sufficient identity. Ground is just a field that gets
            // updated on the matched row now, same as Plant.

            // Style has its own cross-source problem, confirmed against real data: the tracking
            // chart sometimes squashes TWO style numbers sharing the same Graphic+Combo into one
            // space-separated field ("10350823 10356691"), while the planning sheet keeps them as
            // genuinely separate rows, one style each ("10356691" alone). Unlike Plant's compound
            // values (which used inconsistent delimiters — "+", "/", etc. — and turned out too messy
            // to compare reliably), this one is simple and consistent: always plain numbers
            // separated by whitespace, so a token-set-overlap fallback is safe here.
            const incomingStyleTokens = new Set(incomingStyle.split(/\s+/).filter(Boolean));
            const styleMatches = (dbStyleRaw: unknown): boolean => {
              const dbStyle = normalize(dbStyleRaw || "");
              // Blank-tolerant, same as the Category/Season/Fabric guards above: a file that
              // doesn't carry a Style column at all (e.g. an Allocation Chart keyed only by
              // Graphic + Combo) must not be blocked from matching an existing DB row just
              // because Style is missing on one side — confirmed against real data: the
              // Allocation Chart has no Style/Flex column whatsoever, so incomingStyle is
              // always "", and without this guard every one of its rows failed Strategy
              // 1/1b/4 and got treated as brand new instead of updating the matching row
              // already created by the main Tracking Chart import.
              if (!incomingStyle || !dbStyle) return true;
              if (dbStyle === incomingStyle) return true;
              const dbStyleTokens = dbStyle.split(/\s+/).filter(Boolean);
              return dbStyleTokens.some((t) => incomingStyleTokens.has(t));
            };

            // Plant was tried as part of row identity, but real data broke it two different ways
            // in practice: a compound tracking-chart value ("ANTLER+ LEEMA") vs. the planning
            // sheet's separate per-plant rows ("ANTLER", "LEEMA") caused near-total match failures
            // even with a set-overlap comparison, since Plant naming conventions vary too much
            // across sheets to compare reliably. Row identity is back to Category + Season + Style
            // + Graphic + Combo + Ground + Fabric — Plant is just a field that gets updated on the
            // matched row now, same as Technique (see the comment above about that same lesson
            // learned earlier).

            // Ignore blank rows with no Style and no Graphic
            if (!incomingStyle && !incomingGraphic) return;

            let existingMatch: EmbellishmentRow | undefined = undefined;
            let matchType: "tracking" | "style" | "new" | "unchanged" = "new";

            const extractGraphicNum = (g: string) => {
              const matches = (g || "").match(/\d{3,5}/g);
              return matches ? matches[matches.length - 1] : "";
            };
            const incomingGraphicNum = extractGraphicNum(incomingGraphic);

            // For a CK-family source, a row's identity is Graphic + Ground colour — nothing else.
            // Per the planner: the CK charts have no real Combo, and their "Factory Reference #"
            // (Style) column is either blank or an unrelated factory code, so it must never enter
            // matching. Confirmed against real data: graphic 478281S carries five colorway rows in
            // the CKNA SPSU27 Women's chart (Doll Pink, Fragrant Lilac, Dusty Olive, BLACK, BRIGHT
            // WHITE), every one with an empty Factory Reference # and no Combo. With Style/Combo
            // blank, Strategies 1/1b/4 degrade to matching on Graphic alone (blank fields are
            // blank-tolerant), so a brand-new colorway (BLACK / BRIGHT WHITE) silently claimed and
            // overwrote an existing colorway's row (Dusty Olive / Fragrant Lilac) — or got dropped
            // in update-only mode — instead of being added. Gate 1/1b/4 off for every CK-family row
            // that has a Graphic and a Ground, so Strategy CK (Graphic + Ground, still guarded by
            // seasonCategoryCompatible + categoryLineCompatible) is the sole identity check: a miss
            // there means a genuinely new colorway. Non-CK imports (PINK, VS) are untouched.
            const ckGraphicOnlyIdentity =
              (Boolean(data.ckCategory) || isCkFamilyCategory(incomingCategory)) &&
              Boolean(incomingGraphic) &&
              Boolean(incomingGround);

            // Row identity = Graphic + Combo + Style. These are the fields that genuinely identify
            // "the same embellishment plan item" across imports. Technique and Ground were both
            // previously part of this match too, but that broke on real data: a row whose Technique
            // got corrected later (e.g. "DIGITAL" -> "SHP"), or whose Ground/fabric color got
            // reassigned on a later allocation-chart upload (same Graphic/Combo/Style), failed every
            // match strategy and got inserted as a brand-new duplicate row instead of updating the
            // existing one. Both are now just fields that get updated on the matched row (see "Apply
            // non-empty imported values" below), same as any other non-identity column.

            // Tracks whether existingMatch actually came from a row already saved in the
            // database (Strategies 1/1b/4, or the intra-file fallback below when it resolves to
            // a real DB row) versus just merging with another new row earlier in THIS same file.
            // Used by skipNewRows below to tell "genuinely new to the database" apart from
            // "duplicate of another new row in this upload" (which still needs to merge, not skip).
            let matchedFromDb = false;

            // Strategy CK: Graphic + Ground only — Style and Combo skipped entirely.
            //
            // A CK Sample / Allocation Plan and the CK Tracking Chart that established the DB rows
            // share exactly ONE real identifier: the graphic code. Confirmed against real files —
            // the plan sheet's "Style" and "Graphic - Combo #" columns both just repeat the
            // graphic code ("4RM871G"), carrying no genuine style or combo; the tracking chart's
            // Style column is the unrelated factory reference ("CKNA008") and it has no Combo
            // column at all. So Strategies 1/1b/4 (which AND-require Combo + Style to line up) can
            // never match a CK plan row — every one silently became a "new" item, or in
            // update-only mode got dropped entirely ("Total Rows: 0").
            //
            // The tracking chart carries each graphic once per colorway — a single AW Reference #
            // appears ~4x, one row per Ground — so Graphic + Ground IS the identity for CK.
            // Graphic alone would match the wrong colorway and leave the rest unplanned. Ground is
            // compared with all whitespace removed: the plan sheet wraps it across lines
            // ("Orchid\nLaces -\n657- 840"), the tracking chart writes it inline
            // ("Orchid Laces - 657- 840") — same value, different wrapping. Nothing beyond
            // whitespace is stripped, so the distinct "... ARCH" / "... TCX" colorways of one
            // graphic stay separate.
            //
            // Runs BEFORE Strategy 1 and is gated on this being a CK source (the sync sets
            // data.ckCategory; a manual file whose own Category is CK-family also qualifies) with
            // a real Ground present, so it never loosens matching for any non-CK source and, for
            // CK, always wins over the Combo/Style-based strategies that can't distinguish
            // colorways here. seasonCategoryCompatible below still enforces that a CKNA Men's row
            // only matches CKNA Men's / legacy-CK rows for the same season — never CKNA Women's,
            // never a different season, even though those can share a Graphic+Ground.
            // Pass 1: imported rows only. Pass 2 (only if pass 1 found nothing): hand-added rows
            // too — see isManualRow above.
            for (const allowManual of [false, true]) {
              if (existingMatch) break;
              if (
                !existingMatch &&
                incomingGraphic &&
                incomingGround &&
                (Boolean(data.ckCategory) || isCkFamilyCategory(incomingCategory))
              ) {
                const stripWs = (v: string) => v.replace(/\s+/g, "");
                const incomingGroundCompact = stripWs(incomingGround);
                const matches = rows.filter(
                  (r) =>
                    !claimedDbIds.has(r.id) &&
                    (allowManual || !isManualRow(r)) &&
                    normalize(String(String(String(String(r.col7 || ""))))) === incomingGraphic &&
                    stripWs(normalize(String(String(String(String(r.col8 || "")))))) === incomingGroundCompact &&
                    seasonCategoryCompatible(r) &&
                    categoryLineCompatible(r)
                );
                if (matches.length >= 1) {
                  existingMatch = matches[0];
                  matchedFromDb = true;
                }
              }

              // Strategy 1: Exact match on Graphic + Combo (Normalized) + Style
              if (!existingMatch && incomingGraphic && !ckGraphicOnlyIdentity) {
                const matches = rows.filter(
                  (r) =>
                    !claimedDbIds.has(r.id) &&
                    (allowManual || !isManualRow(r)) &&
                    normalize(String(String(String(String(r.col7 || ""))))) === incomingGraphic &&
                    normalizeCombo(String(String(String(String(r.col6 || ""))))) === incomingCombo &&
                    styleMatches(r.col5) &&
                    seasonCategoryCompatible(r) &&
                    fabricCompatible(r) &&
                    groundCompatible(r) &&
                    categoryLineCompatible(r)
                );
                if (matches.length >= 1) {
                  existingMatch = matches[0];
                  matchedFromDb = true;
                }
              }

              // Strategy 1b: Match on Style + Graphic Number (e.g. 527) + Combo
              if (!existingMatch && incomingGraphicNum && !ckGraphicOnlyIdentity) {
                const matches = rows.filter(
                  (r) =>
                    !claimedDbIds.has(r.id) &&
                    (allowManual || !isManualRow(r)) &&
                    styleMatches(r.col5) &&
                    normalizeCombo(String(String(String(String(r.col6 || ""))))) === incomingCombo &&
                    extractGraphicNum(normalize(String(String(String(String(r.col7 || "")))))) === incomingGraphicNum &&
                    seasonCategoryCompatible(r) &&
                    fabricCompatible(r) &&
                    groundCompatible(r) &&
                    categoryLineCompatible(r)
                );
                if (matches.length >= 1) {
                  existingMatch = matches[0];
                  matchedFromDb = true;
                }
              }



              // Strategy 4: VS Excel format — Combo ends with the short suffix
              if (
                !existingMatch &&
                incomingGraphic &&
                incomingCombo &&
                !incomingCombo.includes("-") &&
                !ckGraphicOnlyIdentity
              ) {
                const matches = rows.filter((r) => {
                  const dbCombo = normalizeCombo(String(String(String(String(r.col6 || "")))));
                  const dbComboSuffix = dbCombo.split(/[-\s]/).pop() || "";
                  return (
                    !claimedDbIds.has(r.id) &&
                    (allowManual || !isManualRow(r)) &&
                    normalize(String(String(String(String(r.col7 || ""))))) === incomingGraphic &&
                    styleMatches(r.col5) &&
                    dbComboSuffix === incomingCombo &&
                    seasonCategoryCompatible(r) &&
                    fabricCompatible(r) &&
                    groundCompatible(r) &&
                    categoryLineCompatible(r)
                  );
                });
                if (matches.length >= 1) {
                  existingMatch = matches[0];
                  matchedFromDb = true;
                }
              }
            }

            // Check if this is a split variation (same Graphic+Style, different Combo/Ground).
            // Skipped for a CK graphic-only row: its blank Style would "match" every other colorway
            // of the same graphic and wrongly badge a new CK colorway as a split process.
            let isSplitVariation = false;
            if (!existingMatch && incomingGraphic && !ckGraphicOnlyIdentity) {
              const hasGraphicStyleMatch = rows.some(
                (r) =>
                  String(r.manual_entry || "") !== "1" &&
                  normalize(String(String(String(String(r.col7 || ""))))) === incomingGraphic &&
                  normalize(String(String(String(String(r.col5 || ""))))) === incomingStyle,
              );
              if (hasGraphicStyleMatch) {
                isSplitVariation = true;
              }
            }

            // Intra-file deduplication: if 2 rows in the same uploaded file match on composite key, assign same ID.
            // Category/Season are included so the same Style+Graphic+Combo repeating across two
            // seasons in one workbook (carryover graphics) still lands on two separate rows.
            // Fabric Reference and Plant are deliberately NOT part of this key — they're checked as
            // blank-tolerant disqualifiers (fabricCompatible above) at the DB-match level instead,
            // rather than baked into an exact-string key, so a blank Fabric on one duplicate row
            // doesn't wrongly split it from an otherwise-identical row that has it filled in.
            // Dispatch To (col44) is likewise NOT in this key: a CK chart's per-route rows for one
            // graphic + ground + channel are the same item and must fold onto one database row.
            //
            // For a CK graphic-only row the key MUST use the full graphic code, never the
            // extractGraphicNum() digit-run: that helper caps at 5 digits (`/\d{3,5}/`), so the CK
            // codes "478283S" and "478286S" both collapse to "47828" — with Style/Combo blank the
            // rest of the key is identical too, so one graphic's BLACK / BRIGHT WHITE colorway
            // silently folded into the other graphic's same-named colorway and vanished. Confirmed
            // against real data: 478283S was missing BLACK + BRIGHT WHITE while 478286S had them.
            const compKeyGraphic = ckGraphicOnlyIdentity
              ? incomingGraphic
              : incomingGraphicNum || incomingGraphic;
            const compKey = `${incomingStyle}|${incomingCombo}|${compKeyGraphic}|${incomingGround}|${incomingCategory}|${incomingSeason}|${incomingCategoryLine}`;
            if (!existingMatch && compKey && seenFileNewKeysMap.has(compKey)) {
              const reusableId = seenFileNewKeysMap.get(compKey)!;
              const dbRowMatch = rows.find(r => r.id === reusableId);
              existingMatch = dbRowMatch || ({ id: reusableId } as EmbellishmentRow);
              if (dbRowMatch) matchedFromDb = true;
            }

            // "Only update existing rows" mode (opt-in per import — check this specifically when
            // uploading a historical planning sheet, leave it unchecked for the tracking chart
            // that's meant to establish new items). Nothing this file doesn't already match in
            // the database gets created; everything that DOES match still gets its blanks and
            // planning events filled in normally below.
            if (effectiveSkipNewRows && !matchedFromDb) {
              // Update-only mode: this row matches nothing in the database, so it won't be
              // created. Still surface it in the preview (as its own "Skipped" bucket) with
              // enough detail to see what was left out — colour, style, plant, combo,
              // technique — instead of silently dropping it.
              return {
                mergedRow: {
                  ...(formattedRow as EmbellishmentRow),
                  id: `skip_${index}_${Math.random().toString(36).substr(2, 5)}`,
                },
                matchType: "skipped" as const,
                styleCode: String(formattedRow["col5"] || "").trim(),
                graphic: String(formattedRow["col7"] || "").trim(),
                combo: String(formattedRow["col6"] || "").trim(),
              };
            }

            if (existingMatch) {
              // Only a real DATABASE match is an update. existingMatch can also be the new row an
              // EARLIER line of this same file created (intra-file compKey above) — a duplicate line
              // in the file (INQ15: 10350350 / C1 / VV 14744 / Cheetah on lines 9 and 14). That item
              // doesn't exist yet, so it's still "new" (both lines save into one new row).
              if (matchedFromDb) matchType = "style"; // Matched exact existing record in DB
              claimedDbIds.add(existingMatch.id);
            }

            // Does the matched DB row already carry a real planning event? Used below to decide
            // whether this file is allowed to change its Plant: an item that's already being
            // planned keeps its Plant (the change is only surfaced to the planner, never applied
            // silently); an item with no schedule yet takes the Plant from this file.
            const existingMatchHasEvents =
              Boolean(existingMatch) &&
              Object.keys(existingMatch as Record<string, unknown>).some(
                (k) =>
                  /^\d{4}-\d{2}-\d{2}/.test(k) &&
                  String((existingMatch as Record<string, unknown>)[k] || "").trim() !== "",
              );

            // "Added legs" case: the matched row is already scheduled for one or more plants, and
            // this file's Plant lists ALL of those PLUS one or more new ones (e.g. existing
            // "HI EMB" -> file "HI EMB/BFFAV/LEEMA"). The planner's rule: don't touch the plant(s)
            // that are already planned — just add the new legs and schedule ONLY those, from the
            // date picked in the import dialog. This is distinct from a genuine plant reassignment
            // (which still goes through the keep-vs-replan prompt below).
            const legsOf = (v: unknown): string[] => {
              const raw = String(v || "").replace(/\(.*?\)/g, " ").trim();
              if (!raw) return [];
              const out: string[] = [];
              raw
                .split("/")
                .map((g) => g.trim())
                .filter(Boolean)
                .forEach((g) =>
                  g
                    .split(/>>|>/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .forEach((s) => {
                      if (!out.some((o) => o.toUpperCase() === s.toUpperCase())) out.push(s);
                    }),
                );
              return out;
            };
            const isDyeWashLeg = (p: string) =>
              /BFL|MARTEX|DYNAWASH|DYE|WASH/i.test(p);
            let newLegsToSchedule: string[] = [];
            let plantLegsAdded = false;
            if (existingMatch && existingMatchHasEvents && formattedRow["col11"]) {
              const existingLegs = legsOf(existingMatch.col11);
              const fileLegs = legsOf(formattedRow["col11"]);
              const existingUpper = existingLegs.map((l) => l.toUpperCase());
              const fileUpper = fileLegs.map((l) => l.toUpperCase());
              const allExistingKept =
                existingLegs.length >= 1 &&
                existingUpper.every((l) => fileUpper.includes(l));
              const added = fileLegs.filter(
                (l) => !existingUpper.includes(l.toUpperCase()),
              );
              if (
                allExistingKept &&
                added.length >= 1 &&
                !added.some(isDyeWashLeg) &&
                fileLegs.length >= 2
              ) {
                plantLegsAdded = true;
                newLegsToSchedule = added;
              }
            }

            const targetId = existingMatch
              ? existingMatch.id
              : `row_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 5)}`;
            if (compKey) {
              seenFileNewKeysMap.set(compKey, targetId);
            }

            // Build merged row preserving existing database values and updating non-empty fields from CSV
            const mergedRow: EmbellishmentRow = {
              id: targetId,
              ...(existingMatch || {}),
            };
            if (isSplitVariation) {
              mergedRow.__isSplitProcess = "true";
            }

            // If the user uploads an Excel file to serve as the source of truth, and the Excel row
            // has no tracking data, we should CLEAR the database tracking data to fix corrupted/wrong details.
            if (existingMatch) {
              const hasAwb = String(
                row["__awb2"] || row["__awb1"] || "",
              ).trim();
              const hasRawAwb = Object.entries(row).some(([k, v]) => {
                if (k.startsWith("__")) return false;
                const sv = String(String(String(String(v || ""))))
                  .trim()
                  .toUpperCase();
                return (
                  sv.includes("DTC-") ||
                  sv.includes("LTD-") ||
                  sv.startsWith("DHL") ||
                  sv.startsWith("AWB")
                );
              });

              if (!hasAwb && !hasRawAwb) {
                mergedRow["col24"] = ""; // Clear DHL tracking
                mergedRow["col35"] = ""; // Clear Strike-Off submission #
              }
            }

            // Sent to NY (DHL on the chart) and the matched row already has an NY in its plan: mark
            // the row's OWN planned NY green (per plan: the bare plan and every per-leg
            // "<date>_<PLANT>" plan) instead of stamping a new NY on the DHL date. The DHL-date key
            // used to also count as an "incoming date" below, which wiped the whole existing plan
            // and left just NY|P on the DHL date (GVF27-014, 9/18) — every later event lost.
            //
            // Both chart-DERIVED dates (DHL -> NY, fabric-in -> FR) are only for rows with no plan
            // yet: on a row that already has events they're dropped here, so they never count as
            // "incoming dates" and never trigger the wipe below.
            const nyPassKeys: string[] = [];
            if (existingMatchHasEvents && fabricFrKey && formattedRow[fabricFrKey] === "FR") {
              delete formattedRow[fabricFrKey];
            }
            if (existingMatch && dhlNyKey) {
              const nyGroups = new Map<string, string[]>(); // "" = bare plan, else leg suffix
              Object.entries(existingMatch).forEach(([k, v]) => {
                const m = k.match(/^(\d{4}-\d{2}-\d{2})(_.+)?$/);
                if (!m || typeof v !== "string" || !v.trim()) return;
                if (parseEventValue(v)?.code.toUpperCase() !== "NY") return;
                const g = m[2] || "";
                nyGroups.set(g, [...(nyGroups.get(g) || []), k]);
              });
              if (nyGroups.size > 0) {
                delete formattedRow[dhlNyKey];
                const dhlTime = Date.parse(dhlNyKey);
                nyGroups.forEach((keys) => {
                  const planned = keys.filter(
                    (k) => parseEventValue(String(existingMatch![k]))?.status === "planned",
                  );
                  if (planned.length === 0) return; // this plan's NY already has a verdict
                  const nearest = planned.reduce((a, b) =>
                    Math.abs(Date.parse(b.slice(0, 10)) - dhlTime) < Math.abs(Date.parse(a.slice(0, 10)) - dhlTime) ? b : a,
                  );
                  // Only a DHL sent CLOSE to the planned NY is that NY happening. A DHL weeks away is
                  // a different submission (e.g. DHL 9/9 for the layout strike-off vs an NY planned
                  // 9/28 for the colour-approval round) — that planned NY must stay open, not green.
                  const gapDays = Math.abs(Date.parse(nearest.slice(0, 10)) - dhlTime) / 86_400_000;
                  if (gapDays > DHL_NY_MATCH_MAX_DAYS) return;
                  nyPassKeys.push(nearest); // applied after the merge below
                });
              }
            }

            // If fresh Excel import provides date keys for this row, clear legacy auto-scheduled date keys from existingMatch
            // The DHL-date NY fallback (row has a plan but no NY in it) is added, never a reason to
            // wipe that plan.
            const hasIncomingDates = Object.keys(formattedRow).some((k) =>
              k.match(/^\d{4}-\d{2}-\d{2}$/) && formattedRow[k] && k !== dhlNyKey
            );
            // A Planning Sheet import is purely additive — never wipe dates the database already
            // has just because this particular row/file doesn't happen to also cover them (e.g.
            // this row's real historical range predates or postdates what's in the current file).
            // The merge loop below already applies every date key this row DOES carry.
            if (!effectiveSkipNewRows && existingMatch && hasIncomingDates) {
              // Set to "" rather than deleting the key — mergedRow keeps existingMatch's own row
              // id, and the server merges a save's schedule fields onto whatever it already has
              // stored for that id (see server/db.js) rather than replacing it outright, so a
              // deleted (i.e. absent) key here would leave the legacy date sitting in the database
              // untouched instead of actually clearing it, no matter how clean mergedRow looks
              // going into the "apply imported values" step below.
              Object.keys(mergedRow).forEach((k) => {
                if (k.match(/^\d{4}-\d{2}-\d{2}$/)) {
                  (mergedRow as Record<string, unknown>)[k] = "";
                }
              });
            }

            // Apply non-empty imported values from CSV
            Object.entries(formattedRow).forEach(([k, v]) => {
              if (v !== undefined && v !== "") {
                if (existingMatch) {
                  const existingValue = String(String(String(String(String(existingMatch[k] || ""))))).trim();
                  const isEmpty = existingValue === "" || existingValue === "-";
                  const isDateKey = /^\d{4}-\d{2}-\d{2}$/.test(k);

                  // Plant (col11): a matched row that ISN'T being planned yet takes this file's
                  // Plant — even in update-only / planning-sheet mode, where blanks are normally
                  // the only thing filled in. A matched row that ALREADY has a schedule keeps its
                  // Plant untouched here; the difference is instead recorded in plantChangeConflicts
                  // below so the planner is told rather than having it changed under them.
                  if (k === "col11" && !isEmpty) {
                    // Take the file's Plant when the row isn't planned yet, OR when the file only
                    // ADDS legs to an already-planned row (existing plants kept — see plantLegsAdded).
                    // A genuine reassignment on a planned row is left for the keep-vs-replan prompt.
                    if (!existingMatchHasEvents || plantLegsAdded) {
                      mergedRow[k] = v;
                    }
                    return;
                  }

                  // Fabric Reference (col13): take ALL of the file's reference data. mergeFabricRefs
                  // unions every fabric/lace number from both sides AND keeps any descriptive
                  // "(APPLIQUE:...)" / colour notes the file carries — so a chart cell like
                  // "FB # 22693(APPLIQUE:FB # 22441)" is stored in full, never collapsed to a bare
                  // "FB # 22693". Runs in every mode (including planning-sheet / update-only), since
                  // it only ever adds reference detail, never removes it.
                  if (k === "col13" && !isEmpty) {
                    mergedRow[k] = mergeFabricRefs(existingValue, String(v));
                    return;
                  }

                  if (effectiveSkipNewRows) {
                    // A Planning Sheet import only fills in BLANK fields and always applies
                    // planning-event dates — it never overwrites a field the database already
                    // has a value for. (Status/col1 is excluded from formattedRow entirely
                    // above, so it can never reach here regardless.)
                    if (isDateKey || isEmpty) {
                      mergedRow[k] = v;
                    }
                  } else {
                    // Protect primary keys from being overwritten to prevent base data corruption/cross-pollination
                    const isPrimaryKey = k === "col5" || k === "col6" || k === "col7";
                    if (!isPrimaryKey || isEmpty) {
                      mergedRow[k] = v;
                    }
                  }
                } else {
                  // For entirely new rows, insert all available data
                  mergedRow[k] = v;
                }
              }
            });

            nyPassKeys.forEach((k) => {
              (mergedRow as Record<string, unknown>)[k] = encodeEventValue("NY", "pass");
            });

            // Fallback: the allocation chart sometimes leaves Plant (col11) blank on rows whose
            // Plant Flow (col12) already spells out the same plants around a wash/dye vendor
            // ("BFL WA01055>>REGAL", "REGAL IMAGE/MRC>>BFL WA01055>>REGAL IMAGE/MRC"). Recover
            // col11 from that chain (first non-wash/dye segment, verbatim, "/" structure kept) so
            // the row still has a real Plant to plan / group / dispatch by. Only fills a genuinely
            // blank col11 — never overrides a value the file or the DB row already has.
            if (!String(mergedRow["col11"] || "").trim() && mergedRow["col12"]) {
              const recovered = plantFromFlow(String(mergedRow["col12"]));
              if (recovered) mergedRow["col11"] = recovered;
            }

            // Smart fallback for Category (col3)
            //
            // A `selectedCategoryFilter` branch used to sit here: whenever a file's own Category
            // came in blank, it silently stamped whatever category tab happened to be active on
            // the DASHBOARD at import time onto every row — nothing to do with the file's actual
            // data. Confirmed as the cause of a real incident: a Tracking Chart (no Category
            // column of its own) got auto-stamped "PINK" from the dashboard filter, which then
            // permanently conflicted with the SAME items' real Category ("LOUNGE"/"KNIT") from a
            // later Allocation Chart import that DOES carry a genuine Category column — two
            // non-blank, disagreeing values block every match strategy, so the Allocation Chart
            // could never update those rows. Leaving Category blank when the file doesn't supply
            // it is the correct default: blank is blank-tolerant against a later import that DOES
            // know the real value (see seasonCategoryCompatible above), so that later import can
            // still fill it in correctly instead of being permanently blocked by a guess.
            // No more guessing when a file doesn't mention Category: this used to fall back to
            // (1) copying whatever Category some OTHER existing row with the same Graphic
            // happened to have, or (2) pattern-matching keywords in the uploaded FILE NAME
            // ("PINK", "CK", "VS", "AE"...) — neither is data the file itself actually contains.
            // Confirmed as a real, repeated problem: a stray leftover row elsewhere in the
            // database (from unrelated earlier testing) with the same Graphic could silently
            // poison every future import of that Graphic with its Category, with no connection to
            // the file being imported or which button was used — nearly impossible to diagnose
            // from the import dialog alone. If a file doesn't mention Category, leave it blank;
            // blank is blank-tolerant against a later import that DOES know the real value (see
            // seasonCategoryCompatible above), so that later import can still fill it in
            // correctly instead of the row being stuck with an unrelated guess.
            if (overrideCategory) {
              mergedRow.col3 = overrideCategory;
            }

            // A CK Tracking Chart import stamps its resolved Category (col3) unconditionally, on
            // new rows AND on matched existing ones (mergedRow starts from existingMatch here, so
            // this is what re-labels a legacy bare-"CK" row into "CKNA Men's" / "CKNA Women's" /
            // "CKP" / "Other Knit" once the sync matches it). Overrides whatever the fallback
            // chain above landed on. data.ckCategory is the file-name-derived category; it falls
            // back to "CK" when the file name isn't recognisable. Category being CK-family is what
            // getRowStatus (lib/db.ts) and the Advanced Analytics pending calc key off to route a
            // row onto the S/off Status letter-code path instead of the VS/PINK comment cascade.
            if (data.ckCategory) {
              mergedRow.col3 = data.ckCategory;
            } else if (data.isCkImport) {
              mergedRow.col3 = "CK";
            }

            // Smart fallback for Season (col4)
            if (overrideSeason) {
              mergedRow.col4 = overrideSeason;
            }

            // Legacy cleanup: older imports aliased the charts' "MOVED / REALLOCATED" column into
            // col2 (Trigger). That was wrong — a reallocation/move-out is an exit disposition, not a
            // Trigger. Any such value still sitting in col2 (from a row not yet re-imported) is moved
            // over to col20 (where getRowStatus reads it as Dropped) and the Trigger is cleared so it
            // falls back to the season below.
            {
              const c2legacy = String(mergedRow.col2 || "").trim();
              if (/re-?allocat/i.test(c2legacy) || /\bmov(?:e|ed|ing)\b/i.test(c2legacy)) {
                mergedRow.col20 = c2legacy;
                mergedRow.col1 = "Dropped";
                mergedRow.col2 = "";
              }
            }

            // Smart fallback for Trigger (col2). A Trigger is required — every Trigger drives an AOQ
            // deadline — so a row with no Trigger AND no drop code in its Season cell ("2.35",
            // "10/28", "ICON SHOP") falls back to the season code itself ("SU27"). An existing "N/A"
            // counts as "no Trigger" here so those rows get backfilled on the next import; a real
            // stored Trigger is left untouched.
            const c2now = String(String(String(String(mergedRow.col2 || "")))).trim();
            if (!c2now || c2now.toUpperCase() === "N/A") {
              // CK Tracking Charts have no drop-code column at all — a CK row's Trigger is ALWAYS
              // just its own season (verified: 0 CK rows carry a non-season trigger). So for a CK
              // import, skip the copy-from-another-row-with-the-same-graphic step entirely: that
              // step is what made a carryover graphic's SP27 rows inherit "FA27" from the FAWI
              // chart and show up under an FA27 trigger bucket inside the SP27 view. Non-CK imports
              // (VS / PINK) keep the exact original fallback: real drop-code triggers ("10/28",
              // "ICON SHOP") do get carried across from a sibling row with the same graphic.
              const triggerMatch = data.isCkImport
                ? null
                : rows.find(
                    (r) =>
                      r.col7 &&
                      (String(String(String(String(r.col7 || ""))))).trim().toLowerCase() ===
                        (String(String(String(String(mergedRow.col7 || ""))))).trim().toLowerCase() &&
                      r.col2 &&
                      String(String(String(String(r.col2 || "")))).trim() &&
                      String(r.col2).trim().toUpperCase() !== "N/A",
                  );
              if (triggerMatch && triggerMatch.col2) {
                mergedRow.col2 = triggerMatch.col2;
              } else if (mergedRow.col4 && String(mergedRow.col4).trim()) {
                // col4 is already the cleaned season code at this point (see cleanSeason above).
                mergedRow.col2 = String(mergedRow.col4).trim();
              } else {
                mergedRow.col2 = "N/A";
              }
            }

            // If an existing row was previously marked as Dropped in the database,
            // but the new Excel file does NOT have it marked as dropped (no grey background),
            // we should reset its status to Reactivated instead of keeping it Dropped forever,
            // UNLESS it was explicitly marked as Approved in the new file.
            // A Planning Sheet import never touches Status at all — see effectiveSkipNewRows above.
            //
            // This heuristic only makes sense when the incoming file gives NO status of its own.
            // A CK Tracking Chart's "S/off Status" column is authoritative (A/D/SP/CP/H → stamped
            // as __ckStatusResolved above): its verdict — Dropped, Hold, or anything else — must
            // never be silently flipped to "Reactivated". Doing so was turning every CK row that
            // stayed Dropped across two syncs into a fake "Submission Pending" active item.
            // Scoped to CK imports only — VS/PINK imports keep the exact reactivation behaviour
            // they had before (they have no S/off Status column and never resolve to "Hold").
            const ckResolved = String(row["__ckStatusResolved"] || "");
            const incomingStatusLower = String(formattedRow.col1 || "").trim().toLowerCase();
            const incomingSaysNotActive =
              Boolean(data.isCkImport) &&
              (incomingStatusLower === "dropped" || incomingStatusLower === "hold");
            if (
              !effectiveSkipNewRows &&
              !ckResolved &&
              !incomingSaysNotActive &&
              existingMatch &&
              existingMatch.col1 === "Dropped" &&
              !row["__isGreyDropped"] &&
              !isRowTextDropped
            ) {
              if (mergedRow.col1 !== "Approved") {
                mergedRow.col1 = "Reactivated";
              }
            }

            // Check if anything actually changed compared to the existing database row.
            // Collect EVERY changed field (not just the first one) so the import preview
            // can show the user the full list of updates a PATCH will apply.
            if (existingMatch && Object.keys(existingMatch).length > 1) {
              const fieldDiffs: { key: string; label: string; oldVal: string; newVal: string }[] = [];
              for (const key of Object.keys(mergedRow)) {
                if (key === "id" || key.startsWith("__")) continue;
                // Normalize newlines to \n to avoid false positives when comparing with old database data
                const normalizeStr = (s: unknown) =>
                  String(String(s || ""))
                    .replace(/\r\n/g, "\n")
                    .replace(/\r/g, "\n")
                    .trim();
                const valMerged = normalizeStr(
                  mergedRow[key as keyof EmbellishmentRow] as string,
                );
                const valExisting = normalizeStr(
                  (existingMatch as Record<string, unknown>)[key] as string,
                );

                if (valMerged !== valExisting) {
                  console.log(
                    `Row changed on key ${key}: merged='${valMerged}', existing='${valExisting}'`,
                  );
                  // newDynamicColumns first: a column minted THIS import (see dynamicColumnMap
                  // above) isn't in `columns` yet — that state update lands after this whole
                  // parse pass finishes — so without checking it here the preview would show
                  // brand-new planning-sheet-only fields under their raw "colN" id instead of
                  // their real header text.
                  let label = newDynamicColumns[key] || columns[key] || DEFAULT_COLUMNS[key] || key;
                  if (!columns[key] && !DEFAULT_COLUMNS[key] && !newDynamicColumns[key] && key.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    // Custom schedule date column key (e.g. "2026-08-21") -> readable date
                    label = new Date(key).toLocaleDateString("en-US", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    });
                  }
                  fieldDiffs.push({
                    key,
                    label,
                    oldVal: valExisting,
                    newVal: valMerged,
                  });
                }
              }
              if (fieldDiffs.length === 0) {
                matchType = "unchanged";
              } else {
                (mergedRow as Record<string, unknown>).__diffsJson = JSON.stringify(fieldDiffs);
              }
            }

            // Default Status (col1) if empty — never for a Planning Sheet import (it never
            // touches Status), and moot anyway since that import never creates a row with no
            // prior Status to default in the first place.
            if (
              !effectiveSkipNewRows &&
              (!mergedRow.col1 || !String(String(String(String(mergedRow.col1 || "")))).trim())
            ) {
              mergedRow.col1 = "Active";
            }

            // Auto-schedule the row so all planning events (FS, FR, PPS, NY, NYC, MAST, REAP, PLSD, PLSA)
            // populate — but ONLY when this import didn't already bring real planning dates of its own
            // (a bare "allocation chart" upload: Plant/Process/Application Form filled in, no schedule
            // yet). autoScheduleEmbellishmentRow's own gate (hasAllocationContext) checks exactly those
            // fields, which a FULL historical planning file — like a legacy replan export — also has
            // populated on every row, so it was projecting computed lead-time dates on top of the real
            // imported dates instead of leaving them alone. hasIncomingDates (above) is the correct
            // signal for "this row already carries its own actual planning dates from the file" —
            // trust those as-is and skip auto-scheduling entirely when they're present.
            //
            // A row that already has ANY real dates — however stale — is left completely alone by
            // handleConfirmImport now: import must never invent, extend, or rewrite an existing
            // plan (see the hasExistingEvents comment there). Only a genuinely blank row (no dates
            // at all) is still auto-scheduled.
            //
            // Crucially, none of this can be decided per raw source row: the tracking chart often
            // has the SAME Graphic/Combo/Style/Ground on several rows (one per plant), which the intra-
            // file merge step in handleConfirmImport later unions together field-by-field. If even one
            // of those plant-duplicate rows lacked real dates and got auto-scheduled here on its own, its
            // fabricated "start from today" tail would survive the merge right alongside a sibling
            // duplicate's real dates — they land on different date keys, so neither one overwrites the
            // other. So: never auto-schedule here. Just flag it, and let handleConfirmImport decide once
            // all of this item's duplicate occurrences have already been merged into one.
            //
            // The Planning Sheet button used to be excluded from this entirely, on the theory
            // that "update-only" must also mean "never auto-schedule." Requested explicitly to
            // change: an Allocation Chart uploaded through Planning Sheet (update-only, so it
            // can never create duplicate rows — see effectiveSkipNewRows above) is very often
            // exactly the file that COMPLETES a row's allocation data (Plant + S-Off Requirement
            // going from missing to present), and that completion is real, intentional data from
            // the file, not a fabricated date — so it should trigger scheduling exactly like
            // Import Excel already does in that same situation. This flag only marks the row as
            // "check whether scheduling applies" — handleConfirmImport's own four-case logic
            // (below) still decides what actually happens per row, so a Planning Sheet import
            // still never invents a schedule for a row that already has real dates or wasn't the
            // one that completed the allocation data; it only fires for the same "just completed"
            // and "genuinely blank" cases Import Excel already handles.
            //
            // skipAutoSchedule ("Historical data — don't auto-generate planning dates" in the
            // import dialog) is a second, independent override for the same flag: a one-time bulk
            // import of old records into a fresh database shouldn't have the system invent a brand
            // new schedule for every row that happens to have no dates of its own — those items may
            // simply be finished already, or tracked outside this system entirely. Any real dates
            // the file DOES provide are still applied as-is via the merge logic above regardless.
            // Materialise the NY approval verdict (NYC-A / NYC-R) from the freshly merged
            // strike-off comments — same reconciliation handleUpdateRow runs. Only adds
            // "nycv:" keys (never a real date cell), so it can't create a phantom milestone
            // the way the old "Comment -> NYC" heuristic did.
            const finalRow = deriveNycVerdict(mergedRow);
            if (!skipAutoSchedule) {
              (finalRow as Record<string, unknown>).__needsAutoSchedule = "1";
            }

            // Auto-derive Color Approval (col41) the moment a row's freshly-merged Strike-Off
            // Comments settle into "Approved" during import — same detection the Advanced
            // Dashboard's manual "Sync Approval Cols" button runs (see hasColorApproval), just
            // applied immediately instead of waiting for a separate click. Scoped to Approved
            // rows only: everything else (Comments Pending, C+P, Resubmit, Dropped, ...) is left
            // completely untouched, so this can never stamp a stray N on a row that isn't
            // approved yet. Layout Approval (col40) is set alongside it since a row can't be
            // Approved without Tech & Layout also being signed off.
            // Skip this when the import FILE ITSELF carries an explicit Color Approval column
            // (some CK Tracking Charts do — mapped via the "COLOR APPROVAL"/"COLOUR APPROVAL"
            // header alias into formattedRow.col41 above) — that's the planner's own authoritative
            // value for this row and must win over our comment-scan guess.
            if (
              getRowStatus(finalRow) === "approved" &&
              !String(formattedRow.col41 || "").trim()
            ) {
              finalRow.col40 = "Y";
              finalRow.col41 = hasColorApproval(finalRow) ? "Y" : "N";
            }

            // Auto-derive Approved Date (col39) the same way, from the NY verdict just derived
            // above — so a fresh import needs no separate "Sync Approved Dates" click on the
            // Summary of Graphics page either. Only fires when col39 is blank, so an explicit
            // Approve Date (already on the row, or supplied by this import file's own "Approve
            // Date"/"Approval Date" column) always wins over a comment-derived guess. Also gated
            // to getRowStatus === "approved": parseCommentVerdict skips any line that also
            // mentions a drop, so a graphic approved and LATER dropped (a newer "...DROP" line
            // appended above the older "...APPROVED LAYOUT/TECH/EX" one) would otherwise still
            // get a stamped Approve Date despite col1/col20 already saying Dropped.
            if (
              !String(finalRow.col39 || "").trim() &&
              getRowStatus(finalRow) === "approved"
            ) {
              const approvalVerdict = readNycVerdict(finalRow);
              if (approvalVerdict?.kind === "A") {
                finalRow.col39 = approvalVerdict.iso;
              }
            }

            // Resolve the 1st/2nd S/Off Sent dates and the Drop date the same way, right here at
            // import time, so Summary of Graphics reads them straight off the row instead of
            // re-parsing awb1/awb2/comments on every page load. Computed on finalRow (post-merge)
            // so year-disambiguation (nearestYearIso) sees the row's full accumulated schedule,
            // not just this one sheet row. Never overwrites a value already resolved by an earlier
            // import — only fills in what's still blank.
            const importRefIso = rowRefIso(finalRow);
            if (!String(finalRow.awb1Date || "").trim()) {
              const iso = extractDateFromTrackingText(finalRow.awb1, importRefIso);
              if (iso) finalRow.awb1Date = iso;
            }
            if (!String(finalRow.awb2Date || "").trim()) {
              const iso = extractDateFromTrackingText(finalRow.awb2, importRefIso);
              if (iso) finalRow.awb2Date = iso;
            }
            if (!String(finalRow.dropDate || "").trim() && getRowStatus(finalRow) === "dropped") {
              const iso = extractDropDateIso(finalRow);
              if (iso) finalRow.dropDate = iso;
            }

            // A matched item whose Ground (fabric color), Fabric Reference, or Plant just got
            // REASSIGNED by this import — not filled in for the first time, an actual change from
            // one real value to a different real one — needs its plan redone from scratch, even if
            // some of its events are already colored (pass/fail). The old plan was built for the
            // old fabric/color/plant; it doesn't apply once any of those change. Checked against
            // existingMatch (the row's state before this import touched it), not the merged row.
            if (existingMatch && matchedFromDb) {
              const reassigned = (oldVal: unknown, newVal: unknown) => {
                const o = String(oldVal || "").trim();
                const n = String(newVal || "").trim();
                return o !== "" && n !== "" && o.toUpperCase() !== n.toUpperCase();
              };
              const groundChanged = reassigned(existingMatch.col8, finalRow["col8"]);
              const fabricRefChanged = reassigned(existingMatch.col13, finalRow["col13"]);
              // plantLegsAdded is NOT a reassignment — the existing plant(s) stay, so the shared
              // plan must not be rebuilt; only the new legs get scheduled (see __newLegsToSchedule).
              const plantChanged =
                !plantLegsAdded && reassigned(existingMatch.col11, finalRow["col11"]);
              if (groundChanged || fabricRefChanged || plantChanged) {
                (finalRow as Record<string, unknown>).__forceReplan = "1";
              }
              if (plantLegsAdded && newLegsToSchedule.length) {
                (finalRow as Record<string, unknown>).__newLegsToSchedule =
                  newLegsToSchedule.join("|");
              }

              // A Plant reassignment on a row that ALREADY has a schedule is never applied
              // silently — the merge above left finalRow's Plant untouched (see the col11 branch
              // in "Apply non-empty imported values"), and the planner is asked about it below.
              // `newPlant` here is the value FROM THIS FILE, which is what would be used if the
              // planner chooses to take it.
              const incomingPlantReassign = reassigned(
                existingMatch.col11,
                formattedRow["col11"],
              );
              if (incomingPlantReassign && existingMatchHasEvents && !plantLegsAdded) {
                plantChangeConflicts.push({
                  finalRow: finalRow as Record<string, unknown>,
                  oldPlant: String(existingMatch.col11 || "").trim(),
                  newPlant: String(formattedRow["col11"] || "").trim(),
                  style: String(finalRow["col5"] || "").trim(),
                  graphic: String(finalRow["col7"] || "").trim(),
                  combo: String(finalRow["col6"] || "").trim(),
                  otherReplanReason: groundChanged || fabricRefChanged,
                });
              }
            }

            return {
              mergedRow: finalRow,
              matchType,
              trackingNo: String(finalRow["col24"] || "").trim(),
              styleCode: String(finalRow["col5"] || "").trim(),
              graphic: String(finalRow["col7"] || "").trim(),
              combo: String(finalRow["col6"] || "").trim(),
            };
          },
        ).filter(Boolean) as ParsedImportItem[];

        // Deliberately NOT persisted into the app-wide column config (unlike before). Each
        // unrecognized header still gets its value written onto the row under its own minted
        // colN key above (resolveHeader), so nothing from the file is lost — but it's never
        // registered as a real field/label. That used to happen here, and on a wide legacy
        // planning sheet with dozens of unrecognized headers it meant every single one became a
        // permanent field on the Add/Edit Row form forever after (confirmed: 50+ such columns
        // piled up from one sheet). newDynamicColumns is still used a few lines up (fieldDiffs)
        // to show a friendly label in THIS import's preview only, from the file's own header
        // text — it just never gets written to `columns` any more.

        // Ask once about Plant reassignments that would disturb an existing schedule (e.g. a
        // hand-made cross-dev split being flattened to the file's single plant).
        if (plantChangeConflicts.length > 0) {
          const shown = plantChangeConflicts
            .slice(0, 10)
            .map(
              (c) =>
                `  • ${c.style} ${c.graphic}${c.combo ? " " + c.combo : ""}:  "${c.oldPlant}"  →  "${c.newPlant}"`,
            )
            .join("\n");
          const more =
            plantChangeConflicts.length > 10
              ? `\n  …and ${plantChangeConflicts.length - 10} more`
              : "";
          // During an unattended CK sync, default to the safe choice (keep the existing
          // planned Plant / schedule) rather than blocking the run on a modal dialog.
          const keepExisting = data.ckSyncAuto
            ? true
            : window.confirm(
                `${plantChangeConflicts.length} item(s) already have a planned schedule and this file would change their Plant:\n\n` +
                  shown +
                  more +
                  `\n\n[ OK ]      Keep the existing Plant on these items (schedule left as-is)\n` +
                  `[ Cancel ]  Use the Plant from this file (their schedules get replanned)`,
              );
          plantChangeConflicts.forEach((c) => {
            if (keepExisting) {
              // Merge already left the existing Plant in place; make it explicit and drop the
              // plant-driven replan unless Ground / Fabric also changed.
              c.finalRow.col11 = c.oldPlant;
              if (!c.otherReplanReason) delete c.finalRow.__forceReplan;
            } else {
              // Planner chose the file's Plant — apply it now and force the schedule rebuild
              // (this is the one path where a planned row's Plant actually changes).
              c.finalRow.col11 = c.newPlant;
              c.finalRow.__forceReplan = "1";
            }
          });
        }

        setImportFileName(data.file.name);
        setParsedImportItems(parsedItemsList);
        setImportPlanStartDate(planStartDate || "");
        setImportPreviewOpen(true);
      } catch (err) {
        console.error("CSV/Excel Import failed:", err);
        const errorMessage =
          err instanceof Error ? err.message : "Invalid file format.";
        if (data.ckSyncAuto && ckSyncRef.current?.running) {
          setCkSync((s) =>
            s ? { ...s, running: false, log: [...s.log, `✗ parse failed: ${errorMessage}`] } : s,
          );
        } else {
          alert(`Failed to import file: ${errorMessage}`);
        }
      } finally {
        setIsLoading(false);
      }
  };

  // Confirm and Sync import items from Modal to database
  const handleConfirmImport = async () => {
    if (parsedImportItems.length === 0) return;
    // Defense in depth against the same double-import race the guard in handleImportExcel above
    // exists for — bail if a sync is somehow already in flight (e.g. a very fast double-click
    // before React re-renders the Confirm button as disabled) rather than starting a second write.
    if (isImportSyncingRef.current) return;
    setIsImportSyncing(true);

    try {
      // Snapshot the database exactly as it is right now, BEFORE any import changes are
      // written, so this import can always be undone from the Backup History panel.
      try {
        await createBackup(`Before importing ${importFileName}`, rows, "import");
      } catch (backupErr) {
        console.error("Pre-import backup failed:", backupErr);
        const proceedAnyway = ckSyncRef.current?.running
          ? true
          : window.confirm(
              "Could not save a safety backup before this import (backend may be unreachable). " +
                "Continuing means you WON'T be able to undo this import if something looks wrong.\n\n" +
                "Continue without a backup?"
            );
        if (!proceedAnyway) {
          setIsImportSyncing(false);
          return;
        }
      }

      // "skipped" rows are shown in the preview for visibility only — never written.
      const writableItems = parsedImportItems.filter((item) => item.matchType !== "skipped");
      const allImportedRows = writableItems.map((item) => item.mergedRow);
      const changedItems = writableItems.filter(
        (item) => item.matchType !== "unchanged",
      );

      // Save changed/new rows to database if any
      const rowsToSave: EmbellishmentRow[] = [];
      const idMap = new Map<string, string>(); // Maps old/draft ID to the new current ID

      if (changedItems.length > 0) {
        const dedupMap = new Map<string, EmbellishmentRow>();
        changedItems.forEach((item) => {
          const r = item.mergedRow;
          if (dedupMap.has(r.id)) {
            const existing = dedupMap.get(r.id)!;
            const merged = { ...existing };
            Object.entries(r).forEach(([k, v]) => {
              const strVal = String(String(String(String(v || "")))).trim();
              if (strVal !== "" && strVal !== "-") {
                merged[k as keyof EmbellishmentRow] = v as never;
              }
            });
            dedupMap.set(r.id, merged);
          } else {
            dedupMap.set(r.id, { ...r });
          }
        });
        
        // Resolve the deferred auto-schedule decision now that every duplicate occurrence of
        // each item (e.g. one tracking-chart row per plant) has already been merged into one —
        // see the __needsAutoSchedule comment in processImportFile for why this can't happen any
        // earlier.
        //
        // A row that already carries ANY real planning event (bare or per-leg date key) is left
        // completely untouched by import-triggered scheduling — no matter what else the file
        // changed (Ground/Fabric/Plant reassignment, allocation data going from incomplete to
        // complete, the plan looking stalled/abandoned). Only a genuinely blank row (no dates at
        // all yet — nothing to lose) still gets a fresh auto-schedule below. This used to run four
        // separate cases that could each rewrite or extend an already-planned row's dates —
        // reported directly: "if we have planned any those are getting wiped and again getting
        // new planning" on a tracking-chart re-import. __forceReplan (Ground/Fabric/Plant
        // reassignment) is subject to the exact same rule now — it only actually fires below when
        // the row had no dates to begin with.
        // The date the user picked in the import dialog ("" when they left it blank). Every
        // (re)schedule below starts from here instead of the next working day when it's set.
        const planStart = /^\d{4}-\d{2}-\d{2}$/.test(importPlanStartDate) ? importPlanStartDate : "";

        const deduplicatedRows = Array.from(dedupMap.values()).map((r) => {
          const row = { ...r } as Record<string, unknown>;
          const forceReplan = row.__forceReplan === "1";
          delete row.__forceReplan;
          const neededResolution = row.__needsAutoSchedule === "1";
          delete row.__needsAutoSchedule;

          // A tracking-chart import that leaves this row Dropped wipes its planning
          // events and does NOT schedule (any category — D/H S-off codes, a
          // MOVED/REALLOCATED value, a grey/"dropped" cell all resolve to col1
          // "Dropped" earlier in processImportFile). Each date key is set to "" —
          // not deleted — because the server merges schedule keys and an absent key
          // means "leave as-is", only an explicit "" clears it. Plan Status (col47)
          // then derives to "Dropped" on save.
          if (String(row.col1 || "").trim().toLowerCase() === "dropped") {
            Object.keys(row).forEach((k) => {
              if (/^\d{4}-\d{2}-\d{2}$/.test(k)) row[k] = "";
            });
            return row as EmbellishmentRow;
          }

          // "Added legs" (see plantLegsAdded in processImportFile): the row's Plant just gained
          // one or more new cross-dev legs while keeping the plant(s) that are already planned.
          // Schedule ONLY the new legs — each as an independent plant doing the full embellishment
          // flow, anchored on the import dialog's date (today if none) — onto their own
          // "<date>_<leg>" keys, and mark each leg diverged. Everything already on the row,
          // including the existing plant's schedule, is left exactly as-is.
          const newLegs = String(row.__newLegsToSchedule || "")
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean);
          delete row.__newLegsToSchedule;
          if (newLegs.length) {
            const now = new Date();
            const legStart = planStart || now.toISOString().split("T")[0];
            newLegs.forEach((leg) => {
              const esc = leg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const legRe = new RegExp(`^\\d{4}-\\d{2}-\\d{2}_${esc}$`, "i");
              // Fresh input: this leg as a lone plant, every dated key stripped.
              const bareInput: Record<string, unknown> = {
                ...row,
                col11: leg,
                col12: legPlantFlow(row.col12, leg),
              };
              Object.keys(bareInput).forEach((k) => {
                if (/^\d{4}-\d{2}-\d{2}(_.*)?$/.test(k)) delete bareInput[k];
              });
              const scheduled = autoScheduleEmbellishmentRow(
                bareInput,
                undefined,
                legStart,
                "S",
                { skipNyNyc: true },
              ) as Record<string, unknown>;
              // Clear any stale keys for this leg, then write the fresh plan under "<date>_<leg>".
              Object.keys(row).forEach((k) => {
                if (legRe.test(k)) row[k] = "";
              });
              Object.keys(scheduled).forEach((k) => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(k) && String(scheduled[k] || "").trim()) {
                  row[`${k}_${leg}`] = scheduled[k];
                }
              });
              row[`_leg_${leg}`] = "1";
            });
            return row as EmbellishmentRow;
          }

          // A row that already carries ANY real planning event (bare or per-leg date key) keeps
          // it exactly as-is — never wiped, never extended, never replaced — regardless of
          // forceReplan or neededResolution below. Only a genuinely blank row (no dates at all)
          // still gets scheduled. See the comment above `planStart` for why.
          const hasExistingEvents = Object.keys(row).some(
            (k) => /^\d{4}-\d{2}-\d{2}(_.+)?$/.test(k) && String(row[k] ?? "").trim() !== "",
          );
          if (hasExistingEvents) return row as EmbellishmentRow;

          if (forceReplan || neededResolution) {
            return autoScheduleEmbellishmentRow(
              row,
              undefined,
              planStart || undefined,
              "S",
              { skipNyNyc: true },
            ) as EmbellishmentRow;
          }
          return row as EmbellishmentRow;
        });

        deduplicatedRows.forEach((r) => {
          const originalRow = rows.find((old) => old.id === r.id);

          if (originalRow) {
            // Check if any Planning-Impact fields changed
            const planningFields = [
              "col2",  // Trigger
              "col8",  // Ground Color ← triggers replan
              "col9",  // Technique(s)
              "col10", // Process
              "col11", // Plant
              "col12", // Plant Flow
              "col13", // Fabric Reference
              "col14", // Fabric In Date
              "col15", // Application Form
              "col16", // Alternative Fabric
              "col18", // Technique Category
              "col27", // S-Off Requirement
            ];

            const normalizeStr = (s: unknown) =>
              String(String(s || "")).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

            const hasPlanningChange = planningFields.some((f) => {
              const valNew = normalizeStr(r[f as keyof EmbellishmentRow]);
              const valOld = normalizeStr(originalRow[f as keyof EmbellishmentRow]);
              return valNew !== valOld;
            });

            const isOriginalFullyComplete = planningFields.every((f) => {
              const val = normalizeStr(originalRow[f as keyof EmbellishmentRow]);
              return val !== "";
            });

            if (hasPlanningChange && isOriginalFullyComplete) {
              // Impacts planning process AND previously complete -> Soft-archive old version & create new version
              const updatedOldRow = { ...originalRow, is_current: false };
              const newId = `row_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
              const newVersionRow = {
                ...r,
                id: newId,
                shared_id: originalRow.shared_id || originalRow.id,
                version_number: (Number(originalRow.version_number) || 1) + 1,
                is_current: true,
                change_reason: `Planning update imported from ${importFileName}`,
                changed_date: new Date().toISOString(),
              };

              rowsToSave.push(updatedOldRow, newVersionRow);
              idMap.set(r.id, newId);
            } else {
              // Non-planning change (e.g. comments, tracking) -> Update in place, no versioning
              const updatedInPlaceRow = {
                ...originalRow,
                ...r,
                id: originalRow.id,
                shared_id: originalRow.shared_id || originalRow.id,
                version_number: Number(originalRow.version_number) || 1,
                is_current: true,
              };
              rowsToSave.push(updatedInPlaceRow);
              idMap.set(r.id, originalRow.id);
            }
          } else {
             // It's a brand new row (draft or otherwise)
             const newId = `row_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
             const newVersionRow = {
               ...r,
               id: newId,
               shared_id: newId,
               version_number: 1,
               is_current: true,
               change_reason: `Initial import from ${importFileName}`,
             };
             rowsToSave.push(newVersionRow);
             idMap.set(r.id, newId);
          }
        });
        
        await saveMultipleRows(rowsToSave);
      }



      const loadedRows = await getAllRows(currentRole);

      // Build ordered list: ALL rows from uploaded file in exact file order at top, followed by remaining DB rows
      const loadedMap = new Map(loadedRows.map((r) => [r.id, r]));
      const topSection: EmbellishmentRow[] = [];
      const seenTopIds = new Set<string>();

      allImportedRows.forEach((r) => {
        // Look up the newly generated ID for this row, if it was changed
        const currentId = idMap.get(r.id) || r.id;
        
        if (!seenTopIds.has(currentId)) {
          seenTopIds.add(currentId);
          // Only push if it exists in the DB (to avoid duplicates or orphaned refs)
          const dbRow = loadedMap.get(currentId);
          if (dbRow) topSection.push(dbRow);
        }
      });

      const remainingSection = loadedRows.filter((r) => !seenTopIds.has(r.id));

      // Put ALL uploaded allocation plan data at the VERY TOP
      setRows([...topSection, ...remainingSection]);

      const logEntry: AuditLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        styleCode: "SYSTEM",
        field: "CSV Data Import",
        oldValue: "Previous workspace content",
        newValue: `Imported and synced ${allImportedRows.length} rows from allocation plan ${importFileName}`,
        userRole: currentRole,
      };
      await saveAuditLog(logEntry);
      setAuditLogs((prev) => [logEntry, ...prev]);

      setImportPreviewOpen(false);
    } catch (err) {
      console.error("Import sync failed:", err);
      if (ckSyncRef.current?.running) {
        setCkSync((s) => (s ? { ...s, running: false, log: [...s.log, `✗ import failed: ${String(err)}`] } : s));
      } else {
        alert("Failed to sync imported data to database.");
      }
    } finally {
      setIsImportSyncing(false);
      // CK sync: this file is done — bump the index so the advance effect feeds the next one
      // (or finishes). Done here rather than in feedCkChartFile so the next file's
      // processImportFile closes over the rows state this save just refreshed.
      if (ckSyncRef.current?.running) {
        setCkSync((s) =>
          s
            ? { ...s, index: s.index + 1, log: [...s.log, `✓ ${s.files[s.index]?.label ?? "file"} imported`] }
            : s,
        );
      }
    }
  };

  const handleBulkPlanApproved = async () => {
    if (rows.length === 0) return;

    const approvedRows = rows.filter(r => (String(String(String(String(r.col20 || ''))))).toUpperCase() === 'APPROVED');
    if (approvedRows.length === 0) {
      alert("No approved graphics found.");
      return;
    }

    let updatedCount = 0;
    const updatedRows = rows.map((r) => {
      if ((String(String(String(String(r.col20 || ""))))).toUpperCase() !== "APPROVED") return r;

      let rowUpdated = false;
      const newRow = { ...r };

      Object.entries(newRow).forEach(([key, val]) => {
        if (key.match(/^\d{4}-\d{2}-\d{2}$/) && typeof val === "string") {
          const upperVal = val.toUpperCase();
          if (upperVal.includes("REAP/FCHP") || upperVal.includes("MAST")) {
            // Only update if it's not already passed or failed
            if (!upperVal.includes("|P") && !upperVal.includes("|F")) {
              const code = upperVal.includes("REAP/FCHP") ? "REAP/FCHP" : "MAST";
              newRow[key] = `${code}|P`;
              rowUpdated = true;
            }
          }
        }
      });

      if (rowUpdated) {
        updatedCount++;
        return newRow;
      }
      return r;
    });

    if (updatedCount > 0) {
      try {
        const rowsToSave = updatedRows.filter((r, i) => r !== rows[i]);
        await saveMultipleRows(rowsToSave);
        setRows(updatedRows);
        alert(`Successfully marked REAP/FCHP and MAST as Passed for ${updatedCount} approved graphics.`);
      } catch (err) {
        console.error("Failed to bulk plan approved items:", err);
        alert("Failed to save bulk planned items.");
      }
    } else {
      alert("No pending REAP/FCHP or MAST events found on approved graphics.");
    }
  };

  // Filter rows based on search bar query OR active plant tab for department portal
  const displayedRows = useMemo(() => {
    // Show ALL versions in the main views (as requested by user)
    let result = [...draftRows, ...rows];

    // Apply Planner Team filter (by Category) ONLY if NOT in advanced mode
    // (Advanced mode has its own sidebar filters for Category)
    if (
      viewMode !== "advanced" &&
      currentRole === "Planner" &&
      selectedTeamFilter !== "All Teams"
    ) {
      result = result.filter((row) => {
        const category = (String(String(String(String(row.col3 || ""))))).toUpperCase();
        if (selectedTeamFilter === "Team VS")
          return category.includes("VS") || category.includes("ANGEL");
        if (selectedTeamFilter === "Team Pink")
          return category.includes("PINK");
        if (selectedTeamFilter === "Team CK")
          return category.includes("CK") || isCkFamilyCategory(category);
        return true;
      });
    }

    // Apply Category Dropdown Filter — skipped in advanced mode, which has its own
    // multi-select Category filter in the sidebar (same rationale as the Team filter above).
    // Without this skip, a single Category picked on the standard dashboard silently caps
    // what the advanced view can ever show, so its own multi-select could never widen past it.
    if (selectedCategoryFilter && viewMode !== "advanced") {
      result = result.filter(
        (row) => (String(String(String(String(row.col3 || ""))))).trim() === selectedCategoryFilter,
      );
    }

    // Apply Season Dropdown Filter (also skipped in advanced mode — sidebar has its own)
    if (selectedSeasonFilter && viewMode !== "advanced") {
      result = result.filter(
        (row) => (String(String(String(String(row.col4 || ""))))).trim() === selectedSeasonFilter,
      );
    }

    // Apply Trigger Dropdown Filter
    if (selectedTriggerFilter) {
      result = result.filter(
        (row) => (String(String(String(String(row.col2 || ""))))).trim() === selectedTriggerFilter,
      );
    }

    // Event-capsule triggers (Super Bowl, …) are hidden from EVERY default view — they're
    // planned/reported on their own, so a plain Category + Season view (standard or advanced)
    // must not fold them in on top of the regular seasonal flow. They reappear the moment their
    // Trigger is explicitly picked: standard dashboard via selectedTriggerFilter (above),
    // advanced view via the sidebar Trigger multi-select (advancedSelections.trigger, applied
    // further down). See isHiddenEventTrigger.
    const aTriggerPicked =
      viewMode === "advanced"
        ? advancedSelections.trigger.length > 0
        : !!selectedTriggerFilter;
    if (!aTriggerPicked) {
      result = result.filter((row) => !isHiddenEventTrigger(row.col2));
    }

    // Apply Plan Status (col47) Filter — planning-lifecycle flag, standard dashboard only.
    if (selectedPlanStatusFilter !== "All" && viewMode !== "advanced") {
      result = result.filter((row) => {
        const ps = derivePlanStatus(row as unknown as Record<string, unknown>);
        if (selectedPlanStatusFilter === "Unplanned") return ps === "";
        return ps === selectedPlanStatusFilter;
      });
    }

    // Apply DHL Tracking Filter (3-state: all, withDhl, noDhl)
    // "noDhl" = Not Dispatched: rows with no DHL, no comments, no AOQ, not approved (i.e. !isRowSent).
    // This is a DISPATCH filter, not the status "Submission Pending" — that lives on the Status
    // dropdown ("Pending" = getRowStatus === "pending") and on DashboardStats card #5.
    if (dhlFilter === "withDhl") {
      result = result.filter((row) => (String(String(String(String(row.col24 || ""))))).trim() !== "");
    } else if (dhlFilter === "noDhl") {
      result = result.filter((row) => !isRowSent(row));
    }

    // Apply Color Approval Filter — state is computed over ALL rows so a combo's colour sign-off
    // on a row hidden by other filters still counts.
    if (colorFilter !== "all") {
      const byCombo = colorApprovalByCombo(rows);
      result = result.filter((row) => byCombo.get(comboKeyOf(row)) === colorFilter);
    }

    // Apply Status Filter (Bypass in Advanced Mode so the Sidebar Filters can handle status)
    if (viewMode !== "advanced") {
      if (selectedStatusFilter === "Active") {
        // "Active" excludes both Dropped and Hold (CK "H" — CROSS DEVELOPMENT): a held item is
        // paused, not a live submission, so it's kept out of the working set like a dropped one.
        result = result.filter((row) => {
          const s = getRowStatus(row);
          return s !== "dropped" && s !== "hold";
        });
      } else if (selectedStatusFilter === "Dropped") {
        result = result.filter((row) => getRowStatus(row) === "dropped");
      } else if (selectedStatusFilter === "Hold") {
        result = result.filter((row) => getRowStatus(row) === "hold");
      } else if (selectedStatusFilter === "Approved") {
        result = result.filter((row) => getRowStatus(row) === "approved");
      } else if (selectedStatusFilter === "C+P") {
        result = result.filter((row) => getRowStatus(row) === "c+p");
      } else if (selectedStatusFilter === "Pending") {
        // The actual submission pendings — same rule as the Submission Pending card: combos
        // (Style|Graphic|Combo|Ground) whose strike-off hasn't gone to NY yet (no DHL / strike-off
        // comment on any live row; CK on its SP code), Branding/Trial left out. One row per combo
        // so the table count equals the card, not one line per trigger (KNIT + LOUNGE twins).
        result = groupRowsByCombo(result.filter((r) => !isExcludedFromAdvancedAnalytics(r)))
          .filter((g) => getGroupStatus(g) === "pending")
          .map((g) => g.find((r) => getRowStatus(r) === "pending") ?? g[0]);
      } else if (selectedStatusFilter === "Resubmit") {
        result = result.filter((row) => getRowStatus(row) === "resubmit");
      }
    }

    // Apply strict plant department tab filters
    if (currentRole === "Plant Department") {
      result = result.filter(
        (row) => (row.col11 || "Plant A") === activePlantTab,
      );
    }

    // Apply strict header filter if active (filters by Graphic, Style, or Combo code)
    if (selectedGraphicFilter) {
      result = result.filter(
        (row) =>
          row.col7 === selectedGraphicFilter ||
          row.col5 === selectedGraphicFilter ||
          row.col6 === selectedGraphicFilter,
      );
    }

    // Apply fuzzy text search bar query — searches across all key identity columns
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter((row) => {
        const graphic = (String(String(String(String(row.col7 || ""))))).toLowerCase();
        const style = (String(String(String(String(row.col5 || ""))))).toLowerCase();
        const combo = (String(String(String(String(row.col6 || ""))))).toLowerCase();
        const dhl = (String(String(String(String(row.col24 || ""))))).toLowerCase();
        const category = (String(String(String(String(row.col3 || ""))))).toLowerCase();
        const season = (String(String(String(String(row.col4 || ""))))).toLowerCase();
        const plant = (String(String(String(String(row.col11 || ""))))).toLowerCase();
        // Combined "graphic + combo" string (e.g. "gpf26-335 c22") so a pasted/typed
        // combined search phrase matches, same as what the Graphic column now displays.
        const graphicCombo = `${graphic} ${combo}`.trim();
        return (
          graphic.includes(query) ||
          style.includes(query) ||
          combo.includes(query) ||
          graphicCombo.includes(query) ||
          dhl.includes(query) ||
          category.includes(query) ||
          season.includes(query) ||
          plant.includes(query)
        );
      });
    }

    // Apply advanced selections if in advanced mode — each filter is independent (OR within, AND across)
    if (viewMode === "advanced") {
      if (advancedSelections.category.length > 0) {
        result = result.filter((r) => {
          if (!r.col3) return false;
          // cleanCategory merges KNIT/LOUNGE into "PINK" (display-time only — the
          // stored r.col3 value is untouched) so selecting "PINK" also matches rows
          // whose real category is KNIT or LOUNGE.
          const cNorm = cleanCategory(String(r.col3)).toUpperCase();
          return advancedSelections.category.some((sel) => {
            const selNorm = cleanCategory(sel).toUpperCase();
            return (
              cNorm === selNorm ||
              cNorm.includes(selNorm) ||
              selNorm.includes(cNorm)
            );
          });
        });
      }

      if (advancedSelections.season.length > 0) {
        result = result.filter((r) => {
          if (!r.col4) return false;
          const sNorm = String(r.col4)
            .replace(/[\r\n]+/g, " ")
            .trim()
            .toUpperCase();
          return advancedSelections.season.some((sel) => {
            const selNorm = sel
              .replace(/[\r\n]+/g, " ")
              .trim()
              .toUpperCase();
            return (
              sNorm === selNorm ||
              sNorm.startsWith(selNorm) ||
              selNorm.startsWith(sNorm) ||
              sNorm.includes(selNorm)
            );
          });
        });
      }

      if (advancedSelections.subCategory && advancedSelections.subCategory.length > 0) {
        result = result.filter((r) => {
          if (!r.col4) return false;
          const sNorm = String(r.col4)
            .replace(/[\r\n]+/g, " ")
            .trim()
            .toUpperCase();
          return advancedSelections.subCategory.some((sel) => {
            const selNorm = sel
              .replace(/[\r\n]+/g, " ")
              .trim()
              .toUpperCase();
            return (
              sNorm === selNorm ||
              sNorm.includes(selNorm) ||
              selNorm.includes(sNorm)
            );
          });
        });
      }

      if (advancedSelections.plant.length > 0)
        result = result.filter(
          (r) =>
            r.col11 &&
            advancedSelections.plant.some((p) => (String(String(String(String(r.col11 || ""))))).includes(p)),
        );
      if (advancedSelections.graphicType.length > 0)
        result = result.filter(
          (r) =>
            r.col19 &&
            advancedSelections.graphicType.some((gt) =>
              (String(String(String(String(r.col19 || ""))))).includes(gt),
            ),
        );
      if (advancedSelections.trigger.length > 0)
        result = result.filter(
          (r) =>
            r.col2 &&
            advancedSelections.trigger.some((tr) =>
              (String(String(String(String(r.col2 || ""))))).includes(tr),
            ),
        );
      if (advancedSelections.technique.length > 0)
        result = result.filter(
          (r) =>
            r.col9 &&
            advancedSelections.technique.some((tc) =>
              (String(String(String(String(r.col9 || ""))))).includes(tc),
            ),
        );
      if (advancedSelections.riskFactor.length > 0)
        result = result.filter(
          (r) => r.col17 && advancedSelections.riskFactor.includes(String(r.col17)),
        );
      if (advancedSelections.style.length > 0)
        result = result.filter(
          (r) => r.col5 && advancedSelections.style.includes(String(r.col5)),
        );
      if (advancedSelections.ground.length > 0)
        result = result.filter(
          (r) =>
            r.col8 &&
            advancedSelections.ground.some((gr) => (String(String(String(String(r.col8 || ""))))).includes(gr)),
        );
      if (advancedSelections.comment.length > 0)
        result = result.filter(
          (r) => 
            (r.col22 && advancedSelections.comment.includes(String(r.col22))) || 
            (r.col34 && advancedSelections.comment.includes(String(r.col34)))
        );
      if (advancedSelections.graphic.length > 0)
        result = result.filter(
          (r) => r.col7 && advancedSelections.graphic.includes(String(r.col7)),
        );
      if (advancedSelections.combo.length > 0)
        result = result.filter((r) => {
          if (!r.col6) return false;
          const parts = String(String(String(String(r.col6 || "")))).trim().split(/\s+/);
          const comboNum = parts[parts.length - 1]; // e.g. "C01" from "GVH26-496 C01"
          return advancedSelections.combo.includes(comboNum);
        });
      if (advancedSelections.approvalStatus.length > 0)
        result = result.filter(
          (r) => {
            const status = getRowStatus(r);
            const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
            return advancedSelections.approvalStatus.includes(statusLabel);
          }
        );
    }

    // Apply 3-Day S/OFF SLA Watchlist Filter
    if (slaFilter !== "all") {
      result = result.filter((row) => {
        const sla = calculateSoffSlaStatus(row);
        if (slaFilter === "overdue") return sla.status === "OVERDUE";
        if (slaFilter === "dueSoon") return sla.status === "DUE_SOON";
        if (slaFilter === "priority") return sla.status === "OVERDUE" || sla.status === "DUE_SOON";
        return true;
      });

      // Sort by SLA priority score descending (most overdue at top)
      result.sort((a, b) => calculateSoffSlaStatus(b).priorityScore - calculateSoffSlaStatus(a).priorityScore);
    }

    // Deduplicate array by row ID to prevent duplicate React key errors
    const uniqueResult: EmbellishmentRow[] = [];
    const seenIds = new Set<string>();
    for (const r of result) {
      if (!seenIds.has(r.id)) {
        seenIds.add(r.id);
        uniqueResult.push(r);
      }
    }

    return uniqueResult;
  }, [
    rows,
    draftRows,
    selectedGraphicFilter,
    selectedCategoryFilter,
    selectedSeasonFilter,
    selectedStatusFilter,
    selectedPlanStatusFilter,
    selectedTriggerFilter,
    dhlFilter,
    colorFilter,
    slaFilter,
    searchQuery,
    currentRole,
    activePlantTab,
    selectedTeamFilter,
    viewMode,
    advancedSelections,
  ]);

  // Same rows as displayedRows, but excluding archived (is_current: false) versions — for
  // rollup/summary views (Advanced Analytics, Action Center, Score Card, Fabric Dispatch,
  // Dashboard Stats, the SLA Watchlist bar, and the Due-Tomorrow alert) where an old version
  // replanned via handleForceReplan/handleUpdateRow would otherwise get double-counted alongside
  // its replacement — or, for the SLA/due-soon widgets specifically, wrongly surface an archived
  // version's stale date as still "due soon" after it's been superseded by a fresh replan. The
  // main row Table intentionally keeps using displayedRows (all versions) so history stays
  // visible/auditable there.
  const currentVersionRows = useMemo(
    () => displayedRows.filter((r) => r.is_current !== false),
    [displayedRows],
  );

  // Advanced Analytics deliberately drops rows whose Graphic Type (col19) is "branding" or
  // "trial" — brandings (logo/care-label) aren't real graphic developments, and trials aren't
  // production graphics either, so the business doesn't want either inflating any of the
  // Advanced Analytics counts, charts, or tables. Every other view keeps them.
  const advancedAnalyticsRows = useMemo(
    () =>
      currentVersionRows.filter((r) => !isExcludedFromAdvancedAnalytics(r)),
    [currentVersionRows],
  );

  // The universe of options for the Advanced Analytics sidebar dropdowns — every
  // current-version row, NOT scoped by the standard dashboard's filters or by the
  // advanced sidebar's own selections. Without this the Category multi-select
  // could only ever offer whatever's already selected (picking "Other Knit"
  // narrowed advancedAnalyticsRows to Other Knit, so the dropdown then listed
  // only "Other Knit" and you couldn't add a second category).
  const advancedFilterOptionRows = useMemo(
    () =>
      rows.filter(
        (r) => r.is_current !== false && !isExcludedFromAdvancedAnalytics(r),
      ),
    [rows],
  );

  // Trigger Manager deliberately does NOT use currentVersionRows/displayedRows above — those are
  // scoped by whichever Dashboard filters happen to be active (Category/Season/Team/search, and
  // critically the "Active Items" status filter that's the default). A trigger tag used only by
  // Dropped rows (e.g. an old drop code nobody bothered to retag) would then silently vanish from
  // Trigger Manager's list — impossible to see, delete, or merge from there — while still very
  // much existing in the data and still showing up elsewhere that reads unfiltered rows. Trigger
  // Manager's whole job is "every trigger, anywhere," so it gets the full unfiltered current-
  // version set instead (confirmed as a real incident: triggers "46136"/"46141"/"2/10"/"ICON
  // SHOP" — all Dropped-only — were invisible on this page though the API had them all along).
  const allCurrentVersionRows = useMemo(
    () => rows.filter((r) => r.is_current !== false),
    [rows],
  );

  // Revision History needs every version of a graphic: the current rows plus the archived ones.
  const historyRows = useMemo(() => {
    const ids = new Set(rows.map((r) => r.id));
    return [...rows, ...archivedRows.filter((r) => !ids.has(r.id))];
  }, [rows, archivedRows]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const actionCenterCount = useMemo(() => {
    let count = 0;
    for (const row of rows) {
      if (
        row.col1 === "D" ||
        row.col1 === "Dropped" ||
        row.col1 === "Done" ||
        row.col1 === "DONE"
      )
        continue;

      const cat = (String(String(String(String(row.col3 || ""))))).toUpperCase();
      let belongsToTeam = true;
      if (selectedTeamFilter === "Team VS")
        belongsToTeam = cat.includes("VS") || cat.includes("ANGEL");
      else if (selectedTeamFilter === "Team Pink")
        belongsToTeam = cat.includes("PINK");
      else if (selectedTeamFilter === "Team CK")
        belongsToTeam = cat.includes("CK") || isCkFamilyCategory(cat);

      if (!belongsToTeam) continue;

      const missingRiskFactor = !row.col17 || String(String(String(String(row.col17 || "")))).trim() === "";
      const missingGraphicType = !row.col19 || String(String(String(String(row.col19 || "")))).trim() === "";
      const missingApplicationForm = !row.col10 || String(String(String(String(row.col10 || "")))).trim() === "";

      if (missingRiskFactor || missingGraphicType || missingApplicationForm)
        count++;
    }
    return count;
  }, [rows, selectedTeamFilter]);

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-[#09090b] font-sans text-zinc-900 dark:text-zinc-150 overflow-hidden">
      {newVersionRow && (
        <NewVersionModal
          row={newVersionRow}
          onCancel={() => setNewVersionRow(null)}
          onConfirm={(input) => handleCreateNewVersion(newVersionRow, input)}
        />
      )}
      <GlobalSidebar
        currentView={viewMode}
        setViewMode={setViewMode}
        onImportJSON={handleImportJSON}
        onImportExcel={handleImportExcel}
        onImportPlanningSheet={handleImportPlanningSheet}
        onImportCkTrackingChart={handleImportCkTrackingChart}
        onOpenAuditLogs={() => setIsAuditDrawerOpen(true)}
        auditLogsCount={auditLogs.length}
        currentRole={currentRole}
        pendingUpdatesCount={pendingUpdatesCount}
      />

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-auto relative">
        <Header
          currentRole={currentRole}
          userEmail={userEmail}
          pendingUpdatesCount={pendingUpdatesCount}
          rowsSync={rowsSync}
          onRefreshNow={refreshRowsFresh}
          isRefreshingNow={isRefreshingNow}
          onOpenBackups={() => setIsBackupsModalOpen(true)}
          ckSyncSlot={
            <CkSyncButton
              status={ckChartStatus}
              sync={ckSync}
              onRunSync={runCkChartsSync}
              onRefreshStatus={async () => {
                try {
                  setCkChartStatus(await getCkChartStatus());
                } catch {
                  /* ignore */
                }
              }}
              onReloadRows={refreshRows}
            />
          }
          title={
            viewMode === "standard"
              ? "Dashboard"
              : viewMode === "advanced"
                ? "Advanced Analytics"
                : viewMode === "fabricDispatch"
                  ? "Fabric Dispatch"
                  : viewMode === "triggers"
                    ? "Season AOQ Dates"
                    : viewMode === "reports"
                      ? "Reports"
                      : viewMode === "summaryOfGraphics"
                        ? "TNA Report"
                        : viewMode === "scoreCard"
                          ? "Score Card"
                          : viewMode === "plantPerformance"
                            ? "Plant Performance"
                            : viewMode === "plantSchedules"
                            ? "Plant Schedules"
                            : "Action Center"
          }
          subtitle={
            viewMode === "standard"
              ? `Good morning, ${userEmail ? userEmail.split("@")[0] : "User"}. Here's today's overview.`
              : viewMode === "advanced"
                ? ""
                : viewMode === "fabricDispatch"
                  ? "Manage and export fabric requirements for dispatch."
                  : viewMode === "triggers"
                    ? "Set the AOQ fallback deadline per Category + Season."
                    : viewMode === "reports"
                      ? "Export approval reports by Season and Category."
                      : viewMode === "summaryOfGraphics"
                        ? "AWR, S/Off, Approved, and Dropped dates by Category and Season — exportable to Excel."
                        : viewMode === "scoreCard"
                          ? "AOQ-approval performance by plant — click a plant to merge, hide, or see its graphics."
                          : viewMode === "plantPerformance"
                            ? "Monthly PPS performance by plant — green PPS earns points, red PPS loses them."
                            : viewMode === "plantSchedules"
                            ? "Per-plant calendar of upcoming planning events."
                            : "Quickly resolve missing data for new imports."
          }
        />

        <div className="flex-1">
          {viewMode === "actionCenter" ? (
            <ActionCenterView
              rows={currentVersionRows}
              allRows={allCurrentVersionRows}
              onUpdateRow={handleUpdateRow}
              currentRole={currentRole}
            />
          ) : viewMode === "scoreCard" ? (
            <ScoreCardDashboard rows={allCurrentVersionRows} onUpdateRow={handleUpdateRow} currentRole={currentRole} />
          ) : viewMode === "plantPerformance" ? (
            <PlantPerformanceView rows={allCurrentVersionRows} archivedRows={archivedRows} />
          ) : viewMode === "plantSchedules" ? (
            <PlantSchedulesView rows={currentVersionRows} />
          ) : viewMode === "fabricDispatch" ? (
            <FabricDispatchView rows={currentVersionRows} onUpdateRow={handleUpdateRow} />
          ) : viewMode === "triggers" ? (
            <TriggerManagementView rows={allCurrentVersionRows} onUpdateRow={handleUpdateRow} onRowsChanged={refreshRows} currentRole={currentRole} />
          ) : viewMode === "reports" ? (
            <ReportsView rows={allCurrentVersionRows} />
          ) : viewMode === "summaryOfGraphics" ? (
            <SummaryOfGraphicsView rows={allCurrentVersionRows} onUpdateRow={handleUpdateRow} />
          ) : viewMode === "advanced" ? (
            <div className="flex min-h-[calc(100vh-140px)] w-full mt-4">
              <AdvancedSidebarFilters
                rows={advancedFilterOptionRows}
                selections={advancedSelections}
                setSelections={setAdvancedSelections}
              />
              <AdvancedDashboard rows={advancedAnalyticsRows} onAutoApprove={handleAutoApproveCpSp} selections={advancedSelections} onUpdateRow={handleUpdateRow} />
            </div>
          ) : (
            <main className="w-max min-w-full pb-8">
              {/* Main Dashboard Container */}
              {/* Conditional Rendering based on Simulated Portal Role */}
              {currentRole === "Management" ? (
                <div className="sticky left-0 w-[100vw] max-w-[100vw] px-6 pt-8">
                  <ManagementView rows={rows} />
                </div>
              ) : (
                <>
                  <div className="sticky left-0 w-[100vw] max-w-[100vw] z-40 pointer-events-none">
                    <div className="max-w-7xl mx-auto px-6 pt-8 w-full flex flex-col pointer-events-auto">
                  {/* 3-Day Plant S/OFF SLA Priority Watchlist Bar */}
                  <SlaWatchlistBar
                    rows={currentVersionRows}
                    activeFilter={slaFilter}
                    onFilterChange={setSlaFilter}
                    onOpenDueTomorrowAlert={() => setIsDueTomorrowAlertOpen(true)}
                  />

                  {/* Show Dashboard Stats for non-management */}
                  <DashboardStats rows={currentVersionRows} />

                  {/* C+P SP ATTENTION BANNER — Standard Dashboard */}
                  {(() => {
                    const hasCategoryFilter = (selectedCategoryFilter && selectedCategoryFilter !== "") || (advancedSelections?.category && advancedSelections.category.length > 0);
                    const hasSeasonFilter = (selectedSeasonFilter && selectedSeasonFilter !== "") || (advancedSelections?.season && advancedSelections.season.length > 0);
                    if (!hasCategoryFilter && !hasSeasonFilter) return null;

                    const cpSpRows = displayedRows.filter(r => {
                      const c22 = (String(String(String(String(r.col22 || ''))))).trim().toLowerCase();
                      const c34 = (String(String(String(String(r.col34 || ''))))).trim().toLowerCase();
                      return c22.includes('c+p sp') || c34.includes('c+p sp') ||
                             c22.includes('c+p') || c34.includes('c+p');
                    });
                    if (cpSpRows.length === 0) return null;
                    const unapproved = cpSpRows.filter(r => (String(String(String(String(r.col20 || ''))))).toLowerCase() !== 'c+p');
                    return (
                      <div className="mb-4 bg-gradient-to-r from-amber-950/80 via-orange-950/60 to-amber-950/80 border border-amber-500/40 p-4 rounded-xl flex flex-wrap items-center justify-between gap-4 shadow-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-amber-500/20 border-2 border-amber-400/60 flex items-center justify-center text-amber-300 animate-bounce" style={{ animationDuration: '2s' }}>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-amber-300 font-bold text-sm tracking-wider uppercase">C+P SP — Correct and Process</h3>
                              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-200 font-mono font-extrabold border border-amber-500/40">
                                {cpSpRows.length} item{cpSpRows.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <p className="text-amber-200/60 text-xs mt-0.5">
                              Items with &quot;C+P&quot; (Correct and Process) in strike-off comments are automatically updated to <strong className="text-teal-300">C+P</strong>. Review them to verify corrections.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setShowCpSpModal(true)}
                            className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 hover:border-amber-400/80 text-amber-200 text-xs font-bold rounded-lg transition-all uppercase tracking-wider flex items-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            View All
                          </button>
                          {unapproved.length > 0 && (
                            <button
                              onClick={() => handleAutoApproveCpSp(unapproved.map(r => r.id))}
                              className="px-4 py-2 bg-emerald-600/80 hover:bg-emerald-500 border border-emerald-400/50 hover:border-emerald-300 text-white text-xs font-bold rounded-lg transition-all uppercase tracking-wider flex items-center gap-2"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                              </svg>
                              Auto-Approve All ({unapproved.length})
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* C+P SP DETAIL MODAL — Standard Dashboard */}
                  {showCpSpModal && (() => {
                    const cpSpRows = displayedRows.filter(r => {
                      const c22 = (String(String(String(String(r.col22 || ''))))).trim().toLowerCase();
                      const c34 = (String(String(String(String(r.col34 || ''))))).trim().toLowerCase();
                      return c22.includes('c+p sp') || c34.includes('c+p sp') ||
                             c22.includes('c+p') || c34.includes('c+p');
                    });
                    const unapproved = cpSpRows.filter(r => (String(String(String(String(r.col20 || ''))))).toLowerCase() !== 'approved');
                    return (
                      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowCpSpModal(false)}>
                        <div className="bg-[#0c1824] border border-amber-500/30 rounded-xl shadow-2xl w-full max-w-5xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                          {/* Modal Header */}
                          <div className="flex items-center justify-between px-6 py-4 border-b border-amber-500/20 bg-gradient-to-r from-amber-950/60 to-transparent">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                </svg>
                              </div>
                              <div>
                                <h2 className="text-amber-200 font-bold text-base tracking-wider uppercase">C+P SP Items</h2>
                                <p className="text-amber-300/50 text-[10px]">Strike-off comments containing &quot;C+P SP&quot; — Correct and Process</p>
                              </div>
                            </div>
                            <button onClick={() => setShowCpSpModal(false)} className="text-zinc-400 hover:text-white transition-colors p-1">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>

                          {/* Modal Body */}
                          <div className="overflow-auto max-h-[65vh] p-4">
                            <table className="w-full text-left text-xs text-white uppercase tracking-wider">
                              <thead>
                                <tr className="border-b border-zinc-700">
                                  <th className="pb-2 px-2 font-bold text-zinc-400">Style</th>
                                  <th className="pb-2 px-2 font-bold text-zinc-400">Graphic</th>
                                  <th className="pb-2 px-2 font-bold text-zinc-400">Combo</th>
                                  <th className="pb-2 px-2 font-bold text-zinc-400">Category</th>
                                  <th className="pb-2 px-2 font-bold text-zinc-400">Season</th>
                                  <th className="pb-2 px-2 font-bold text-zinc-400">1st S/O Comment</th>
                                  <th className="pb-2 px-2 font-bold text-zinc-400">2nd S/O Comment</th>
                                  <th className="pb-2 px-2 font-bold text-zinc-400">Current Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cpSpRows.map((r) => {
                                  const currentStatus = String(r.col20 || 'Pending').trim();
                                  const isApproved = currentStatus.toLowerCase() === 'approved';
                                  return (
                                    <tr key={r.id} className={`border-b border-zinc-800/50 transition-colors ${
                                      isApproved ? 'bg-emerald-950/30' : 'bg-amber-950/20 hover:bg-amber-950/40'
                                    }`}>
                                      <td className="py-2 px-2 text-zinc-300 text-[10px] font-mono">{r.col5 || '-'}</td>
                                      <td className="py-2 px-2 text-[#00ffd5] text-[10px] font-mono">{r.col7 || '-'}</td>
                                      <td className="py-2 px-2 text-zinc-300 text-[10px]">{r.col6 || '-'}</td>
                                      <td className="py-2 px-2 text-zinc-400 text-[10px]">{r.col3 || '-'}</td>
                                      <td className="py-2 px-2 text-zinc-400 text-[10px]">{r.col4 || '-'}</td>
                                      <td className="py-2 px-2">
                                        {r.col22 ? (
                                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                            (String(String(String(String(r.col22 || ''))))).toLowerCase().includes('c+p') ? 'bg-amber-500/20 text-amber-200 font-bold border border-amber-500/30' : 'text-zinc-300'
                                          }`}>{String(String(String(String(r.col22 || "")))).trim()}</span>
                                        ) : <span className="text-zinc-600 text-[10px]">-</span>}
                                      </td>
                                      <td className="py-2 px-2">
                                        {r.col34 ? (
                                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                            (String(String(String(String(r.col34 || ''))))).toLowerCase().includes('c+p') ? 'bg-amber-500/20 text-amber-200 font-bold border border-amber-500/30' : 'text-zinc-300'
                                          }`}>{String(String(String(String(r.col34 || "")))).trim()}</span>
                                        ) : <span className="text-zinc-600 text-[10px]">-</span>}
                                      </td>
                                      <td className="py-2 px-2">
                                        <span className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase ${
                                          isApproved ? 'bg-green-900/80 text-green-300 border border-green-700/50' : 'bg-red-900/60 text-red-300 border border-red-700/50'
                                        }`}>
                                          {currentStatus}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            {cpSpRows.length === 0 && (
                              <div className="text-center text-zinc-500 text-sm py-12">No items with C+P SP comments found.</div>
                            )}
                          </div>

                          {/* Modal Footer */}
                          <div className="flex items-center justify-between px-6 py-3 border-t border-zinc-800 bg-[#0a1520]">
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                              {cpSpRows.length} total &bull; {unapproved.length} not yet approved
                            </span>
                            <div className="flex gap-2">
                              {unapproved.length > 0 && (
                                <button
                                  onClick={() => { handleAutoApproveCpSp(unapproved.map(r => r.id)); setShowCpSpModal(false); }}
                                  className="px-4 py-1.5 bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-all uppercase tracking-wider flex items-center gap-2"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                  </svg>
                                  Approve All ({unapproved.length})
                                </button>
                              )}
                              <button
                                onClick={() => setShowCpSpModal(false)}
                                className="px-4 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-bold rounded-lg transition-all"
                              >
                                Close
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Plant department selector tabs */}
                  {currentRole === "Plant Department" && (
                    <div className="mb-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-2.5 flex flex-wrap items-center gap-1.5 shadow-sm">
                      <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-3.5 mr-2">
                        Select Plant Schedule:
                      </span>
                      {["Plant A", "Plant B", "Plant C", "Subcontracted"].map(
                        (plant) => (
                          <button
                            key={plant}
                            onClick={() => setActivePlantTab(plant)}
                            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border border-transparent ${
                              activePlantTab === plant
                                ? "bg-blue-600 text-white shadow-sm font-semibold"
                                : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-850"
                            }`}
                          >
                            {plant}
                          </button>
                        ),
                      )}
                    </div>
                  )}

                  <FilterControls
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    selectedGraphicFilter={selectedGraphicFilter}
                    setSelectedGraphicFilter={setSelectedGraphicFilter}
                    selectedCategoryFilter={selectedCategoryFilter}
                    setSelectedCategoryFilter={setSelectedCategoryFilter}
                    selectedSeasonFilter={selectedSeasonFilter}
                    setSelectedSeasonFilter={setSelectedSeasonFilter}
                    selectedTriggerFilter={selectedTriggerFilter}
                    setSelectedTriggerFilter={setSelectedTriggerFilter}
                    selectedStatusFilter={selectedStatusFilter}
                    setSelectedStatusFilter={setSelectedStatusFilter}
                    selectedPlanStatusFilter={selectedPlanStatusFilter}
                    setSelectedPlanStatusFilter={setSelectedPlanStatusFilter}
                    dhlFilter={dhlFilter}
                    setDhlFilter={setDhlFilter}
                    colorFilter={colorFilter}
                    setColorFilter={setColorFilter}
                    selectedTeamFilter={selectedTeamFilter}
                    setSelectedTeamFilter={setSelectedTeamFilter}
                    rows={rows}
                    onOpenConfig={() => setIsConfigOpen(true)}
                    onResetDatabase={handleResetDatabase}
                    currentRole={currentRole}
                    onBulkPlanApproved={handleBulkPlanApproved}
                    />
                    </div>
                  </div>

                  {/* Table Render Container */}
                  <div className="px-6 min-w-max mt-4">
                  {isLoading ? (
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-16 text-center shadow-sm">
                      <div className="flex flex-col items-center justify-center gap-4">
                        {/* Spinner */}
                        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                          Loading plan from local database...
                        </p>
                      </div>
                    </div>
                  ) : (
                    <Table
                      rows={displayedRows}
                      allRows={rows}
                      historyRows={historyRows}
                      columns={columns}
                      onUpdateRow={handleUpdateRow}
                      onDeleteRow={handleDeleteRow}
                      onDeleteMultipleRows={handleDeleteMultipleRows}
                      onDuplicateRow={handleDuplicateRow}
                      onForceReplan={handleForceReplan}
                      onNewVersion={(row) => setNewVersionRow(row)}
                      onClearRowPlan={handleClearRowPlan}
                      onSetPlanStartDate={handleSetPlanStartDate}
                      onApplyPlanFlow={(rowId, dateKey, flowId) =>
                        handleSetPlanStartDate(rowId, dateKey, undefined, flowId)
                      }

                      onAddRow={handleAddRow}
                      onPublishRow={handlePublishRow}
                      selectedGraphicFilter={selectedGraphicFilter}
                      setSelectedGraphicFilter={setSelectedGraphicFilter}
                      currentRole={currentRole}
                    />
                  )}
                  </div>
                </>
              )}
            </main>
          )}
        </div>
      </div>

      {/* Render Settings Config Modal */}
      {Object.keys(columns).length > 0 && (
        <ColumnConfigModal
          isOpen={isConfigOpen}
          onClose={() => setIsConfigOpen(false)}
          columns={columns}
          onSave={handleSaveColumns}
        />
      )}

      {/* Render Audit Drawer */}
      <AuditTrailDrawer
        isOpen={isAuditDrawerOpen}
        onClose={() => setIsAuditDrawerOpen(false)}
        logs={auditLogs}
        onClearLogs={handleClearAuditLogs}
      />

      {/* Render Import Analysis Preview Modal */}
      <ImportPreviewModal
        isOpen={importPreviewOpen}
        fileName={importFileName}
        parsedItems={parsedImportItems}
        onClose={() => setImportPreviewOpen(false)}
        onConfirm={handleConfirmImport}
        isImporting={isImportSyncing}
      />

      {/* Render Import Config Modal */}
      <ImportConfigModal
        isOpen={pendingImportData !== null}
        fileName={pendingImportData?.file.name || ""}
        defaultCategory={selectedCategoryFilter}
        defaultSeason={selectedSeasonFilter}
        availableSheets={pendingImportData?.availableSheets || []}
        defaultSheets={pendingImportData?.defaultSheets || []}
        previewHeaders={pendingImportData?.previewHeaders || []}
        isPlanningSheetImport={pendingImportData?.isPlanningSheetImport || false}
        isCkImport={pendingImportData?.isCkImport || false}
        ckCategory={pendingImportData?.ckCategory || "CK"}
        onCancel={() => setPendingImportData(null)}
        onConfirm={(category, season, selectedSheets, skipNewRows, skipAutoSchedule, planStartDate) => {
          if (pendingImportData) {
            processImportFile(pendingImportData, category, season, selectedSheets, skipNewRows, skipAutoSchedule, planStartDate);
          }
          setPendingImportData(null);
        }}
      />

      {/* Render S/OFF Due Tomorrow Alert Box Modal */}
      <DueTomorrowAlertModal
        isOpen={isDueTomorrowAlertOpen}
        onClose={() => setIsDueTomorrowAlertOpen(false)}
        rows={currentVersionRows}
      />

      {/* Backup History — restore data from before an import or database clear */}
      {isBackupsModalOpen && (
        <BackupsModal
          onClose={() => setIsBackupsModalOpen(false)}
          onRestored={refreshRows}
        />
      )}
    </div>
  );
}
