#!/usr/bin/env node
/**
 * Forecast coverage check: does every one of the 40 price zones that CAN honestly have a forecast show one on elpriser.org?
 *
 *   npm run forecast-coverage                       # the live site, all 40 zones
 *   node scripts/check-forecast-coverage.mjs --zone de,at --json
 *   node scripts/check-forecast-coverage.mjs --base http://localhost:8788 --today 2026-11-08
 *
 * No secrets: it reads the public API only (`/api/nordic?zone=<zone>`) and two checked-in gate files. Exit code 1 when a zone FAILS, 0 otherwise
 * (a WARN and a NO MODEL are printed, never hidden; `--strict` makes a WARN fail too).
 *
 * What counts, per kind of zone (the zone lists are read from functions/api/[[catchall]].js, so a new zone cannot slip past):
 *  - eu (25 zones, scripts/forecast_model/eu): the horizons the GATE publishes for the zone (publish_gate.json, `fuel` or `nofuel` as the run says) are
 *    expected; the top one must be on the API, every horizon on the API must be one the gate allows AND have accuracy numbers ("a horizon without
 *    numbers is not published"), and the run must be fresh. A horizon the gate rejects is "not published by design": it is listed, never a failure.
 *  - gb (own job, gb_gate.json, horizons 1-7): the same rules.
 *  - nordic (13 zones, one pooled model, no per-horizon gate): forecast days that follow the last settled day without a hole, at least 6 of them, fresh.
 *  - xk: no model exists yet: NO MODEL (a forecast on the API makes it an EU zone, judged by its gate entry: it went live 2026-11-08 with D+2..D+6).
 * On top of that every zone gets an explicit verdict for D+2, D+5 and D+7 (the date today + n): shown / blocked-by-gate (documented, not a failure) / due (today's run is not in yet) /
 * hidden-bug / no-model. The exit code is 1 when a zone FAILs OR lacks one of the three without a documented gate reason (a hidden-bug or a no-model).
 * Freshness: the run's `forecastGenerated` (Nordic: `generated`) is at most one day old = PASS, two = WARN (a run was missed), three or more = FAIL
 * (the Worker stops showing a run after 3 days). The model's `trainedThrough` is checked too (a frozen training set looks healthy until you read the date).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = d => Date.parse(`${d}T00:00:00Z`);
const ageDays = (later, earlier) => Math.round((dayMs(later) - dayMs(earlier)) / DAY);
const rangeText = hs => {              // [2,3,4,6] -> "h2-4,6"
  const out = [];
  for (let i = 0; i < hs.length; i++) {
    let j = i;
    while (j + 1 < hs.length && hs[j + 1] === hs[j] + 1) j++;
    out.push(j > i ? `${hs[i]}-${hs[j]}` : `${hs[i]}`);
    i = j;
  }
  return hs.length ? `h${out.join(',')}` : '-';
};

/** The zone lists of the Worker: { nordic: [...], eu: [...] } (eu = every zone served from eu-prices-*, gb and xk included). */
export function zoneLists(workerSrc) {
  const arr = name => {
    const m = workerSrc.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
    if (!m) throw new Error(`${name} not found in the Worker`);
    return m[1].split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean);
  };
  return {
    nordic: arr('NORDIC_ZONES'),
    eu: [...arr('EU_ZONES_ENERGY_CHARTS'), ...arr('EU_ZONES_ENTSOE'), ...arr('EU_ZONES_ELEXON'), ...arr('EU_ZONES_SEMOPX')],
  };
}

export const kindOf = (zone, lists) => (lists.nordic.includes(zone) ? 'nordic' : zone === 'gb' ? 'gb' : zone === 'xk' ? 'xk' : 'eu');

/** Judge one zone's /api/nordic answer. `body` is the parsed JSON (or null when the API did not answer), `ctx` = { today, gate, gbGate, lists }.
 *  Pure: no network, no clock. Returns { zone, kind, status: PASS|WARN|FAIL|NO MODEL, ... }. */
function analyzeZoneBase(zone, body, ctx) {
  let kind = kindOf(zone, ctx.lists);
  const res = { zone, kind, status: 'PASS', settledLast: null, first: null, last: null, nDays: 0, horizons: [], expected: [], byDesign: [], generated: null, age: null, trainedThrough: null,
                reasons: [], notes: [] };
  const fail = r => { res.status = 'FAIL'; res.reasons.push(r); };
  const warn = r => { if (res.status === 'PASS') res.status = 'WARN'; res.reasons.push(r); };
  if (!body || !Array.isArray(body.days)) { fail('the API gave no usable answer'); return res; }
  const days = body.days.filter(d => d && typeof d.date === 'string' && DATE.test(d.date));
  const settled = days.filter(d => d.type === 'actual').map(d => d.date).sort();
  const fc = days.filter(d => d.type === 'forecast').sort((a, b) => (a.date < b.date ? -1 : 1));
  if (kind === 'xk' && fc.length) { kind = 'eu'; res.kind = 'eu'; res.notes.push('Kosovo is in production (the API shows a forecast): judged like every EU zone'); }
  res.settledLast = settled.length ? settled[settled.length - 1] : null;
  res.nDays = fc.length;
  res.first = fc.length ? fc[0].date : null;
  res.last = fc.length ? fc[fc.length - 1].date : null;
  res.horizons = fc.map(d => d.horizon).filter(Number.isInteger);
  if (fc.length) res.ahead = [ageDays(res.first, ctx.today), ageDays(res.last, ctx.today)];     // D+n of the first and the last forecast day, from today
  res.generated = typeof body.forecastGenerated === 'string' ? body.forecastGenerated : (kind === 'nordic' && typeof body.generated === 'string' ? body.generated : null);
  res.trainedThrough = typeof body.trainedThrough === 'string' && DATE.test(body.trainedThrough) ? body.trainedThrough : null;
  const acc = body.accuracy && body.accuracy.byHorizon ? Object.keys(body.accuracy.byHorizon).map(Number).sort((a, b) => a - b) : [];

  // the horizons the model is expected to show
  if (kind === 'eu' || kind === 'gb') {
    const lo = kind === 'gb' ? 1 : 2, hi = 7;
    let allowed;
    if (kind === 'gb') allowed = Object.keys((ctx.gbGate && ctx.gbGate.days) || {}).map(Number);
    else {
      const g = ctx.gate && ctx.gate.zones && ctx.gate.zones[zone];
      const fuel = body.accuracy && typeof body.accuracy.fuel === 'boolean' ? body.accuracy.fuel : true;
      allowed = g ? (fuel ? g.fuel : g.nofuel) || [] : [];
    }
    allowed = [...new Set(allowed)].filter(h => h >= lo && h <= hi).sort((a, b) => a - b);
    res.expected = allowed;
    const rejected = [];
    for (let h = lo; h <= hi; h++) if (!allowed.includes(h)) rejected.push(h);
    if (rejected.length) {
      const forced = (ctx.gate && ctx.gate.forcedOff && ctx.gate.forcedOff[zone]) || [];
      res.byDesign = rejected;
      res.notes.push(`not published by design: ${rangeText(rejected)} (${rejected.every(h => forced.includes(h)) ? 'forced off in the gate' : 'the gate: under 5 % better than level+shape on the hold-out or the whole backtest'})`);
    }
    if (!allowed.length) res.notes.push('the gate lets no horizon through for this zone');
  }

  if (kind === 'xk') {
    if (fc.length) res.notes.push('a forecast is shown (a model has been added)');
    else { res.status = 'NO MODEL'; res.notes.push('no model for this zone (Kosovo has none yet)'); }
    return finishFreshness(res, ctx, warn, fail, kind);
  }
  if (!fc.length) {
    if (kind === 'gb' || kind === 'eu') {
      fail(`no forecast shown. The Worker hides a run that is older than 3 days or does not start the day after the last settled day (${res.settledLast ? new Date(dayMs(res.settledLast) + DAY).toISOString().slice(0, 10) : '?'}) without a hole`);
    } else fail('no forecast days after the last settled day');
    return res;
  }
  // contiguous after the last settled day (the Worker guarantees it for eu/gb; for the Nordic feed it is the feed's own property, and the apps stop at the first hole)
  let prev = res.settledLast;
  for (const d of fc) {
    if (prev && d.date !== new Date(dayMs(prev) + DAY).toISOString().slice(0, 10)) { fail(`a hole before the forecast day ${d.date} (the apps stop at the first missing day)`); break; }
    prev = d.date;
  }

  if (kind === 'eu' || kind === 'gb') {
    const hs = res.horizons;
    if (hs.length !== fc.length) fail('forecast days without a horizon');
    const extra = hs.filter(h => !res.expected.includes(h));
    if (extra.length) fail(`shows ${rangeText(extra)} which the gate does not allow (a horizon the gate rejects must never be shown)`);
    const noNumbers = hs.filter(h => !acc.includes(h));
    if (noNumbers.length) fail(`shows ${rangeText(noNumbers)} without accuracy numbers (a horizon without numbers is not published)`);
    if (res.expected.length) {
      const top = res.expected[res.expected.length - 1];
      if (!hs.includes(top)) fail(`the gate allows up to h${top} but the API shows ${rangeText(hs)}`);
      if (hs.length && Math.min(...hs) > res.expected[0]) warn(`starts at h${Math.min(...hs)}, not h${res.expected[0]}: the site already has settled days the model had not seen`);
    }
    const banded = fc.every(d => Array.isArray(d.prices) && d.prices.length && d.prices.every(p => typeof p.min_eur_mwh === 'number' && typeof p.max_eur_mwh === 'number'));
    if (!banded) res.notes.push('no P10/P90 band on every hour');
  } else {            // nordic
    if (fc.length < 6) warn(`only ${fc.length} forecast day(s); the pooled model delivers 7 or more`);
  }
  return finishFreshness(res, ctx, warn, fail, kind);
}

/** The three horizons the business lives by (the period views of the site are 2, 5 and 7 days). D+n is the DATE today + n; for the EU zones the model's
 *  `horizon` h of that date is n whenever the run joined at tomorrow, which is the gate's meaning of h. */
export const KEY_HORIZONS = [2, 5, 7];
/** The hour (UTC) from which a run of THIS day is expected on the API: the EU job starts 15:15, the Nordic job 12:40; before it the answer is yesterday's run, which ends one day
 *  earlier, so D+7 is "due", not missing. */
const RUN_DUE_HOUR = 16;
export const CELL_CODE = { 'shown': 'shown', 'hidden-bug': 'HIDDEN', 'blocked-by-gate': 'gate', 'no-model': 'NO MODEL', 'due': 'due' };

/** Verdict for D+2, D+5, D+7 of one zone, from the zone's analysis `res` and its answer `body`:
 *   shown            a forecast day for that date is on the API
 *   blocked-by-gate  the gate (publish_gate.json / gb_gate.json: under 5 % better than level+shape on the hold-out or the whole backtest, or the owner's `forcedOff`) does not let the
 *                    horizon through for this zone: documented, deliberately not shown, never a failure
 *   no-model         there is no model for the zone in production
 *   due              before 16:00 UTC the run on the API ends at D+6 (made before tomorrow's prices were in): the 15:15 run is due and D+7 cannot be there yet
 *   hidden-bug       the gate allows it (or the zone has no gate), a model exists, and it is not on the API: a failure.
 *  `ungated` marks a zone that is shown without any per-horizon gate or accuracy block (the 13 Nordic zones). */
export function horizonCells(res, body, ctx) {
  const kind = res.kind;
  const days = body && Array.isArray(body.days) ? body.days : [];
  const fc = days.filter(d => d && d.type === 'forecast' && typeof d.date === 'string');
  const hour = Number.isFinite(ctx.hourUtc) ? ctx.hourUtc : 23;
  const cells = {};
  for (const n of KEY_HORIZONS) {
    const date = new Date(dayMs(ctx.today) + n * DAY).toISOString().slice(0, 10);
    const hit = fc.find(d => d.date === date);
    const cell = { n, date, status: 'hidden-bug', horizon: null, reason: '' };
    if (hit) { cell.status = 'shown'; cell.horizon = Number.isInteger(hit.horizon) ? hit.horizon : null; if (kind === 'nordic') cell.ungated = true; }
    else if (!body || !Array.isArray(body.days)) cell.reason = 'the API gave no usable answer';
    else if (kind === 'xk') { cell.status = 'no-model'; cell.reason = 'no model for this zone in production'; }
    else if ((kind === 'eu' || kind === 'gb') && !res.expected.includes(n)) {
      cell.status = 'blocked-by-gate';
      const forced = (ctx.gate && ctx.gate.forcedOff && ctx.gate.forcedOff[res.zone]) || [];
      cell.reason = forced.includes(n) ? 'forced off in publish_gate.json (the owner\'s exclusion)' : 'the gate: under 5 % better than level+shape on the hold-out or the whole backtest';
    } else if (n === 7 && fc.length && hour < RUN_DUE_HOUR && res.last === new Date(dayMs(ctx.today) + 6 * DAY).toISOString().slice(0, 10)) {
      cell.status = 'due'; cell.reason = 'the run on the API ends D+6 (it was made before tomorrow\'s prices were in); the 15:15 run is due';
    } else cell.reason = fc.length ? `the forecast on the API covers ${res.first}..${res.last}, not ${date}` : 'no forecast on the API for this zone';
    cells[n] = cell;
  }
  return cells;
}

export function analyzeZone(zone, body, ctx) {
  const res = analyzeZoneBase(zone, body, ctx);
  res.cells = horizonCells(res, body, ctx);
  return res;
}

/** A key horizon that is missing and has no documented gate reason (hidden-bug or no-model); `due` and `blocked-by-gate` are not gaps. */
export const coverageGap = r => !!r.cells && KEY_HORIZONS.some(n => ['hidden-bug', 'no-model'].includes(r.cells[n].status));

function finishFreshness(res, ctx, warn, fail, kind) {
  if (res.nDays || kind === 'xk') {
    if (res.generated) {
      res.age = ageDays(ctx.today, res.generated);
      if (res.age >= 3) fail(`the run is ${res.age} days old (the Worker stops showing a run after 3 days)`);
      else if (res.age === 2) warn('the run is 2 days old: yesterday\'s run is missing');
      else if (res.age < 0) res.age = 0;
    } else if (res.nDays) fail('no run date on the answer (forecastGenerated)');
  }
  if (res.trainedThrough && res.nDays) {
    const lag = ageDays(ctx.today, res.trainedThrough);
    if (lag > 7) fail(`the training data stops ${lag} days ago (a price source has frozen)`);
    else if (lag > 3) warn(`the training data stops ${lag} days ago`);
  }
  return res;
}

async function getJson(url, tries = 3) {
  let last = '';
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'elpriser-forecast-coverage/1.0 (+https://elpriser.org)', Accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
      if (r.status === 404) return { __status: 404 };
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { last = e.message || String(e); await new Promise(res => setTimeout(res, 600 * (i + 1))); }
  }
  return { __error: last };
}

const pad = (s, n) => String(s ?? '').padEnd(n);
export function renderTable(results) {
  const lines = [pad('zone', 6) + pad('kind', 7) + pad('status', 9) + pad('settled to', 12) + pad('forecast days', 25) + pad('horizons', 12) + pad('expected', 10) + pad('run', 7) + pad('D+2', 9) + pad('D+5', 9) + pad('D+7', 9) + 'notes'];
  for (const r of results) {
    const days = r.nDays ? `${r.first.slice(5)}..${r.last.slice(5)} (${r.nDays})` : 'none';
    const hz = r.nDays ? (r.horizons.length ? rangeText(r.horizons) : `D+${r.ahead[0]}..D+${r.ahead[1]}`) : '-';
    const ex = r.kind === 'eu' || r.kind === 'gb' ? rangeText(r.expected) : '-';
    const run = r.age == null ? '-' : r.age === 0 ? 'today' : `${r.age} d`;
    const note = [...r.reasons, ...r.notes].join('; ');
    const cz = KEY_HORIZONS.map(n => pad(r.cells ? CELL_CODE[r.cells[n].status] + (r.cells[n].ungated ? '*' : '') : '-', 9)).join('');
    lines.push(pad(r.zone, 6) + pad(r.kind, 7) + pad(r.status, 9) + pad(r.settledLast || '-', 12) + pad(days, 25) + pad(hz, 12) + pad(ex, 10) + pad(run, 7) + cz + note);
  }
  return lines.join('\n');
}

export async function main(argv) {
  const opt = { base: 'https://elpriser.org', zones: null, today: null, hour: null, json: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opt.json = true;
    else if (a === '--strict') opt.strict = true;
    else if (a === '--base') opt.base = argv[++i];
    else if (a === '--zone' || a === '--zones') opt.zones = argv[++i].split(',').map(z => z.trim().toLowerCase()).filter(Boolean);
    else if (a === '--today') opt.today = argv[++i];
    else if (a === '--hour') opt.hour = Number(argv[++i]);
    else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^[#/* ]+/gm, '')); return 0; }
    else { console.error(`unknown argument ${a}`); return 2; }
  }
  if (opt.today && !DATE.test(opt.today)) { console.error('--today must be YYYY-MM-DD'); return 2; }
  const lists = zoneLists(fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8'));
  const all = [...lists.nordic, ...lists.eu];
  const readJson = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const ctx = { today: opt.today || new Date().toISOString().slice(0, 10), hourUtc: opt.hour != null ? opt.hour : new Date().getUTCHours(), lists,
                gate: readJson('scripts/forecast_model/eu/publish_gate.json'), gbGate: readJson('scripts/forecast_model/gb/gb_gate.json') };
  const zones = opt.zones || all;
  const bad = zones.filter(z => !all.includes(z));
  if (bad.length) { console.error(`unknown zone(s): ${bad.join(', ')}`); return 2; }
  const bodies = {};
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < zones.length) {
      const z = zones[next++];
      const b = await getJson(`${opt.base.replace(/\/$/, '')}/api/nordic?zone=${encodeURIComponent(z)}`);
      bodies[z] = b && !b.__status && !b.__error ? b : null;
    }
  }));
  const results = zones.map(z => analyzeZone(z, bodies[z], ctx));
  if (opt.json) { console.log(JSON.stringify({ today: ctx.today, base: opt.base, results }, null, 2)); }
  else {
    console.log(`Forecast coverage of ${zones.length} zones on ${opt.base}, ${ctx.today} (UTC)\n`);
    console.log(renderTable(results));
    const n = s => results.filter(r => r.status === s).length;
    const design = results.filter(r => r.byDesign.length).map(r => `${r.zone} ${rangeText(r.byDesign)}`);
    console.log(`\n${n('PASS')} pass, ${n('WARN')} warn, ${n('FAIL')} fail, ${n('NO MODEL')} no model of ${results.length}`);
    if (design.length) console.log(`not published by design (the gate): ${design.join(', ')}`);
    for (const r of results.filter(x => x.status === 'FAIL' || x.status === 'WARN')) for (const why of r.reasons) console.log(`${r.status} ${r.zone}: ${why}`);
    for (const r of results.filter(x => x.status === 'NO MODEL')) console.log(`NO MODEL ${r.zone}: ${r.notes.join('; ')}`);
    console.log(`\nD+2 / D+5 / D+7 (the date today + n; shown* = shown without any per-horizon gate or accuracy block, as the 13 Nordic zones are):`);
    for (const n of KEY_HORIZONS) {
      const c = st => results.filter(r => r.cells && r.cells[n].status === st).length;
      const ungated = results.filter(r => r.cells && r.cells[n].status === 'shown' && r.cells[n].ungated).length;
      console.log(`  D+${n}: ${c('shown')} shown (${ungated} of them ungated), ${c('hidden-bug')} hidden-bug, ${c('blocked-by-gate')} blocked-by-gate, ${c('no-model')} no-model, ${c('due')} due`);
    }
    for (const r of results) for (const n of KEY_HORIZONS) {
      const c = r.cells && r.cells[n];
      if (c && c.status !== 'shown') console.log(`${c.status === 'blocked-by-gate' || c.status === 'due' ? 'note   ' : 'MISSING'} ${r.zone} D+${n} (${c.date}): ${CELL_CODE[c.status]}: ${c.reason}`);
    }
  }
  return results.some(r => r.status === 'FAIL' || (opt.strict && r.status === 'WARN') || coverageGap(r)) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => process.exit(code), e => { console.error(e.message || e); process.exit(2); });
}
