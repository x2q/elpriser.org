#!/usr/bin/env node
/**
 * The anonymous usage counts (functions/_usage.js): which callers are recognised, what is written,
 * and — more important than either — what is never written. Offline.
 * Run: node test-usage.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { usageClient, recordUsage } from './functions/_usage.js';

const req = (url, ua) => new Request(url, { headers: ua == null ? {} : { 'user-agent': ua } });
const sink = () => { const points = []; return { points, env: { USAGE: { writeDataPoint: p => points.push(p) } } }; };
const always = () => 0;   // passes the 1-in-5 sampling

test('apps are recognised by User-Agent, with version and build', () => {
  const q = new URLSearchParams();
  assert.deepEqual(usageClient(req('https://elpriser.org/api/forecast', 'ElpriserAndroid/1.0.3 (4) (+https://elpriser.org)'), q), { client: 'android', version: '1.0.3 (4)', host: '' });
  assert.deepEqual(usageClient(req('https://elpriser.org/api/forecast', 'ElpriserIOS/1.0.5 (7) (+https://elpriser.org)'), q), { client: 'ios', version: '1.0.5 (7)', host: '' });
  // The previous fixed User-Agent still counts, as 1.0.
  assert.deepEqual(usageClient(req('https://elpriser.org/api/forecast', 'ElpriserIOS/1.0 (+https://elpriser.org)'), q), { client: 'ios', version: '1.0', host: '' });
});

test('Shelly and Home Assistant: platform version from the User-Agent, script version from ?client=', () => {
  assert.deepEqual(usageClient(req('https://elpriser.org/api/now', 'Shelly/1.4.4'), new URLSearchParams()), { client: 'shelly', version: '', host: '1.4.4' });
  assert.deepEqual(usageClient(req('https://elpriser.org/api/schedule', 'Shelly/1.4.4'), new URLSearchParams('client=shelly-script-2')), { client: 'shelly', version: 'script 2', host: '1.4.4' });
  assert.deepEqual(usageClient(req('https://elpriser.org/api/schedule', 'HomeAssistant/2026.10.2 aiohttp/3.9'), new URLSearchParams('client=ha-plan-2')), { client: 'homeassistant', version: 'script 2', host: '2026.10.2' });
});

test('browsers, bots and unknown clients are not recorded; junk in ?client= is ignored', () => {
  const { points, env } = sink();
  for (const ua of ['Mozilla/5.0 (Macintosh) Chrome/130', 'curl/8.4', 'Googlebot/2.1', null])
    assert.equal(recordUsage(env, req('https://elpriser.org/api/schedule?area=DK1', ua), 200, always), false);
  assert.equal(recordUsage(env, req('https://elpriser.org/api/schedule?client=shelly-script-2', 'Mozilla/5.0'), 200, always), true);   // our own script tag is enough
  assert.equal(usageClient(req('https://x/api/now', 'curl/8'), new URLSearchParams('client=<script>')), null);
  assert.equal(points.length, 1);
});

test('what is written: client, version, host, endpoint, area, strategy, status — and nothing else', () => {
  const { points, env } = sink();
  const request = new Request('https://elpriser.org/api/schedule?area=DK2&strategy=cheapest_n&hours=6&gln=5790000705184&client=shelly-script-2',
    { headers: { 'user-agent': 'Shelly/1.4.4', 'cf-connecting-ip': '203.0.113.9' } });
  assert.equal(recordUsage(env, request, 200, always), true);
  assert.deepEqual(points[0], { indexes: ['shelly'], blobs: ['shelly', 'script 2', '1.4.4', 'schedule', 'DK2', 'cheapest_n', '2xx'], doubles: [1] });
  const written = JSON.stringify(points);
  for (const never of ['203.0.113.9', '5790000705184', 'gln']) assert.ok(!written.includes(never), `${never} must not be stored`);
});

test('/api/now from Shelly and Home Assistant is sampled 1 in 5 and weighted; apps are not sampled', () => {
  const { points, env } = sink();
  assert.equal(recordUsage(env, req('https://elpriser.org/api/now?area=DK1', 'Shelly/1.4.4'), 200, () => 0.5), false);
  assert.equal(recordUsage(env, req('https://elpriser.org/api/now?area=DK1', 'Shelly/1.4.4'), 200, () => 0.1), true);
  assert.equal(points[0].doubles[0], 5);
  assert.equal(recordUsage(env, req('https://elpriser.org/api/forecast?area=DK1', 'ElpriserIOS/1.0.5 (7)'), 200, () => 0.99), true);
  assert.equal(points[1].doubles[0], 1);
});

test('status classes, odd values and a missing binding', () => {
  const { points, env } = sink();
  recordUsage(env, req('https://elpriser.org/api/schedule?area=DK9&strategy=DROP%20TABLE', 'Shelly/1.4.4'), 503, always);
  assert.deepEqual(points[0].blobs, ['shelly', '', '1.4.4', 'schedule', '', 'other', '5xx']);
  assert.equal(recordUsage({}, req('https://elpriser.org/api/forecast', 'ElpriserIOS/1.0.5 (7)'), 200, always), false);   // local server / tests: no binding
  assert.equal(recordUsage({ USAGE: { writeDataPoint() { throw new Error('boom'); } } }, req('https://elpriser.org/api/forecast', 'ElpriserIOS/1.0.5 (7)'), 200, always), false);   // never breaks the response
});

test('a 400 carries one fixed reason word, derived from the shape of the query — never its values', () => {
  const { points, env } = sink();
  const ha = u => recordUsage(env, req(u, 'HomeAssistant/2026.8.3'), 400, always);
  ha('https://elpriser.org/api/prices?area=DK1&mode=net_inkl_alt');
  ha('https://elpriser.org/api/prices?area=DK1&mode=net_inkl_alt&gln=123');
  ha('https://elpriser.org/api/prices?area=NO1');
  ha('https://elpriser.org/api/prices?area=DK1&date=15-01-2025');
  ha('https://elpriser.org/api/prices?area=DK1&start=2025-01-01');
  ha('https://elpriser.org/api/prices?area=DK1&mode=bogus');
  assert.deepEqual(points.map(p => p.blobs[7]), ['gln_missing', 'gln_invalid', 'area_invalid', 'date_invalid', 'range_incomplete', 'other']);
  const written = JSON.stringify(points);
  for (const never of ['123', 'NO1', '15-01-2025', '2025-01-01'])   // the mode word itself is already stored as 'strategy' (a short a-z word), as before
    assert.ok(!written.includes(never), `${never} must not be stored`);
  recordUsage(env, req('https://elpriser.org/api/prices?area=DK1&mode=inkl_alt', 'HomeAssistant/2026.8.3'), 200, always);
  assert.equal(points[6].blobs.length, 7, 'only a 400 has a reason');
});

test('the clients send what the server recognises', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('&client=shelly-script-2"'), 'Shelly script no longer tags its version');
  assert.ok(html.includes('&client=ha-plan-2"'), 'Home Assistant YAML no longer tags its version');
  assert.match(fs.readFileSync(new URL('./ElpriserAndroid/app/src/main/java/org/elpriser/app/data/Api.kt', import.meta.url), 'utf8'), /ElpriserAndroid\/\$\{BuildConfig\.VERSION_NAME\} \(\$\{BuildConfig\.VERSION_CODE\}\)/);
  assert.match(fs.readFileSync(new URL('./ElpriserIOS/Sources/Api.swift', import.meta.url), 'utf8'), /ElpriserIOS\/\\\(version\) \(\\\(build\)\)/);
  assert.match(fs.readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8'), /binding = "USAGE"/);
});
