/**
 * Embellishment Plan — Plant Update Sync (Google Sheet side)
 * ---------------------------------------------------------------------------
 * Builds a weekly grid per plant (one row per style/leg, three columns per day:
 * event / Result / Reason), lets the plant mark each Pass / Fail (+ a reason from
 * the controlled list), and queues those results into Supabase `pending_updates`
 * for a planner to approve in the app (/plant-updates).
 *
 * Setup: see integrations/google-sheet/README.md (or docs/plant-sheet-sync.md).
 * Shows one week (Mon–Sun of the current week by default).
 *
 * Configure via Project Settings → Script Properties:
 *   DB_MODE            'test' or 'prod'   (which database below to use; default 'test')
 *   SUPABASE_URL_TEST  https://xxxx.supabase.co
 *   SUPABASE_KEY_TEST  sb_publishable_...
 *   SUPABASE_URL_PROD  https://yyyy.supabase.co
 *   SUPABASE_KEY_PROD  sb_publishable_...
 *   WINDOW_DAYS        7   (how many days to show; default 7)      (optional)
 *   TARGET_DATE        2026-08-30  (window start; blank = this Monday)  (optional)
 *   PLANT_EMAILS       {"ANTLER":["a@x.com"],"BFL":[...]}   (optional)
 *   EVENT_FILTER       FS            only show these event codes (comma-sep); blank = all  (optional)
 *   EVENT_EXCLUDE      FS            hide these event codes (comma-sep); blank = none      (optional)
 *   COMBINED_SHEET     true          one shared tab with a Plant column instead of one tab per plant (optional)
 *   SHEET_NAME         Fabric Sending  name of that combined tab (default "All Events")   (optional)
 *   SHEET_EDITORS      ["a@x.com"]   emails allowed to edit the combined tab's Result/Reason (optional)
 *
 * EVENT_FILTER / EVENT_EXCLUDE / COMBINED_SHEET are how one copy of this script drives
 * more than one sheet: leave them blank for the per-plant all-events sheet, or set
 * EVENT_FILTER=FS + COMBINED_SHEET=true on a second sheet to get a single fabric-sample
 * sheet (and optionally EVENT_EXCLUDE=FS on the first so the two don't overlap).
 *
 * Flip test <-> prod from the "Plant Sync" menu, or by editing DB_MODE.
 * (Legacy: plain SUPABASE_URL / SUPABASE_KEY still work as a fallback.)
 */

// ------------------------------ config ------------------------------------

function cfg_() {
  var p = PropertiesService.getScriptProperties();
  var mode = (p.getProperty('DB_MODE') || 'test').toLowerCase();
  var suffix = mode === 'prod' ? '_PROD' : '_TEST';

  var url = (p.getProperty('SUPABASE_URL' + suffix) || p.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  var key = p.getProperty('SUPABASE_KEY' + suffix) || p.getProperty('SUPABASE_KEY') || '';
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL' + suffix + ' and SUPABASE_KEY' + suffix + ' in Script Properties (DB_MODE = ' + mode + ').');
  }
  var emails = {};
  try { emails = JSON.parse(p.getProperty('PLANT_EMAILS') || '{}'); } catch (e) {}
  var sheetEditors = [];
  try { sheetEditors = JSON.parse(p.getProperty('SHEET_EDITORS') || '[]'); } catch (e) {}
  var codeList = function (raw) {
    return String(raw || '').split(',').map(function (s) { return s.trim().toUpperCase(); })
      .filter(function (s) { return s; });
  };
  // Guard against a non-numeric WINDOW_DAYS: parseInt('abc') -> NaN, and Math.max(1, NaN) is
  // still NaN, which made the day-columns loop run zero times (a sheet with no event columns).
  var winDays = parseInt(p.getProperty('WINDOW_DAYS') || '7', 10);
  if (!(winDays >= 1)) winDays = 7;
  return {
    mode: mode,
    url: url,
    key: key,
    targetDate: p.getProperty('TARGET_DATE') || '',
    windowDays: winDays,
    emails: emails,
    eventFilter: codeList(p.getProperty('EVENT_FILTER')),   // allowlist; [] = all
    eventExclude: codeList(p.getProperty('EVENT_EXCLUDE')),  // denylist; [] = none
    combined: String(p.getProperty('COMBINED_SHEET') || '').trim().toLowerCase() === 'true',
    sheetName: (p.getProperty('SHEET_NAME') || 'All Events').trim(),
    sheetEditors: sheetEditors,
  };
}

function currentDbMode_() {
  return (PropertiesService.getScriptProperties().getProperty('DB_MODE') || 'test').toLowerCase();
}

function switchToTest_() { setDbMode_('test'); }
function switchToProd_() { setDbMode_('prod'); }

function setDbMode_(mode) {
  PropertiesService.getScriptProperties().setProperty('DB_MODE', mode);
  var cfg = cfg_(); // validates the target has URL + key
  try {
    SpreadsheetApp.getActive().toast('Now using ' + mode.toUpperCase() + ' database (' + cfg.url + '). Run "Rebuild sheets" to reload.', 'Plant Sync', 8);
  } catch (e) {}
}

var META_TABS = ['_Reasons', '_Meta'];

// Matrix layout: fixed context columns, then 3 columns per day
// (<label> | <label> Result | <label> Reason), then a status column and 4
// hidden housekeeping columns.
var CONTEXT_COLS = ['Style', 'Graphic', 'Combo', 'Ground', 'Technique', 'Comment'];
var COMBINED_CONTEXT_COLS = ['Plant'].concat(CONTEXT_COLS); // combined-sheet layout
var NCTX = CONTEXT_COLS.length;                  // 6 (per-plant); combined tabs use 7
var TRAIL_COLS = ['Sync Status', 'row_id', 'plan', 'sent', 'edited_at']; // 5 (last 4 hidden)
var NTRAIL = TRAIL_COLS.length;

// How many context columns a given generated tab actually has — a combined tab leads
// with a "Plant" column, a per-plant tab does not. Read paths use this; write paths
// use cfg.combined directly.
function nctxOf_(sh) {
  var h0 = String(sh.getRange(1, 1, 1, 1).getValue() || '').trim().toLowerCase();
  return h0 === 'plant' ? COMBINED_CONTEXT_COLS.length : CONTEXT_COLS.length;
}

function dayCols_(nctx, i) {        // (context-col count, 0-based day index) -> 1-based column numbers
  var base = nctx + i * 3;
  return { event: base + 1, result: base + 2, reason: base + 3 };
}
function nDaysOf_(sh) { return Math.max(0, (sh.getLastColumn() - nctxOf_(sh) - NTRAIL) / 3); }
function trailCol_(sh, name) { return sh.getLastColumn() - NTRAIL + 1 + TRAIL_COLS.indexOf(name); }

// A tab we generated carries "plan" and "row_id" in its header row.
function isPlantTab_(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol < NCTX + NTRAIL || sh.getLastRow() < 1) return false;
  var h = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  return h.indexOf('plan') > -1 && h.indexOf('row_id') > -1;
}
var RESULT_OPTIONS = ['Planned', 'Pass', 'Fail'];

// ------------------------------ menu -------------------------------------

function onOpen() {
  var mode = currentDbMode_().toUpperCase();
  var cfg;
  try { cfg = cfg_(); } catch (e) { cfg = { combined: false }; }
  var layout = cfg.combined ? 'ONE COMBINED TAB' : 'ONE TAB PER PLANT';
  SpreadsheetApp.getUi()
    .createMenu('Plant Sync')
    .addItem('Rebuild sheets from system', 'rebuildSheets')
    .addItem('Send edits to system now', 'flushEdits')
    .addSeparator()
    .addItem('★ Make this the FS fabric-sending sheet (one combined tab)', 'makeFabricSendingSheet')
    .addItem('Layout: ' + layout + '  →  switch to ' + (cfg.combined ? 'per-plant' : 'combined'),
             cfg.combined ? 'setLayoutPerPlant_' : 'setLayoutCombined_')
    .addItem('Database: ' + mode + '  →  switch to TEST', 'switchToTest_')
    .addItem('Database: ' + mode + '  →  switch to PROD', 'switchToProd_')
    .addSeparator()
    .addItem('Install / refresh triggers', 'installTriggers')
    .addToUi();
}

// One click: turn this whole spreadsheet into the single-tab FS fabric-sending sheet and
// rebuild it now. Deletes the per-plant tabs and leaves one "Fabric Sending" tab.
function makeFabricSendingSheet() {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('EVENT_FILTER', 'FS');
  p.setProperty('COMBINED_SHEET', 'true');
  if (!p.getProperty('SHEET_NAME')) p.setProperty('SHEET_NAME', 'Fabric Sending');
  rebuildSheets();
  try {
    SpreadsheetApp.getActive().toast(
      'Rebuilt as one "' + (p.getProperty('SHEET_NAME')) + '" tab — FS events only, Plant in column A.',
      'Plant Sync', 8);
  } catch (e) {}
}

function setLayoutCombined_() { setLayout_(true); }
function setLayoutPerPlant_() { setLayout_(false); }

function setLayout_(combined) {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('COMBINED_SHEET', combined ? 'true' : 'false');
  if (combined && !p.getProperty('SHEET_NAME')) p.setProperty('SHEET_NAME', 'All Events');
  try {
    SpreadsheetApp.getActive().toast(
      'Layout set to ' + (combined ? 'one combined tab' : 'one tab per plant') +
      '. Run "Rebuild sheets from system" to apply.', 'Plant Sync', 8);
  } catch (e) {}
}

// ------------------------------ REST helpers -----------------------------

function rest_(cfg, pathAndQuery, opts) {
  opts = opts || {};
  var params = {
    method: opts.method || 'get',
    muteHttpExceptions: true,
    headers: {
      apikey: cfg.key,
      Authorization: 'Bearer ' + cfg.key,
    },
  };
  if (opts.body) {
    params.contentType = 'application/json';
    params.payload = JSON.stringify(opts.body);
  }
  if (opts.prefer) params.headers.Prefer = opts.prefer;
  var res = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + pathAndQuery, params);
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Supabase ' + code + ': ' + res.getContentText().slice(0, 500));
  }
  var text = res.getContentText();
  return text ? JSON.parse(text) : null;
}

// The columns this script reads, under the names the rest of the script uses (col3, col5, …) and
// under the readable names a database created from server/supabase_named.sql stores them as.
var ROW_COLS_ = ['col3', 'col4', 'col5', 'col6', 'col7', 'col8', 'col9', 'col10', 'col11', 'col12', 'col22'];
var NAMED_ROW_COLS_ = {
  col3: 'category', col4: 'season', col5: 'style', col6: 'graphic_combo', col7: 'graphic',
  col8: 'ground', col9: 'techniques', col10: 'process', col11: 'plant', col12: 'plant_flow',
  col22: 'comments',
};

// Tries the readable column names first; if the database still has the old col3/col5/… columns
// Supabase answers 400 and we fall back. Either way the rows come back keyed col3, col5, …
function fetchAllRows_(cfg) {
  try {
    return fetchRowsWith_(cfg, true);
  } catch (e) {
    if (String(e).indexOf('Supabase 400') === -1) throw e;
    return fetchRowsWith_(cfg, false);
  }
}

function fetchRowsWith_(cfg, named) {
  var out = [];
  var pageSize = 1000;
  var offset = 0;
  var cols = ROW_COLS_.map(function (c) { return named ? NAMED_ROW_COLS_[c] : c; });
  var select = ['id'].concat(cols, ['schedule']).join(',');
  while (true) {
    var page = rest_(cfg, 'rows?select=' + select +
      '&is_current=eq.true&limit=' + pageSize + '&offset=' + offset);
    if (!page || !page.length) break;
    if (named) {
      page.forEach(function (r) {
        ROW_COLS_.forEach(function (c) { r[c] = r[NAMED_ROW_COLS_[c]]; delete r[NAMED_ROW_COLS_[c]]; });
      });
    }
    out = out.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

// ------------------------------ event parsing ----------------------------

// Mirror of app/lib/eventCodes.ts parseEventValue — just enough to classify.
function eventStatus_(raw) {
  if (!raw) return null;
  var v = String(raw).trim();
  if (!v) return null;
  if (v.indexOf('|') > -1) {
    var s = (v.split('|')[1] || '').toUpperCase();
    if (s === 'P') return 'pass';
    if (s === 'F') return 'fail';
    return 'planned';
  }
  var up = v.toUpperCase();
  if (/-FAIL$|-F$/.test(up)) return 'fail';
  // "-S" / bare code / anything else = planned (still needs confirmation).
  return 'planned';
}

// The "approval chain" half of the 2-plant PPSES flow (sequence [...,"PPSES","PPS","NY","NYC",
// "MAST","REAP/FCHP","PLSD","PLSA"] — app/lib/planningFlows.ts PLANNING_FLOWS id 2/6/9/12). For a
// "+"-combined single-row location this is the block that belongs on the SECOND plant — mirror
// of POST_PPS_EVENT_CODES in app/lib/plantUtils.ts.
var POST_PPS_EVENT_CODES = {
  'PPS': true, 'NY': true, 'NYC': true, 'MAST': true, 'REAP/FCHP': true, 'PLSD': true, 'PLSA': true
};

function baseCode_(raw) {
  var v = String(raw || '').trim();
  // "|X" = planner-locked planned milestone (app/lib/eventCodes.ts). Strip the tail like any
  // other "|..." verdict so the plant sheet still sees a clean base code.
  if (v.indexOf('|') > -1) return v.split('|')[0].toUpperCase();
  var m = v.match(/^(.+)-(?:S|F|T|PASS|FAIL)$/i);
  return (m ? m[1] : v).trim().toUpperCase();
}

// Plant canonicalization — kept in sync with app/lib/plantUtils.ts CANONICAL_PLANTS.
var CANONICAL_PLANTS = {
  'ANT': 'ANTLER', 'ANTLER': 'ANTLER', 'ANTELR': 'ANTLER', 'ANTLER MRC': 'ANTLER',
  // AV — AV1 / AV2 / BFFAV / BRANDIXEMB are all the same embellishment plant.
  // (AV1 / AV2 lose their digit in normalizeSinglePlant_ and land on "AV" already.)
  'AV': 'AV', 'AV1': 'AV', 'AV2': 'AV',
  'BFFAV': 'AV', 'BFFAW': 'AV', 'BFF AV': 'AV', 'BFF AW': 'AV',
  'BRANDIXEMB': 'AV', 'BRANDIX EMB': 'AV',
  'BRANDIX EMBELLISHMENT': 'AV', 'BRANDIX EMBELLISHMENTS': 'AV',
  'BRANDIXEMBELLISHMENT': 'AV', 'BRANDIXEMBELLISHMENTS': 'AV',
  'BABL': 'BABL', 'ALIF': 'ALIF', 'KC': 'KC', // Alif / KC = BABL sub-plants (2026-11-05)
  'BFL': 'BFL',
  'BRANDIX': 'BRANDIX', 'BRANDIX APPAREL': 'BRANDIX', 'BRANDIX - SLEEP': 'BRANDIX',
  'BRANDIX - SPORT': 'BRANDIX', 'BRANDIX SPORT': 'BRANDIX', 'BRANDIX SLEEP': 'BRANDIX',
  'EXPO': 'EXPO',
  'FUSION': 'FUSION', 'FUSHION': 'FUSION',
  'HI': 'HI EMB', 'HI EMB': 'HI EMB', 'H-EMB': 'HI EMB', 'H EMB': 'HI EMB', 'HI-EMB': 'HI EMB',
  'HIEMB': 'HI EMB', 'HI EMBROIDERY': 'HI EMB', 'HI EMBROIDERY PLANT': 'HI EMB',
  'HI EMBROIDERY-PLANT': 'HI EMB', 'CKT': 'HI EMB',
  'LEEMA': 'LEEMA',
  'MARTEX': 'MARTEX', 'BACK-MARTEX': 'MARTEX', 'BACK MARTEX': 'MARTEX',
  'MRC': 'MRC',
  'REGAL': 'REGAL IMAGE', 'REGAL IMAGE': 'REGAL IMAGE', 'REGALIMAGE': 'REGAL IMAGE', 'REEGAL': 'REGAL IMAGE', 'REEGAL IMAGE': 'REGAL IMAGE',
  'INNER HOOD-REGAL': 'REGAL IMAGE', 'INNER HOOD REGAL': 'REGAL IMAGE',
  'RC': 'RICH COLOR', 'RICH COLOR': 'RICH COLOR',
  'SCREEN LINE': 'SCREEN LINE', 'SCREENLINE': 'SCREEN LINE',
  'THARINDU': 'THARINDU PRINT', 'THARINDU PRINT': 'THARINDU PRINT',
  'THARINDU PRINTER': 'THARINDU PRINT', 'THARINDU PRINTERS': 'THARINDU PRINT',
  'THRINDU': 'THARINDU PRINT', 'THRINDU PRINTERS': 'THARINDU PRINT', 'THRINDU PRINT': 'THARINDU PRINT',
};

function normalizeSinglePlant_(rawName) {
  if (!rawName) return '';
  var clean = String(rawName)
    .replace(/\(.*?\)/g, '')          // drop parenthetical comments e.g. (WA01152)
    .replace(/[^A-Za-z\s-]/g, '')     // drop digits/symbols e.g. BFL01055 -> BFL
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!clean || clean.length <= 1 || clean === 'N/A' || clean === 'TBD' || clean === 'NONE') return '';
  return CANONICAL_PLANTS[clean] || clean;
}

// Mirror of app/lib/plantUtils.ts extractPlants — split multi-plant flow strings
// and canonicalize each, deduped.
function extractPlants_(cell) {
  if (!cell || !String(cell).trim()) return [];
  var tokens = String(cell).replace(/\(.*?\)/g, ' ').split(/>>|>|\+|\/|\n/);
  var seen = {};
  var out = [];
  tokens.forEach(function (tok) {
    var c = normalizeSinglePlant_(tok);
    if (c && !seen[c]) { seen[c] = 1; out.push(c); }
  });
  return out;
}

// Cross-dev leg names for a row — mirror of crossDevLegNames (plantUtils.ts) + the
// isDyeWashRow guard in Table.tsx. Returns [] for a row that is NOT a parallel split
// (one location, a dye/wash round-trip, or a purely sequential ">>"/">" chain with no
// "/") — those keep the "first plant owns the bare key" path. A genuine "/"-split
// ("MRC / BABL", "Antler+Leema / RC+MRC") returns one entry per leg, the leg name kept
// VERBATIM — that is exactly the string the app stores in its "<date>_<leg>" keys.
//
// The leg count comes ONLY from col11's "/" split ("always use the PLANT column to
// identify how many plants"). A dye/wash step in PLANT FLOW (col12
// "BFL (WA01055) >> ANTLER/REGAL/EXPO") or PROCESS text drives the flow, not the leg
// count — so it is not checked. The only dye case that still collapses the split is a
// dye vendor sitting as one of col11's own "/" legs ("LEEMA / BFL" round-trip).
function crossDevLegs_(row) {
  var raw = String(row.col11 || '').trim();
  if (!raw) return [];
  var groups = raw.split('/').map(function (g) { return g.trim(); })
    .filter(function (g) { return g; });
  if (groups.length < 2) return [];

  var isDyeWash = function (p) {
    var u = String(p || '').toUpperCase();
    return u.indexOf('BFL') > -1 || u.indexOf('MARTEX') > -1 || u.indexOf('DYNAWASH') > -1 ||
      u.indexOf('DYE') > -1 || u.indexOf('WASH') > -1;
  };
  if (groups.some(isDyeWash)) {
    return [];
  }
  var legs = [];
  groups.forEach(function (g) {
    g.split(/>>|>/).map(function (s) { return s.trim(); }).filter(function (s) { return s; })
      .forEach(function (s) { if (legs.indexOf(s) === -1) legs.push(s); });
  });
  return legs.length > 1 ? legs : [];
}

// Normalize a leg name ("MRC", "Antler+Leema") to the tab / Plant-column label.
function legTabName_(legName) {
  return String(legName).split('+').map(function (s) {
    return normalizeSinglePlant_(s) || s.trim().toUpperCase();
  }).filter(function (s) { return s; }).join(' + ') || 'Unassigned';
}

// A cross-dev leg can itself be a "+"-combined location ("Antler+Leema") — ONE shared
// production event that both plants work at together. We do NOT want a joint
// "ANTLER + LEEMA" tab; each plant gets its own tab / row instead. Returns every
// individual canonical plant in the leg (deduped); the caller keeps them all pointed
// at the single shared "<date>_<leg>" field key, so a Pass/Fail from either plant
// confirms the same event and the planner still approves it once. Falls back to the
// joint label only if nothing canonicalizes.
function splitLegPlants_(legName) {
  var seen = {}, out = [];
  String(legName).split('+').forEach(function (s) {
    var p = normalizeSinglePlant_(s);
    if (p && !seen[p]) { seen[p] = 1; out.push(p); }
  });
  return out.length ? out : [legTabName_(legName)];
}

// Plants of a "+" leg that own `code`: PPS onward goes to the SECOND plant only (same rule
// as a bare "+" location), earlier steps stay on every plant. Mirror of legPlantsForCode in
// app/lib/plantUtils.ts.
function legPlantsForCode_(legName, code) {
  var plants = splitLegPlants_(legName);
  return (POST_PPS_EVENT_CODES[code] && plants.length >= 2) ? [plants[1]] : plants;
}

function isoDate_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Monday of the week containing `d`.
function weekStart_(d) {
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var day = x.getDay();                 // 0 Sun .. 6 Sat
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
  return x;
}

// "2026-08-14" -> "Fri 14 Aug"
function dateLabel_(iso) {
  var d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? iso : Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEE d MMM');
}

// ------------------------------ rebuildSheets ----------------------------

function rebuildSheets() {
  var cfg = cfg_();
  var ss = SpreadsheetApp.getActive();

  var start = cfg.targetDate || isoDate_(weekStart_(new Date()));
  var endD = new Date(start + 'T00:00:00');
  endD.setDate(endD.getDate() + cfg.windowDays - 1);
  var end = isoDate_(endD);

  var rows = fetchAllRows_(cfg);
  var reasons = rest_(cfg, 'reason_codes?deprecated=eq.false&order=sort_order&select=code,label,responsible');
  var pendingById = {};
  var puList = rest_(cfg, 'pending_updates?select=id,status') || [];
  puList.forEach(function (p) { pendingById[p.id] = p.status; });

  // The days shown as column groups.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    throw new Error('Bad window start "' + start + '" — clear or fix the TARGET_DATE script property (YYYY-MM-DD).');
  }
  var days = [];
  for (var di = 0; di < cfg.windowDays; di++) {
    var dd = new Date(start + 'T00:00:00');
    dd.setDate(dd.getDate() + di);
    days.push({ iso: isoDate_(dd), label: dateLabel_(isoDate_(dd)) });
  }
  if (!days.length) {
    throw new Error('No day columns to build (WINDOW_DAYS = "' + cfg.windowDays + '"). Set WINDOW_DAYS to a whole number like 7, or clear it.');
  }

  // Preserve un-synced edits from the current tabs.
  var savedEdits = readExistingEdits_(ss);

  // Bucket into plant -> (one row per system-row+leg) -> per-date events.
  var buckets = {};
  rows.forEach(function (r) {
    var sched = r.schedule || {};
    var legs = crossDevLegs_(r);              // [] unless this is a "/"-split cross-dev row
    Object.keys(sched).forEach(function (key) {
      var m = key.match(/^(\d{4}-\d{2}-\d{2})(?:_(.+))?$/);
      if (!m) return;
      var dateStr = m[1];
      var suffix = m[2] || '';
      if (dateStr < start || dateStr > end) return;
      var raw = sched[key];
      if (eventStatus_(raw) !== 'planned') return;

      // Optional per-sheet event-code scoping (EVENT_FILTER / EVENT_EXCLUDE script props).
      var code = baseCode_(raw);
      if (cfg.eventFilter.length && cfg.eventFilter.indexOf(code) === -1) return;
      if (cfg.eventExclude.length && cfg.eventExclude.indexOf(code) > -1) return;

      // Which plant tab(s) does this event belong on?
      //  - "<date>_<X>" suffixed key -> that leg, verbatim (a planner-diverged leg).
      //  - bare "<date>" key on a "/"-split cross-dev row -> fan out to EVERY leg that
      //    hasn't diverged yet (no "<date>_<leg>" key of its own). Each leg confirms
      //    against its OWN "<date>_<leg>" field key, with old_value "" — so an approval
      //    never touches the shared bare key or another leg. Matches the app
      //    (Table.tsx split sub-rows, FabricDispatchView leg resolution).
      //  - a leg that is a "+"-combined location ("Antler+Leema") is fanned one step
      //    further: each of its plants gets its own tab / row, but all of them stay
      //    pointed at the single shared "<date>_<leg>" field key (splitLegPlants_).
      //  - bare key on any other row -> first plant only (unchanged).
      var targets = [];   // { tab, fieldKey, old, legLabel }
      if (suffix) {
        legPlantsForCode_(suffix, code).forEach(function (p) {
          targets.push({ tab: p, fieldKey: key, old: String(raw), legLabel: p });
        });
      } else if (legs.length) {
        legs.forEach(function (leg) {
          // A leg that has fully diverged ("_leg_<leg>" marker set) keeps a complete
          // independent schedule on its own keys — it must NEVER pick up a bare-key event,
          // which by then is stale left-over from the pre-divergence plan.
          if (sched['_leg_' + leg] != null && String(sched['_leg_' + leg]).trim()) return;
          var own = sched[dateStr + '_' + leg];
          if (own != null && String(own).trim()) return;   // that leg has its own value for this date
          var fieldKey = dateStr + '_' + leg;
          legPlantsForCode_(leg, code).forEach(function (p) {
            targets.push({ tab: p, fieldKey: fieldKey, old: '', legLabel: p });
          });
        });
      } else {
        // A single "+"-combined location ("Antler+Leema", "MRC+Rich Color") is NOT a cross-dev
        // split — it's one shared production event both plants work at (splitLegPlants_ /
        // plus-combo-two-plants-ppses). The planner's rule: everything from PPS onward — PPS,
        // NY, NYC, MAST, REAP/FCHP, PLSD, PLSA — always goes to the SECOND plant listed, never
        // the first. Only the earlier origin/strike-off steps (FS, FR, PPSES, ...) stay on the
        // first plant. Mirror of POST_PPS_EVENT_CODES in app/lib/plantUtils.ts.
        var plants = extractPlants_(r.col11);
        var tabName = plants[0] || 'Unassigned';
        if (POST_PPS_EVENT_CODES[code] && plants.length >= 2) tabName = plants[1];
        targets.push({ tab: tabName, fieldKey: key, old: String(raw), legLabel: '' });
      }

      targets.forEach(function (t) {
        var tab = cfg.combined ? cfg.sheetName : t.tab;
        var rowKey = r.id + '|' + t.legLabel;
        var byRow = buckets[tab] = buckets[tab] || {};
        var rec = byRow[rowKey];
        if (!rec) {
          rec = byRow[rowKey] = {
            rowId: r.id, leg: t.legLabel, plant: t.tab,
            style: r.col5 || '', graphic: r.col7 || '', combo: r.col6 || '',
            ground: r.col8 || '', technique: r.col9 || '', comment: r.col22 || '',
            events: {},
          };
        }
        var puId = 'pu_' + r.id + '_' + t.fieldKey;
        rec.events[dateStr] = {
          key: t.fieldKey,
          base: code,
          old: t.old,
          sync: pendingById[puId] ? statusLabel_(pendingById[puId]) : '',
        };
      });
    });
  });

  writeReasonsTab_(ss, reasons);
  var reasonRange = "'_Reasons'!$A$2:$A$" + (reasons.length + 1);

  // Write / refresh one tab per plant.
  var wantedTabs = Object.keys(buckets).sort();
  wantedTabs.forEach(function (plant) {
    var recList = Object.keys(buckets[plant]).map(function (k) { return buckets[plant][k]; });
    writePlantTab_(ss, plant, recList, savedEdits, reasonRange, cfg, days);
  });

  // Remove stale plant tabs (keep meta + any manually added).
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (META_TABS.indexOf(name) > -1) return;
    if (wantedTabs.indexOf(name) > -1) return;
    if (isPlantTab_(sh)) ss.deleteSheet(sh); // only our generated tabs
  });

  writeMetaTab_(ss, cfg, start, end, days.length, rows.length, wantedTabs);
}

function statusLabel_(status) {
  return status === 'applied' ? 'Applied ✓'
    : status === 'rejected' ? 'Rejected — resubmit'
    : status === 'stale' ? '⚠ changed in plan — recheck'
    : 'Queued ✓';
}

// "<tab>|<rowId>[|<plant>]" -> { results:{iso:val}, reasons:{iso:val}, sent:jsonStr, editedAt }
// The trailing "|<plant>" is only added on a combined tab, where one rowId can appear on
// several rows (one per plant leg) so the plain tab+rowId key would collide.
function readExistingEdits_(ss) {
  var saved = {};
  ss.getSheets().forEach(function (sh) {
    if (!isPlantTab_(sh)) return;
    var last = sh.getLastRow();
    if (last < 2) return;
    var nctx = nctxOf_(sh);
    var combined = nctx === COMBINED_CONTEXT_COLS.length;
    var nDays = nDaysOf_(sh);
    var lastCol = sh.getLastColumn();
    var vals = sh.getRange(2, 1, last - 1, lastCol).getValues();
    var rowIdC = lastCol - NTRAIL + 1;       // 'row_id'
    var sentC = lastCol - 1;                 // 'sent'
    var editC = lastCol;                     // 'edited_at'
    vals.forEach(function (row) {
      var rid = row[rowIdC - 1];
      if (!rid) return;
      var results = {}, reasons = {};
      for (var i = 0; i < nDays; i++) {
        var dc = dayCols_(nctx, i);
        // day iso is derived from the header label match at write time; here we
        // just index by position and re-map in writePlantTab_ via the same order.
        results[i] = row[dc.result - 1];
        reasons[i] = row[dc.reason - 1];
      }
      var key = sh.getName() + '|' + rid + (combined ? '|' + row[0] : '');
      saved[key] = {
        results: results,
        reasons: reasons,
        sent: String(row[sentC - 1] || '{}'),
        editedAt: row[editC - 1] || '',
      };
    });
  });
  return saved;
}

function writePlantTab_(ss, tabName, records, savedEdits, reasonRange, cfg, days) {
  var sh = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  var oldFilter = sh.getFilter();
  if (oldFilter) oldFilter.remove();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  sh.clear();
  sh.clearConditionalFormatRules();

  var ctxCols = cfg.combined ? COMBINED_CONTEXT_COLS : CONTEXT_COLS;
  var nctx = ctxCols.length;

  records.sort(function (a, b) {
    return (cfg.combined ? String(a.plant).localeCompare(String(b.plant)) : 0) ||
      a.style.localeCompare(b.style) ||
      String(a.graphic).localeCompare(b.graphic) || String(a.combo).localeCompare(b.combo);
  });

  var totalCols = nctx + days.length * 3 + NTRAIL;

  // Header
  var header = ctxCols.slice();
  days.forEach(function (d) { header.push(d.label, d.label + ' Result', d.label + ' Reason'); });
  header = header.concat(TRAIL_COLS);

  var data = [header];
  records.forEach(function (rec) {
    var editKey = tabName + '|' + rec.rowId + (cfg.combined ? '|' + rec.plant : '');
    var prev = savedEdits[editKey] || {};
    var row = cfg.combined
      ? [rec.plant, rec.style, rec.graphic, rec.combo, rec.ground, rec.technique, rec.comment]
      : [rec.style, rec.graphic, rec.combo, rec.ground, rec.technique, rec.comment];
    var planMap = {};
    days.forEach(function (d, i) {
      var ev = rec.events[d.iso];
      if (ev) {
        planMap[d.iso] = { k: ev.key, o: ev.old, b: ev.base };
        var pr = (prev.results && prev.results[i]) || '';
        var pn = (prev.reasons && prev.reasons[i]) || '';
        // Show a hint in the event cell when a submitted result bounced back.
        var hint = ev.sync === 'Rejected — resubmit' ? ' · rejected'
          : ev.sync === '⚠ changed in plan — recheck' ? ' · recheck'
          : ev.sync === 'Queued ✓' ? ' · sent' : '';
        row.push(ev.base + hint, pr, pn);
      } else {
        row.push('', '', '');
      }
    });
    row.push('', rec.rowId, JSON.stringify(planMap), prev.sent || '{}', prev.editedAt || '');
    data.push(row);
  });

  // Plain text everywhere so "2026-08-14" / "FR-S" aren't coerced to dates.
  sh.getRange(1, 1, Math.max(data.length, sh.getMaxRows()), totalCols).setNumberFormat('@');
  sh.getRange(1, 1, data.length, totalCols).setValues(data);

  sh.setFrozenRows(1);
  // Freezing all 7 context columns on the combined tab leaves no room for the day columns —
  // freeze just Plant + Style there. Per-plant tabs keep the full context frozen.
  sh.setFrozenColumns(cfg.combined ? 2 : nctx);
  sh.getRange(1, 1, 1, totalCols).setFontWeight('bold').setBackground('#f1f3f4')
    .setVerticalAlignment('middle').setWrap(true);
  // Hide the 4 housekeeping columns (row_id, plan, sent, edited_at).
  for (var c = totalCols - 3; c <= totalCols; c++) sh.hideColumns(c);
  // Sensible widths per day group: event / result / reason.
  days.forEach(function (d, i) {
    var dc = dayCols_(nctx, i);
    sh.setColumnWidth(dc.event, 62);
    sh.setColumnWidth(dc.result, 78);
    sh.setColumnWidth(dc.reason, 150);
  });
  // Tint alternate day groups so the eye can follow a day down the sheet.
  days.forEach(function (d, i) {
    if (i % 2 === 0) return;
    var dc = dayCols_(nctx, i);
    sh.getRange(2, dc.event, Math.max(records.length, 1), 3).setBackground('#f5f7fa');
  });

  var n = records.length;
  if (n) {
    var resultRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(RESULT_OPTIONS, true).setAllowInvalid(false).build();
    var reasonRule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(ss.getRange(reasonRange), true).setAllowInvalid(true).build();

    // Whole Result / Reason column per day (batched — one call each, not per cell).
    // Cells on days with no event just get an unused dropdown; flushEdits ignores them.
    days.forEach(function (d, i) {
      var dc = dayCols_(nctx, i);
      sh.getRange(2, dc.result, n, 1).setDataValidation(resultRule);
      sh.getRange(2, dc.reason, n, 1).setDataValidation(reasonRule);
    });

    sh.getRange(1, 1, n + 1, nctx + days.length * 3 + 1).createFilter();
  }

  sh.autoResizeColumns(1, nctx);
  // Cap the free-text context columns (Ground / Technique / Comment auto-size very wide and
  // shove the day columns off the right edge) and wrap them instead.
  sh.getRange(2, 1, Math.max(records.length, 1), nctx).setWrap(true).setVerticalAlignment('top');
  for (var cc = 1; cc <= nctx; cc++) {
    if (sh.getColumnWidth(cc) > 170) sh.setColumnWidth(cc, 170);
  }
  protectTab_(sh, tabName, cfg, days);
}

function protectTab_(sh, tabName, cfg, days) {
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (p.canEdit()) p.remove();
  });
  var nctx = cfg.combined ? COMBINED_CONTEXT_COLS.length : CONTEXT_COLS.length;
  var last = Math.max(sh.getLastRow(), 2);
  var ranges = [sh.getRange(1, 1, last, nctx)];                 // context
  days.forEach(function (d, i) {                                 // each "Event" column
    ranges.push(sh.getRange(1, dayCols_(nctx, i).event, last, 1));
  });
  ranges.push(sh.getRange(1, nctx + days.length * 3 + 1, last, NTRAIL)); // status + hidden
  ranges.forEach(function (rng) {
    var prot = rng.protect().setDescription('system-managed');
    prot.removeEditors(prot.getEditors());
    if (prot.canDomainEdit && prot.canDomainEdit()) prot.setDomainEdit(false);
  });
  // Per-plant tab: grant that plant's users edit access (PLANT_EMAILS[plant]).
  // Combined tab: grant SHEET_EDITORS, else every address listed anywhere in PLANT_EMAILS.
  var mails;
  if (cfg.combined) {
    mails = (cfg.sheetEditors && cfg.sheetEditors.length)
      ? cfg.sheetEditors
      : Object.keys(cfg.emails).reduce(function (acc, k) { return acc.concat(cfg.emails[k] || []); }, []);
  } else {
    mails = cfg.emails[tabName] || [];
  }
  if (mails && mails.length) { try { sh.addEditors(mails); } catch (e) {} }
}

function writeReasonsTab_(ss, reasons) {
  var sh = ss.getSheetByName('_Reasons') || ss.insertSheet('_Reasons');
  sh.clear();
  var rows = [['Failure Reason', 'code']];
  reasons.forEach(function (r) {
    var label = r.label + (r.responsible ? ' (' + r.responsible + ')' : '');
    rows.push([label, r.code]);
  });
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.hideSheet();
}

function writeMetaTab_(ss, cfg, start, end, nDays, rowCount, tabs) {
  var sh = ss.getSheetByName('_Meta') || ss.insertSheet('_Meta');
  sh.clear();
  var scope = cfg.eventFilter.length ? ('only ' + cfg.eventFilter.join(', '))
    : cfg.eventExclude.length ? ('all except ' + cfg.eventExclude.join(', '))
    : 'all planned events';
  sh.getRange(1, 1, 10, 2).setNumberFormat('@').setValues([
    ['Database', cfg.mode.toUpperCase() + '  ' + cfg.url],
    ['Event scope', scope],
    ['Layout', cfg.combined ? 'combined (one tab: ' + cfg.sheetName + ')' : 'one tab per plant'],
    ['Last rebuild', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')],
    ['Showing events for', start + '  to  ' + end],
    ['window_start', start],
    ['window_days', String(nDays)],
    ['System rows scanned', String(rowCount)],
    ['Tabs', tabs.join(', ')],
    ['', ''],
  ]);
  sh.hideSheet();
}

// Day ISO dates for the current window, read from _Meta.
function windowDays_(ss) {
  var sh = ss.getSheetByName('_Meta');
  if (!sh) return [];
  var kv = {};
  sh.getRange(1, 1, sh.getLastRow(), 2).getValues().forEach(function (r) { kv[r[0]] = r[1]; });
  var start = String(kv['window_start'] || '');
  var n = parseInt(kv['window_days'] || '7', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  var out = [];
  for (var i = 0; i < n; i++) {
    var d = new Date(start + 'T00:00:00');
    d.setDate(d.getDate() + i);
    out.push(isoDate_(d));
  }
  return out;
}

// ------------------------------ onEdit -----------------------------------

// Cosmetic only: stamps edited_at and clears a stale ⚠/Error on rows a user just
// touched. flushEdits() no longer depends on edited_at (a plant user's *simple*
// onEdit can't write it — it's inside a protected range — so it is often blank).
// Install an *installable* onEdit (Plant Sync → Install / refresh triggers) to
// have this run as the owner and actually take effect for plant users.
function onEdit(e) {
  var sh = e.range.getSheet();
  if (!isPlantTab_(sh)) return;
  var nctx = nctxOf_(sh), nDays = nDaysOf_(sh);
  var c1 = e.range.getColumn(), c2 = c1 + e.range.getNumColumns() - 1;
  var touchesResult = false;
  for (var c = c1; c <= c2; c++) {
    var zone = c - nctx;                     // 1..nDays*3
    if (zone < 1 || zone > nDays * 3) continue;
    var within = ((zone - 1) % 3) + 1;       // 1 event, 2 result, 3 reason
    if (within === 2 || within === 3) { touchesResult = true; break; }
  }
  if (!touchesResult) return;

  var r1 = Math.max(2, e.range.getRow());
  var r2 = e.range.getRow() + e.range.getNumRows() - 1;
  var editC = trailCol_(sh, 'edited_at'), sc = trailCol_(sh, 'Sync Status');
  for (var r = r1; r <= r2; r++) {
    try { sh.getRange(r, editC).setValue(new Date()); } catch (err) {}
    try {
      var status = String(sh.getRange(r, sc).getValue() || '');
      if (status.indexOf('⚠') === 0 || status.indexOf('Error') === 0) sh.getRange(r, sc).clearContent();
    } catch (err) {}
  }
}

// ------------------------------ flushEdits -------------------------------

function flushEdits() {
  var cfg = cfg_();
  var ss = SpreadsheetApp.getActive();
  var reasonCode = reasonLabelToCode_(ss);
  var isoDays = windowDays_(ss);
  var queued = 0, needReason = 0, errors = 0;

  ss.getSheets().forEach(function (sh) {
    if (!isPlantTab_(sh)) return;
    var nctx = nctxOf_(sh);
    var combined = nctx === COMBINED_CONTEXT_COLS.length;
    var ctxOffset = combined ? 1 : 0;             // extra leading "Plant" column
    var tabPlant = sh.getName();                  // per-plant tab: the plant name
    var last = sh.getLastRow();
    if (last < 2) return;
    var lastCol = sh.getLastColumn();
    var nDays = nDaysOf_(sh);
    var vals = sh.getRange(2, 1, last - 1, lastCol).getValues();
    var rowIdC = trailCol_(sh, 'row_id'), planC = trailCol_(sh, 'plan');
    var sentC = trailCol_(sh, 'sent'), editC = trailCol_(sh, 'edited_at'), syncC = trailCol_(sh, 'Sync Status');

    for (var i = 0; i < vals.length; i++) {
      var row = vals[i];
      var sheetRow = i + 2;

      var plant = combined ? String(row[0] || tabPlant) : tabPlant;
      var plan = {}; try { plan = JSON.parse(row[planC - 1] || '{}'); } catch (e) {}
      if (!plan || !Object.keys(plan).length) continue;      // no planned events on this row
      var sent = {}; try { sent = JSON.parse(row[sentC - 1] || '{}'); } catch (e) {}

      // Do NOT gate on the hidden edited_at column. A plant user's simple onEdit
      // can't write it (protected range), so it is often blank even when a result
      // was entered. Instead compare each day's Result/Reason to what we've already
      // sent and queue anything new.
      var done = [], pend = [], errored = false;
      for (var di = 0; di < nDays; di++) {
        var iso = isoDays[di];
        var p = iso && plan[iso];
        if (!p) continue;

        var dc = dayCols_(nctx, di);
        var res = String(row[dc.result - 1] || '').toLowerCase();
        if (!res || res === 'planned') continue;

        var newValue, rcode = null;
        if (res === 'pass') {
          newValue = p.b + '|P';
        } else {
          var label = String(row[dc.reason - 1] || '');
          rcode = reasonCode[label] || (label.match(/^(\d{1,2}[a-z]?)\b/) || [])[1] || null;
          if (!rcode) { pend.push(dayShort_(iso) + ': reason'); needReason++; continue; }
          newValue = p.b + '|F|' + rcode;
        }
        if (sent[iso] === newValue) continue;                 // already queued in an earlier flush

        try {
          rest_(cfg, 'pending_updates', {
            method: 'post',
            prefer: 'resolution=merge-duplicates,return=minimal',
            body: {
              id: 'pu_' + row[rowIdC - 1] + '_' + p.k,
              source: 'google-sheet', plant: plant, row_id: row[rowIdC - 1],
              style: row[ctxOffset + 0], graphic: row[ctxOffset + 1], combo: row[ctxOffset + 2],
              field_key: p.k, base_code: p.b, old_value: String(p.o || ''),
              new_value: newValue, result: res, reason_code: rcode, note: null,
              status: 'pending', submitted_by: sessionEmail_(),
              created_at: new Date().toISOString(), reviewed_at: null, reviewed_by: null,
            },
          });
          sent[iso] = newValue;
          done.push(dayShort_(iso));
          queued++;
        } catch (err) {
          pend.push(dayShort_(iso) + ': error');
          errored = true; errors++;
        }
      }

      if (!done.length && !pend.length) continue;            // nothing new on this row
      sh.getRange(sheetRow, sentC).setValue(JSON.stringify(sent));
      var summary = [];
      if (done.length) summary.push(done.join(', ') + ' queued ✓');
      if (pend.length) summary.push('⚠ ' + pend.join(', '));
      sh.getRange(sheetRow, syncC).setValue(summary.join('  ·  '));
      if (!pend.length && !errored) { try { sh.getRange(sheetRow, editC).clearContent(); } catch (e) {} }
    }
  });

  var msg = queued + ' queued to system';
  if (needReason) msg += ', ' + needReason + ' waiting for a reason';
  if (errors) msg += ', ' + errors + ' errored';
  try { SpreadsheetApp.getActive().toast(msg, 'Plant Sync', 6); } catch (e) {}
}

function dayShort_(iso) {
  var d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? iso : Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEE');
}

function reasonLabelToCode_(ss) {
  var map = {};
  var sh = ss.getSheetByName('_Reasons');
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    map[String(r[0])] = String(r[1]);
  });
  return map;
}

function sessionEmail_() {
  try { return Session.getActiveUser().getEmail() || null; } catch (e) { return null; }
}

// ------------------------------ triggers ---------------------------------

function installTriggers() {
  var ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'rebuildSheets' || fn === 'flushEdits' || fn === 'onEdit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rebuildSheets').timeBased().atHour(6).everyDays(1).create();
  ScriptApp.newTrigger('flushEdits').timeBased().everyMinutes(10).create();
  // Installable onEdit runs as the sheet owner, so it can stamp the protected
  // edited_at / Sync Status columns that a plant user's simple onEdit cannot.
  ScriptApp.newTrigger('onEdit').forSpreadsheet(ss).onEdit().create();
  try {
    ss.toast('Triggers installed: rebuild daily 6am, flush every 10 min, on-edit stamp.', 'Plant Sync', 6);
  } catch (e) {}
}
