#!/usr/bin/env node
/**
 * Tell IndexNow — Bing, Yandex, Seznam, Naver, Yep — which elpriser.org URLs
 * have changed, so they are recrawled now rather than whenever. Bing matters
 * beyond Bing: ChatGPT's web search draws largely on its index.
 *
 *   npm run indexnow                 whole sitemap, at most once per 20 hours
 *   npm run indexnow -- --force      ignore the daily guard
 *   node scripts/indexnow.mjs URL…   just these URLs (no guard)
 *
 * `npm run deploy` runs it after every successful deploy, and the guard is
 * what keeps that honest: deploys happen many times a day, and IndexNow asks
 * for changed URLs, not a resubmission of the same forty on every push. Once
 * a day matches the site: most of its pages carry new prices daily.
 *
 * It never fails a deploy — errors are reported and the exit code is left
 * to the caller, which in package.json ignores it.
 */
import fs from 'node:fs';

const HOST = 'elpriser.org';
const KEY = 'ede0d7c16ca973f60282b7079da12804';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const STATE = new URL('../.indexnow-state.json', import.meta.url);
const GUARD_HOURS = 20;

const args = process.argv.slice(2);
const force = args.includes('--force');
const explicit = args.filter(a => !a.startsWith('--'));

async function main() {
  let urls;
  if (explicit.length) {
    urls = explicit;
  } else {
    const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null;
    const ageH = state ? (Date.now() - Date.parse(state.at)) / 3.6e6 : Infinity;
    if (!force && ageH < GUARD_HOURS) {
      console.log(`indexnow: skipped — last submitted ${ageH.toFixed(1)} h ago (${state.count} URLs, HTTP ${state.status}). --force to override.`);
      return 0;
    }
    const xml = await (await fetch(`https://${HOST}/sitemap.xml`)).text();
    urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  }
  const foreign = urls.filter(u => new URL(u).host !== HOST);
  if (foreign.length) throw new Error(`not on ${HOST}: ${foreign.join(', ')}`);
  if (!urls.length) throw new Error('no URLs to submit');

  // IndexNow fetches the key file to verify ownership. Checking it first turns
  // a confusing 403 — e.g. right after a deploy that has not propagated —
  // into a clear message.
  const served = (await (await fetch(KEY_LOCATION)).text()).trim();
  if (served !== KEY) throw new Error(`${KEY_LOCATION} does not serve the key (got "${served.slice(0, 40)}")`);

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: urls }),
  });
  const meaning = { 200: 'accepted', 202: 'accepted, key validation pending', 400: 'bad request',
                    403: 'key not valid for this host', 422: 'URLs do not match the host or key',
                    429: 'too many requests' }[res.status] || 'unexpected';
  console.log(`indexnow: HTTP ${res.status} (${meaning}) — ${urls.length} URL(s)`);
  if (!explicit.length && (res.status === 200 || res.status === 202)) {
    fs.writeFileSync(STATE, JSON.stringify({ at: new Date().toISOString(), count: urls.length, status: res.status }, null, 1));
  }
  return res.status === 200 || res.status === 202 ? 0 : 1;
}

main().then(code => process.exit(code), e => { console.error('indexnow:', e.message || e); process.exit(1); });
