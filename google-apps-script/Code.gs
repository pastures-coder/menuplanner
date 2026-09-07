/**
 * Meal Planner v6.6 — bound Google Apps Script backend.
 * Bind this script to the Google Sheet created from meal-spinner-live-data.xlsx.
 */
const APP_SCHEMA_VERSION = 8;
const SHEETS = {
  meals: 'Meals',
  plan: 'Current Plan',
  history: 'Meal History',
  runs: 'Shopping Runs',
  settings: 'Settings',
};

function doGet(e) {
  const p = (e && e.parameter) || {};

  // Reliable browser bridge for GitHub Pages. HTML Service can be framed when
  // XFrameOptionsMode.ALLOWALL is explicitly enabled; the embedded page then
  // uses google.script.run to call the server without cross-origin fetch/JSONP.
  if (String(p.bridge || '') === '1') return bridgeHtml_();

  // Keep the JSON/JSONP diagnostic endpoint for manual testing.
  const callback = String(p.callback || '');
  let payload;
  try {
    if (p.action !== 'loadState') throw new Error('Unknown action');
    assertHouseholdKey_(p.key);
    payload = {ok: true, state: loadState_(), revision: currentRevision_()};
  } catch (err) {
    payload = {ok: false, error: String(err && err.message || err)};
  }
  const json = JSON.stringify(payload);
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback)) {
    return ContentService.createTextOutput(`${callback}(${json});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let payload;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action !== 'saveState') throw new Error('Unknown action');
    payload = saveStateRequest_(body.key, body.revision, body.state || {});
  } catch (err) {
    payload = {ok: false, error: String(err && err.message || err)};
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

// Public functions called only from the HTML-service bridge.
function bridgeLoad(key) {
  try {
    assertHouseholdKey_(key);
    return {ok: true, state: loadState_(), revision: currentRevision_()};
  } catch (err) {
    return {ok: false, error: String(err && err.message || err)};
  }
}

function bridgeSave(key, revision, state) {
  try {
    return saveStateRequest_(key, revision, state || {});
  } catch (err) {
    return {ok: false, error: String(err && err.message || err)};
  }
}

function saveStateRequest_(key, revision, state) {
  assertHouseholdKey_(key);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const current = currentRevision_();
    if (revision === undefined || revision === null || Number(revision) !== current) {
      throw new Error(`STALE_REVISION:${current}`);
    }
    saveState_(state || {});
    const next = current + 1;
    setSetting_('state_revision', String(next), 'Monotonic shared-state revision used to prevent stale-device overwrites');
    return {ok: true, savedAt: new Date().toISOString(), revision: next};
  } finally {
    lock.releaseLock();
  }
}

function bridgeHtml_() {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><script>
(function(){
  const SOURCE='mealPlannerBridge';
  function reply(id,payload){
    try{ parent.postMessage({source:SOURCE,id:id,payload:payload}, '*'); }catch(e){}
  }
  window.addEventListener('message', function(ev){
    if(ev.source !== parent) return;
    const m=ev.data || {};
    if(m.source !== 'mealPlannerClient' || !m.id) return;
    if(m.action === 'ping') { reply(m.id,{ok:true,pong:true}); return; }
    if(m.action === 'load') {
      google.script.run
        .withSuccessHandler(function(r){ reply(m.id,r); })
        .withFailureHandler(function(err){ reply(m.id,{ok:false,error:(err&&err.message)||String(err)}); })
        .bridgeLoad(m.key || '');
      return;
    }
    if(m.action === 'save') {
      google.script.run
        .withSuccessHandler(function(r){ reply(m.id,r); })
        .withFailureHandler(function(err){ reply(m.id,{ok:false,error:(err&&err.message)||String(err)}); })
        .bridgeSave(m.key || '', m.revision, m.state || {});
    }
  });
  try{ parent.postMessage({source:SOURCE,ready:true}, '*'); }catch(e){}
})();
</script></body></html>`;
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sh_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error(`Missing sheet: ${name}`);
  return s;
}

function settingsMap_() {
  const s = sh_(SHEETS.settings);
  const n = Math.max(2, s.getLastRow());
  const rows = s.getRange(2, 1, n - 1, 2).getValues();
  const out = {};
  rows.forEach(r => { if (r[0]) out[String(r[0])] = r[1]; });
  return out;
}

function assertHouseholdKey_(provided) {
  const expected = String(settingsMap_().household_key || '').trim();
  if (!expected) throw new Error('Set household_key in the Settings sheet first');
  if (String(provided || '') !== expected) throw new Error('Invalid household key');
}

function currentRevision_() {
  const raw = settingsMap_().state_revision;
  const n = Number(raw || 0);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function settingRow_(key) {
  const s = sh_(SHEETS.settings);
  const n = Math.max(2, s.getLastRow());
  const vals = s.getRange(2, 1, n - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) if (String(vals[i][0]) === key) return i + 2;
  return null;
}

function setSetting_(key, value, description) {
  const s = sh_(SHEETS.settings);
  let row = settingRow_(key);
  if (!row) {
    row = s.getLastRow() + 1;
    s.getRange(row, 1, 1, 3).setValues([[key, value, description || '']]);
  } else {
    s.getRange(row, 2).setValue(value);
    if (description) s.getRange(row, 3).setValue(description);
  }
}

function loadState_() {
  const cfg = settingsMap_();
  let settings = {};
  let shoppingDraft = {items: [], sourceSlots: [], generatedAt: null, cleared: false};
  let planExtras = {};
  try { settings = cfg.settings_json ? JSON.parse(String(cfg.settings_json)) : {}; } catch (_) {}
  try { shoppingDraft = cfg.shopping_draft_json ? JSON.parse(String(cfg.shopping_draft_json)) : shoppingDraft; } catch (_) {}
  try { planExtras = cfg.plan_extras_json ? JSON.parse(String(cfg.plan_extras_json)) : {}; } catch (_) {}
  const plan = readPlan_();
  Object.keys(planExtras || {}).forEach(key => {
    if (plan[key]) Object.assign(plan[key], planExtras[key] || {});
  });
  return {
    settings,
    meals: readMeals_(),
    plan,
    shoppingDraft,
    shoppingRuns: readShoppingRuns_(),
  };
}

function readMeals_() {
  const s = sh_(SHEETS.meals);
  const n = s.getLastRow();
  if (n < 2) return [];
  const rows = s.getRange(2, 1, n - 1, 13).getValues();
  const now = new Date();
  return rows.filter(r => r[0]).map((r, i) => {
    const types = [];
    if (yes_(r[1])) types.push('Lunch');
    if (yes_(r[2])) types.push('Dinner');
    if (yes_(r[3])) types.push('Guests');
    let last = null;
    if (r[9] instanceof Date && !isNaN(r[9])) last = Math.max(0, Math.round((now - r[9]) / 86400000));
    const id = String(r[12] || slug_(r[0]) + '-' + (i + 1));
    return {
      id,
      name: String(r[0]),
      types,
      speed: String(r[4] || 'Medium'),
      batch: yes_(r[5]),
      cook: String(r[6] || ''),
      proteinLevel: String(r[7] || 'Medium'),
      repeatWeeks: Number(r[8] || 4),
      last,
      ingredients: String(r[10] || '').split(',').map(x => x.trim()).filter(Boolean),
      notes: String(r[11] || ''),
    };
  });
}

function readPlan_() {
  const s = sh_(SHEETS.plan);
  const n = s.getLastRow();
  const out = {};
  if (n < 2) return out;
  const rows = s.getRange(2, 1, n - 1, 13).getValues();
  rows.filter(r => r[0] && r[1]).forEach(r => {
    const dateISO = dateISO_(r[0]);
    const key = `${dateISO}|${String(r[1])}`;
    out[key] = {
      mealId: r[2] ? String(r[2]) : null,
      locked: bool_(r[4]),
      blank: bool_(r[5]),
      linkedFrom: r[6] ? String(r[6]) : null,
      cookOverride: r[7] ? String(r[7]) : '',
      note: r[8] ? String(r[8]) : '',
      shoppingExportedAt: r[10] ? isoTimestamp_(r[10]) : null,
      shoppingRunId: r[11] ? String(r[11]) : null,
    };
  });
  return out;
}

function readShoppingRuns_() {
  const s = sh_(SHEETS.runs);
  const n = s.getLastRow();
  if (n < 2) return [];
  return s.getRange(2, 1, n - 1, 5).getValues().filter(r => r[0]).map(r => ({
    id: String(r[0]),
    markedAt: r[1] ? isoTimestamp_(r[1]) : null,
    sourceSlots: String(r[2] || '').split('\n').filter(Boolean),
    items: String(r[3] || '').split('\n').filter(Boolean),
  }));
}

function saveState_(state) {
  state = state || {};
  writeMeals_(state.meals || []);
  writePlan_(state.plan || {}, state.meals || []);
  writeHistory_(state.plan || {}, state.meals || []);
  writeShoppingRuns_(state.shoppingRuns || []);
  setSetting_('app_schema_version', String(APP_SCHEMA_VERSION), 'Meal Planner data schema version');
  setSetting_('settings_json', JSON.stringify(state.settings || {}), 'The app writes menu-generation settings here');
  const planExtras = {};
  Object.keys(state.plan || {}).forEach(key => {
    const slot = state.plan[key] || {};
    if (slot.manualBlank) planExtras[key] = {manualBlank: true};
  });
  setSetting_('plan_extras_json', JSON.stringify(planExtras), 'Extra per-tile state not represented as Current Plan columns');
  setSetting_('shopping_draft_json', JSON.stringify(state.shoppingDraft || {}), 'Temporary current shopping draft');
  setSetting_('last_sync_utc', new Date().toISOString(), 'Last successful shared-state write');
  SpreadsheetApp.flush();
}

function writeMeals_(meals) {
  const s = sh_(SHEETS.meals);
  clearBody_(s, 13);
  if (!meals.length) return;
  const rows = meals.map(m => [
    m.name || '',
    hasType_(m, 'Lunch') ? 'Yes' : 'No',
    hasType_(m, 'Dinner') ? 'Yes' : 'No',
    hasType_(m, 'Guests') ? 'Yes' : 'No',
    m.speed || 'Medium',
    m.batch ? 'Yes' : 'No',
    m.cook || '',
    m.proteinLevel || 'Medium',
    Number(m.repeatWeeks || 4),
    '',
    (m.ingredients || []).join(', '),
    m.notes || '',
    m.id || '',
  ]);
  s.getRange(2, 1, rows.length, 13).setValues(rows);
}

function writePlan_(plan, meals) {
  const s = sh_(SHEETS.plan);
  clearBody_(s, 13);
  const names = mealMap_(meals);
  const now = new Date();
  const rows = Object.keys(plan).sort().map(key => {
    const slot = plan[key] || {};
    const bits = key.split('|');
    return [
      parseISODate_(bits[0]), bits[1] || '', slot.mealId || '', names[slot.mealId]?.name || '',
      !!slot.locked, !!slot.blank, slot.linkedFrom || '', slot.cookOverride || '', slot.note || '',
      slot.shoppingExportedAt ? 'Shopped' : 'Not shopped', slot.shoppingExportedAt ? new Date(slot.shoppingExportedAt) : '',
      slot.shoppingRunId || '', now,
    ];
  });
  if (rows.length) s.getRange(2, 1, rows.length, 13).setValues(rows);
}

function writeHistory_(plan, meals) {
  const s = sh_(SHEETS.history);
  clearBody_(s, 9);
  const map = mealMap_(meals), today = dateISO_(new Date()), now = new Date();
  const rows = Object.keys(plan).sort().filter(k => k.split('|')[0] < today && plan[k] && plan[k].mealId).map(k => {
    const slot = plan[k], bits = k.split('|'), meal = map[slot.mealId] || {};
    return [parseISODate_(bits[0]), bits[1], slot.mealId, meal.name || '', slot.cookOverride || meal.cook || '', meal.proteinLevel || '', slot.linkedFrom || '', slot.shoppingRunId || '', now];
  });
  if (rows.length) s.getRange(2, 1, rows.length, 9).setValues(rows);
}

function writeShoppingRuns_(runs) {
  const s = sh_(SHEETS.runs);
  clearBody_(s, 5);
  if (!runs.length) return;
  const rows = runs.map(r => [r.id || '', r.markedAt ? new Date(r.markedAt) : '', (r.sourceSlots || []).join('\n'), (r.items || []).join('\n'), (r.items || []).length]);
  s.getRange(2, 1, rows.length, 5).setValues(rows);
}

function clearBody_(sheet, width) {
  const max = Math.max(2, sheet.getMaxRows());
  if (max > 1) sheet.getRange(2, 1, max - 1, width).clearContent();
}
function mealMap_(meals) { const x = {}; (meals || []).forEach(m => { if (m && m.id) x[m.id] = m; }); return x; }
function hasType_(m, type) { return Array.isArray(m.types) && m.types.indexOf(type) >= 0; }
function yes_(v) { return String(v || '').trim().toLowerCase() === 'yes' || v === true; }
function bool_(v) { return v === true || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'yes'; }
function slug_(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function dateISO_(v) { const d = v instanceof Date ? v : new Date(v); return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function parseISODate_(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12, 0, 0); }
function isoTimestamp_(v) { const d = v instanceof Date ? v : new Date(v); return d.toISOString(); }
