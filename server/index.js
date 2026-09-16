const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const db = require("./db");
const ckSync = require("./ckSync");

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for frontend Next.js app
app.use(
  cors({
    origin: "*", // Allow all origins for dev simplicity, restrict in production
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Disposition", "X-CK-Category"],
  })
);

app.use(express.json({ limit: "50mb" }));

const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let userRole = "Planner";
    let userId = "local-dev-user";

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const { data, error } = await supabase.auth.getUser(token);
      
      if (!error && data?.user) {
        userId = data.user.id;
        // Get user role
        const { data: roleData, error: roleError } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .single();

        if (!roleError && roleData) {
          userRole = roleData.role;
        }
      }
    }

    // Bypass the auto-grant if Supabase is unreachable, just use the local role
    try {
      if (userRole === "Planner" && userId !== "local-dev-user") {
        await supabase.from("user_roles").upsert({ user_id: userId, role: "Planner" });
      }
    } catch (e) {
      console.warn("Could not upsert role to Supabase, continuing locally.");
    }
    
    req.userRole = userRole;

    // Enforce read-only access
    if (userRole === "Read-Only" && ["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
      return res.status(403).json({ error: "Forbidden: Read-Only access" });
    }

    next();
  } catch (err) {
    console.error("Auth Middleware Error:", err);
    return res.status(500).json({ error: "Internal Server Error during authentication" });
  }
};

app.use("/api", authMiddleware);

app.get("/api/auth/me", (req, res) => {
  res.json({ role: req.userRole });
});

// Admin: Get all users and their roles
app.get("/api/admin/users", async (req, res) => {
  try {
    if (req.userRole !== "Planner" && req.userRole !== "Admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    
    // We fetch from user_roles. Since we need emails, we'd ideally join auth.users.
    // Assuming we can fetch auth.users, or just return user_roles.
    // Supabase JS doesn't let us query auth.users with anon key, 
    // but we can query user_roles. The UI will just show user_id if we can't get email, 
    // or we can use the admin API if we have the service role key.
    // For this mockup, we'll just fetch user_roles.
    const { data: roles, error } = await supabase.from("user_roles").select("*");
    if (error) throw error;
    
    res.json(roles);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Create a new user and assign a team
app.post("/api/admin/users", async (req, res) => {
  try {
    if (req.userRole !== "Planner" && req.userRole !== "Admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    
    const { username, password, team } = req.body;
    if (!username || !password || !team) {
      return res.status(400).json({ error: "Missing fields" });
    }
    
    const cleanUsername = username.trim().toLowerCase().replace(/\s+/g, '');
    const email = `${cleanUsername}@brandix.com`;
    
    // Use a fresh client so we don't pollute the session if it's stored globally (though it's server side)
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    );
    
    const { data, error } = await adminClient.auth.signUp({
      email,
      password,
    });
    
    if (error) throw error;
    
    // Assign role
    if (data.user) {
      const { error: roleError } = await supabase
        .from("user_roles")
        .upsert({ user_id: data.user.id, role: team });
        
      if (roleError) throw roleError;
    }
    
    res.json({ success: true, user_id: data.user?.id });
  } catch (err) {
    console.error("Error creating user:", err);
    res.status(500).json({ error: err.message });
  }
});



// 1. Get All Rows (optionally filtered by team)
app.get("/api/rows", async (req, res) => {
  try {
    // Determine if a team filter should be applied
    // Teams pass their role name; Planner, Management, Plant Department get unfiltered data
    const teamParam = req.userRole || "";
    const PRIVILEGED_ROLES = ["Planner", "Management", "Plant Department", ""];
    const isTeamRole = teamParam.startsWith("Team");
    const teamOwner = isTeamRole ? teamParam : null;

    const rows = await db.getAllRows(teamOwner);
    res.json(rows);
  } catch (err) {
    console.error("Error in GET /api/rows:", err);
    res.status(500).json({ error: "Failed to fetch rows: " + err.message });
  }
});

// 2. Create Row
app.post("/api/rows", async (req, res) => {
  try {
    const saved = await db.saveRow(req.body);
    res.status(201).json(saved);
  } catch (err) {
    console.error("Error in POST /api/rows:", err);
    res.status(500).json({ error: "Failed to create row: " + err.message });
  }
});

// 3. Update Row
app.put("/api/rows/:id", async (req, res) => {
  try {
    const row = { ...req.body, id: req.params.id };
    const saved = await db.saveRow(row);
    res.json(saved);
  } catch (err) {
    console.error(`Error in PUT /api/rows/${req.params.id}:`, err);
    res.status(500).json({ error: "Failed to update row: " + err.message });
  }
});

// 4. Delete Row
app.delete("/api/rows/:id", async (req, res) => {
  try {
    await db.deleteRow(req.params.id);
    res.json({ success: true, message: `Row ${req.params.id} deleted successfully.` });
  } catch (err) {
    console.error(`Error in DELETE /api/rows/${req.params.id}:`, err);
    res.status(500).json({ error: "Failed to delete row: " + err.message });
  }
});

// 4b. Clear All Rows
app.delete("/api/rows", async (req, res) => {
  try {
    await db.clearAllRows();
    res.json({ success: true, message: "All rows deleted successfully." });
  } catch (err) {
    console.error("Error in DELETE /api/rows:", err);
    res.status(500).json({ error: "Failed to clear all rows: " + err.message });
  }
});

// 5. Delete Multiple Rows
app.post("/api/rows/delete-multiple", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: "Missing array of ids." });
    }
    await db.deleteMultipleRows(ids);
    res.json({ success: true, message: `${ids.length} rows deleted successfully.` });
  } catch (err) {
    console.error("Error in POST /api/rows/delete-multiple:", err);
    res.status(500).json({ error: "Failed to delete multiple rows: " + err.message });
  }
});

// 5b. Upsert Multiple Rows
app.post("/api/rows/bulk", async (req, res) => {
  try {
    const { rows } = req.body;
    if (!rows || !Array.isArray(rows)) {
      return res.status(400).json({ error: "Missing array of rows." });
    }
    await db.upsertMultipleRows(rows);
    res.status(201).json({ success: true, message: `${rows.length} rows upserted successfully.` });
  } catch (err) {
    console.error("Error in POST /api/rows/bulk:", err);
    res.status(500).json({ error: "Failed to upsert multiple rows: " + err.message });
  }
});

// 6. Get Audit Logs
app.get("/api/audit-logs", async (req, res) => {
  try {
    const logs = await db.getAuditLogs();
    res.json(logs);
  } catch (err) {
    console.error("Error in GET /api/audit-logs:", err);
    res.status(500).json({ error: "Failed to fetch audit logs: " + err.message });
  }
});

// 7. Add Audit Log
app.post("/api/audit-logs", async (req, res) => {
  try {
    await db.saveAuditLog(req.body);
    res.status(201).json(req.body);
  } catch (err) {
    console.error("Error in POST /api/audit-logs:", err);
    res.status(500).json({ error: "Failed to create audit log: " + err.message });
  }
});

// 7b. Add Multiple Audit Logs
app.post("/api/audit-logs/bulk", async (req, res) => {
  try {
    const { logs } = req.body;
    if (!logs || !Array.isArray(logs)) {
      return res.status(400).json({ error: "Missing array of logs." });
    }
    await db.saveMultipleAuditLogs(logs);
    res.status(201).json({ success: true, message: `${logs.length} audit logs saved.` });
  } catch (err) {
    console.error("Error in POST /api/audit-logs/bulk:", err);
    res.status(500).json({ error: "Failed to create multiple audit logs: " + err.message });
  }
});

// 8. Clear Audit Logs
app.delete("/api/audit-logs", async (req, res) => {
  try {
    await db.clearAuditLogs();
    res.json({ success: true, message: "Audit logs cleared." });
  } catch (err) {
    console.error("Error in DELETE /api/audit-logs:", err);
    res.status(500).json({ error: "Failed to clear audit logs: " + err.message });
  }
});

// 9. Get Column Settings
app.get("/api/columns", async (req, res) => {
  try {
    const cols = await db.getColumns();
    res.json(cols);
  } catch (err) {
    console.error("Error in GET /api/columns:", err);
    res.status(500).json({ error: "Failed to fetch columns config: " + err.message });
  }
});

// 10. Update Column Settings
app.put("/api/columns", async (req, res) => {
  try {
    await db.saveColumns(req.body);
    res.json({ success: true, message: "Columns configuration updated." });
  } catch (err) {
    console.error("Error in PUT /api/columns:", err);
    res.status(500).json({ error: "Failed to save columns config: " + err.message });
  }
});

// 10a. Season AOQ dates (Category + Season fallback deadline)
app.get("/api/season-aoq", async (req, res) => {
  try {
    const map = await db.getSeasonAoq();
    res.json(map);
  } catch (err) {
    console.error("Error in GET /api/season-aoq:", err);
    res.status(500).json({ error: "Failed to fetch season AOQ config: " + err.message });
  }
});

app.put("/api/season-aoq", async (req, res) => {
  try {
    await db.saveSeasonAoq(req.body);
    res.json({ success: true, message: "Season AOQ config updated." });
  } catch (err) {
    console.error("Error in PUT /api/season-aoq:", err);
    res.status(500).json({ error: "Failed to save season AOQ config: " + err.message });
  }
});

// 10a-2. Plant aliases (merge / hide plant names)
app.get("/api/plant-aliases", async (req, res) => {
  try {
    const config = await db.getPlantAliases();
    res.json(config);
  } catch (err) {
    console.error("Error in GET /api/plant-aliases:", err);
    res.status(500).json({ error: "Failed to fetch plant aliases: " + err.message });
  }
});

app.put("/api/plant-aliases", async (req, res) => {
  try {
    await db.savePlantAliases(req.body);
    res.json({ success: true, message: "Plant aliases updated." });
  } catch (err) {
    console.error("Error in PUT /api/plant-aliases:", err);
    res.status(500).json({ error: "Failed to save plant aliases: " + err.message });
  }
});

// 10a-3. Trigger catalog (planner-defined Triggers with their own AOQ date + Category/Season)
app.get("/api/trigger-catalog", async (req, res) => {
  try {
    const triggers = await db.getTriggerCatalog();
    res.json({ triggers });
  } catch (err) {
    console.error("Error in GET /api/trigger-catalog:", err);
    res.status(500).json({ error: "Failed to fetch trigger catalog: " + err.message });
  }
});

app.put("/api/trigger-catalog", async (req, res) => {
  try {
    await db.saveTriggerCatalog(req.body?.triggers);
    res.json({ success: true, message: "Trigger catalog updated." });
  } catch (err) {
    console.error("Error in PUT /api/trigger-catalog:", err);
    res.status(500).json({ error: "Failed to save trigger catalog: " + err.message });
  }
});

// 10b. Backups: list (metadata only, no row payload)
app.get("/api/backups", async (req, res) => {
  try {
    const backups = await db.listBackups();
    res.json(backups);
  } catch (err) {
    console.error("Error in GET /api/backups:", err);
    res.status(500).json({ error: "Failed to fetch backups: " + err.message });
  }
});

// 10c. Backups: create a snapshot of the rows the caller currently has
app.post("/api/backups", async (req, res) => {
  try {
    const { label, rows, reason } = req.body;
    if (!rows || !Array.isArray(rows)) {
      return res.status(400).json({ error: "Missing array of rows." });
    }
    const backup = await db.createBackup(label, rows, reason, req.userRole);
    res.status(201).json(backup);
  } catch (err) {
    console.error("Error in POST /api/backups:", err);
    res.status(500).json({ error: "Failed to create backup: " + err.message });
  }
});

// 10d. Backups: fetch one full backup (including row data) — used to preview before restoring
app.get("/api/backups/:id", async (req, res) => {
  try {
    const backup = await db.getBackup(req.params.id);
    if (!backup) return res.status(404).json({ error: "Backup not found" });
    res.json(backup);
  } catch (err) {
    console.error(`Error in GET /api/backups/${req.params.id}:`, err);
    res.status(500).json({ error: "Failed to fetch backup: " + err.message });
  }
});

// 10e. Backups: restore — replaces all current rows with the backup's snapshot
app.post("/api/backups/:id/restore", async (req, res) => {
  try {
    const result = await db.restoreBackup(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error(`Error in POST /api/backups/${req.params.id}/restore:`, err);
    res.status(500).json({ error: "Failed to restore backup: " + err.message });
  }
});

// ============================================================
// Plant update sync (shared Google Sheet -> staging -> approve)
// ============================================================

// P1. Reason codes (controlled failure-reason list)
app.get("/api/reason-codes", async (req, res) => {
  try {
    res.json(await db.getReasonCodes());
  } catch (err) {
    console.error("Error in GET /api/reason-codes:", err);
    res.status(500).json({ error: "Failed to fetch reason codes: " + err.message });
  }
});

// P2. Event codes (milestone vocabulary)
app.get("/api/event-codes", async (req, res) => {
  try {
    res.json(await db.getEventCodes());
  } catch (err) {
    console.error("Error in GET /api/event-codes:", err);
    res.status(500).json({ error: "Failed to fetch event codes: " + err.message });
  }
});

// P2b. Reason code CRUD (Planner/Admin) — admin "Reason Codes" tab
app.post("/api/reason-codes", async (req, res) => {
  try {
    if (req.userRole !== "Planner" && req.userRole !== "Admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!req.body || !req.body.code) return res.status(400).json({ error: "code is required" });
    res.status(201).json(await db.upsertReasonCode(req.body));
  } catch (err) {
    console.error("Error in POST /api/reason-codes:", err);
    res.status(500).json({ error: "Failed to save reason code: " + err.message });
  }
});

app.put("/api/reason-codes/:code", async (req, res) => {
  try {
    if (req.userRole !== "Planner" && req.userRole !== "Admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(await db.upsertReasonCode({ ...req.body, code: req.params.code }));
  } catch (err) {
    console.error(`Error in PUT /api/reason-codes/${req.params.code}:`, err);
    res.status(500).json({ error: "Failed to save reason code: " + err.message });
  }
});

app.delete("/api/reason-codes/:code", async (req, res) => {
  try {
    if (req.userRole !== "Planner" && req.userRole !== "Admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    await db.deleteReasonCode(req.params.code);
    res.json({ success: true });
  } catch (err) {
    console.error(`Error in DELETE /api/reason-codes/${req.params.code}:`, err);
    res.status(500).json({ error: "Failed to delete reason code: " + err.message });
  }
});

// P3. List staged plant updates (default: pending)
app.get("/api/plant-updates", async (req, res) => {
  try {
    res.json(await db.listPendingUpdates(req.query.status || "pending"));
  } catch (err) {
    console.error("Error in GET /api/plant-updates:", err);
    res.status(500).json({ error: "Failed to fetch plant updates: " + err.message });
  }
});

// P4. Create/replace a staging row (manual / curl entry; the Apps Script writes
// straight to Supabase). Gated by the same Read-Only block as everything else.
app.post("/api/plant-updates", async (req, res) => {
  try {
    const item = req.body || {};
    if (!item.row_id || !item.field_key) {
      return res.status(400).json({ error: "row_id and field_key are required" });
    }
    res.status(201).json(await db.createPendingUpdate(item));
  } catch (err) {
    console.error("Error in POST /api/plant-updates:", err);
    res.status(500).json({ error: "Failed to create plant update: " + err.message });
  }
});

// P5. Apply approved staging rows into rows.schedule (Planner/Admin only)
app.post("/api/plant-updates/apply", async (req, res) => {
  try {
    if (req.userRole !== "Planner" && req.userRole !== "Admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { ids } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ error: "Missing array of ids." });
    res.json(await db.applyPendingUpdates(ids, req.userRole));
  } catch (err) {
    console.error("Error in POST /api/plant-updates/apply:", err);
    res.status(500).json({ error: "Failed to apply plant updates: " + err.message });
  }
});

// P6. Reject staging rows (Planner/Admin only)
app.post("/api/plant-updates/reject", async (req, res) => {
  try {
    if (req.userRole !== "Planner" && req.userRole !== "Admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { ids } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ error: "Missing array of ids." });
    res.json(await db.rejectPendingUpdates(ids, req.userRole));
  } catch (err) {
    console.error("Error in POST /api/plant-updates/reject:", err);
    res.status(500).json({ error: "Failed to reject plant updates: " + err.message });
  }
});

// 11. Reset Database & Seed
app.post("/api/reset", async (req, res) => {
  try {
    const { mockRows } = req.body;
    if (!mockRows || !Array.isArray(mockRows)) {
      return res.status(400).json({ error: "Missing mockRows array." });
    }
    await db.seedDatabase(mockRows);
    res.json({ success: true, message: "Database re-seeded successfully." });
  } catch (err) {
    console.error("Error in POST /api/reset:", err);
    res.status(500).json({ error: "Failed to reset database: " + err.message });
  }
});

// 12. CK Charts sync — read the CK tracking-chart workbooks from the local
// OneDrive-synced folder, report which changed, stream them to the importer.
ckSync.registerRoutes(app, supabase);

// Start Server
app.listen(PORT, () => {
  console.log(`[SERVER] Embellishment Planning API server running on port ${PORT}`);
});
