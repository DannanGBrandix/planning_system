// ---------------------------------------------------------------------------
// `npm run ck:login`
//
// Opens a real Chrome window, lets you sign in to SharePoint / Microsoft 365
// once with your Brandix account, and saves the session to
// server/.ck-session.json. After that the server can pull the CK tracking
// charts on its own — "Pull latest from SharePoint" in the Sync CK Charts panel.
//
// Sign-in is detected automatically (it actually test-downloads one chart), so
// it works even when run through a wrapper that has no interactive stdin.
// Pressing ENTER also saves immediately if you'd rather not wait for the check.
//
// Re-run this whenever a pull reports "not signed in".
// ---------------------------------------------------------------------------

const readline = require("readline");
const {
  SESSION_FILE,
  folderWebUrl,
  downloadUrl,
  launchChrome,
  isXlsx,
  looksLikeLogin,
  FILES,
} = require("./ckFetch");

const CHECK_EVERY_MS = 4000;
const GIVE_UP_AFTER_MS = 6 * 60 * 1000;

async function sessionIsSignedIn(context) {
  try {
    const resp = await context.request.get(downloadUrl(FILES[0]), {
      maxRedirects: 10,
      timeout: 60000,
    });
    const buf = await resp.body();
    const head = buf.slice(0, 512).toString("utf8");
    if (looksLikeLogin(resp.status(), resp.url(), head)) return false;
    return isXlsx(buf);
  } catch {
    return false;
  }
}

(async () => {
  let chromium;
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    console.error("playwright-core is not installed — run `npm install` first.");
    process.exit(1);
  }

  let browser;
  try {
    browser = await launchChrome(chromium, false);
  } catch (e) {
    console.error(
      "\nCould not launch a browser. Install Google Chrome, or run\n" +
        "  npx playwright install chromium\n" +
        "and try again.\n",
    );
    console.error(String(e.message || e));
    process.exit(1);
  }

  const ctx = await browser.newContext({ acceptDownloads: false });
  const page = await ctx.newPage();
  await page.goto(folderWebUrl()).catch(() => {});

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log(" A Chrome window opened.");
  console.log("");
  console.log(" 1. Sign in with your Brandix account (tick \"Stay signed in\").");
  console.log(" 2. Wait until the CKA Tracking Charts / 2027 folder shows the");
  console.log("    .xlsx files.");
  console.log("");
  console.log(" I'll detect the sign-in automatically and save the session.");
  console.log(" (Or press ENTER here to save right now.)");
  console.log("──────────────────────────────────────────────────────────────\n");

  let done = false;
  const finish = async (why) => {
    if (done) return;
    done = true;
    const ok = await sessionIsSignedIn(ctx);
    if (!ok && why === "enter") {
      console.log(
        "\n⚠  Not signed in yet — SharePoint still returns a login page.\n" +
          "   Finish signing in, then run `npm run ck:login` again.\n",
      );
      await browser.close().catch(() => {});
      process.exit(1);
    }
    await ctx.storageState({ path: SESSION_FILE });
    await browser.close().catch(() => {});
    console.log(`\n✓ Session saved to ${SESSION_FILE}`);
    console.log('  Now use "Pull latest from SharePoint" in the Sync CK Charts panel.\n');
    process.exit(0);
  };

  // ENTER = save now
  try {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on("line", () => {
      rl.close();
      finish("enter");
    });
  } catch {
    /* no interactive stdin — auto-detect only */
  }

  // Poll for a working session
  const startedAt = Date.now();
  const timer = setInterval(async () => {
    if (done) return clearInterval(timer);
    if (Date.now() - startedAt > GIVE_UP_AFTER_MS) {
      clearInterval(timer);
      if (!done) {
        done = true;
        console.log("\n⚠  Timed out waiting for sign-in. Run `npm run ck:login` again.\n");
        await browser.close().catch(() => {});
        process.exit(1);
      }
      return;
    }
    if (await sessionIsSignedIn(ctx)) {
      clearInterval(timer);
      await finish("auto");
    }
  }, CHECK_EVERY_MS);

  // If the user just closes the Chrome window, save whatever we have.
  browser.on("disconnected", () => finish("enter"));
})();
