// ---------------------------------------------------------------------------
// CK duplicate-row cleanup — shared core used by both the CLI (dedupe_ck.js)
// and the POST /api/ck-charts/dedupe route.
//
//   Identity  = Category (col3) + Season (col4) + Graphic (col7) +
//               Ground (col8, whitespace-removed) + Technique (col9,
//               whitespace-collapsed) + Category/Product Line (schedule.col43)
//
//   Technique is in the identity on the planner's instruction: one graphic +
//   ground colour is legitimately carried on more than one row when it's being
//   developed with two different techniques — "OP. 01 - WATERBASE PRINT" vs
//   "OP. 02 - SOFT PLASTISOL PRINT", "OPTION 01: EMBROIDERY" vs "OPTION 02:
//   METALLIC INK", a re-development that switched technique + plant. Those are
//   distinct developments, not duplicates, and must never be merged together.
//
//   NOTE: "Dispatch To" (schedule.col44) is deliberately NOT part of the
//   identity. The CK charts list the SAME graphic + ground colour on a
//   separate row per approval route (HK, NY, NK...), each with its own DHL
//   number and dates — but it's one strike-off item, so those rows are
//   duplicates to merge, not distinct developments. Different ground colours
//   of the same graphic ARE distinct (col8 is in the key). Confirmed against
//   the 2027 charts: every CK duplicate group differs by Dispatch To only,
//   never by Product Line, and the paired rows carry the same S/off Status.
//
//   Planning event = any "YYYY-MM-DD" key in schedule with a non-empty value.
//   A row that has one is NEVER modified or deleted.
//
// For each duplicate group:
//   • rows WITH events            -> untouched, always kept
//   • rows WITHOUT events:
//       - group also has event rows -> delete the event-less dups (redundant)
//       - group has NO event rows   -> merge into one survivor (newest non-empty
//         value wins per field), delete the rest
//
// planDedupe() is read-only. applyDedupe() backs up every touched row to the
// `backups` table, then merges + deletes.
// ---------------------------------------------------------------------------

function ckCanon(raw) {
  const c = (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!c) return "";
  if (c === "CK") return "CK";
  if (c.startsWith("CKNA")) {
    if (c.includes("WOMEN")) return "CKNAWOMEN";
    if (c.includes("MEN")) return "CKNAMEN";
    return "CK";
  }
  if (c.startsWith("CKP")) return "CKP";
  if (c.startsWith("OTHERKNIT")) return "OTHERKNIT";
  if (c.startsWith("CK")) return "CK";
  return "";
}
const CK_CANONS = new Set(["CK", "CKNAMEN", "CKNAWOMEN", "CKP", "OTHERKNIT"]);
const isCkFamily = (raw) => CK_CANONS.has(ckCanon(raw));

const norm = (v) =>
  String(v ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().toLowerCase();
const stripWs = (v) => v.replace(/\s+/g, "");
const isDateKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k);

function hasPlanningEvent(row) {
  const s = row.schedule || {};
  return Object.keys(s).some((k) => isDateKey(k) && String(s[k] || "").trim() !== "");
}

function flatten(row) {
  const {
    id, created_at, schedule, is_current, shared_id, version_number,
    change_reason, changed_date, team_owner, ...cols
  } = row;
  return { ...cols, ...(schedule || {}) };
}

// Identity WITHOUT category — Season + Graphic + Ground + Technique + Category/
// Product Line. Grouping is done on this, then split by category (below) so a
// legacy bare-"CK" row that shares everything-but-category with exactly one
// specific CK category (e.g. an orphan left behind by an earlier import that
// didn't re-label it) folds into that category's group instead of stranding.
// Dispatch To is intentionally excluded — see the header note. Technique is
// whitespace-collapsed (not stripped) so "GLITTER\nPRINT" == "GLITTER PRINT"
// but token order / extra words still split ("GLITTER" != "GLITTER PRINT",
// "OP. 01 …" != "OP. 02 …") — err toward keeping rows separate.
const collapseWs = (v) => norm(v).replace(/\s+/g, " ");
function coreKey(r) {
  const s = r.schedule || {};
  return [
    norm(r.col4), norm(r.col7),
    stripWs(norm(r.col8)), collapseWs(r.col9), norm(s.col43),
  ].join(" | ");
}

// When the SAME graphic + ground colour appears on more than one row it's a
// RE-SUBMISSION, not a data-entry mistake — the planner opened a fresh S/off
// round further down the sheet (new dates, new comments), and the LATEST round's
// verdict is the row's real status. Confirmed against the 2027 charts: e.g.
// 4RK802G / Black was "A" on the Jan s/off and "D" on an April re-s/off ("pitch
// sheet updated"); 4LK821G / Black was "D" in June and "A" after a July re-s/off.
// So the merge takes col1 (and every other field) from the newest row, never a
// "most-advanced status wins" rule. ckStatusRank is kept only for the has-events
// tie-break where created_at can't be trusted.
const CK_STATUS_RANK = { approved: 5, "c+p": 4, pending: 3, hold: 2, dropped: 1 };
function ckStatusRank(v) {
  const t = norm(v);
  if (t === "a" || t === "approved") return CK_STATUS_RANK.approved;
  if (t === "cp" || t === "c+p") return CK_STATUS_RANK["c+p"];
  if (t === "sp" || t === "pending" || t === "submission pending") return CK_STATUS_RANK.pending;
  if (t === "h" || t === "hold") return CK_STATUS_RANK.hold;
  if (t === "d" || t === "dropped") return CK_STATUS_RANK.dropped;
  return 0;
}

async function fetchAllCkRows(sb) {
  let all = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from("rows")
      .select("*")
      .or("is_current.eq.true,is_current.is.null")
      .range(off, off + 999);
    if (error) throw error;
    if (!data.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
  }
  return all.filter((r) => isCkFamily(r.col3));
}

/** Read-only. Returns { groups, toDelete, toUpdate, backupIds, counts }. */
async function planDedupe(sb) {
  const ck = await fetchAllCkRows(sb);

  // 1) group by the category-free core identity
  const byCore = new Map();
  for (const r of ck) {
    const k = coreKey(r);
    if (!byCore.has(k)) byCore.set(k, []);
    byCore.get(k).push(r);
  }

  // 2) within each core group, bucket by canonical category. A bare-"CK" row
  //    joins the specific bucket when the core group contains exactly one
  //    specific CK category; otherwise it stays in its own "CK" bucket.
  const dupGroups = [];
  for (const [core, rows] of byCore) {
    const specifics = new Set(
      rows.map((r) => ckCanon(r.col3)).filter((c) => c && c !== "CK"),
    );
    const soleSpecific = specifics.size === 1 ? [...specifics][0] : null;
    const buckets = new Map();
    for (const r of rows) {
      let b = ckCanon(r.col3) || "CK";
      if (b === "CK" && soleSpecific) b = soleSpecific;
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b).push(r);
    }
    for (const [cat, brows] of buckets) {
      if (brows.length > 1) dupGroups.push([`${cat} | ${core}`, brows]);
    }
  }

  const toDelete = [];
  const toUpdate = [];
  const backupIds = new Set();
  const groupReport = [];

  for (const [k, rowsRaw] of dupGroups) {
    const rows = [...rowsRaw].sort((a, b) =>
      String(a.created_at || "").localeCompare(String(b.created_at || "")));
    const withEvents = rows.filter(hasPlanningEvent);
    const withoutEvents = rows.filter((r) => !hasPlanningEvent(r));
    const g = { key: k, total: rows.length, kept: [], deleted: [], merged: null };
    withEvents.forEach((r) => g.kept.push({ id: r.id, reason: "has planning events" }));

    if (withoutEvents.length === 0) {
      groupReport.push(g);
      continue;
    }

    if (withEvents.length > 0) {
      const eventFlat = withEvents.map(flatten);
      for (const r of withoutEvents) {
        const f = flatten(r);
        const lost = Object.entries(f)
          .filter(([key, val]) => String(val ?? "").trim() !== "" && !isDateKey(key))
          .filter(([key, val]) => !eventFlat.some((ef) => norm(ef[key]) === norm(val)))
          .map(([key, val]) => ({ field: key, value: String(val).slice(0, 60) }));
        toDelete.push({ id: r.id, reason: "event-less duplicate of a row that has a plan" });
        backupIds.add(r.id);
        withEvents.forEach((e) => backupIds.add(e.id));
        g.deleted.push({ id: r.id, lostFields: lost });
      }
      // A deleted event-less dup may carry the newest S/off round's verdict (the
      // re-submission), while the kept row holds only the planning dates. Bump the
      // kept row(s) to the group's newest col1 so a later "Dropped"/"Approved"
      // re-s/off isn't lost. "Newest" = latest created_at; if two rows tie, the
      // more-advanced status wins as a fallback.
      const newest = [...rows].sort((a, b) => {
        const t = String(b.created_at || "").localeCompare(String(a.created_at || ""));
        return t !== 0 ? t : ckStatusRank(b.col1) - ckStatusRank(a.col1);
      })[0];
      for (const e of withEvents) {
        if (norm(e.col1) !== norm(newest.col1)) {
          toUpdate.push({ id: e.id, patch: { col1: newest.col1 } });
          backupIds.add(e.id);
        }
      }
    } else {
      const ordered = [...withoutEvents].sort((a, b) =>
        String(b.created_at || "").localeCompare(String(a.created_at || "")));
      const survivor = ordered[0];
      const losers = ordered.slice(1);
      const merged = {};
      for (const r of [...ordered].reverse()) {
        for (const [key, val] of Object.entries(flatten(r))) {
          if (String(val ?? "").trim() !== "") merged[key] = val;
        }
      }
      // col1 follows the same newest-wins rule as every other field (the loop
      // above already applied it): the latest S/off round is the real status.
      const survFlat = flatten(survivor);
      const patch = {};
      for (const [key, val] of Object.entries(merged)) {
        if (norm(survFlat[key]) !== norm(val)) patch[key] = val;
      }
      g.kept.push({ id: survivor.id, reason: "survivor (no plan on any row in group)" });
      if (Object.keys(patch).length) {
        toUpdate.push({ id: survivor.id, patch });
        backupIds.add(survivor.id);
        g.merged = { id: survivor.id, fields: Object.keys(patch) };
      }
      for (const r of losers) {
        toDelete.push({ id: r.id, reason: "merged into survivor" });
        backupIds.add(r.id);
        g.deleted.push({ id: r.id, lostFields: [] });
      }
    }
    groupReport.push(g);
  }

  return {
    ckRowCount: ck.length,
    duplicateGroups: dupGroups.length,
    toDelete,
    toUpdate,
    backupIds: [...backupIds],
    groups: groupReport,
    _ck: ck,
  };
}

async function applyDedupe(sb, plan) {
  const { toDelete, toUpdate, backupIds, _ck } = plan;
  if (!toDelete.length && !toUpdate.length) {
    return { deleted: 0, updated: 0, backupId: null };
  }

  const backupRows = _ck.filter((r) => backupIds.includes(r.id));
  const backupId =
    "ck_dedupe_" + new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

  // Primary backup: the `backups` table (restorable from the Backup History panel).
  const { error: bErr } = await sb.from("backups").insert({
    id: backupId,
    label: "Before CK duplicate-row cleanup",
    reason: "manual",
    row_count: backupRows.length,
    created_by: "ckDedupe",
    data: backupRows,
  });
  // Fallback: if the backups table rejects the write (e.g. missing RLS policy on
  // this database), write a local JSON snapshot instead and continue — the
  // cleanup must never proceed with NO backup at all, but it also shouldn't be
  // blocked by a DB-policy quirk.
  let backupNote = backupId;
  if (bErr) {
    const fs = require("fs");
    const path = require("path");
    const dir = path.resolve(__dirname, "ck_dedupe_backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, backupId + ".json");
    fs.writeFileSync(
      file,
      JSON.stringify({ id: backupId, created_at: new Date().toISOString(), rows: backupRows }, null, 2),
    );
    backupNote = "local:" + file + " (backups table rejected the write: " + bErr.message + ")";
    console.warn("ckDedupe: DB backup failed, wrote local snapshot ->", file);
  }

  const REAL = new Set(Array.from({ length: 33 }, (_, i) => `col${i + 1}`));
  for (const { id, patch } of toUpdate) {
    const colPatch = {};
    const schedPatch = {};
    for (const [k, v] of Object.entries(patch)) {
      if (REAL.has(k)) colPatch[k] = v;
      else schedPatch[k] = v;
    }
    if (Object.keys(schedPatch).length) {
      const { data: cur } = await sb.from("rows").select("schedule").eq("id", id).single();
      colPatch.schedule = { ...(cur?.schedule || {}), ...schedPatch };
    }
    colPatch.change_reason = "CK dedupe: merged fields from removed duplicate row(s)";
    const { error } = await sb.from("rows").update(colPatch).eq("id", id);
    if (error) throw new Error(`update ${id} failed: ${error.message}`);
  }

  const delIds = toDelete.map((d) => d.id);
  for (let i = 0; i < delIds.length; i += 100) {
    const { error } = await sb.from("rows").delete().in("id", delIds.slice(i, i + 100));
    if (error) throw new Error("delete chunk failed: " + error.message);
  }

  return { deleted: delIds.length, updated: toUpdate.length, backupId: backupNote };
}

module.exports = { planDedupe, applyDedupe, isCkFamily };
