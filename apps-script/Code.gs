// Image Model Tester — team backend (Google Apps Script, V8 runtime).
// One script owned by the team lead: appends test records to a Google Sheet,
// stores reference/output images in a Drive folder, proxies Seedream with the
// owner's Ark keys, and exposes the judge API used by the Claude Code /judge skill.
// Testers never sign in to Google; the GitHub Pages app sends a shared token.
//
// Script Properties (File → Project settings → Script properties):
//   SHARED_TOKEN   created by setup(); paste into public/google-config.js
//   SHEET_ID       created by setup()
//   FOLDER_ID      created by setup()
//   ARK_KEY_PRO    Volcengine Ark key with access to doubao-seedream-5-0-pro-260628
//   ARK_KEY_FLASH  Volcengine Ark key with access to doubao-seedream-5-0-flash-260915
//   DAILY_LIMIT    optional; team-wide generations per day (default 1000)
//   GEN_USAGE      managed by the script: today's generation count

const PROPS = PropertiesService.getScriptProperties();
const COLUMNS = ['paths','input','prompt','outputs','model used','judge','review','开源/闭源','tester','status','test date','record_id'];
const COL = {paths:1,input:2,prompt:3,outputs:4,model:5,judge:6,review:7,source:8,tester:9,status:10,date:11,record_id:12};
const MODELS = {
  'doubao-seedream-5-0-pro-260628': {slot:'pro', prop:'ARK_KEY_PRO'},
  'doubao-seedream-5-0-flash-260915': {slot:'flash', prop:'ARK_KEY_FLASH'},
};
const ARK_URL = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const SEEDREAM_SIZE = '800x1424'; // Official 1K / nominal 9:16 mapping, same as lib/volcengine.ts.
const PATH_PATTERN = /^tests\/[a-zA-Z0-9_\/-]+\.(png|jpg|webp|txt|json)$/;
const IMAGE_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=\r\n]+$/;
// The token is public in the Pages source, so this caps what anyone holding it can spend on Ark.
const DAILY_LIMIT = 1000;

// Run once from the Apps Script editor. Safe to run again: it only creates what is missing.
function setup() {
  let folderId = PROPS.getProperty('FOLDER_ID');
  if (!folderId) { folderId = DriveApp.createFolder('Image Model Tester').getId(); PROPS.setProperty('FOLDER_ID', folderId); }
  let sheetId = PROPS.getProperty('SHEET_ID');
  if (!sheetId) {
    const ss = SpreadsheetApp.create('Image Model Tester — test records');
    sheetId = ss.getId(); PROPS.setProperty('SHEET_ID', sheetId);
    DriveApp.getFileById(sheetId).moveTo(DriveApp.getFolderById(folderId));
    const sheet = ss.getSheets()[0]; sheet.setName('records');
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('A:L').setNumberFormat('@'); // Plain text: prompts are never evaluated as formulas.
    sheet.hideColumns(COL.record_id);
    const protection = sheet.getRange('F:F').protect().setDescription('judge — written only by the Claude Code judge');
    protection.removeEditors(protection.getEditors()); // The owner keeps edit rights.
  }
  if (!PROPS.getProperty('SHARED_TOKEN')) PROPS.setProperty('SHARED_TOKEN', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  Logger.log('Sheet: https://docs.google.com/spreadsheets/d/' + sheetId);
  Logger.log('Folder: https://drive.google.com/drive/folders/' + folderId);
  Logger.log('SHARED_TOKEN: ' + PROPS.getProperty('SHARED_TOKEN'));
  Logger.log('Now set ARK_KEY_PRO and ARK_KEY_FLASH in Script properties, then Deploy → New deployment → Web app.');
}

function doGet() {
  return ContentService.createTextOutput('Image Model Tester team backend is running. The tester talks to this URL with POST.').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return reply({error:'Invalid request.'}, 400); }
  const token = PROPS.getProperty('SHARED_TOKEN');
  if (!token || !body || body.token !== token) return reply({error:'Invalid team token. Rebuild the Pages site with the current token.'}, 401);
  try {
    switch (body.action) {
      case 'status': return reply(status());
      case 'generate': return reply(generate(body));
      case 'upload': return reply(upload(body));
      case 'records': return reply(upsertRecords(body.rows || []));
      case 'csv': return reply({csv: csv()});
      case 'list': return reply(listUnjudged(body));
      case 'file': return reply(getFile(body.path));
      case 'judge': return reply(writeJudgment(body));
      default: return reply({error:'Unknown action.'}, 400);
    }
  } catch (err) { return reply({error: String((err && err.message) || err)}, err.status || 500); }
}

// Apps Script always answers HTTP 200, so the real status travels inside the JSON.
function reply(data, status) {
  const out = Object.assign({status: status || 200}, data);
  out.ok = out.status < 400;
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function fail(message, status) { const err = new Error(message); err.status = status || 400; throw err; }

function status() {
  const models = {};
  Object.keys(MODELS).forEach(id => { const key = PROPS.getProperty(MODELS[id].prop) || ''; models[MODELS[id].slot] = {connected: key.length > 0, suffix: key.slice(-4)}; });
  return {models, legacyKeyPresent:false, notice:'Keys are set once by the team owner in the Apps Script properties. Testers do not enter keys.', sheetUrl: sheetUrl(), folderUrl: folderUrl(), daily: dailyUsage()};
}

// Team-wide daily generation counter, reset at midnight in the script's time zone.
function dailyUsage() {
  const date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  let saved; try { saved = JSON.parse(PROPS.getProperty('GEN_USAGE') || '{}'); } catch (err) { saved = {}; }
  return {date, used: saved.date === date ? Number(saved.count) || 0 : 0, limit: Number(PROPS.getProperty('DAILY_LIMIT')) || DAILY_LIMIT, timeZone: Session.getScriptTimeZone()};
}
// Counted before the Ark call, so failed attempts count too and a flood of bad requests is still capped.
function reserveGeneration() {
  return withLock(() => {
    const usage = dailyUsage();
    if (usage.used >= usage.limit) fail('The team daily limit of ' + usage.limit + ' generations is reached. It resets at midnight (' + usage.timeZone + ').', 429);
    PROPS.setProperty('GEN_USAGE', JSON.stringify({date: usage.date, count: usage.used + 1}));
  });
}
function sheetUrl() { return 'https://docs.google.com/spreadsheets/d/' + PROPS.getProperty('SHEET_ID'); }
function folderUrl() { return 'https://drive.google.com/drive/folders/' + PROPS.getProperty('FOLDER_ID'); }

// Same contract as POST /api/generate on the Sites backend: {model,prompt,images,n:1} → {images:[dataURL],settings}.
function generate(input) {
  const model = MODELS[input.model]; if (!model) fail('Unsupported Seedream model.');
  if (input.n !== 1) fail('Send one image per request for these models.');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 12000) fail('Enter a prompt of up to 12,000 characters.');
  const images = input.images || [];
  if (!Array.isArray(images) || images.length > 10) fail('Seedream accepts up to 10 reference images.');
  images.forEach(img => {
    if (typeof img !== 'string' || !IMAGE_PATTERN.test(img)) fail('Use PNG, JPEG, or WebP reference images.');
    if (img.length * 0.75 > 10 * 1024 * 1024) fail('Each Seedream reference must be under 10 MB.');
  });
  const key = PROPS.getProperty(model.prop);
  if (!key) fail('The team owner has not set the Seedream ' + (model.slot === 'pro' ? 'Pro' : 'Flash') + ' key (' + model.prop + ') in the Apps Script properties.', 503);
  const payload = {model: input.model, prompt: input.prompt, size: SEEDREAM_SIZE, response_format:'b64_json', output_format:'png', watermark:true};
  if (images.length) payload.image = images;
  reserveGeneration();
  const response = UrlFetchApp.fetch(ARK_URL, {method:'post', contentType:'application/json', headers:{Authorization:'Bearer ' + key}, payload: JSON.stringify(payload), muteHttpExceptions:true});
  const code = response.getResponseCode();
  if (code !== 200) {
    const messages = {401:'API key rejected. Ask the team owner to replace it.', 403:'The team Ark account cannot access this model. Enable it in the Volcengine console.', 429:'Volcengine rate limit reached. Wait before retrying.'};
    fail(messages[code] || ('Volcengine returned HTTP ' + code + '. Check the team account balance and model access.'), 502);
  }
  const result = JSON.parse(response.getContentText());
  const outputs = (result.data || []).filter(x => typeof x.b64_json === 'string' && /^[A-Za-z0-9+\/=\r\n]+$/.test(x.b64_json));
  if (outputs.length !== 1) fail('Volcengine did not return one valid image.', 502);
  return {images: ['data:image/png;base64,' + outputs[0].b64_json], settings: {resolution:'1K', aspect_ratio:'9:16', requested_size: SEEDREAM_SIZE, actual_size: outputs[0].size || null, model: input.model, provider:'volcengine', requests:1}};
}

// Files use the same relative paths as the ZIP export (tests/<date>_<run>/references/…, models/…/outputs/…).
function upload(body) {
  const path = body.path;
  if (typeof path !== 'string' || !PATH_PATTERN.test(path)) fail('Invalid file path.');
  const parts = path.split('/'), name = parts.pop();
  const folder = ensureFolder(parts);
  const existing = folder.getFilesByName(name);
  const image = /\.(png|jpg|webp)$/.test(name);
  if (existing.hasNext()) {
    const file = existing.next();
    if (image) return {id: file.getId(), url: file.getUrl(), existed:true}; // Image bytes are immutable per run.
    file.setContent(String(body.text || '')); return {id: file.getId(), url: file.getUrl(), replaced:true};
  }
  let blob;
  if (image) {
    if (typeof body.data !== 'string' || !IMAGE_PATTERN.test(body.data)) fail('Invalid image data.');
    const mime = body.data.slice(5, body.data.indexOf(';'));
    blob = Utilities.newBlob(Utilities.base64Decode(body.data.split(',')[1]), mime, name);
  } else {
    blob = Utilities.newBlob(String(body.text || ''), name.endsWith('.json') ? 'application/json' : 'text/plain', name);
  }
  const file = folder.createFile(blob);
  return {id: file.getId(), url: file.getUrl()};
}
function ensureFolder(parts) {
  let folder = DriveApp.getFolderById(PROPS.getProperty('FOLDER_ID'));
  parts.forEach(part => { const found = folder.getFoldersByName(part); folder = found.hasNext() ? found.next() : folder.createFolder(part); });
  return folder;
}
function resolveFile(path) {
  if (typeof path !== 'string' || !PATH_PATTERN.test(path)) fail('Invalid file path.');
  const parts = path.split('/'), name = parts.pop();
  let folder = DriveApp.getFolderById(PROPS.getProperty('FOLDER_ID'));
  for (const part of parts) { const found = folder.getFoldersByName(part); if (!found.hasNext()) return null; folder = found.next(); }
  const files = folder.getFilesByName(name);
  return files.hasNext() ? files.next() : null;
}
function getFile(path) {
  const file = resolveFile(path); if (!file) fail('File not found.', 404);
  const blob = file.getBlob();
  return {name: file.getName(), mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes())};
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) fail('The team backend is busy. Try again.', 503);
  try { return fn(); } finally { lock.releaseLock(); }
}
function recordsSheet() {
  const sheet = SpreadsheetApp.openById(PROPS.getProperty('SHEET_ID')).getSheetByName('records');
  if (!sheet) fail('The records sheet is missing. Run setup() again.', 503);
  return sheet;
}
function rowIndex(sheet) {
  const last = sheet.getLastRow(), map = {};
  if (last < 2) return map;
  sheet.getRange(2, COL.record_id, last - 1, 1).getValues().forEach((row, i) => { if (row[0]) map[String(row[0])] = i + 2; });
  return map;
}
// Google Sheets treats a leading "=" as a formula. The CSV export does the same apostrophe prefix.
const text = value => { const s = String(value == null ? '' : value); return /^\s*=/.test(s) ? "'" + s : s; };

// The app owns A–E, J, K and may set G, H, I when it has a value. F (judge) is never touched here.
function upsertRecords(rows) {
  if (!Array.isArray(rows) || rows.length > 200) fail('Send up to 200 records per request.');
  return withLock(() => {
    const sheet = recordsSheet(), index = rowIndex(sheet);
    let inserted = 0, updated = 0;
    rows.forEach(row => {
      const id = String(row.record_id || '');
      if (!/^[a-f0-9]{8,64}:[0-9]{1,3}$/.test(id)) fail('Invalid record id.');
      const core = [row.paths, row.input, row.prompt, row.outputs, row['model used']].map(text);
      const tail = [row.status, row['test date']].map(text);
      const r = index[id];
      if (r) {
        sheet.getRange(r, COL.paths, 1, 5).setValues([core]);
        sheet.getRange(r, COL.status, 1, 2).setValues([tail]);
        if (row.review && row.review !== 'Unreviewed') sheet.getRange(r, COL.review).setValue(text(row.review));
        if (row['开源/闭源']) sheet.getRange(r, COL.source).setValue(text(row['开源/闭源']));
        if (row.tester) sheet.getRange(r, COL.tester).setValue(text(row.tester));
        updated++;
      } else {
        const values = core.concat(['', text(row.review === 'Unreviewed' ? '' : row.review), text(row['开源/闭源']), text(row.tester)], tail, [id]);
        sheet.appendRow(values);
        index[id] = sheet.getLastRow();
        inserted++;
      }
    });
    return {inserted, updated};
  });
}

function allRecords() {
  const sheet = recordsSheet(), last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, COLUMNS.length).getValues().map((values, i) => {
    const row = {row: i + 2}; COLUMNS.forEach((name, j) => row[name] = values[j] == null ? '' : String(values[j])); return row;
  }).filter(row => row.record_id);
}
// Eleven columns, identical quoting to records-core.js recordsCSV.
function csv() {
  const cell = value => { let s = String(value == null ? '' : value); if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const columns = COLUMNS.slice(0, 11);
  const lines = [columns].concat(allRecords().map(row => columns.map(name => row[name])));
  return '﻿' + lines.map(line => line.map(cell).join(',')).join('\r\n') + '\r\n';
}

// Judge API — used by scripts/judge.mjs.
function listUnjudged(body) {
  const limit = Math.min(Number(body.limit) || 20, 100);
  const parse = value => { try { const v = JSON.parse(value); return Array.isArray(v) ? v : []; } catch (err) { return []; } };
  const pending = allRecords().filter(row => !row.judge && row.status === 'done' && parse(row.outputs).length);
  return {total: pending.length, records: pending.slice(0, limit).map(row => ({
    record_id: row.record_id, path: row.paths, prompt: row.prompt, input: parse(row.input), outputs: parse(row.outputs),
    model: row['model used'], review: row.review, source: row['开源/闭源'], tester: row.tester, date: row['test date'],
  }))};
}
function writeJudgment(body) {
  const id = String(body.record_id || ''), verdict = String(body.verdict || '');
  if (!['pass','fail','needs-review'].includes(verdict)) fail('Verdict must be pass, fail, or needs-review.');
  const score = body.score === '' || body.score == null ? '' : Number(body.score);
  if (score !== '' && !(score >= 0 && score <= 5)) fail('Score must be 0–5.');
  return withLock(() => {
    const sheet = recordsSheet(), r = rowIndex(sheet)[id];
    if (!r) fail('Record not found.', 404);
    const cell = sheet.getRange(r, COL.judge);
    if (cell.getValue() && !body.force) fail('This record is already judged. Pass force to replace it.', 409);
    const value = [verdict, score === '' ? '' : 'Score: ' + score + '/5', 'Judge: ' + (body.model || 'Claude Code') + ' · rubric ' + (body.rubric || 'v1') + ' · ' + new Date().toISOString(), String(body.notes || '')].filter(Boolean).join('\n');
    cell.setValue(text(value));
    return {record_id: id, judge: value};
  });
}
