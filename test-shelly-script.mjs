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
  .replace('${scheduleUrl}', 'https://elpriser.org/api/schedule?area=DK1&strategy=cheapest_n&hours=6');
for (const ph of ['${flexCat}', '${flexLabel}', '${flexRated}', '${flexPhases}', '${flexMaxOff}']) {
  if (!code.includes(ph)) throw new Error(`script template no longer has ${ph}`);
}

// Planen: priceOn(t) svarer for tidspunktet t (ms) — scriptet henter hele døgnets 24 timer på én gang.
// `startMs` er enhedens ur ved start; `kvsInit` er det, der ligger i enhedens KVS; `failHttp(n)` får
// hentning nr. n (0-baseret) til at fejle.
function run({ share, category = 'freezer', maxOff = 0, metered = true, priceOn, startMs = 1_700_000_000_000, kvsInit = {}, failHttp = () => false, noClock = false }) {
  let now = startMs;
  const timers = [], posts = [], sets = [], kvs = { ...kvsInit }, gets = [];
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
      if (method === 'HTTP.GET') {
        gets.push(now);
        if (failHttp(gets.length - 1)) return cb(null, 'timeout');
        const day0 = Math.floor(now / 86_400_000) * 86_400_000;
        const schedule = Array.from({ length: 24 }, (_, h) => ({ hour: h, price: 1.2, on: priceOn(day0 + h * 3_600_000) }));
        const hNow = Math.floor((now - day0) / 3_600_000);
        cb({ code: 200, body: JSON.stringify({ area: 'DK1', date: new Date(day0).toISOString().slice(0, 10), on_now: schedule[hNow].on, schedule }) });
      }
      else if (method === 'Switch.Set') { relay = params.on; sets.push({ t: now, on: params.on }); }
      else if (method === 'HTTP.POST') posts.push({ t: now, body: JSON.parse(params.body), url: params.url });
      else if (method === 'KVS.Get') cb(kvs[params.key] ? { value: kvs[params.key] } : null);
      else if (method === 'KVS.Set') kvs[params.key] = params.value;
    },
    getComponentStatus: (comp) => {
      if (comp === 'sys') {
        if (noClock) return { time: null };
        const d = new Date(now);
        return { time: String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') };
      }
      return metered ? { output: relay, apower: relay ? 95 : 0 } : { output: relay };
    },
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
  return { advance, posts, sets, kvs, gets, get relay() { return relay; }, get now() { return now; } };
}

let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };

// 1. Default script shares nothing.
{
  const s = run({ share: false, priceOn: () => false });
  s.advance(120);
  ok(s.posts.length === 0, 'standard: ingen data sendes', `${s.posts.length} posts`);
  ok(s.kvs.elpriser_flex_id === undefined, 'standard: intet enheds-id oprettes');
  ok(Object.keys(s.kvs).every(k => k === 'elpriser_plan'), 'standard: kun planen gemmes', Object.keys(s.kvs).join(','));
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
  // Tændt TID, ikke antal kommandoer: scriptet tjekker hvert 5. minut, så en tændt periode består af
  // flere kommandoer, og antallet siger intet om, hvor længe frysen faktisk har haft strøm.
  let onMs = 0, last = null;
  for (const e of s.sets) {
    if (last && last.on) onMs += e.t - last.t;
    last = e;
  }
  if (last && last.on) onMs += s.now - last.t;
  ok(onMs >= 60 * 60000, 'fryser: får reelle tændte perioder', `${(onMs / 60000).toFixed(0)} tændte minutter på 6 t`);
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

// 7. Plan once, decide locally: the network is only touched about once a day.
{
  const s = run({ share: false, priceOn: t => Math.floor(t / 3_600_000) % 24 < 12 });
  s.advance(48 * 60);
  ok(s.gets.length >= 2 && s.gets.length <= 4, 'plan: ca. ét kald i døgnet (højst 4 på 48 t)', `${s.gets.length} kald på 48 t`);
  // The relay follows the hourly plan: on for hours 0-11 (UTC here), off for 12-23.
  const wrong = s.sets.filter(e => (Math.floor(e.t / 3_600_000) % 24 < 12) !== e.on);
  ok(wrong.length <= 3, 'plan: relæet følger timeplanen', `${wrong.length} kommandoer afveg`);
}

// 8. A reboot restores the saved plan instead of asking again.
{
  const first = run({ share: false, priceOn: t => Math.floor(t / 3_600_000) % 24 < 12 });
  first.advance(5);
  const saved = first.kvs.elpriser_plan;
  ok(typeof saved === 'string' && /^\d+\|[01]{24}$/.test(saved), 'plan: gemmes i KVS som "<ms>|24 tegn"', String(saved));
  ok(saved.length < 64, 'plan: får plads i KVS-værdien');
  const second = run({ share: false, priceOn: () => false, startMs: first.now, kvsInit: { elpriser_plan: saved } });
  second.advance(30);
  ok(second.gets.length === 0, 'genstart: bruger den gemte plan, spørger ikke igen', `${second.gets.length} kald`);
  ok(second.sets.length > 0, 'genstart: styrer straks efter planen');
}

// 9. A new day (the clock wraps past midnight) fetches a fresh plan.
{
  const day = 86_400_000;
  const s = run({ share: false, priceOn: () => true, startMs: Math.floor(1_700_000_000_000 / day) * day + 20 * 3_600_000 });
  s.advance(30);
  const before = s.gets.length;
  s.advance(5 * 60);   // over midnat
  ok(s.gets.length > before, 'ny dag: henter en ny plan efter midnat', `${before} -> ${s.gets.length}`);
}

// 10. API failure: the saved plan keeps working, and retries are spaced out.
{
  const s = run({ share: false, priceOn: () => true, failHttp: n => n >= 1 });
  s.advance(60);                         // first plan succeeds
  s.advance(24 * 60 + 60);               // plan goes stale, every refetch fails
  ok(s.sets.length > 0 && s.sets.every(e => e.on === true), 'fejl: den gemte plan bruges videre');
  ok(s.gets.length <= 1 + (24 * 60 + 60) / 5 + 1, 'fejl: genforsøg med afstand, ikke hvert minut', `${s.gets.length} kald`);
}

// 11. No clock on the device yet: falls back to asking every quarter of an hour.
{
  const s = run({ share: false, priceOn: () => true, noClock: true });
  s.advance(120);
  ok(s.gets.length >= 6 && s.gets.length <= 10, 'uden ur: spørger hvert kvarter', `${s.gets.length} kald på 2 t`);
}

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
