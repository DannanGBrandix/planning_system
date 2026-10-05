#!/usr/bin/env node
// Restore a database export (the folder written by the read-only backup, e.g.
// D:\Brandix\prod_backup_2026-09-19) into a NEW, EMPTY Supabase project, then verify that
// every value came across.
//
//   node server/restore_from_export.js <exportDir> --url https://xxxx.supabase.co --key sb_publishable_...
//        [--dry-run] [--skip-backups] [--keep-bulk] [--allow-non-empty]
//
// If --url/--key are omitted the project in server/.env is used.
//
// What it does
//   1. checks the export files against MANIFEST.json (SHA-256) — refuses a damaged backup
//   2. refuses to write into the old production / test projects, and into a project that already holds rows
//   3. restores: columns_config, reason_codes, event_codes, rows, pending_updates, audit_logs, backups
//      - rows go in under whichever column style the target uses (readable names from
//        supabase_named.sql, or col1..col33) — see server/rowColumns.js
//      - the junk row id="bulk" (919 KB, created by an old bad request) is left out unless --keep-bulk
//      - user_roles is NOT restored: it points at auth.users, which doesn't exist in the new project.
//        (The app gives a new user the Planner role automatically on first login.)
//   4. VERIFIES by reading everything back from the new database and comparing it, value by value,
//      with the export (JSON compared key-order-insensitively; timestamps by instant).
//   Exit code 0 only if every table matches. A report is written to <exportDir>/RESTORE_REPORT.json.
//
// Safe to re-run: every write is an upsert on the primary key.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const rowColumns = require("./rowColumns");

const OLD_PROJECT_REFS = ["ktgsyakzevczufcziqci", "vxsfwwdcjjhsitfauyxa"]; // old prod, old test

// ---- args --------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : undefined; };
const exportDir = args.find((a) => !a.startsWith("--") && ![opt("--url"), opt("--key"), opt("--report")].includes(a));
if (!exportDir) {
  console.error("Usage: node server/restore_from_export.js <exportDir> --url <supabase url> --key <publishable key> [--dry-run] [--skip-backups] [--keep-bulk] [--allow-non-empty]");
  process.exit(2);
}
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const URL_ = opt("--url") || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = opt("--key") || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const DRY = flag("--dry-run");

// ---- helpers -----------------------------------------------------------------------------------
const PK = { rows: "id", audit_logs: "id", columns_config: "id", pending_updates: "id", backups: "id", reason_codes: "code", event_codes: "code" };
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const same = (a, b) => canon(a ?? null) === canon(b ?? null);
const sameTime = (a, b) => (a == null && b == null) || new Date(a).getTime() === new Date(b).getTime();
const log = (...m) => console.log(...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function retry(label, fn, tries = 4) {
  for (let i = 1; ; i++) {
    const res = await fn();
    if (!res.error) return res;
    if (i >= tries) throw new Error(`${label}: ${res.error.message || JSON.stringify(res.error)}`);
    await sleep(500 * i);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(exportDir, file), "utf8"));
}

(async () => {
  // 1. integrity of the export ------------------------------------------------------------------
  const manifest = readJson("MANIFEST.json");
  for (const [t, m] of Object.entries(manifest.tables)) {
    if (!m.present) continue;
    const buf = fs.readFileSync(path.join(exportDir, `${t}.json`));
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    if (sha !== m.sha256) throw new Error(`Export file ${t}.json does not match MANIFEST.json (damaged or edited) — aborting.`);
    if (!m.complete) throw new Error(`Export of ${t} was incomplete when it was taken — aborting.`);
  }
  log(`Export OK: ${Object.keys(manifest.tables).filter((t) => manifest.tables[t].present).length} tables, checksums match (exported ${manifest.exported_at} from ${manifest.project}).`);

  // 2. target safety ----------------------------------------------------------------------------
  if (!URL_ || !KEY) throw new Error("No target: pass --url and --key (or set them in server/.env).");
  if (OLD_PROJECT_REFS.some((ref) => URL_.includes(ref))) throw new Error(`Refusing to restore into an OLD project (${URL_}). Use the new project's URL.`);
  const sb = createClient(URL_, KEY);
  log(`Target: ${URL_}${DRY ? "   (DRY RUN — nothing will be written)" : ""}`);

  const named = await rowColumns.isNamed(sb);
  log(`Target rows table uses ${named ? "NAMED columns (category, style, …)" : "LEGACY columns (col1 … col33)"}.`);

  const count = async (t) => {
    const { count: c, error } = await sb.from(t).select("*", { count: "exact", head: true });
    if (error) throw new Error(`Cannot read table "${t}" in the target (${error.message}). Did supabase_named.sql run successfully?`);
    return c;
  };
  const before = {};
  for (const t of Object.keys(PK)) before[t] = await count(t);
  log("Target row counts before:", JSON.stringify(before));
  if (!flag("--allow-non-empty") && (before.rows > 0 || before.audit_logs > 0)) {
    throw new Error("Target already contains data. Refusing (use --allow-non-empty only if you are sure — writes are upserts, so re-running is safe).");
  }

  // 3. load export ------------------------------------------------------------------------------
  const data = {};
  for (const t of Object.keys(PK)) {
    if (manifest.tables[t]?.present) data[t] = readJson(`${t}.json`);
  }
  if (flag("--skip-backups")) delete data.backups;
  let skippedBulk = 0;
  if (data.rows && !flag("--keep-bulk")) {
    const n = data.rows.length;
    data.rows = data.rows.filter((r) => r.id !== "bulk");
    skippedBulk = n - data.rows.length;
  }
  const plan = Object.fromEntries(Object.entries(data).map(([t, rows]) => [t, rows.length]));
  log("To restore:", JSON.stringify(plan), skippedBulk ? `(left out ${skippedBulk} junk row id="bulk")` : "");
  if (manifest.tables.user_roles?.present) log(`Not restoring user_roles (${manifest.tables.user_roles.saved_count} row) — it references auth users that don't exist in the new project.`);
  if (DRY) { log("Dry run complete."); return; }

  // 4. restore ----------------------------------------------------------------------------------
  const upsert = async (t, rows, batch) => {
    for (let i = 0; i < rows.length; i += batch) {
      const slice = rows.slice(i, i + batch);
      await retry(`${t} ${i}-${i + slice.length}`, () => sb.from(t).upsert(slice, { onConflict: PK[t] }));
      process.stdout.write(`\r  ${t}: ${Math.min(i + batch, rows.length)}/${rows.length}   `);
    }
    process.stdout.write("\n");
  };
  const ORDER = ["columns_config", "reason_codes", "event_codes", "rows", "pending_updates", "audit_logs", "backups"];
  for (const t of ORDER) {
    if (!data[t]) continue;
    if (t === "rows") await upsert(t, data.rows.map((r) => rowColumns.toDb(r, named)), 100);
    else if (t === "backups") await upsert(t, data.backups, 1); // each snapshot is ~5 MB
    else await upsert(t, data[t], t === "audit_logs" ? 1000 : 200);
  }

  // 5. verify: read everything back and compare -------------------------------------------------
  log("\nVerifying (reading everything back from the new database)…");
  const report = { target: URL_, restored_at: new Date().toISOString(), style: named ? "named" : "legacy", skipped_bulk_rows: skippedBulk, tables: {} };
  let allOk = true;
  const fetchAll = async (t, pageSize) => {
    const out = [];
    for (let off = 0; ; off += pageSize) {
      const { data: page } = await retry(`read ${t} @${off}`, () => sb.from(t).select("*").order(PK[t], { ascending: true }).range(off, off + pageSize - 1));
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  };
  const compare = (t, src, got, fix) => {
    const byId = new Map(got.map((r) => [String(r[PK[t]]), fix ? fix(r) : r]));
    let missing = 0, differing = 0, valuesChecked = 0;
    const examples = [];
    for (const s of src) {
      const g = byId.get(String(s[PK[t]]));
      if (!g) { missing++; if (examples.length < 3) examples.push(`missing ${s[PK[t]]}`); continue; }
      for (const k of Object.keys(s)) {
        valuesChecked++;
        const eq = k === "created_at" || k === "timestamp" || k === "reviewed_at" ? sameTime(s[k], g[k]) : same(s[k], g[k]);
        if (!eq) { differing++; if (examples.length < 3) examples.push(`${s[PK[t]]}.${k}`); break; }
      }
    }
    return { missing, differing, valuesChecked, extra: byId.size - (src.length - missing), examples };
  };

  for (const t of ORDER) {
    if (!data[t]) continue;
    const src = data[t];
    const got = t === "backups" ? await fetchAll(t, 1) : await fetchAll(t, t === "audit_logs" ? 1000 : 500);
    const cmp = compare(t, src, got, t === "rows" ? (r) => rowColumns.fromDb(r, named) : null);
    const ok = got.length === src.length && cmp.missing === 0 && cmp.differing === 0;
    allOk = allOk && ok;
    report.tables[t] = { expected: src.length, in_target: got.length, missing: cmp.missing, differing: cmp.differing, values_compared: cmp.valuesChecked, ok };
    log(`${ok ? "OK  " : "FAIL"} ${t.padEnd(16)} expected ${String(src.length).padStart(6)}  found ${String(got.length).padStart(6)}  missing ${cmp.missing}  differing ${cmp.differing}  (${cmp.valuesChecked.toLocaleString()} values compared)${cmp.examples.length ? "  e.g. " + cmp.examples.join(", ") : ""}`);
  }
  report.all_ok = allOk;
  fs.writeFileSync(opt("--report") || path.join(exportDir, "RESTORE_REPORT.json"), JSON.stringify(report, null, 2));
  log(allOk ? "\nALL DATA RESTORED AND VERIFIED." : "\nVERIFICATION FAILED — see above. Nothing was deleted from the export.");
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error("\nSTOPPED:", e.message); process.exit(1); });
