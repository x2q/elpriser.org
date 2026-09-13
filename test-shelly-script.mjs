#!/usr/bin/env node
/**
 * Runs the Shelly script exactly as /automation generates it, inside a small
 * emulation of the Shelly scripting API with a controllable clock and relay.
 * Run: npm run test:shelly   (offline, no server)
 *
 * The script switches real appliances in people's homes, and one of its jobs
 * is keeping a freezer from being held off by price long enough to spoil food.
 * That is not something to verify by reading the template.
 */
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const a = html.indexOf('const shellyCode=\n`') + 'const shellyCode=\n`'.length;
const b = html.indexOf('`;', a);
// Device placeholders are filled per run below; everything else here.
const code = html.slice(a, b)
  .replace('${shellyName}', 'Elpris DK1 — test')
  .replace('${apiUrl}', 'https://elpriser.org/api/now?area=DK1&strategy=cheapest_n&hours=6');
for (const ph of ['${flexCat}', '${flexLabel}', '${flexRated}', '${flexPhases}', '${flexMaxOff}']) {
  if (!code.includes(ph)) throw new Error(`script template no longer has ${ph}`);
}

function run({ share, category = 'freezer', maxOff = 0, metered = true, priceOn }) {
  let now = 1_700_000_000_000;
  const timers = [], posts = [], sets = [], kvs = {};
  let relay = true;
  const src = code
    .replace('var SHARE_FLEX = false;', `var SHARE_FLEX = ${share};`)
    .replaceAll('${flexCat}', category)
    .replaceAll('${flexLabel}', 'test')
    .replaceAll('${flexRated}', '2200')
    .replaceAll('${flexPhases}', '1')
    .replaceAll('${flexMaxOff}', String(maxOff));
  if (src.includes('${')) throw new Error('uninterpolated template placeholder left in script');
  if (!src.includes(`var SHARE_FLEX = ${share};`)) throw new Error('SHARE_FLEX default changed');
  const Shelly = {
    call(method, params, cb) {
      if (method === 'HTTP.GET') cb({ code: 200, body: JSON.stringify({ on: priceOn(now), price: 1.2, hour: 12, area: 'DK1' }) });
      else if (method === 'Switch.Set') { relay = params.on; sets.push({ t: now, on: params.on }); }
      else if (method === 'HTTP.POST') posts.push({ t: now, body: JSON.parse(params.body), url: params.url });
      else if (method === 'KVS.Get') cb(kvs[params.key] ? { value: kvs[params.key] } : null);
      else if (method === 'KVS.Set') kvs[params.key] = params.value;
    },
    getComponentStatus: () => (metered ? { output: relay, apower: relay ? 95 : 0 } : { output: relay }),
  };
  const ctx = {
    Shelly, print() {}, JSON, Math,
    Date: { now: () => now },
    Timer: { set: (ms, rep, fn) => timers.push({ ms, fn, next: now + ms }) },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const advance = mins => {
    const end = now + mins * 60000;
    while (true) {
      const t = timers.reduce((m, x) => (x.next < m.next ? x : m), { next: Infinity });
      if (t.next > end) break;
      now = t.next; t.next += t.ms; t.fn();
    }
    now = end;
  };
  return { advance, posts, sets, kvs, get relay() { return relay; } };
}

let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };

// 1. Default script shares nothing.
{
  const s = run({ share: false, priceOn: () => false });
  s.advance(120);
  ok(s.posts.length === 0, 'standard: ingen data sendes', `${s.posts.length} posts`);
  ok(Object.keys(s.kvs).length === 0, 'standard: intet id oprettes');
}

// 2. Opted in: payload shape, id persistence, reporting cadence.
{
  const s = run({ share: true, priceOn: () => true });
  s.advance(61);
  ok(s.posts.length >= 4, 'deler: rapporterer ved start og hver 15. min', `${s.posts.length} posts på 61 min`);
  ok(s.posts.length <= 6, 'deler: ikke én rapport pr. minut', `${s.posts.length} posts på 61 min`);
  const p = s.posts[0].body;
  ok(/^[a-f0-9]{32}$/.test(p.id), 'id er 32 hex-tegn', p.id);
  ok(s.posts.every(x => x.body.id === p.id), 'samme id i alle rapporter');
  ok(s.kvs.elpriser_flex_id === p.id, 'id gemt i KVS, overlever genstart');
  ok(p.platform === 'shelly' && p.area === 'DK1' && p.category === 'freezer', 'felter: platform, område, kategori');
  ok(p.measured === true && p.power_w === 95, 'målt effekt sendes', JSON.stringify(p));
  const keys = Object.keys(p).sort().join(',');
  ok(keys === 'area,category,commanded_on,id,max_off_min,measured,on,phases,platform,power_w,rated_w,v',
     'intet ud over de dokumenterede felter', keys);
}

// 3. Relay without metering (3-phase pump on a contactor): power is null, not 0.
{
  const s = run({ share: true, category: 'water_pump', metered: false, priceOn: () => false });
  s.advance(1);
  const p = s.posts[0].body;
  ok(p.power_w === null && p.measured === false, 'umålt relæ: power_w null, ikke 0', JSON.stringify(p));
  ok(p.rated_w === 2200, 'umålt relæ: mærkeeffekt sendes');
}

// 4. Freezer safety guard: price says OFF for 6 hours.
{
  const s = run({ share: false, maxOff: 45, priceOn: () => false });
  s.advance(360);
  let longestOff = 0, offStart = null;
  let t0 = s.sets[0]?.t;
  for (const e of s.sets) {
    if (!e.on && offStart === null) offStart = e.t;
    if (e.on && offStart !== null) { longestOff = Math.max(longestOff, e.t - offStart); offStart = null; }
  }
  ok(longestOff > 0 && longestOff <= 46 * 60000, 'fryser: aldrig slukket over 45 min', `længst slukket ${(longestOff / 60000).toFixed(0)} min`);
  const onMinutes = s.sets.filter(e => e.on).length;
  ok(onMinutes >= 60, 'fryser: får reelle tændte perioder', `${onMinutes} tændte minut-kommandoer på 6 t`);
}

// 5. Guard off (MAX_OFF_MIN = 0) keeps today's behaviour exactly.
{
  const s = run({ share: false, maxOff: 0, priceOn: () => false });
  s.advance(360);
  ok(s.sets.every(e => e.on === false), 'uden grænse: uændret adfærd, følger prisen');
}

// 6. Price ON: guard never interferes.
{
  const s = run({ share: false, maxOff: 45, priceOn: () => true });
  s.advance(180);
  ok(s.sets.every(e => e.on === true), 'pris siger tænd: grænsen blander sig ikke');
}

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
