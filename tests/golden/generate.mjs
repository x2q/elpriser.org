// Builds app-contract.json from reference.mjs plus the net list in index.html.
// Run:  node tests/golden/generate.mjs      (test-golden.mjs fails when the file is stale)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as ref from './reference.mjs';
import * as zn from './zones.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** The web app's net list is the source of truth for names, GLNs, areas and match strings. */
export function webNets() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/const NETS=(\{[\s\S]*?\]\});/);
  if (!m) throw new Error('could not find const NETS in index.html');
  const NETS = vm.runInNewContext('(' + m[1] + ')');
  const out = [];
  for (const area of ['DK1', 'DK2']) {
    for (const n of NETS[area]) out.push({ name: n.name, gln: n.gln, area, match: n.match });
  }
  return out;
}

const ramp = (f) => Array.from({ length: 24 }, (_, h) => +f(h).toFixed(4));
const hourly = (prices, extra = () => ({})) => prices.map((price, hour) => ({ hour, price, ...extra(hour) }));

export function build() {
  const nets = webNets();

  const matchInputs = [
    'N1', 'Elnetselskabet N1 A/S', 'TREFOR El-net Øst A/S', 'TREFOR El-Net A/S', 'KONSTANT Net A/S',
    'Vores Elnet A/S', 'Radius Elnet A/S', 'Cerius A/S', 'Netselskabet Elværk A/S', 'Nord Energi Net A/S',
    'FLOW Elnet A/S', 'L-Net A/S', 'Elnet Midt A/S', 'RAH Net A/S', 'Ukendt Net ApS', '', '   ', null,
  ];

  const flat = Array(24).fill(1.5);
  const vshape = ramp(h => 1 + Math.abs(h - 12) * 0.1);
  const evening = ramp(h => (h >= 17 && h <= 20 ? 3 : 1) + h * 0.01);
  const windows = [
    { vals: flat, n: 3 }, { vals: vshape, n: 1 }, { vals: vshape, n: 4 }, { vals: vshape, n: 6, highest: true },
    { vals: evening, n: 2 }, { vals: evening, n: 4, highest: true }, { vals: vshape, n: 24 },
    { vals: ramp(h => (h === 23 || h === 0 ? 0.2 : 2)), n: 2 },
  ].map(c => ({ ...c, highest: !!c.highest, expect: ref.cheapestWindow(c.vals, c.n, !!c.highest) }));

  const eight = [1, 2, 3, 4, 5, 6, 7, 8];
  const day24 = Array.from({ length: 24 }, (_, i) => i + 1);
  const verdicts = [
    { price: 0.5, vals: day24 }, { price: 9, vals: day24 }, { price: 10, vals: day24 }, { price: 17, vals: day24 },
    { price: 18, vals: day24 }, { price: 24, vals: day24 }, { price: 99, vals: day24 }, { price: 2, vals: eight },
  ].map(c => ({ ...c, expect: ref.verdict(c.price, c.vals) }));

  const dayNames = ['2026-10-10', '2026-10-11', '2026-12-31', '2028-02-29', '2027-01-01', '2026-06-05']
    .map(ref.dayNames);

  const forecastResponse = {
    area: 'DK1', mode: 'net_inkl_alt', generated: '2026-10-10T11:00:00Z', model: { name: 'elpriser-gbm-v3' },
    days: [
      { date: '2026-10-10', type: 'actual', prices: hourly(ramp(h => 1.2 + h * 0.05)) },
      { date: '2026-10-11', type: 'forecast', prices: hourly(ramp(h => 1.4 + h * 0.03), h => ({ min: +(1.2 + h * 0.03).toFixed(4), max: +(1.7 + h * 0.03).toFixed(4) })) },
      // 23 hours only: not a day, must be dropped
      { date: '2026-10-12', type: 'forecast', prices: hourly(ramp(h => 1.3)).filter(p => p.hour !== 7) },
      // a null price in hour 5 and an out-of-range hour 24: dropped
      { date: '2026-10-13', type: 'forecast', prices: [...hourly(ramp(h => 1.3)).map(p => (p.hour === 5 ? { ...p, price: null } : p)), { hour: 24, price: 9 }] },
      // band on some hours only
      { date: '2026-10-14', type: 'forecast', prices: hourly(ramp(h => 1.1 + h * 0.02), h => (h % 2 === 0 ? { min: 1.0, max: 1.9 } : { min: null, max: null })) },
    ],
  };

  const co2Response = {
    area: 'DK1', unit: 'g/kWh',
    records: [
      ...Array.from({ length: 24 }, (_, hour) => ({ date: '2026-10-10', hour, co2: 90 + hour * 3 })),
      ...Array.from({ length: 12 }, (_, hour) => ({ date: '2026-10-11', hour, co2: 120 })),
      { date: '2026-10-10', hour: 24, co2: 1 },
    ],
  };

  // /api/nordic: prices in EUR/MWh, converted to the zone's sub-unit per kWh. Three zones: a forecast zone with a band (NOK), a settled-only
  // zone (EUR), and a zone whose response carries no rate (PLN: the fallback applies).
  const eurDay = (date, type, f, extra = () => ({})) => ({ date, type, prices: Array.from({ length: 24 }, (_, hour) => ({ hour, eur_mwh: +f(hour).toFixed(2), ...extra(hour) })) });
  const zoneCases = [
    { response: { zone: 'no1', generated: '2026-10-10', trainedThrough: '2026-10-09', unit: 'EUR/MWh',
        zoneInfo: { name: 'NO1 Oslo', country: 'NO', currency: 'NOK', rate: 10.84, rateDate: '2026-10-09', rateSource: 'ecb' },
        days: [
          eurDay('2026-10-09', 'actual', h => 50 + h),
          eurDay('2026-10-10', 'actual', h => 60 + h * 2),
          eurDay('2026-10-11', 'forecast', h => 70 + h, h => ({ min_eur_mwh: +(60 + h).toFixed(2), max_eur_mwh: +(85 + h).toFixed(2) })),
          { date: '2026-10-12', type: 'forecast', prices: eurDay('x', 'f', () => 1).prices.filter(p => p.hour !== 3) },
          { date: '2026-10-13', type: 'forecast', prices: [...eurDay('x', 'f', () => 1).prices.map(p => (p.hour === 5 ? { ...p, eur_mwh: null } : p)), { hour: 24, eur_mwh: 9 }] },
          eurDay('2026-10-14', 'forecast', h => (h % 2 === 0 ? 40 - h : -5 - h), h => (h % 2 === 0 ? { min_eur_mwh: 30, max_eur_mwh: 90 } : { min_eur_mwh: null, max_eur_mwh: null })),
        ] } },
    { response: { zone: 'de', generated: '2026-10-10', trainedThrough: null, unit: 'EUR/MWh',
        zoneInfo: { name: 'DE-LU Germany and Luxembourg', country: 'DE', currency: 'EUR', rate: 1 },
        days: [eurDay('2026-10-10', 'actual', h => (h < 6 ? -12.5 + h : 80 + h * 1.5)), eurDay('2026-10-11', 'actual', h => 100 - h)] } },
    { response: { zone: 'pl', generated: '2026-10-10', trainedThrough: null, unit: 'EUR/MWh',
        zoneInfo: { name: 'PL Poland', country: 'PL', currency: 'PLN' },
        days: [eurDay('2026-10-10', 'actual', h => 90 + h)] } },
  ].map(c => ({ ...c, expect: zn.parseZone(c.response) }));

  const zoneDayCases = [
    { today: '2026-10-10', dates: ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-13'] },
    { today: '2026-10-10', dates: ['2026-10-09', '2026-10-11'] },
    { today: '2026-10-10', dates: ['2026-10-10'] },
    { today: '2026-10-10', dates: ['2026-10-09'] },
  ].map(c => ({ ...c, expect: zn.daysFrom(c.dates.map(date => ({ date })), c.today).map(d => d.date) }));

  const defaultZoneCases = [
    ['DK', 'da'], ['DK', 'en'], ['dk', 'DA'], ['NO', 'nb'], ['SE', 'sv'], ['FI', 'fi'], ['NL', 'nl'], ['DE', 'de'], ['LU', 'fr'], ['LU', 'de'], ['IT', 'it'],
    ['AT', 'de'], ['BE', 'nl'], ['BE', 'fr'], ['CH', 'de'], ['CH', 'fr'], ['CH', 'it'], ['ES', 'es'], ['PT', 'pt'], ['GR', 'el'], ['HR', 'hr'], ['RS', 'sr'],
    ['', 'da'], ['', 'sv'], ['', 'nn'], ['', 'no'], ['GB', 'en'], ['US', 'en'], ['', ''], [null, null], ['JP', 'ja'], ['BR', 'pt'], ['DK', ''], ['de', 'de-AT'], ['', 'pt-PT'], ['', 'SR-Latn'],
  ].map(([region, language]) => ({ region, language, expect: zn.defaultZone(region, language) }));

  return {
    _about: 'Generated by tests/golden/generate.mjs from tests/golden/reference.mjs and index.html. Do not edit by hand. Read by the web test (test-golden.mjs), the Android unit test and the iOS unit test.',
    nets,
    matchCases: matchInputs.map(input => ({ input, expect: ref.matchNet(nets, input) })),
    cheapestWindow: windows,
    verdict: verdicts,
    dayNames,
    forecast: { response: forecastResponse, expect: ref.parseForecast(forecastResponse) },
    co2: { response: co2Response, expect: ref.parseCo2(co2Response) },
    zones: zn.ZONES,
    countries: zn.countries(),
    regionZone: zn.REGION_ZONE,
    languageZone: zn.LANGUAGE_ZONE,
    fallbackZone: zn.FALLBACK_ZONE,
    defaultZone: defaultZoneCases,
    fxFallback: zn.FX_FALLBACK,
    zoneResponses: zoneCases,
    zoneDays: zoneDayCases,
  };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const out = path.join(import.meta.dirname, 'app-contract.json');
  fs.writeFileSync(out, JSON.stringify(build(), null, 2) + '\n');
  console.log('wrote', out);
}
