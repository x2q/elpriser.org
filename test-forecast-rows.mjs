#!/usr/bin/env node
/**
 * Unit test for the homepage's server-rendered "Næste 7 døgn" rows.
 * Run: npm run test:forecast   (offline, no server)
 *
 * The function lives inside a Pages Function module that Node cannot import as
 * CommonJS, so it is lifted out and run in a sandbox — the same approach
 * test-shelly-script.mjs uses. That keeps the thing under test the code that
 * actually ships, rather than a copy that can drift.
 *
 * Worth testing rather than eyeballing: the bar geometry divides by the week's
 * price span, which is zero on a flat week; the day labels have to say "I dag"
 * and "I morgen" relative to Danish time, not the server's; and exactly one day
 * may carry the "cheapest" badge.
 */
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('./functions/[[path]].js', import.meta.url), 'utf8');
const start = src.indexOf('const FC_WEEKDAYS');
const end = src.indexOf('/** Build the live-price JSON-LD block');
if (start < 0 || end < 0 || end < start) throw new Error('buildForecastRows not found in functions/[[path]].js');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(src.slice(start, end) + '\nglobalThis.build = buildForecastRows;', ctx);
const build = ctx.build;

let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };

const day = (date, lo, hi, type = 'forecast') => ({
  date, type,
  prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, price: h === 0 ? lo : h === 1 ? hi : (lo + hi) / 2 })),
});
const week = (los, his, types = []) => ({
  days: los.map((lo, i) => day(
    new Date(Date.UTC(2026, 8, 27 + i)).toISOString().slice(0, 10),
    lo, his[i], types[i] || 'forecast')),
});
const TODAY = '2026-09-27';
const rowsOf = html => html.split('<div class="fc-row">').slice(1);

// ── A normal week ──────────────────────────────────────────────────────────
{
  const html = build(week([0.15, 0.96, 0.59, 0.71, 0.13, 0.42, 0.38],
                          [1.86, 2.49, 2.03, 1.74, 0.86, 1.71, 1.66],
                          ['actual', 'actual']), TODAY);
  const rows = rowsOf(html);
  ok(rows.length === 7, 'syv rækker', `${rows.length}`);
  ok(/>I dag</.test(rows[0]), 'første række hedder "I dag"');
  ok(/>I morgen</.test(rows[1]), 'anden række hedder "I morgen"');
  ok(/Tirsdag|Onsdag|Torsdag|Fredag|Lørdag|Søndag|Mandag/.test(rows[2]),
     'tredje række har dansk ugedag med stort begyndelsesbogstav', rows[2].slice(0, 80));
  ok((rows[0].match(/fc-tag real">BØRSPRIS/) || []).length === 1, 'faktiske priser mærkes BØRSPRIS');
  ok(/fc-tag">PROGNOSE/.test(rows[2]), 'øvrige dage mærkes PROGNOSE');
  ok(/0,15/.test(rows[0]) && /1,86/.test(rows[0]), 'komma som decimaltegn', rows[0].slice(0, 120));

  const badges = (html.match(/fc-badge/g) || []).length;
  ok(badges === 1, 'præcis ét "ugens billigste"-mærke', `${badges}`);
  ok(/fc-badge/.test(rows[4]), 'mærket sidder på dagen med laveste pris (0,13)');
  ok((html.match(/fc-spacer/g) || []).length === 6, 'de øvrige rækker får en afstandsholder');

  // Geometry: the cheapest day starts at 0 %, nothing runs past 100 %.
  const geo = [...html.matchAll(/left:([\d.]+)%;width:([\d.]+)%/g)].map(m => [+m[1], +m[2]]);
  ok(geo.length === 7, 'alle rækker har en søjle');
  ok(geo.every(([l, w]) => Number.isFinite(l) && Number.isFinite(w) && l >= 0 && l + w <= 100.05),
     'ingen søjle går uden for 0–100 %', JSON.stringify(geo));
  ok(Math.min(...geo.map(g => g[0])) === 0, 'billigste dag starter i venstre kant');
}

// ── A flat week: every day identical, so the span is zero ──────────────────
{
  const html = build(week([1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1]), TODAY);
  ok(!/NaN|Infinity/.test(html), 'flad uge giver hverken NaN eller Infinity', html.slice(0, 200));
  const geo = [...html.matchAll(/left:([\d.]+)%;width:([\d.]+)%/g)].map(m => [+m[1], +m[2]]);
  ok(geo.every(([l, w]) => l === 0 && w === 0), 'flad uge: søjler uden bredde', JSON.stringify(geo[0]));
  ok((html.match(/fc-badge/g) || []).length === 1, 'flad uge: stadig kun ét mærke');
}

// ── Not enough data ────────────────────────────────────────────────────────
{
  ok(build({ days: [] }, TODAY) === '', 'ingen dage giver tom streng');
  ok(build({}, TODAY) === '', 'manglende days-felt giver tom streng');
  ok(build(week([0.5], [1.5]), TODAY) === '', 'én dag alene er ikke en uge');
  const holed = week([0.5, 0.7, 0.9], [1.5, 1.7, 1.9]);
  holed.days[1].prices = holed.days[1].prices.map(p => ({ ...p, price: null }));
  const rows = rowsOf(build(holed, TODAY));
  ok(rows.length === 2, 'et døgn uden priser springes over frem for at tegne en tom række', `${rows.length}`);
}

// ── Never more than seven, even when the API returns ten ───────────────────
{
  const ten = week(Array.from({ length: 10 }, (_, i) => 0.2 + i / 20),
                   Array.from({ length: 10 }, (_, i) => 1.2 + i / 20));
  ok(rowsOf(build(ten, TODAY)).length === 7, 'ti dage fra API\'et vises som syv');
}

// ── Labels follow the date passed in, not the machine's clock ──────────────
{
  const w = week([0.3, 0.4, 0.5], [1.3, 1.4, 1.5]);
  const rows = rowsOf(build(w, '2026-09-28'));   // "today" is the second day
  ok(!/>I dag</.test(rows[0]) && />I dag</.test(rows[1]),
     '"I dag" følger den dato serveren sender ind', rows[0].slice(0, 60));
}

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
