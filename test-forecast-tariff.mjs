#!/usr/bin/env node
/**
 * /api/forecast with a grid company: the tariff must be the one in force on
 * each day's own date, added with VAT, and never a silent zero.
 * Run: npm run test:forecast-tariff   (offline)
 *
 * A user planning a heat pump against N1 found the forecast short of
 * /api/prices by 0,110 / 0,329 / 0,988 kr at 03 / 13 / 19 — exactly N1's
 * winter nettarif incl. VAT — because net_ modes returned the untariffed sum.
 * The functions are lifted out of the Pages Function and run as shipped.
 */
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('./functions/api/[[catchall]].js', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error(`not found: ${a}`); return src.slice(i, j); };
const code = cut('function getTariffHourly(', '// ── Price conversion')
           + cut('const FORECAST_BASE_MODE', 'async function handleForecast(');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(code + '\nglobalThis.apply = applyGridTariff; globalThis.BASE = FORECAST_BASE_MODE;', ctx);
const { apply, BASE } = ctx;

let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };

const flat = v => Array.from({ length: 24 }, () => v);
const day = (date, price, extra = {}) => ({ date, type: 'forecast',
  prices: Array.from({ length: 24 }, (_, hour) => ({ hour, price, ...extra })) });
// Newest first, as loadTariffRecords returns them. Winter from 1 Oct, summer before.
const recs = [
  { fromStr: '2026-10-01', toStr: null, hourly: flat(0.2), rank: 1 },
  { fromStr: '2026-04-01', toStr: '2026-10-01', hourly: flat(0.1), rank: 1 },
];

// ── The tariff is added with VAT ──────────────────────────────────────────
{
  const [d] = apply([day('2026-10-06', 1.0)], recs);
  ok(Math.abs(d.prices[5].price - (1.0 + 0.2 * 1.25)) < 1e-9, 'tariffen lægges til inkl. 25 % moms', d.prices[5].price);
  ok(d.tariff === 'published', 'en dag med offentliggjort tarif mærkes published', d.tariff);
}

// ── A forecast that crosses a tariff change switches at the right midnight ─
{
  const days = apply([day('2026-09-30', 1.0), day('2026-10-01', 1.0)], recs);
  ok(Math.abs(days[0].prices[0].price - 1.125) < 1e-9, 'sidste sommerdag får sommertariffen', days[0].prices[0].price);
  ok(Math.abs(days[1].prices[0].price - 1.25) < 1e-9, 'første vinterdag får vintertariffen', days[1].prices[0].price);
}

// ── Bands move with the price ─────────────────────────────────────────────
{
  const [d] = apply([day('2026-10-06', 1.0, { min: 0.5, max: 2.0 })], recs);
  ok(Math.abs(d.prices[3].min - 0.75) < 1e-9 && Math.abs(d.prices[3].max - 2.25) < 1e-9, 'min og max forskydes med samme tarif');
}

// ── Nothing is ever turned into a zero tariff ─────────────────────────────
{
  const [before] = apply([day('2026-01-01', 1.0)], [{ fromStr: '2026-04-01', toStr: null, hourly: flat(0.1), rank: 1 }]);
  ok(before.tariff === null && before.prices.every(p => p.price === null), 'en dato før alle tariffer giver null, ikke et uændret tal', JSON.stringify(before.prices[0]));
  const [after] = apply([day('2027-06-01', 1.0)], [{ fromStr: '2026-04-01', toStr: '2026-10-01', hourly: flat(0.1), rank: 1 }]);
  ok(after.tariff === 'last_known' && Math.abs(after.prices[0].price - 1.125) < 1e-9, 'uden offentliggjort tarif bruges den seneste, og det står i svaret', JSON.stringify([after.tariff, after.prices[0].price]));
  const [hole] = apply([{ date: '2026-10-06', type: 'forecast', prices: [{ hour: 0, price: null }, { hour: 1, price: 1 }] }], recs);
  ok(hole.prices[0].price === null, 'et manglende tal forbliver manglende');
}

// ── Hourly tariff profiles are read per hour ──────────────────────────────
{
  const hourly = Array.from({ length: 24 }, (_, h) => (h >= 17 && h < 20 ? 0.8 : 0.1));
  const [d] = apply([day('2026-10-06', 1.0)], [{ fromStr: '2026-10-01', toStr: null, hourly, rank: 0 }]);
  ok(Math.abs(d.prices[19].price - 2.0) < 1e-9 && Math.abs(d.prices[12].price - 1.125) < 1e-9, 'spidslast og dag får hver sin tarif', `${d.prices[19].price} / ${d.prices[12].price}`);
}

// ── Modes ─────────────────────────────────────────────────────────────────
ok(BASE.net_inkl_alt === 'inkl_alt' && BASE.net_inkl_alt_elvarme === 'inkl_alt_elvarme', 'net_inkl_alt bygges på inkl_alt (og elvarme-varianten på sin)');
ok(BASE.net_inkl_tarif === 'inkl_alt_minus', 'net_inkl_tarif bygges uden elafgift — den faldt før igennem til inkl. afgift');

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
