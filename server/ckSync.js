// ---------------------------------------------------------------------------
// CK Charts sync — gets the six CK tracking-chart workbooks to the frontend and
// tracks which changed since the last sync (for the dashboard alert badge).
//
// Two sources, memory-first:
//   1. SharePoint  — "Pull latest from SharePoint" fetches the live workbooks
//      straight from OneDrive into memory (server/ckFetch.js, using the
//      `npm run ck:login` session). NOTHING is written to disk; the buffers are
//      held in `memCharts` only until the import has read them.
//   2. Folder      — CK_SYNC_DIR (server/.env). A fallback for when there's no
//      SharePoint session yet; drop the .xlsx files there manually.
//
// The in-memory copy always wins over the folder copy.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { planDedupe, applyDedupe } = require("./ckDedupe");
const { fetchCkBuffers } = require("./ckFetch");

// key -> { fileName, buffer, hash, category, at } for charts pulled from
// SharePoint this server run. Cleared only by a restart or a fresh pull.
const memCharts = new Map();
const hashBuf = (buf) => crypto.createHash("sha1").update(buf).digest("hex");

const CK_SYNC_DIR =
  process.env.CK_SYNC_DIR ||
  "C:/Users/danna/AppData/Local/Temp/claude/D--Brandix-embellishmentplan/1731609e-b3ba-4f07-b9aa-70d589fc8b06/scratchpad/ck";

const STATE_FILE = path.resolve(__dirname, ".ck_sync_state.json");

// The known charts. `match` is tested (case-insensitive) against the file name;
// `category` is the CK category every row from that file is stamped with.
const CK_CHARTS = [
  { key: "ckna-fawi-mens", category: "CKNA Men's", match: [/ckna/i, /fawi/i, /men/i], not: [/women/i], label: "CKNA FAWI27 Men's" },
  { key: "ckna-fawi-womens", category: "CKNA Women's", match: [/ckna/i, /fawi/i, /women/i], label: "CKNA FAWI27 Women's" },
  { key: "ckna-spsu-mens", category: "CKNA Men's", match: [/ckna/i, /spsu/i, /men/i], not: [/women/i], label: "CKNA SPSU27 Men's" },
  { key: "ckna-spsu-womens", category: "CKNA Women's", match: [/ckna/i, /spsu/i, /women/i], label: "CKNA SPSU27 Women's" },
  { key: "ckp", category: "CKP", match: [/ckp/i], label: "CKP" },
  { key: "other-knit", category: "Other Knit", match: [/other\s*knit/i], label: "Other Knit" },
];

function classifyFile(name) {
  for (const chart of CK_CHARTS) {
    if (chart.not && chart.not.some((re) => re.test(name))) continue;
    if (chart.match.every((re) => re.test(name))) return chart;
  }
  return null;
}

function listXlsx(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith("~$"));
  } catch {
    return null; // directory missing / unreadable
  }
}

function sha1(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha1").update(buf).digest("hex");
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

/** Current status of every known chart — SharePoint (memory) first, folder next. */
function chartStatus() {
  const state = readState();
  const files = listXlsx(CK_SYNC_DIR);
  const dirOk = files !== null;
  const charts = CK_CHARTS.map((chart) => {
    const last = state[chart.key];
    const base = {
      key: chart.key,
      label: chart.label,
      category: chart.category,
      lastSyncedHash: last?.hash || null,
      lastSyncedAt: last?.at || null,
    };

    const mem = memCharts.get(chart.key);
    if (mem) {
      return {
        ...base,
        present: true,
        source: "sharepoint",
        fileName: mem.fileName,
        size: mem.buffer.length,
        modified: mem.at,
        hash: mem.hash,
        changed: !last || last.hash !== mem.hash,
      };
    }

    const fileName = dirOk ? files.find((f) => classifyFile(f)?.key === chart.key) : null;
    if (!fileName) {
      return { ...base, present: false, source: null, changed: false };
    }
    const full = path.join(CK_SYNC_DIR, fileName);
    const stat = fs.statSync(full);
    const hash = sha1(full);
    return {
      ...base,
      present: true,
      source: "folder",
      fileName,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      hash,
      changed: !last || last.hash !== hash,
    };
  });
  return {
    dir: CK_SYNC_DIR,
    dirOk,
    charts,
    anyChanged: charts.some((c) => c.changed && c.present),
    missing: charts.filter((c) => !c.present).map((c) => c.label),
    haveSharePoint: memCharts.size > 0,
  };
}

function resolveChartFile(key) {
  const mem = memCharts.get(key);
  if (mem) {
    return {
      fileName: mem.fileName,
      buffer: mem.buffer,
      chart: CK_CHARTS.find((c) => c.key === key),
    };
  }
  const files = listXlsx(CK_SYNC_DIR) || [];
  const fileName = files.find((f) => classifyFile(f)?.key === key);
  if (!fileName) return null;
  return { fileName, full: path.join(CK_SYNC_DIR, fileName), chart: CK_CHARTS.find((c) => c.key === key) };
}

/** Record the given chart keys (or all present) as synced at their current hash. */
function markSynced(keys) {
  const status = chartStatus();
  const state = readState();
  const now = new Date().toISOString();
  const targets = keys && keys.length ? keys : status.charts.filter((c) => c.present).map((c) => c.key);
  for (const c of status.charts) {
    if (c.present && targets.includes(c.key)) {
      state[c.key] = { hash: c.hash, at: now, fileName: c.fileName };
    }
  }
  writeState(state);
  return chartStatus();
}

function registerRoutes(app, supabase) {
  app.get("/api/ck-charts", (req, res) => {
    try {
      res.json(chartStatus());
    } catch (err) {
      console.error("GET /api/ck-charts:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ck-charts/file", (req, res) => {
    try {
      const { key } = req.query;
      const found = resolveChartFile(String(key || ""));
      if (!found) return res.status(404).json({ error: "chart not available (no SharePoint pull and not in the folder)" });
      res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.set("Content-Disposition", `attachment; filename="${found.fileName}"`);
      res.set("X-CK-Category", found.chart?.category || "CK");
      if (found.buffer) return res.end(found.buffer);
      fs.createReadStream(found.full).pipe(res);
    } catch (err) {
      console.error("GET /api/ck-charts/file:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Pull the live CK workbooks straight from SharePoint into memory using the
  // saved sign-in (see ckFetch.js / `npm run ck:login`). No file is written to
  // disk. The frontend calls this, then runs the normal import, which now reads
  // the workbooks back out of `memCharts` via /api/ck-charts/file.
  app.post("/api/ck-charts/fetch", async (req, res) => {
    try {
      const logs = [];
      const result = await fetchCkBuffers({ onLog: (m) => logs.push(m) });

      const fetched = [];
      const unclassified = [];
      for (const f of result.files) {
        const chart = classifyFile(f.name);
        if (!chart) {
          unclassified.push(f.name);
          continue;
        }
        memCharts.set(chart.key, {
          fileName: f.name,
          buffer: f.buffer,
          hash: hashBuf(f.buffer),
          category: chart.category,
          at: new Date().toISOString(),
        });
        fetched.push(f.name);
      }

      res.json({
        fetched,
        failed: result.failed || [],
        unclassified,
        needAuth: !!result.needAuth,
        reason: result.reason,
        logs,
        status: chartStatus(),
      });
    } catch (err) {
      console.error("POST /api/ck-charts/fetch:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ck-charts/mark-synced", (req, res) => {
    try {
      const keys = Array.isArray(req.body?.keys) ? req.body.keys : null;
      res.json(markSynced(keys));
    } catch (err) {
      console.error("POST /api/ck-charts/mark-synced:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Duplicate cleanup. GET returns the read-only plan; POST {apply:true} executes
  // it (backs every touched row up to the `backups` table first). Rows that carry
  // a real planning event are never touched.
  app.get("/api/ck-charts/dedupe", async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ error: "no db client" });
      const plan = await planDedupe(supabase);
      delete plan._ck;
      res.json(plan);
    } catch (err) {
      console.error("GET /api/ck-charts/dedupe:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ck-charts/dedupe", async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ error: "no db client" });
      const plan = await planDedupe(supabase);
      if (!req.body?.apply) {
        delete plan._ck;
        return res.json({ applied: false, plan });
      }
      const result = await applyDedupe(supabase, plan);
      res.json({ applied: true, result });
    } catch (err) {
      console.error("POST /api/ck-charts/dedupe:", err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerRoutes, chartStatus, CK_SYNC_DIR };
