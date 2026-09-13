"use client";
import React, { useState, useMemo } from "react";
import { EmbellishmentRow, getRowStatus } from "../lib/db";
import { parseEventValue, EVENT_CODES } from "../lib/eventCodes";
import { autoScheduleEmbellishmentRow } from "../lib/planningFlows";
import EventStatusPanel from "./EventStatusPanel";

interface ActionCenterViewProps {
  rows: EmbellishmentRow[];
  // Unfiltered current-version rows, independent of whatever Dashboard filters (Category/Season/
  // Team/status/search) happen to be active — used only for the "Trigger AOQ Dates" group below.
  // Without this, a trigger used only by rows the Dashboard's default filters hide (e.g. Dropped
  // items) would silently vanish from this reminder, same bug already found and fixed on the
  // Trigger Manager page. Falls back to `rows` if not supplied.
  allRows?: EmbellishmentRow[];
  onUpdateRow: (row: EmbellishmentRow) => void;
  currentRole: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function toDateOnly(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function diffDays(target: Date, from: Date) {
  const t = toDateOnly(target);
  const f = toDateOnly(from);
  return Math.round((t.getTime() - f.getTime()) / 86_400_000);
}

function parseDate(raw: string): Date | null {
  if (!raw || raw === "N/A" || raw === "PENDING") return null;
  const iso = new Date(raw);
  if (!isNaN(iso.getTime())) return iso;
  const dayMon = raw.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})(?:[-/\s](\d{2,4}))?$/i);
  if (dayMon) {
    const day = parseInt(dayMon[1], 10);
    const monthStr = dayMon[2];
    const yr = dayMon[3]
      ? dayMon[3].length === 2 ? 2000 + parseInt(dayMon[3], 10) : parseInt(dayMon[3], 10)
      : new Date().getFullYear();
    const mIdx = new Date(`${monthStr} 1, 2000`).getMonth();
    if (!isNaN(mIdx)) return new Date(yr, mIdx, day);
  }
  return null;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function eventLookupLabel(code: string): string {
  const found = EVENT_CODES.find(e => e.code.toUpperCase() === code.toUpperCase());
  return found?.label || code;
}

// ─── types ──────────────────────────────────────────────────────────────────

type UrgencyBucket = "overdue" | "yesterday" | "today" | "tomorrow" | "week" | "future";

interface Notification {
  id: string;
  rowId: string;
  style: string;
  graphic: string;
  combo: string;
  season: string;
  category: string;
  plant: string;
  ground: string;
  fabricRef: string;
  eventCode: string;
  eventLabel: string;
  eventCategory: string;
  date: Date;
  diff: number;
  bucket: UrgencyBucket;
  isScheduleEvent: boolean;
  eventStatus: "planned" | "pass" | "fail";
  dateKey: string;  // the raw "YYYY-MM-DD" schedule key, for editing this exact event
  rawValue: string; // the raw stored value (e.g. "NY-S", "FS|F|11"), for editing this exact event
  // "schedule" = a normal date-keyed planning event (opens EventStatusPanel, the NY/PPS/AWR-style
  // pass/fail editor). "aoq" = the AOQ (col20) approval-still-pending alert below — col20 doesn't
  // use that pass/fail/reason vocabulary at all, it holds a plain verdict word (Approved/Dropped/
  // Resubmit/C+P) once decided, so it gets its own small verdict picker instead.
  // "triggerAoq" = a Trigger-level summary card (see triggerAoqNotifications below) — one entry
  // per Trigger that still has rows awaiting an AOQ decision, not one entry per row. Read-only
  // here; the date itself is set/changed on the Trigger Manager page.
  kind: "schedule" | "aoq" | "triggerAoq";
}

// How many days ahead of an unresolved AOQ (col20) date to start surfacing it as a notification —
// AOQ approval decisions need lead time, so this fires earlier than the 7-day "This Week" window
// used for the schedule events above.
const AOQ_LEAD_DAYS = 21;

// Key date column definitions
const KEY_DATE_COLS: { col: string; label: string; eventCode: string }[] = [
  { col: "col14", label: "Fabric In Date",        eventCode: "FR"   },
  { col: "col23", label: "1st S/OFF Target",       eventCode: "PPS"  },
  { col: "col26", label: "AWR",                    eventCode: "AWR"  },
  { col: "col28", label: "Ready Date (Adv. Plan)", eventCode: "RDPS" },
];

function getBucket(diff: number): UrgencyBucket {
  if (diff < -1)   return "overdue";
  if (diff === -1) return "yesterday";
  if (diff === 0)  return "today";
  if (diff === 1)  return "tomorrow";
  if (diff <= 7)   return "week";
  return "future";
}

function bucketLabel(b: string) {
  const map: Record<string, string> = {
    all: "All", overdue: "Overdue", yesterday: "Yesterday", today: "Today",
    tomorrow: "Tomorrow", week: "This Week", future: "Upcoming",
  };
  return map[b] || b;
}

// ─── main component ──────────────────────────────────────────────────────────

export default function ActionCenterView({ rows, allRows, onUpdateRow }: ActionCenterViewProps) {
  const [now] = useState(() => new Date());
  const [filter, setFilter] = useState<UrgencyBucket | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedSeason, setSelectedSeason] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [editingNotification, setEditingNotification] = useState<Notification | null>(null);

  const uniqueSeasons = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => {
      if (r.col4 && String(String(String(String(r.col4 || "")))).trim()) set.add(String(String(String(String(r.col4 || "")))).trim());
    });
    return Array.from(set).sort();
  }, [rows]);

  const uniqueCategories = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => {
      if (r.col3 && String(String(String(String(r.col3 || "")))).trim()) set.add(String(String(String(String(r.col3 || "")))).trim());
    });
    return Array.from(set).sort();
  }, [rows]);

  const notifications: Notification[] = useMemo(() => {
    const today = toDateOnly(now);
    // Rolling window around today: far enough back to keep nagging about overdue items, forward
    // through the "Upcoming" range. This replaced a "current calendar month" check that silently
    // hid tomorrow / this-week whenever today was the last day of a month (reported: on Aug 31
    // every September event vanished from the Notification Center).
    const PAST_WINDOW_DAYS = 45;
    const FUTURE_WINDOW_DAYS = 45;
    const inWindow = (diff: number) => diff >= -PAST_WINDOW_DAYS && diff <= FUTURE_WINDOW_DAYS;
    const list: Notification[] = [];

    rows.forEach(row => {
      const s = (String(String(String(String(row.col1 || ""))))).trim().toUpperCase();
      if (s === "D" || s.includes("DROP") || s.includes("DONE")) return;

      const style    = String(row.col5 || "N/A");
      const graphic  = String(row.col7 || row.col6 || "N/A");
      const combo = String(row.col6 || "");
      const season = String(row.col4 || "");
      const category = String(row.col3 || "");
      const plant    = String(row.col11 || row.col12 || "Unassigned");
      const ground   = String(row.col8 || "N/A");
      const fabricRef = String(row.col13 || "N/A");

      // 1. Key date columns (REMOVED: User only wants to see planning events)
      // KEY_DATE_COLS.forEach(({ col, label, eventCode }) => { ... });

      // 2. Date-keyed schedule columns (e.g. "2026-07-04": "PPS-S")
      Object.keys(row).forEach(k => {
        if (!k.startsWith("20")) return;
        const raw = row[k];
        if (!raw || typeof raw !== "string") return;
        const d = parseDate(k);
        if (!d) return;
        const diff = diffDays(d, today);
        if (!inWindow(diff)) return;
        const parsed = parseEventValue(raw);
        if (!parsed) return;
        // Show every event on its date — planned ("-S"), pass (|P), fail (|F). Nothing is filtered
        // out here: a pass still shows (rendered green, like the dashboard) so the day's full
        // picture is visible, not just the outstanding items. (Older behaviour hid passes and past
        // "-S" entirely, which silently dropped completed AND un-actioned milestones from view.)
        const code = parsed.code.toUpperCase().replace(/-S$/, "").replace(/-F$/, "");
        const evDef = EVENT_CODES.find(e => e.code.toUpperCase() === code);
        list.push({
          id: `${row.id}-sched-${k}`,
          rowId: row.id,
          style, graphic, combo, season, category, plant, ground, fabricRef,
          eventCode: code,
          eventLabel: eventLookupLabel(code) || raw,
          eventCategory: evDef?.category || "external",
          date: d, diff,
          bucket: getBucket(diff),
          isScheduleEvent: true,
          eventStatus: parsed.status,
          dateKey: k,
          rawValue: raw,
          kind: "schedule",
        });
      });

      // 3. Schedule object
      if (row.schedule && typeof row.schedule === "object") {
        Object.entries(row.schedule as Record<string, unknown>).forEach(([k, v]) => {
          if (!k.startsWith("20") || typeof v !== "string") return;
          const d = parseDate(k);
          if (!d) return;
          const diff = diffDays(d, today);
          if (!inWindow(diff)) return;
          const parsed = parseEventValue(v);
          if (!parsed) return;
          // Same as section 2: show every event (planned / pass / fail); nothing filtered.
          const code = parsed.code.toUpperCase().replace(/-S$/, "").replace(/-F$/, "");
          const evDef = EVENT_CODES.find(e => e.code.toUpperCase() === code);
          list.push({
            id: `${row.id}-schedobj-${k}`,
            rowId: row.id,
            style, graphic, combo, season, category, plant, ground, fabricRef,
            eventCode: code,
            eventLabel: eventLookupLabel(code) || v,
            eventCategory: evDef?.category || "external",
            date: d, diff,
            bucket: getBucket(diff),
            isScheduleEvent: true,
            eventStatus: parsed.status,
            dateKey: k,
            rawValue: v,
            kind: "schedule",
          });
        });
      }

      // 4. AOQ (col20) approval still pending. Until someone records a decision, col20 holds the
      // target AOQ date itself; once decided it gets overwritten with a verdict word (Approved /
      // Dropped / Resubmit / C+P) — see getRowStatus in lib/db.ts. So "pending" status here means
      // exactly one thing: an AOQ date is set and nothing has been decided yet. Surface it once
      // it's within AOQ_LEAD_DAYS, same as everything else, but with a longer runway since
      // approval decisions need more notice than a single planning event.
      if (getRowStatus(row) === "pending") {
        const aoqDate = parseDate(String(row.col20 || ""));
        if (aoqDate) {
          const diff = diffDays(aoqDate, today);
          if (diff <= AOQ_LEAD_DAYS) {
            list.push({
              id: `${row.id}-aoq`,
              rowId: row.id,
              style, graphic, combo, season, category, plant, ground, fabricRef,
              eventCode: "AOQ",
              eventLabel: "AOQ Approval",
              eventCategory: "approval",
              date: aoqDate, diff,
              bucket: getBucket(diff),
              isScheduleEvent: false,
              eventStatus: "planned",
              dateKey: "col20",
              rawValue: String(row.col20 || ""),
              kind: "aoq",
            });
          }
        }
      }
    });

    list.sort((a, b) => a.diff - b.diff);
    return list;
  }, [rows, now]);

  // Trigger-level "still awaiting AOQ" summary — one card per Trigger (not per row), so a bulk
  // AOQ date set on the Trigger Manager page for e.g. 117 rows shows as ONE reminder here instead
  // of 117 near-identical row-level cards. Deliberately NOT gated by AOQ_LEAD_DAYS like the
  // per-row "AOQ Approval" cards above — the whole point is to see every Trigger deadline you've
  // set, however far out, not just the ones about to expire (reported directly: dates set here
  // weren't showing up because they were more than 21 days away).
  const triggerAoqNotifications: Notification[] = useMemo(() => {
    const today = toDateOnly(now);
    const groups = new Map<string, { rows: EmbellishmentRow[]; seasons: Set<string> }>();

    (allRows || rows).forEach(row => {
      const s = (String(String(String(String(row.col1 || ""))))).trim().toUpperCase();
      if (s === "D" || s.includes("DROP") || s.includes("DONE")) return;

      const trigger = String(row.col2 || "").trim();
      if (!trigger || trigger.toUpperCase() === "N/A" || trigger === "-") return;

      // Only rows still genuinely awaiting a decision — same "pending" gate as the per-row AOQ
      // card, and col20 must actually hold a parseable date (not blank, not a resolved verdict).
      if (getRowStatus(row) !== "pending") return;
      if (!parseDate(String(row.col20 || ""))) return;

      if (!groups.has(trigger)) groups.set(trigger, { rows: [], seasons: new Set() });
      const g = groups.get(trigger)!;
      g.rows.push(row);
      const season = String(row.col4 || "").trim();
      if (season) g.seasons.add(season);
    });

    const list: Notification[] = [];
    groups.forEach((g, trigger) => {
      // The soonest pending AOQ date across this Trigger's rows is what actually needs acting on
      // first — that's what drives the urgency bucket/badge, even if most rows share one date.
      const dates = g.rows
        .map(r => parseDate(String(r.col20 || "")))
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime());
      const soonest = dates[0];
      if (!soonest) return;
      const diff = diffDays(soonest, today);

      list.push({
        id: `trigger-aoq-${trigger}`,
        rowId: "",
        style: trigger,
        graphic: "",
        combo: "",
        season: Array.from(g.seasons).sort().join(", "),
        category: "",
        plant: "",
        ground: "",
        fabricRef: "",
        eventCode: "TRIGGER",
        eventLabel: "Trigger AOQ Dates",
        eventCategory: "approval",
        date: soonest,
        diff,
        bucket: getBucket(diff),
        isScheduleEvent: false,
        eventStatus: "planned",
        dateKey: "col20",
        rawValue: `${g.rows.length} row${g.rows.length === 1 ? "" : "s"}`,
        kind: "triggerAoq",
      });
    });

    list.sort((a, b) => a.diff - b.diff);
    return list;
  }, [rows, allRows, now]);

  const allNotifications = useMemo(
    () => [...notifications, ...triggerAoqNotifications],
    [notifications, triggerAoqNotifications],
  );

  const filtered = useMemo(() => {
    let r = allNotifications;
    if (filter !== "all") r = r.filter(n => n.bucket === filter);
    if (selectedSeason !== "all") r = r.filter(n => n.season === selectedSeason);
    if (selectedCategory !== "all") r = r.filter(n => n.category === selectedCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(n =>
        n.style.toLowerCase().includes(q) ||
        n.graphic.toLowerCase().includes(q) ||
        n.plant.toLowerCase().includes(q) ||
        n.eventLabel.toLowerCase().includes(q) ||
        n.eventCode.toLowerCase().includes(q) ||
        n.season.toLowerCase().includes(q) ||
        n.category.toLowerCase().includes(q)
      );
    }
    return r;
  }, [allNotifications, filter, search, selectedSeason, selectedCategory]);

  const counts = useMemo(() => {
    const c = { overdue: 0, yesterday: 0, today: 0, tomorrow: 0, week: 0, future: 0, all: allNotifications.length };
    allNotifications.forEach(n => { c[n.bucket]++; });
    return c;
  }, [allNotifications]);

  const todayStr = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] w-full bg-[#0a0a0f] text-white overflow-hidden">

      {/* ── Header ── */}
      <div className="shrink-0 px-8 pt-7 pb-5 bg-gradient-to-r from-[#0a0a0f] via-[#0f1020] to-[#0a0a0f] border-b border-zinc-800">
        <div className="flex items-start justify-between gap-6 max-w-[1400px] mx-auto flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center text-2xl shadow-lg shadow-amber-500/10">
              🔔
            </div>
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight">Notification Center</h1>
              <p className="text-sm text-zinc-400 mt-0.5 font-medium" suppressHydrationWarning>
                {todayStr}&nbsp;·&nbsp;{fmtTime(now)}
              </p>
            </div>
          </div>

          {/* Summary stat chips */}
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {counts.overdue > 0 && <StatChip label="Overdue"   value={counts.overdue}  color="rose"   />}
            {counts.yesterday > 0 && <StatChip label="Yesterday" value={counts.yesterday} color="fuchsia" />}
            {counts.today   > 0 && <StatChip label="Due Today" value={counts.today}    color="amber"  />}
            {counts.tomorrow > 0 && <StatChip label="Tomorrow" value={counts.tomorrow} color="orange" />}
            <StatChip label="This Week"  value={counts.week}  color="blue" />
            <StatChip label="All Events" value={counts.all}   color="zinc" />
          </div>
        </div>

        {/* Filter chips + search */}
        <div className="flex flex-wrap items-center gap-3 mt-5 max-w-[1400px] mx-auto">
          {(["all", "overdue", "yesterday", "today", "tomorrow", "week", "future"] as const).map(b => (
            <FilterChip
              key={b}
              label={bucketLabel(b)}
              count={b === "all" ? counts.all : counts[b]}
              active={filter === b}
              urgent={b === "overdue" || b === "yesterday" || b === "today"}
              onClick={() => setFilter(b)}
            />
          ))}
          <div className="ml-auto flex items-center gap-3">
            {/* Season Filter */}
            <select
              value={selectedSeason}
              onChange={(e) => setSelectedSeason(e.target.value)}
              className="bg-zinc-900 hover:bg-zinc-850 cursor-pointer border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500 appearance-none min-w-[130px] truncate"
              title="Filter by Season"
            >
              <option value="all">All Seasons</option>
              {uniqueSeasons.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            
            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-zinc-900 hover:bg-zinc-850 cursor-pointer border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500 appearance-none max-w-[200px] truncate"
              title="Filter by Category"
            >
              <option value="all">All Categories</option>
              {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            {/* Search Bar */}
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
              <svg className="w-4 h-4 text-zinc-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search style, graphic, plant…"
                className="bg-transparent text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none w-52"
              />
              {search && (
                <button suppressHydrationWarning onClick={() => setSearch("")} className="text-zinc-500 hover:text-zinc-300 text-xs">✕</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Notification List ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-6">
        {filtered.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <div className="max-w-[1400px] mx-auto space-y-2">
            {renderEventsGrouped(filtered, setEditingNotification)}
          </div>
        )}
      </div>

      {/* Set Status modal — same panel Table.tsx uses on the Dashboard, so a change made here
          updates the exact same shared row/schedule data and shows up there too. Only for
          "schedule" notifications — AOQ has its own verdict picker below, since col20 doesn't use
          the pass/fail/reason-code vocabulary this panel is built around. */}
      <EventStatusPanel
        isOpen={editingNotification !== null && editingNotification.kind === "schedule"}
        onClose={() => setEditingNotification(null)}
        rowId={editingNotification?.rowId || ""}
        dateKey={editingNotification?.dateKey || ""}
        dateLabel={editingNotification ? fmtDate(editingNotification.date) : ""}
        rawValue={editingNotification?.rawValue || ""}
        plant={editingNotification?.plant || ""}
        style={editingNotification?.style}
        graphic={editingNotification?.graphic}
        onSave={async (rowId, dateKey, newValue) => {
          const row = rows.find(r => r.id === rowId);
          if (row) {
            const rawRow: Record<string, unknown> = { ...row, [dateKey]: newValue };
            const scheduledRow = autoScheduleEmbellishmentRow(rawRow);
            scheduledRow.change_reason = "Updated via Action Center";
            await onUpdateRow(scheduledRow as EmbellishmentRow);
          }
          setEditingNotification(null);
        }}
      />

      {/* AOQ verdict picker — col20 holds a plain word (Approved/Dropped/Resubmit/C+P) once
          decided, not an event code + pass/fail + reason, so it gets its own small panel. */}
      <AoqVerdictPanel
        notification={editingNotification?.kind === "aoq" ? editingNotification : null}
        onClose={() => setEditingNotification(null)}
        onSave={async (rowId, verdict) => {
          const row = rows.find(r => r.id === rowId);
          if (row) {
            await onUpdateRow({
              ...row,
              col20: verdict,
              change_reason: "AOQ approval set via Action Center",
            } as EmbellishmentRow);
          }
          setEditingNotification(null);
        }}
      />
    </div>
  );
}

// ─── group renderer ───────────────────────────────────────────────────────────

function renderEventsGrouped(list: Notification[], onEdit: (n: Notification) => void) {
  if (list.length === 0) return null;

  // Group by eventCode/eventLabel
  const grouped = list.reduce((acc, n) => {
    const key = n.eventLabel;
    if (!acc[key]) acc[key] = [];
    acc[key].push(n);
    return acc;
  }, {} as Record<string, Notification[]>);

  const sortedEvents = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      {sortedEvents.map(([eventLabel, items]) => (
        <EventGroup key={eventLabel} eventLabel={eventLabel} items={items} onEdit={onEdit} />
      ))}
    </>
  );
}

function EventGroup({ eventLabel, items, onEdit }: { eventLabel: string, items: Notification[], onEdit: (n: Notification) => void }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="mb-10 bg-[#0c0c11] border border-zinc-800/80 rounded-3xl overflow-hidden shadow-2xl">
      <div 
        className="px-6 py-4 bg-[#111118] border-b border-zinc-800 flex items-center justify-between cursor-pointer hover:bg-[#161622] transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-4">
           <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center text-lg font-black text-amber-400">
             {items[0].eventCode.substring(0,2)}
           </div>
           <div>
             <h2 className="text-xl font-black text-white">{eventLabel}</h2>
             <p className="text-xs text-zinc-500 font-bold mt-0.5">{items.length} {items.length === 1 ? 'Item' : 'Items'}</p>
           </div>
        </div>
        <div className="text-zinc-500 bg-zinc-800/50 p-2 rounded-full hover:bg-zinc-700/50 transition-colors">
          {isCollapsed ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
          )}
        </div>
      </div>
      
      {!isCollapsed && (
        <div className="p-5 space-y-6">
          {renderUrgencySubgroup("overdue", "🚨 Overdue", items, onEdit)}
          {renderUrgencySubgroup("yesterday", "🕐 Yesterday", items, onEdit)}
          {renderUrgencySubgroup("today", "⚡ Due Today", items, onEdit)}
          {renderUrgencySubgroup("tomorrow", "⏰ Due Tomorrow", items, onEdit)}
          {renderUrgencySubgroup("week", "📅 This Week", items, onEdit)}
          {renderUrgencySubgroup("future", "🗓 Upcoming", items, onEdit)}
        </div>
      )}
    </div>
  );
}

function renderUrgencySubgroup(bucket: UrgencyBucket, heading: string, list: Notification[], onEdit: (n: Notification) => void) {
  const items = list.filter(n => n.bucket === bucket);
  if (items.length === 0) return null;

  const styleMap = {
    overdue:   "border-rose-500/20 bg-rose-500/5 text-rose-400",
    yesterday: "border-fuchsia-500/20 bg-fuchsia-500/5 text-fuchsia-400",
    today:     "border-amber-500/20 bg-amber-500/5 text-amber-400",
    tomorrow:  "border-orange-500/20 bg-orange-500/5 text-orange-400",
    week:      "border-blue-500/20 bg-blue-500/5 text-blue-400",
    future:    "border-zinc-800/60 bg-zinc-800/20 text-zinc-400"
  };

  const badgeMap = {
    overdue:   "bg-rose-500/20 text-rose-300",
    yesterday: "bg-fuchsia-500/20 text-fuchsia-300",
    today:     "bg-amber-500/20 text-amber-300",
    tomorrow:  "bg-orange-500/20 text-orange-300",
    week:      "bg-blue-500/20 text-blue-300",
    future:    "bg-zinc-800 text-zinc-300"
  };

  return (
    <div className={`border rounded-2xl ${styleMap[bucket]}`}>
      <div className="px-4 py-2 border-b border-inherit flex items-center justify-between opacity-80">
        <span className="text-[11px] font-black uppercase tracking-wider">{heading}</span>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${badgeMap[bucket]}`}>{items.length}</span>
      </div>
      <div className="p-3 grid gap-2.5">
        {items.map(n =>
          n.kind === "triggerAoq"
            ? <TriggerAoqCard key={n.id} n={n} />
            : <NotificationCard key={n.id} n={n} onEdit={onEdit} />
        )}
      </div>
    </div>
  );
}

// ─── notification card ────────────────────────────────────────────────────────

function NotificationCard({ n, onEdit }: { n: Notification; onEdit: (n: Notification) => void }) {
  const isOverdue   = n.bucket === "overdue";
  const isYesterday = n.bucket === "yesterday";
  const isToday     = n.bucket === "today";
  const isTomorrow  = n.bucket === "tomorrow";

  // A confirmed pass is green regardless of which day-bucket it falls in — matches the dashboard's
  // event badge. Fail is red. Otherwise the colour tracks how urgent the day-bucket is.
  const badgeCls =
    n.eventStatus === "pass" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30" :
    n.eventStatus === "fail" ? "bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30" :
    isOverdue   ? "bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30" :
    isYesterday ? "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40 hover:bg-fuchsia-500/30" :
    isToday     ? "bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30" :
    isTomorrow  ? "bg-orange-500/20 text-orange-300 border-orange-500/40 hover:bg-orange-500/30" :
    n.bucket === "week" ? "bg-blue-500/20 text-blue-300 border-blue-500/30 hover:bg-blue-500/30" :
                 "bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700";

  const diffLabel =
    isOverdue   ? `${Math.abs(n.diff)}d overdue` :
    isYesterday ? "Yesterday" :
    isToday     ? "Today" :
    isTomorrow  ? "Tomorrow" :
                 `In ${n.diff}d`;

  return (
    <div className="bg-[#0c0e14] border border-zinc-800/70 rounded-xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-900/40 hover:border-zinc-700 transition-colors">
      {/* Field group */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 flex-1 min-w-0">
        <div className="w-24">
          <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5">Style</span>
          <span className="text-xs font-mono text-zinc-200 font-bold">{n.style}</span>
        </div>
        <div className="w-28">
          <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5">Graphic</span>
          <span className="text-xs font-mono text-amber-300 font-bold">{n.graphic}</span>
        </div>
        {n.combo && (
          <div className="w-16">
            <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5">Combo</span>
            <span className="text-xs text-zinc-300 font-bold">{n.combo}</span>
          </div>
        )}
        {n.ground && n.ground !== "N/A" && (
          <div className="w-28 hidden md:block">
            <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5">Ground</span>
            <span className="text-xs text-zinc-300 font-bold">{n.ground}</span>
          </div>
        )}
        {/* Fabric Reference matters specifically for FS (First Sample) and FR (Fabric Received) —
            that's the fabric being sampled/received, so surface it only for those two events. */}
        {(n.eventCode === "FS" || n.eventCode === "FR") && n.fabricRef && n.fabricRef !== "N/A" && (
          <div className="w-28 hidden md:block">
            <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5">Fabric Ref</span>
            <span className="text-xs font-mono text-purple-300 font-bold">{n.fabricRef}</span>
          </div>
        )}
        <div className="min-w-[90px]">
          <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5">Plant</span>
          <span className="text-xs text-zinc-300 font-bold">{n.plant}</span>
        </div>
        <div className="w-16 hidden md:block">
          <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5">Season</span>
          <span className="text-xs text-zinc-400">{n.season || "-"}</span>
        </div>
        <div className="w-24 hidden lg:block">
          <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5">Category</span>
          <span className="text-xs text-zinc-400">{n.category || "-"}</span>
        </div>
      </div>

      {/* Date + status action */}
      <div className="shrink-0 flex items-center gap-5 border-t sm:border-t-0 sm:border-l border-zinc-800 pt-3 sm:pt-0 sm:pl-5">
        <div className="text-right">
          <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5">Date</span>
          <span className="text-xs font-black text-zinc-200 whitespace-nowrap">{fmtDate(n.date)}</span>
        </div>
        <div className="text-right">
          <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Status</span>
          <button
            type="button"
            onClick={() => onEdit(n)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-black border shadow-sm transition-colors whitespace-nowrap ${badgeCls}`}
          >
            {n.eventStatus === "pass" ? "✓ " : n.eventStatus === "fail" ? "✗ " : ""}{diffLabel} · {n.eventLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// A Trigger-level card — deliberately simpler than NotificationCard, since "Style/Graphic/Combo"
// don't apply to a summary spanning many rows. Read-only: the date itself is set on the Trigger
// Manager page, not here, so there's no onEdit/click action (unlike NotificationCard).
function TriggerAoqCard({ n }: { n: Notification }) {
  const isOverdue   = n.bucket === "overdue";
  const isYesterday = n.bucket === "yesterday";
  const isToday     = n.bucket === "today";
  const isTomorrow  = n.bucket === "tomorrow";

  const badgeCls =
    isOverdue   ? "bg-rose-500/20 text-rose-300 border-rose-500/40" :
    isYesterday ? "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40" :
    isToday     ? "bg-amber-500/20 text-amber-300 border-amber-500/40" :
    isTomorrow  ? "bg-orange-500/20 text-orange-300 border-orange-500/40" :
    n.bucket === "week" ? "bg-blue-500/20 text-blue-300 border-blue-500/30" :
                 "bg-zinc-800 text-zinc-300 border-zinc-700";

  const diffLabel =
    isOverdue   ? `${Math.abs(n.diff)}d overdue` :
    isYesterday ? "Yesterday" :
    isToday     ? "Today" :
    isTomorrow  ? "Tomorrow" :
                 `In ${n.diff}d`;

  return (
    <div className="bg-[#0c0e14] border border-zinc-800/70 rounded-xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 flex-1 min-w-0">
        <div className="min-w-[100px]">
          <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5">Trigger</span>
          <span className="text-sm font-mono text-white font-bold">{n.style}</span>
        </div>
        <div className="w-24">
          <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5">Rows Pending</span>
          <span className="text-xs text-zinc-300 font-bold">{n.rawValue}</span>
        </div>
        {n.season && (
          <div className="min-w-[80px] hidden md:block">
            <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5">Season(s)</span>
            <span className="text-xs text-zinc-400">{n.season}</span>
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-5 border-t sm:border-t-0 sm:border-l border-zinc-800 pt-3 sm:pt-0 sm:pl-5">
        <div className="text-right">
          <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-0.5">AOQ Date</span>
          <span className="text-xs font-black text-zinc-200 whitespace-nowrap">{fmtDate(n.date)}</span>
        </div>
        <div className="text-right">
          <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Status</span>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-black border whitespace-nowrap ${badgeCls}`}
            title="Set/change this on the Trigger Manager page"
          >
            {diffLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── stat chip ────────────────────────────────────────────────────────────────

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  const styles: Record<string, string> = {
    rose:   "bg-rose-500/15 border-rose-500/30 text-rose-300",
    fuchsia: "bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-300",
    amber:  "bg-amber-500/15 border-amber-500/30 text-amber-300",
    orange: "bg-orange-500/15 border-orange-500/30 text-orange-300",
    blue:   "bg-blue-500/15 border-blue-500/30 text-blue-300",
    zinc:   "bg-zinc-800 border-zinc-700 text-zinc-300",
  };
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold ${styles[color] || styles.zinc}`}>
      <span className="text-base font-black">{value}</span>
      <span>{label}</span>
    </div>
  );
}

// ─── filter chip ──────────────────────────────────────────────────────────────

function FilterChip({
  label, count, active, urgent, onClick,
}: {
  label: string; count: number; active: boolean; urgent?: boolean; onClick: () => void;
}) {
  return (
    <button
      suppressHydrationWarning
      onClick={onClick}
      className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
        active
          ? urgent
            ? "bg-rose-500 text-white shadow-lg shadow-rose-500/30"
            : "bg-amber-500 text-black shadow-lg shadow-amber-500/30"
          : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
      }`}
    >
      {label}
      {count > 0 && (
        <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${
          active ? "bg-black/25" : "bg-zinc-800 text-zinc-300"
        }`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── empty state ──────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: string }) {
  const msgs: Record<string, { icon: string; title: string; sub: string }> = {
    overdue:  { icon: "✅", title: "No Overdue Events",       sub: "Nothing is past its deadline. Great work!" },
    yesterday:{ icon: "🕐", title: "Nothing From Yesterday",   sub: "No events were scheduled yesterday." },
    today:    { icon: "🎉", title: "Nothing Due Today",        sub: "You have a clear schedule today." },
    tomorrow: { icon: "😌", title: "Nothing Due Tomorrow",     sub: "Tomorrow looks clear." },
    week:     { icon: "📅", title: "No Events This Week",      sub: "No scheduled events in the next 7 days." },
    future:   { icon: "🗓", title: "No Upcoming Events",       sub: "No events scheduled in the next 45 days." },
    all:      { icon: "📭", title: "No Events Found",          sub: "Adjust your search or filters." },
  };
  const m = msgs[filter] || msgs.all;
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 text-center py-32">
      <div className="w-20 h-20 rounded-3xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-4xl">
        {m.icon}
      </div>
      <div>
        <h2 className="text-xl font-black text-zinc-300">{m.title}</h2>
        <p className="text-sm text-zinc-500 mt-1">{m.sub}</p>
      </div>
    </div>
  );
}

// ─── AOQ verdict panel ─────────────────────────────────────────────────────────
// col20's real vocabulary once a decision is made — see getRowStatus in lib/db.ts.

const AOQ_VERDICTS = [
  { value: "APPROVED", label: "Approved", icon: "🟢", cls: "border-emerald-500 bg-emerald-950 text-emerald-300 hover:border-emerald-400" },
  { value: "DROPPED",  label: "Dropped",  icon: "⚫", cls: "border-zinc-500 bg-zinc-800 text-zinc-300 hover:border-zinc-400" },
  { value: "RESUBMIT", label: "Resubmit", icon: "🔁", cls: "border-amber-500 bg-amber-950 text-amber-300 hover:border-amber-400" },
  { value: "C+P",      label: "C+P",      icon: "🟡", cls: "border-yellow-500 bg-yellow-950 text-yellow-300 hover:border-yellow-400" },
] as const;

function AoqVerdictPanel({
  notification, onClose, onSave,
}: {
  notification: Notification | null;
  onClose: () => void;
  onSave: (rowId: string, verdict: string) => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  if (!notification) return null;
  const n = notification;

  const handlePick = async (verdict: string) => {
    setSaving(true);
    try {
      await onSave(n.rowId, verdict);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[380px] bg-[#0f1115] border-l border-zinc-800 shadow-2xl z-50 flex flex-col overflow-hidden">
        <div className="p-5 border-b border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black uppercase tracking-widest text-amber-300">
              AOQ Approval
            </span>
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-200 transition-colors p-1 rounded-lg hover:bg-zinc-800"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="px-2 py-0.5 rounded bg-zinc-900/80 border border-zinc-700 text-zinc-300 text-[11px] font-bold">
              📅 AOQ Date: {fmtDate(n.date)}
            </span>
            {n.plant && (
              <span className="px-2 py-0.5 rounded bg-zinc-900/80 border border-zinc-700 text-blue-300 text-[11px] font-bold">
                🏭 {n.plant}
              </span>
            )}
          </div>
          <div className="mt-2 text-xs text-zinc-400">
            <span className="font-mono text-white font-bold">{n.style}</span>
            {" · "}
            <span className="text-amber-300 font-bold">{n.graphic}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <p className="text-xs text-zinc-500 mb-4">
            No approval decision has been recorded for this AOQ date yet. Pick the outcome to
            write it into col20 (Strike-Off Aesthetic Approval).
          </p>
          <div className="grid grid-cols-2 gap-3">
            {AOQ_VERDICTS.map((v) => (
              <button
                key={v.value}
                type="button"
                disabled={saving}
                onClick={() => handlePick(v.value)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${v.cls}`}
              >
                <span className="text-2xl">{v.icon}</span>
                <span className="text-[11px] font-black">{v.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 border-t border-zinc-800">
          <button
            onClick={onClose}
            disabled={saving}
            className="w-full py-2 rounded-xl font-semibold text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 transition-all disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
