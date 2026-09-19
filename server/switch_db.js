const fs = require("fs");
const path = require("path");

const targetEnv = process.argv[2]; // "test", "prod", "oldprod" or "oldtest"

if (!targetEnv || !["test", "prod", "oldprod", "oldtest"].includes(targetEnv)) {
  console.log("Usage: node server/switch_db.js [test|prod|oldprod|oldtest]");
  process.exit(1);
}

const DB_CONFIGS = {
  // PRODUCTION since 2026-09-19: the new Supabase account/project (readable column names —
  // see docs/named-columns-and-restore.md). Data was restored from the old prod and verified.
  prod: {
    name: "PRODUCTION (new project, Sep 2026)",
    url: "https://dxppkrlwsrbeiakvjtcg.supabase.co",
    key: "sb_publishable_HZ8kMu9zqs-RVwj_lUU0Fw_ZURuzH1X",
  },
  // The previous production project (old account/org, over its free egress quota). Kept only as a
  // rollback; legacy col1..col33 column names — server/db.js auto-detects that. Do not write to it
  // after cut-over: it no longer receives the app's data.
  oldprod: {
    name: "OLD PRODUCTION (rollback only)",
    url: "https://ktgsyakzevczufcziqci.supabase.co",
    key: "sb_publishable_sd4ukbcNz0Ut6FEdxUugAA_uuhnCCHE",
  },
  // TEST since 2026-09-19: a second project in the NEW Supabase account (readable column names),
  // loaded with a copy of production so tests run against real-shaped data.
  test: {
    name: "TESTING DATABASE (new project, Sep 2026)",
    url: "https://wetaazteocnpkkciemvw.supabase.co",
    key: "sb_publishable_0f7BeIAhjGu5opptu4zriA_iTEig2Tg",
  },
  // The previous test project (old account/org). Legacy col1..col33 names.
  oldtest: {
    name: "OLD TESTING DATABASE (previous project)",
    url: "https://vxsfwwdcjjhsitfauyxa.supabase.co",
    key: "sb_publishable_Tlo7TJBaxPe-WUAxHP9zyg_unc9W2nP",
  },
};

const config = DB_CONFIGS[targetEnv];

// Preserve every CK_* setting across DB switches (this file gets fully
// rewritten below, so anything not in the template would otherwise be lost):
// CK_SYNC_DIR, and the optional CK_SP_* SharePoint-pull overrides.
const serverEnvPathExisting = path.resolve(__dirname, ".env");
let ckLines = "\n";
try {
  const matches = fs
    .readFileSync(serverEnvPathExisting, "utf8")
    .match(/^CK_[A-Z0-9_]+=.*$/gm);
  if (matches && matches.length) ckLines = "\n" + matches.join("\n") + "\n";
} catch {}

// 1. Update .env.local (Frontend)
const envLocalPath = path.resolve(__dirname, "../.env.local");
const envLocalContent = `# Frontend environment variables
NEXT_PUBLIC_API_URL=http://localhost:5001/api

# Active Database Mode: ${targetEnv.toUpperCase()} (${config.name})
NEXT_PUBLIC_SUPABASE_URL=${config.url}
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${config.key}
`;

fs.writeFileSync(envLocalPath, envLocalContent, "utf8");

// 2. Update server/.env (Backend)
const serverEnvPath = path.resolve(__dirname, ".env");
const serverEnvContent = `PORT=5001
${ckLines}
# Active Database Mode: ${targetEnv.toUpperCase()} (${config.name})
NEXT_PUBLIC_SUPABASE_URL=${config.url}
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${config.key}
`;

fs.writeFileSync(serverEnvPath, serverEnvContent, "utf8");

console.log("=================================================");
console.log(`✅ Successfully switched database to: [ ${config.name} ]`);
console.log(`URL: ${config.url}`);
console.log("=================================================");
console.log("👉 Restart your server ('bun run dev:all') if running.");
