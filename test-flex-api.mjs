#!/usr/bin/env node
/**
 * Exercises /api/flex/* end to end: valid reports, every rejection, the
 * down/up capacity arithmetic, that the summary never exposes a device id, and
 * that forget removes a device.
 * Run: BASE=http://localhost:8788 TOKEN=localtest npm run test:flex
 *      BASE=https://elpriser.org TOKEN=<FLEX_ADMIN_TOKEN> npm run test:flex
 *
 * Writes three test devices and deletes them again before exiting. It counts
 * capacity across the whole database, so run it against production only when
 * no real devices are reporting — otherwise their load is in the totals.
 */
const BASE = process.env.BASE || 'http://localhost:8788';
const TOKEN = process.env.TOKEN || 'localtest';
let pass = 0; const fails = [];
const ok = (c, name, d) => { if (c) pass++; else fails.push(`${name}${d ? ' — ' + d : ''}`); };

const post = (path, body, raw) => fetch(BASE + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'flextest' },
  body: raw ?? JSON.stringify(body),
});
const id = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

const freezer = id(), pump = id(), ha = id();
const base = { v: 1, platform: 'shelly', area: 'DK1' };

// Valid reports: a metered freezer that is on, a 3-phase pump on a contactor
// (no metering, declared rating) held off by price, and an HA device.
let r = await post('/api/flex/report', { ...base, id: freezer, category: 'freezer', on: true, commanded_on: true, power_w: 92.5, measured: true, rated_w: 120, max_off_min: 45, phases: 1 });
ok(r.status === 204, 'rapport: fryser', `status ${r.status} ${await r.text()}`);
r = await post('/api/flex/report', { ...base, id: pump, category: 'water_pump', on: false, commanded_on: false, power_w: null, measured: false, rated_w: 2200, phases: 3 });
ok(r.status === 204, 'rapport: 3-faset pumpe via kontaktor', `status ${r.status} ${await r.text()}`);
r = await post('/api/flex/report', { ...base, id: ha, platform: 'homeassistant', category: 'water_heater', area: 'DK2', on: true, commanded_on: true, power_w: 2950, measured: true });
ok(r.status === 204, 'rapport: HA vandvarmer', `status ${r.status} ${await r.text()}`);

// Repeat within the same 15-minute slot must replace, not add a row.
r = await post('/api/flex/report', { ...base, id: freezer, category: 'freezer', on: true, commanded_on: true, power_w: 101, measured: true, rated_w: 120, max_off_min: 45 });
ok(r.status === 204, 'rapport: gentagelse i samme slot');

// Rejections.
const reject = async (name, body, want, raw) => {
  const x = await post('/api/flex/report', body, raw);
  const t = await x.text();
  ok(x.status === want, `afvist: ${name}`, `status ${x.status} ${t}`);
  return t;
};
let t = await reject('id med MAC-lignende tegn', { ...base, id: 'AA:BB:CC:DD:EE:FF', category: 'water_pump', on: true }, 400);
ok(/id/.test(t), 'fejlbesked nævner id', t);
t = await reject('ukendt kategori', { ...base, id: id(), category: 'jacuzzi', on: true }, 400);
ok(/category/.test(t), 'fejlbesked nævner category', t);
// Appliances that must not be regulated are refused, and told why.
for (const [cat, why] of [['drain_pump', /flood/], ['medical', /medical/], ['cycle_appliance', /mid-cycle/], ['it_equipment', /outage/]]) {
  const x = await post('/api/flex/report', { ...base, id: id(), category: cat, on: true });
  const txt = await x.text();
  ok(x.status === 422, `uegnet apparat afvist: ${cat}`, `status ${x.status} ${txt}`);
  ok(why.test(txt), `afvisningen forklarer hvorfor: ${cat}`, txt);
}
await reject('ukendt område', { ...base, id: id(), category: 'water_pump', area: 'SE3', on: true }, 400);
await reject('negativ effekt', { ...base, id: id(), category: 'water_pump', on: true, power_w: -5, measured: true }, 400);
await reject('absurd effekt', { ...base, id: id(), category: 'water_pump', on: true, power_w: 5e9, measured: true }, 400);
await reject('on som streng', { ...base, id: id(), category: 'water_pump', on: 'true' }, 400);
await reject('ikke JSON', null, 400, 'on=true');
await reject('for stor body', null, 413, JSON.stringify({ ...base, id: id(), category: 'water_pump', on: true, pad: 'x'.repeat(4000) }));

// Wrong method / unknown path.
r = await fetch(BASE + '/api/flex/report', { headers: { 'User-Agent': 'flextest' } });
ok(r.status === 404, 'GET på report giver 404', `status ${r.status}`);

// Summary is private.
r = await fetch(BASE + '/api/flex/summary', { headers: { 'User-Agent': 'flextest' } });
ok(r.status === 401, 'summary uden token giver 401', `status ${r.status}`);
r = await fetch(BASE + '/api/flex/summary', { headers: { Authorization: 'Bearer forkert', 'User-Agent': 'flextest' } });
ok(r.status === 401, 'summary med forkert token giver 401', `status ${r.status}`);

r = await fetch(BASE + '/api/flex/summary', { headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'flextest' } });
ok(r.status === 200, 'summary med token', `status ${r.status}`);
const s = await r.json();
const body = JSON.stringify(s);
// Aggregates only: no device id may appear anywhere in the response.
ok(![freezer, pump, ha].some(x => body.includes(x)), 'summary indeholder ingen enheds-id');
// Freezer on at 101 W (the replaced value, not 92.5+101) + water heater 2950 W on.
const down = s.now.by_area_category.reduce((a, x) => a + x.down_w, 0);
const up = s.now.by_area_category.reduce((a, x) => a + x.up_w, 0);
ok(Math.abs(down - 3051) < 0.01, 'down_w = målt effekt af tændte enheder', `down_w ${down}, forventet 3051`);
// Pump held off by price, not metered: its 2200 W rating is the up flex.
ok(Math.abs(up - 2200) < 0.01, 'up_w = mærkeeffekt af enheder holdt slukket', `up_w ${up}, forventet 2200`);
ok(s.now.devices === 3, 'tre enheder, gentagelse ikke talt dobbelt', `devices ${s.now.devices}`);

// Forget removes a device entirely.
r = await post('/api/flex/forget', { id: freezer });
ok(r.status === 204, 'forget', `status ${r.status}`);
r = await fetch(BASE + '/api/flex/summary', { headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'flextest' } });
const s2 = await r.json();
ok(s2.now.devices === 2, 'efter forget: to enheder', `devices ${s2.now.devices}`);
ok(Math.abs(s2.now.by_area_category.reduce((a, x) => a + x.down_w, 0) - 2950) < 0.01, 'efter forget: fryserens effekt er væk');

// Clean up the rest so a production run leaves nothing behind.
await post('/api/flex/forget', { id: pump });
await post('/api/flex/forget', { id: ha });

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
