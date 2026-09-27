#!/usr/bin/env node
/**
 * Unit test for the server-rendered content on the eleven non-Danish zone
 * pages. Run: npm run test:zone   (offline, no server)
 *
 * These pages served an empty shell to crawlers — an <h1> of &nbsp; and the
 * word "Loading…" — so the numbers here are the whole point. Lifted out of the
 * Pages Function and run in a sandbox, the same way test-forecast-rows.mjs
 * does, so the code under test is the code that ships.
 */
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('./functions/[[path]].js', import.meta.url), 'utf8');
const start = src.indexOf('const SSR_ZONES = {');
const end = src.indexOf('/** Build the live-price JSON-LD block');
if (start < 0 || end < 0) throw new Error('buildZoneIntro not found in functions/[[path]].js');
const ctx = { console, Intl, Date };
vm.createContext(ctx);
vm.runInContext(src.slice(start, end) + '\nglobalThis.b = buildZoneIntro; globalThis.Z = SSR_ZONES; globalThis.cur = buildZoneCurrency; globalThis.curRe = ZONE_CUR_RE;', ctx);
const { b: build, Z: ZONES, cur, curRe } = ctx;

const TODAY = '2026-09-27';
let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };

const day = (date, lo, hi, actual = false) => ({
  date, actual,
  prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: h === 0 ? lo : h === 1 ? hi : (lo + hi) / 2 })),
});
const data = (n = 10, lo = 20, hi = 90) => ({
  days: Array.from({ length: n }, (_, i) =>
    day(new Date(Date.UTC(2026, 8, 27 + i)).toISOString().slice(0, 10), lo + i, hi + i, i < 2)),
});

ok(Object.keys(ZONES).length === 11, 'elleve zoner dækket', String(Object.keys(ZONES).length));

// ── Every zone renders, in its own language ────────────────────────────────
for (const [key, z] of Object.entries(ZONES)) {
  const r = build(key, data(), TODAY);
  ok(!!r, `${key}: giver indhold`);
  if (!r) continue;
  ok(r.title.includes(z.name) && r.title.includes(z.city),
     `${key}: overskrift nævner zone og by`, r.title);
  ok(r.eyebrow.length > 3, `${key}: har eyebrow`, r.eyebrow);
  ok(r.html.includes(z.sub + '/kWh'), `${key}: bruger lokal enhed ${z.sub}`, r.html.slice(0, 120));
  ok((r.html.match(/<tr>/g) || []).length === 10, `${key}: ti rækker`);
  ok(!/NaN|Infinity|undefined/.test(r.html), `${key}: ingen NaN eller undefined`);
}

// ── Language is not Danish for the foreign zones ───────────────────────────
ok(build('se3', data(), TODAY).eyebrow === 'Elprisprognos', 'SE3 er på svensk', build('se3', data(), TODAY).eyebrow);
ok(build('fi', data(), TODAY).eyebrow === 'Sähkön hintaennuste', 'FI er på finsk');
ok(build('nl', data(), TODAY).eyebrow === 'Stroomprijsverwachting', 'NL er på hollandsk');
ok(build('no2', data(), TODAY).title.startsWith('Strømpriser'), 'NO2 er på norsk');

// ── Currency conversion: EUR/MWh to the zone's sub-unit per kWh ────────────
{
  // 100 EUR/MWh in SE3 → 100/1000 * 11.3 * 100 = 113 öre/kWh
  const r = build('se3', { days: [day('2026-09-27', 100, 100, true), day('2026-09-28', 100, 100)] }, TODAY);
  ok(r.html.includes('113 – 113'), 'SE3: 100 EUR/MWh bliver 113 öre/kWh', r.html.match(/>[\d, –]+<\/td>/g)?.join(' '));
  // FI has rate 1, so 100 EUR/MWh → 10 snt/kWh
  const f = build('fi', { days: [day('2026-09-27', 100, 100, true), day('2026-09-28', 100, 100)] }, TODAY);
  ok(/10,0 – 10,0/.test(f.html), 'FI: 100 EUR/MWh bliver 10,0 snt/kWh', f.html.match(/>[\d, –]+<\/td>/g)?.join(' '));
}

// ── Labels ─────────────────────────────────────────────────────────────────
{
  const r = build('no1', data(), TODAY);
  const rows = r.html.split('<tr>').slice(1);
  ok(rows[0].includes('I dag'), 'første række er "i dag"', rows[0].slice(0, 90));
  ok(rows[0].includes('faktisk'), 'faktiske priser mærkes med act-etiketten');
  ok(rows[5].includes('prognose'), 'senere døgn mærkes som prognose');
  ok(!rows[5].includes('I dag'), 'kun første række hedder "i dag"');
}

// ── Not enough data, and a zone that does not exist ────────────────────────
ok(build('se1', { days: [] }, TODAY) === null, 'ingen dage giver null');
ok(build('se1', {}, TODAY) === null, 'manglende days giver null');
ok(build('se1', data(1), TODAY) === null, 'ét døgn alene giver null');
{
  const holed = data(3);
  holed.days[1].prices = holed.days[1].prices.map(p => ({ ...p, eur_mwh: null }));
  ok((build('se1', holed, TODAY).html.match(/<tr>/g) || []).length === 2, 'døgn uden priser springes over');
}

// ── Decimals: large local values lose the decimal so rows stay narrow ──────
{
  const big = build('no4', { days: [day('2026-09-27', 900, 1200, true), day('2026-09-28', 900, 1200)] }, TODAY);
  ok(!/,/.test(big.html.match(/<td class="py-1\.5 text-right[^>]*>([^<]*)</)[1]),
     'store tal vises uden decimal', big.html.match(/<td class="py-1\.5 text-right[^>]*>([^<]*)</)[1]);
}

// ── The "today" label follows the date, not the row position ──────────────
{
  // The live feed opens on yesterday; labelling row 0 "today" dated it wrong.
  const withYesterday = { days: [
    day('2026-09-26', 50, 90, true), day('2026-09-27', 50, 90, true),
    day('2026-09-28', 50, 90), day('2026-09-29', 50, 90)] };
  const r = build('se3', withYesterday, TODAY);
  const rows = r.html.split('<tr>').slice(1);
  ok(rows.length === 3, 'gårsdagen er droppet', String(rows.length));
  ok(rows[0].includes('I dag') && rows[0].includes('27 sep'),
     '"I dag" står ud for den rigtige dato', rows[0].slice(0, 110));
  ok(!rows[1].includes('I dag'), 'kun ét døgn hedder "i dag"');
  ok(r.html.includes('Kommande 3 dygn'), 'overskriften tæller de viste døgn', r.html.slice(0, 90));
}

// ── The currency dropdown, in the zone's own language ──────────────────────
{
  const idx = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  // If someone reformats the three <option>s the swap stops happening and the
  // dropdown silently reverts to English. That must fail here, not in Google's
  // index, so the regex is tested against the markup it has to match.
  ok(curRe.test(idx), 'ZONE_CUR_RE rammer stadig valuta-dropdownen i index.html');
  const matched = idx.match(curRe)[0];
  ok(/Local/.test(matched) && /Incl\. grid \+ tax/.test(matched),
     'den engelske standardtekst ligger inden for det, der bliver skiftet ud', matched.slice(0, 80));

  ok(/öre\/kWh/.test(cur('se3')), 'SE3 får öre med svensk ö', cur('se3').slice(0, 60));
  ok(/øre\/kWh/.test(cur('no1')), 'NO1 får øre med norsk ø');
  ok(/snt\/kWh/.test(cur('fi')), 'FI får snt');
  ok(/cent\/kWh/.test(cur('nl')), 'NL får cent');

  for (const [k, want] of [['no1', 'Inkl. nettleie og avgifter'],
                           ['se3', 'Inkl. elnätsavgift och skatt'],
                           ['fi',  'Sis. siirto ja verot'],
                           ['nl',  'Incl. netkosten en belasting']]) {
    ok(cur(k).includes(want), `${k} oversætter "inkl. nettarif"`, cur(k));
  }

  for (const k of Object.keys(ZONES)) {
    const h = cur(k);
    const texts = [...h.matchAll(/>([^<]*)</g)].map(m => m[1]);
    ok(!texts.some(x => x === 'Local' || x === 'Incl. grid + tax'),
       `${k} har ingen engelsk rest tilbage`, JSON.stringify(texts));
    ok((h.match(/<option /g) || []).length === 3, `${k} har stadig tre valg`);
    // FI has no usable tariff register and NL's grid cost is a fixed annual
    // charge, so neither can offer "incl. grid" — the client hides it, and the
    // server must agree or the option flickers in and out on load.
    const hidden = /id="zCurTotal" style="display:none"/.test(h);
    ok(hidden === (k === 'fi' || k === 'nl'),
       `${k}: "inkl. nettarif"-valget er skjult netop når der ikke findes tariffer`, h);
  }
}

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
