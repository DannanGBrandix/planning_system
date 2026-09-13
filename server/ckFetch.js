// ---------------------------------------------------------------------------
// CK Charts — pull the tracking-chart workbooks straight from SharePoint and
// hand the bytes back IN MEMORY (nothing is saved to disk), using a sign-in the
// user established once (see ckAuth.js / `npm run ck:login`).
//
// Why this exists: the app server has no browser, and the CK files live in a
// "People in Brandix with the link" OneDrive folder — an anonymous request
// gets a login page, not a file. So we replay a saved session:
//
//   server/.ck-session.json   Playwright storageState (cookies) — gitignored
//
// Fetch strategy:
//   1. Plain authenticated HTTP request with the saved cookies (fast, no
//      browser) — hits the same /_layouts/15/download.aspx?SourceUrl=… URL a
//      browser "Download" uses.
//   2. If SharePoint bounces us to a sign-in page the short-lived FedAuth
//      cookie has expired — launch headless Chrome with the same session so it
//      can do a silent SSO refresh (works while the longer-lived rtFa cookie
//      is still alive), re-save the session, and retry once.
//   3. Still a login page -> { needAuth: true }; the user re-runs
//      `npm run ck:login`.
//
// Config (server/.env, all optional — sensible defaults below):
//   CK_SP_SITE     personal-site root, e.g.
//                  https://brandix-my.sharepoint.com/personal/sudheerak_brandix_com
//   CK_SP_FOLDER   server-relative folder path that holds the 6 workbooks
//   CK_SP_FILES    "|"-separated file names, to override the default list
// ---------------------------------------------------------------------------

const path = require("path");
const fs = require("fs");

const SESSION_FILE = path.resolve(__dirname, ".ck-session.json");

const SITE =
  process.env.CK_SP_SITE ||
  "https://brandix-my.sharepoint.com/personal/sudheerak_brandix_com";
const FOLDER =
  process.env.CK_SP_FOLDER ||
  "/personal/sudheerak_brandix_com/Documents/CKA Tracking Charts/2027";

const DEFAULT_FILES = [
  "CKNA FAWI27 Men's Tracking Chart.xlsx",
  "CKNA FAWI27 Women's Tracking Chart.xlsx",
  "CKNA SPSU27 Men's Tracking Chart.xlsx",
  "CKNA SPSU27 Women's Tracking Chart.xlsx",
  "SP27 CKP Tracking Chart.xlsx",
  "SPSU27 Other Knit Tracker.xlsx",
];
const FILES = (process.env.CK_SP_FILES || "").trim()
  ? process.env.CK_SP_FILES.split("|").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_FILES;

/** The URL a browser "Download" hits for one file in the folder. */
function downloadUrl(fileName) {
  const src = `${FOLDER.replace(/\/$/, "")}/${fileName}`;
  return `${SITE}/_layouts/15/download.aspx?SourceUrl=${encodeURIComponent(src)}`;
}

/** SharePoint web view of the folder — where the user lands during ck:login. */
function folderWebUrl() {
  return `${SITE}/_layouts/15/onedrive.aspx?id=${encodeURIComponent(FOLDER)}`;
}

function loadPlaywright() {
  try {
    return require("playwright-core");
  } catch {
    throw new Error(
      "playwright-core is not installed — run `npm install` in the project root.",
    );
  }
}

function sessionExists() {
  return fs.existsSync(SESSION_FILE);
}

// Prefer the user's installed Google Chrome (no browser download); fall back to
// a `npx playwright install chromium` binary if that's what's available.
async function launchChrome(chromium, headless) {
  try {
    return await chromium.launch({ channel: "chrome", headless });
  } catch {
    return await chromium.launch({ headless });
  }
}

const LOGIN_URL = /login\.microsoftonline\.com|login\.live\.com|\/_forms\/default\.aspx|\/login\.aspx|\/_layouts\/15\/(Authenticate|error)\.aspx/i;
function looksLikeLogin(status, url, bodyStart) {
  if (LOGIN_URL.test(url || "")) return true;
  if (status === 401 || status === 403) return true;
  if (/<title>\s*Sign in/i.test(bodyStart || "")) return true;
  return false;
}

// A real .xlsx is a ZIP — first two bytes "PK". A login/HTML/error response is not.
function isXlsx(buf) {
  return buf && buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

async function fetchViaRequest(files) {
  const { request } = loadPlaywright();
  const ctx = await request.newContext({ storageState: SESSION_FILE });
  const out = [];
  try {
    for (const name of files) {
      try {
        const resp = await ctx.get(downloadUrl(name), {
          maxRedirects: 10,
          timeout: 180000,
        });
        const buf = await resp.body();
        const head = buf.slice(0, 512).toString("utf8");
        const login = looksLikeLogin(resp.status(), resp.url(), head);
        if (login || !isXlsx(buf)) {
          out.push({ name, ok: false, login, status: resp.status() });
        } else {
          out.push({ name, ok: true, buf });
        }
      } catch (e) {
        out.push({ name, ok: false, login: false, status: 0, error: String(e.message || e) });
      }
    }
  } finally {
    await ctx.dispose();
  }
  return out;
}

// Launch headless Chrome with the saved session and hit a SharePoint page so it
// can silently re-mint FedAuth from rtFa. Returns true if the session still
// resolves to a signed-in user (and re-saves it), false if a real login is needed.
async function refreshSession(log) {
  const { chromium } = loadPlaywright();
  let browser;
  try {
    browser = await launchChrome(chromium, true);
  } catch (e) {
    log(`  (silent refresh unavailable: ${e.message})`);
    return false;
  }
  try {
    const ctx = await browser.newContext({ storageState: SESSION_FILE });
    const page = await ctx.newPage();
    await page
      .goto(`${SITE}/_layouts/15/sharepoint.aspx`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      })
      .catch(() => {});
    await page.waitForTimeout(4000);
    if (LOGIN_URL.test(page.url())) return false;
    await ctx.storageState({ path: SESSION_FILE });
    return true;
  } catch {
    return false;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Pull every CK workbook from SharePoint and return the bytes IN MEMORY — no
 * file is written anywhere. The caller (ckSync.js) holds the buffers just long
 * enough to run the import. Never throws for a per-file failure.
 *
 * @returns {{
 *   files: { name: string, buffer: Buffer }[],
 *   failed: { name: string, error: string }[],
 *   needAuth: boolean,
 *   reason?: string,
 * }}
 */
async function fetchCkBuffers({ onLog } = {}) {
  const log = (m) => onLog && onLog(m);

  if (!sessionExists()) {
    return {
      files: [],
      failed: [],
      needAuth: true,
      reason: "Not signed in to SharePoint yet. Run `npm run ck:login` once in the project terminal.",
    };
  }

  log(`Reading ${FILES.length} CK chart(s) from SharePoint…`);
  let results = await fetchViaRequest(FILES);

  if (results.some((r) => !r.ok && r.login)) {
    log("Session looks expired — trying a silent refresh…");
    if (await refreshSession(log)) {
      log("Refreshed. Retrying…");
      results = await fetchViaRequest(FILES);
    }
  }

  if (results.length && results.every((r) => !r.ok && r.login)) {
    return {
      files: [],
      failed: FILES.map((n) => ({ name: n, error: "not signed in" })),
      needAuth: true,
      reason: "SharePoint session expired. Run `npm run ck:login` again.",
    };
  }

  const files = [];
  const failed = [];
  for (const r of results) {
    if (r.ok) {
      log(`  ✓ ${r.name} (${(r.buf.length / 1e6).toFixed(1)} MB)`);
      files.push({ name: r.name, buffer: r.buf });
    } else {
      const why = r.login ? "not signed in" : r.error ? r.error : `HTTP ${r.status}`;
      log(`  ✗ ${r.name} — ${why}`);
      failed.push({ name: r.name, error: why });
    }
  }
  return { files, failed, needAuth: false };
}

module.exports = {
  fetchCkBuffers,
  launchChrome,
  isXlsx,
  looksLikeLogin,
  SESSION_FILE,
  downloadUrl,
  folderWebUrl,
  FILES,
  SITE,
  FOLDER,
};
