// Cross-platform contract: the web app, the Android app and the iOS app each
// carry their own copy of the net list and a few small pieces of logic. Nothing
// else would notice one of them drifting, so they are pinned to one JSON file.
//
//   index.html + tests/golden/reference.mjs  ->  tests/golden/app-contract.json
//                                                   |-> this test (web + source of the apps)
//                                                   |-> Android unit test (ContractTest.kt)
//                                                   '-> iOS unit test (ContractTests.swift)
//
// Run: npm run test:golden. Regenerate the file with: node tests/golden/generate.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { build, webNets } from './tests/golden/generate.mjs';

const ROOT = import.meta.dirname;
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/golden/app-contract.json'), 'utf8'));

test('app-contract.json is up to date with index.html and the reference implementation', () => {
  assert.deepEqual(golden, JSON.parse(JSON.stringify(build())),
    'stale: run `node tests/golden/generate.mjs` and commit the result (the net list in index.html or the reference logic changed)');
});

test('the Android net list equals the web net list (name, GLN, area, match strings)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ElpriserAndroid/app/src/main/java/org/elpriser/app/data/Models.kt'), 'utf8');
  const nets = [...src.matchAll(/Net\("([^"]+)", "(\d{13})", "(DK[12])", listOf\(([^)]*)\)\)/g)].map(m => ({
    name: m[1], gln: m[2], area: m[3], match: [...m[4].matchAll(/"([^"]+)"/g)].map(x => x[1]),
  }));
  assert.deepEqual(nets, golden.nets);
});

test('the iOS net list equals the web net list (name, GLN, area, match strings)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ElpriserIOS/Sources/Models.swift'), 'utf8');
  const nets = [...src.matchAll(/Net\(name: "([^"]+)", gln: "(\d{13})", area: "(DK[12])", match: \[([^\]]*)\]\)/g)].map(m => ({
    name: m[1], gln: m[2], area: m[3], match: [...m[4].matchAll(/"([^"]+)"/g)].map(x => x[1]),
  }));
  assert.deepEqual(nets, golden.nets);
});

test('every net the apps know is one the server prices (GLN known to functions/[[path]].js)', () => {
  const fn = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  for (const n of golden.nets) assert.ok(fn.includes(`gln: '${n.gln}'`), `${n.name} (${n.gln}) is not in the server's net list`);
});

test('the contract covers the cases that have bitten before', () => {
  // Longest match wins, a net whose name contains another net's name.
  const m = Object.fromEntries(golden.matchCases.map(c => [c.input, c.expect]));
  assert.equal(m['TREFOR El-net Øst A/S'], 'Trefor Øst');
  assert.equal(m['TREFOR El-Net A/S'], 'Trefor');
  assert.equal(m[''], null);
  // Days that are incomplete are not days; a band on some hours still counts.
  assert.deepEqual(golden.forecast.expect.days.map(d => d.date), ['2026-10-10', '2026-10-11', '2026-10-14']);
  assert.deepEqual(Object.keys(golden.co2.expect), ['2026-10-10']);
});

test('the web app resolves every grid-company name exactly as the contract says', () => {
  // The web's own matchNet(), taken out of index.html and run against the same
  // cases as the apps. (It used to take the FIRST match in list order, which put
  // "TREFOR El-net Øst" on the DK1 Trefor net.)
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const nets = html.match(/const NETS=(\{[\s\S]*?\]\});/)[1];
  const fn = html.match(/function matchNet\(n\)\{[\s\S]*?\n\}/)[0];
  const web = vm.runInNewContext(`const NETS=${nets};${fn};matchNet`);
  for (const c of golden.matchCases) {
    const got = c.input && c.input.trim() ? web(c.input) : null;
    assert.equal(got ? got.net.name : null, c.expect, `matchNet(${JSON.stringify(c.input)})`);
  }
  assert.ok(webNets().length === golden.nets.length);
});

/* ── Zones: the same table in the API, the web, the contract and both apps ───────────────────────── */

const apiSrc = fs.readFileSync(path.join(ROOT, 'functions/api/[[catchall]].js'), 'utf8');
const apiList = name => ((apiSrc.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`)) || [])[1] || '').split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean);
const apiInfo = Object.fromEntries([...apiSrc.matchAll(/^\s+'?([a-z0-9-]+)'?:\s+\{ name: '([^']+)',\s+country: '([A-Z]{2})', currency: '([A-Z]{3})'/gm)].map(m => [m[1], { name: m[2], country: m[3], currency: m[4] }]));

test('the contract\'s zone table lists exactly the zones /api/nordic serves, with the API\'s country and currency', () => {
  const served = [...apiList('NORDIC_ZONES'), ...apiList('EU_ZONES_ENERGY_CHARTS'), ...apiList('EU_ZONES_ENTSOE'), ...apiList('EU_ZONES_ELEXON'), ...apiList('EU_ZONES_SEMOPX')];
  assert.deepEqual(golden.zones.map(z => z.key).sort(), [...served].sort());
  assert.equal(served.length, 40, 'the API serves 13 Nordic/NL + 27 EU zones (Kosovo and Great Britain joined)');
  for (const z of golden.zones) {
    const info = apiInfo[z.key];
    assert.ok(info, `${z.key}: no zoneInfo in the API`);
    assert.equal(z.country, info.country, `${z.key}: country`);
    assert.equal(z.currency, info.currency, `${z.key}: currency`);
  }
});

test('the zone table agrees with the web\'s ZONES (currency, sub-unit, the names of the Norwegian and Swedish areas)', () => {
  const fn = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const from = fn.indexOf('var ZONES={');
  const body = fn.slice(from, fn.indexOf('\n};', from) + 3);
  const web = vm.runInNewContext(body.replace('var ZONES=', '(').replace(/;\s*$/, ')'));
  for (const z of golden.zones) {
    const w = web[z.key];
    if (!w) continue;
    assert.equal(z.currency, w.cur, `${z.key}: currency`);
    if (z.sub !== 'ct') assert.equal(z.sub, w.sub, `${z.key}: sub-unit`);
    else assert.equal(w.cur, 'EUR', `${z.key}: ct means euro cent`);
    if (/^(no|se)\d$/.test(z.key)) assert.equal(z.city, w.city, `${z.key}: city`);
  }
  // the API's days are by the zone's own wall clock: the contract's tz must be a real IANA zone
  for (const z of golden.zones) assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: z.tz }), `${z.key}: ${z.tz}`);
});

test('countries: every zone belongs to exactly one country; the default zone of every region and language is a zone of the table', () => {
  const keys = new Set(golden.zones.map(z => z.key));
  assert.deepEqual(golden.countries.flatMap(c => c.zones).sort(), [...keys].sort());
  for (const z of [...Object.values(golden.regionZone), ...Object.values(golden.languageZone), golden.fallbackZone]) assert.ok(keys.has(z), z);
  const dk = golden.defaultZone.filter(c => c.region === 'DK' || c.language === 'da').map(c => c.expect);
  assert.ok(dk.every(z => z === 'dk1'), 'Denmark and Danish stay on DK1: the Danish experience is unchanged');
  assert.equal(golden.countries.length, 32, '30 countries in the apps + Kosovo and the United Kingdom, which only the API and the web serve so far');
});

test('/api/nordic parsing: complete days only, EUR/MWh -> sub-unit per kWh at the response\'s rate (ECB fallback without one), band optional', () => {
  const [no, de, pl] = golden.zoneResponses;
  assert.deepEqual(no.expect.days.map(d => d.date), ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-14']);
  assert.equal(no.expect.days[1].price[0], 65.04, '60 EUR/MWh x 10.84 / 10');
  assert.equal(no.expect.days[1].actual, true);
  assert.equal(no.expect.days[2].actual, false);
  assert.ok(no.expect.days[2].lo && no.expect.days[2].hi && no.expect.days[1].lo === null);
  assert.equal(de.expect.days[0].price[0], -1.25, 'a negative price stays negative');
  assert.equal(pl.expect.rate, 4.39, 'no rate in zoneInfo: the fallback for PLN');
  assert.equal(pl.expect.days[0].price[0], 39.51);
});

test('days from today: consecutive, a hole ends the run, no today means nothing', () => {
  assert.deepEqual(golden.zoneDays.map(c => c.expect), [['2026-10-10', '2026-10-11'], [], ['2026-10-10'], []]);
});

const zoneTable = (file, re, build) => {
  const f = path.join(ROOT, file);
  return fs.existsSync(f) ? [...fs.readFileSync(f, 'utf8').matchAll(re)].map(build) : null;
};
const strip = z => ({ key: z.key, country: z.country, tz: z.tz, currency: z.currency, sub: z.sub, city: z.city });

// Skipped until the apps' Zones files exist (the Europe work adds them); then they pin the apps to the contract.
const kotlinZones = path.join(ROOT, 'ElpriserAndroid/app/src/main/java/org/elpriser/app/data/Zones.kt');
const swiftZones = path.join(ROOT, 'ElpriserIOS/Sources/Zones.swift');

test('the Android zone table (Zones.kt) equals the contract: key, country, time zone, currency, sub-unit, city, in order', { skip: !fs.existsSync(kotlinZones) && 'Zones.kt not written yet' }, () => {
  const rows = zoneTable('ElpriserAndroid/app/src/main/java/org/elpriser/app/data/Zones.kt',
    /Zone\("([a-z0-9-]+)", "([A-Z]{2})", "([A-Za-z\/_]+)", "([A-Z]{3})", "([^"]+)", (?:"([^"]+)"|null)\)/g,
    m => ({ key: m[1], country: m[2], tz: m[3], currency: m[4], sub: m[5], city: m[6] ?? null }));
  assert.deepEqual(rows, golden.zones.filter(z => z.apps !== false).map(strip));
});

test('the iOS zone table (Zones.swift) equals the contract: key, country, time zone, currency, sub-unit, city, in order', { skip: !fs.existsSync(swiftZones) && 'Zones.swift not written yet' }, () => {
  const rows = zoneTable('ElpriserIOS/Sources/Zones.swift',
    /Zone\(key: "([a-z0-9-]+)", country: "([A-Z]{2})", tz: "([A-Za-z\/_]+)", currency: "([A-Z]{3})", sub: "([^"]+)", city: (?:"([^"]+)"|nil)\)/g,
    m => ({ key: m[1], country: m[2], tz: m[3], currency: m[4], sub: m[5], city: m[6] ?? null }));
  assert.deepEqual(rows, golden.zones.filter(z => z.apps !== false).map(strip));
});
