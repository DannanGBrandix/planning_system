"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "../utils/supabase/client";
import {
  listPendingUpdates,
  applyPendingUpdates,
  rejectPendingUpdates,
  getEventCodes,
  type PendingUpdate,
  type EventCodeRow,
} from "../lib/db";
import { parseEventValue, getReasonByCode } from "../lib/eventCodes";
import { loadCodes } from "../lib/codesStore";

const ALLOWED_ROLES = ["Planner", "Admin", "Management"];

function formatFieldKey(fieldKey: string): { date: string; flow: string | null } {
  const [datePart, ...rest] = fieldKey.split("_");
  const flow = rest.length ? rest.join("_") : null;
  const d = new Date(datePart + "T00:00:00");
  const date = Number.isNaN(d.getTime())
    ? datePart
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return { date, flow };
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Render an encoded event value ("PPS", "PPS|P", "PPS|F|14") as readable text. */
function EventValue({ raw }: { raw: string | null }) {
  const parsed = raw ? parseEventValue(raw) : null;
  if (!parsed) return <span className="text-zinc-500">—</span>;
  if (parsed.status === "pass") {
    return <span className="font-semibold text-emerald-400">{parsed.code} · Pass</span>;
  }
  if (parsed.status === "fail") {
    const reason = parsed.reasonCode ? getReasonByCode(parsed.reasonCode) : undefined;
    return (
      <span className="font-semibold text-rose-400">
        {parsed.code} · Fail
        {reason ? ` — ${reason.label} (${reason.responsible})` : parsed.reasonCode ? ` — ${parsed.reasonCode}` : ""}
      </span>
    );
  }
  return <span className="text-zinc-300">{parsed.code} · Planned</span>;
}

export default function PlantUpdatesPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<"checking" | "denied" | "ok">("checking");
  const [role, setRole] = useState<string>("");

  const [pending, setPending] = useState<PendingUpdate[]>([]);
  const [stale, setStale] = useState<PendingUpdate[]>([]);
  const [eventCodes, setEventCodes] = useState<EventCodeRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // --- Auth gate (same pattern as app/admin/page.tsx) ---
  useEffect(() => {
    (async () => {
      try {
        const supabase = createSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setAuthState("denied");
          return;
        }
        const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";
        const res = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setRole(data.role || "");
          setAuthState(ALLOWED_ROLES.includes(data.role) ? "ok" : "denied");
        } else {
          setAuthState("denied");
        }
      } catch (err) {
        console.error("Auth check failed", err);
        setAuthState("denied");
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s, ec] = await Promise.all([
        listPendingUpdates("pending"),
        listPendingUpdates("stale"),
        getEventCodes(),
        loadCodes(true),
      ]);
      setPending(p);
      setStale(s);
      setEventCodes(ec);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authState !== "ok") return;
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [authState, load]);

  const eventDesc = useMemo(() => {
    const m = new Map<string, string>();
    eventCodes.forEach((e) => m.set(e.code, e.description || ""));
    return m;
  }, [eventCodes]);

  const grouped = useMemo(() => {
    const byPlant = new Map<string, PendingUpdate[]>();
    for (const item of pending) {
      const key = item.plant || "Unassigned";
      if (!byPlant.has(key)) byPlant.set(key, []);
      byPlant.get(key)!.push(item);
    }
    return Array.from(byPlant.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pending]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleGroup = (items: PendingUpdate[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = items.every((i) => next.has(i.id));
      items.forEach((i) => (allOn ? next.delete(i.id) : next.add(i.id)));
      return next;
    });
  };

  const runApprove = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const r = await applyPendingUpdates(Array.from(selected));
      const parts = [`${r.applied} applied`];
      if (r.stale.length) parts.push(`${r.stale.length} changed since submitted (re-check below)`);
      if (r.errors.length) parts.push(`${r.errors.length} errored`);
      setToast(parts.join(" · "));
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runReject = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const r = await rejectPendingUpdates(Array.from(selected));
      setToast(`${r.rejected} rejected`);
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (authState === "checking") {
    return <Shell><p className="text-zinc-400 text-sm">Checking access…</p></Shell>;
  }
  if (authState === "denied") {
    return (
      <Shell>
        <div className="max-w-md">
          <h1 className="text-lg font-bold text-zinc-100">Access denied</h1>
          <p className="mt-2 text-sm text-zinc-400">
            The plant update review board is available to Planner, Admin and Management roles
            {role ? ` (you are "${role}")` : ""}.
          </p>
          <button
            onClick={() => router.push("/")}
            className="mt-4 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-700"
          >
            Back to dashboard
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-zinc-100">Plant Updates</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Event results submitted from plant sheets. Approve to write them into the plan.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading || busy}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {toast && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="ml-3 font-bold text-zinc-500 hover:text-zinc-200">×</button>
        </div>
      )}

      {/* Sticky action bar */}
      <div className="sticky top-0 z-10 -mx-6 mt-4 border-b border-zinc-800 bg-[#0b0b0d]/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-zinc-300">{selected.size} selected</span>
          <button
            onClick={runApprove}
            disabled={busy || selected.size === 0}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            Approve
          </button>
          <button
            onClick={runReject}
            disabled={busy || selected.size === 0}
            className="rounded-lg bg-rose-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-rose-600 disabled:opacity-40"
          >
            Reject
          </button>
        </div>
      </div>

      {/* Stale callout */}
      {stale.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <h2 className="text-sm font-bold text-amber-300">
            {stale.length} changed since the plant submitted — re-check
          </h2>
          <p className="mt-1 text-xs text-amber-200/80">
            The plan value for these events was edited after the sheet was built, so they were not
            applied. Verify, then handle them directly on the dashboard or re-issue the sheet.
          </p>
          <ul className="mt-3 space-y-1.5 text-xs text-amber-100/90">
            {stale.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-2">
                <span className="font-semibold">{s.style || s.row_id}</span>
                <span className="text-amber-200/60">{s.graphic}</span>
                <span>·</span>
                <span>{formatFieldKey(s.field_key).date}</span>
                <span>·</span>
                <EventValue raw={s.new_value} />
                {s.staleReason && <span className="text-amber-200/60">({s.staleReason})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Groups */}
      {!loading && pending.length === 0 && (
        <p className="mt-10 text-center text-sm text-zinc-500">No pending plant updates.</p>
      )}

      <div className="mt-4 space-y-6 pb-20">
        {grouped.map(([plant, items]) => {
          const allOn = items.every((i) => selected.has(i.id));
          return (
            <section key={plant} className="overflow-hidden rounded-xl border border-zinc-800">
              <header className="flex items-center gap-3 bg-zinc-900 px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={() => toggleGroup(items)}
                  className="h-4 w-4 accent-emerald-500"
                />
                <span className="text-sm font-bold text-zinc-100">🏭 {plant}</span>
                <span className="text-xs text-zinc-500">{items.length} update{items.length === 1 ? "" : "s"}</span>
              </header>
              <div className="divide-y divide-zinc-800">
                {items.map((item) => {
                  const fk = formatFieldKey(item.field_key);
                  return (
                    <div
                      key={item.id}
                      className={`flex items-start gap-3 px-4 py-3 ${selected.has(item.id) ? "bg-emerald-500/5" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggle(item.id)}
                        className="mt-1 h-4 w-4 accent-emerald-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <span className="font-semibold text-zinc-100">{item.style || item.row_id}</span>
                          {item.graphic && <span className="text-zinc-400">{item.graphic}</span>}
                          {item.combo && <span className="text-zinc-500">/ {item.combo}</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-bold text-zinc-200">
                            {item.base_code}
                          </span>
                          {eventDesc.get(item.base_code || "") && (
                            <span className="text-zinc-500">{eventDesc.get(item.base_code || "")}</span>
                          )}
                          <span>·</span>
                          <span className="text-zinc-300">{fk.date}</span>
                          {fk.flow && (
                            <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-300">{fk.flow}</span>
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                          <EventValue raw={item.old_value} />
                          <span className="text-zinc-600">→</span>
                          <EventValue raw={item.new_value} />
                        </div>
                        {item.note && (
                          <p className="mt-1 text-xs italic text-zinc-400">“{item.note}”</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right text-[11px] text-zinc-500">
                        <div>{timeAgo(item.created_at)}</div>
                        {item.submitted_by && <div className="text-zinc-600">{item.submitted_by}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      <div className="mx-auto max-w-4xl px-6 py-8">{children}</div>
    </div>
  );
}
