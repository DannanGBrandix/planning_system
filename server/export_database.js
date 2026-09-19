#!/usr/bin/env node
// Read-only full export of a Supabase project to local JSON files — a backup you can restore with
// server/restore_from_export.js (into any new project, named-column or legacy).
//
//   npm run db:export                       # exports the ACTIVE database (server/.env), i.e. what the app is using
//   node server/export_database.js [outDir] [--url https://xxxx.supabase.co --key sb_publishable_...]
//
// Default output: D:\Brandix\db_backups\<project-ref>_<YYYY-MM-DD_HHMM>   (outside the git repo)
//
// - Only GET/HEAD requests; nothing in Supabase is changed.
// - `rows` are written in the app's own format (col1..col33) whichever column style the database uses,
//   so an export of a NAMED database restores into either style (see server/rowColumns.js).
// - Every table's saved count is compared with Supabase's exact count; MANIFEST.json holds counts + SHA-256.
// - Free Supabase plans have no downloadable backups — run this regularly and copy the folder somewhere safe.
// - Not included (not reachable with the publishable key): auth users (emails/passwords) and the schema
//   (recreate with server/supabase_named.sql).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const rowColumns = require("./rowColumns");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : undefined; };
const positional = args.find((a) => !a.startsWith("--") && ![opt("--url"), opt("--key")].includes(a));
const URL_ = opt("--url") || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = opt("--key") || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!URL_ || !KEY) { console.error("No database configured: pass --url/--key or set them in server/.env"); process.exit(2); }

const ref = (URL_.match(/https:\/\/([^.]+)\./) || [])[1] || "project";
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
const OUT = positional || path.resolve(__dirname, "..", "..", "db_backups", `${ref}_${stamp}`);
fs.mkdirSync(OUT, { recursive: true });

const sb = createClient(URL_, KEY);
const TABLES = [
  ["rows", "id"], ["audit_logs", "id"], ["columns_config", "id"], ["pending_updates", "id"],
  ["user_roles", "user_id"], ["reason_codes", "code"], ["event_codes", "code"], ["backups", "id"],
];

async function exactCount(t, pk) {
  const { count, error } = await sb.from(t).select(pk, { count: "exact", head: true });
  return error ? null : count;
}

(async () => {
  const named = await rowColumns.isNamed(sb);
  console.log(`Exporting ${URL_}  (rows table: ${named ? "named" : "legacy"} columns) -> ${OUT}`);
  const manifest = {
    project: URL_,
    exported_at: new Date().toISOString(),
    rows_format: "col1..col33 (normalized; restorable into named or legacy databases)",
    note: "Read-only export via PostgREST GET. Tables as returned by the API (rows incl. schedule JSONB + created_at).",
    tables: {},
  };

  for (const [t, pk] of TABLES) {
    const expected = await exactCount(t, pk);
    if (expected === null) { console.log(`- ${t}: not present / not readable (skipped)`); manifest.tables[t] = { present: false }; continue; }
    const file = path.join(OUT, `${t}.json`);
    const fd = fs.openSync(file, "w");
    fs.writeSync(fd, "[");
    let first = true, got = 0;
    const seen = new Set();
    const write = (arr) => {
      for (const r0 of arr) {
        const r = t === "rows" ? rowColumns.fromDb(r0, named) : r0;
        const k = String(r[pk]);
        if (seen.has(k)) throw new Error(`duplicate ${t}.${pk}=${k} while paging`);
        seen.add(k);
        fs.writeSync(fd, (first ? "\n" : ",\n") + JSON.stringify(r));
        first = false; got++;
      }
    };
    const read = async (build, label) => {
      for (let attempt = 1; ; attempt++) {
        const { data, error } = await build();
        if (!error) return data;
        if (attempt >= 4) throw new Error(`${label}: ${error.message}`);
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    };

    if (t === "backups") { // each row holds a ~5 MB snapshot: one at a time
      const ids = (await read(() => sb.from("backups").select("id").order("id", { ascending: true }), "backups ids")).map((x) => x.id);
      for (const id of ids) write(await read(() => sb.from("backups").select("*").eq("id", id), `backup ${id}`));
    } else {
      for (let off = 0; ; off += 1000) {
        const page = await read(() => sb.from(t).select("*").order(pk, { ascending: true }).range(off, off + 999), `${t} @${off}`);
        write(page);
        if (page.length < 1000) break;
      }
    }
    fs.writeSync(fd, "\n]\n"); fs.closeSync(fd);

    const buf = fs.readFileSync(file);
    JSON.parse(buf); // must be valid JSON
    const complete = got === expected;
    manifest.tables[t] = { present: true, expected_count: expected, saved_count: got, complete, bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") };
    console.log(`${complete ? "OK      " : "MISMATCH"} ${t.padEnd(16)} expected=${String(expected).padStart(6)} saved=${String(got).padStart(6)}  ${(buf.length / 1048576).toFixed(2)} MB`);
  }

  fs.writeFileSync(path.join(OUT, "MANIFEST.json"), JSON.stringify(manifest, null, 2));
  const bad = Object.entries(manifest.tables).filter(([, v]) => v.present && !v.complete);
  console.log(bad.length ? `\nINCOMPLETE: ${bad.map(([k]) => k).join(", ")} (the database changed while exporting? run it again)` : "\nAll tables saved completely.");
  console.log("Output folder:", OUT);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
