#!/usr/bin/env node
/**
 * The app page in 26 languages (/download and /<lang>/download) and "Hent appen" on every localized page.
 * Run: node test-download-i18n.mjs   (hermetic: the real Pages Function, index.html, the files in download/img; no network)
 *
 * What this guards:
 *  - the TABLE (functions/_download_i18n.js): every language has every key, no empty value, the same placeholders, headings in two parts,
 *    title <= 60 and description <= 155 characters, no untranslated Danish or English left over (except product names);
 *  - the LANGUAGES: the same 26 as i18n/languages.json, one page each, one URL scheme (/download, /<code>/download);
 *  - each PAGE: 200, one h1 in the language, <html lang>, canonical to itself, the whole hreflang set (and x-default = English), og:locale,
 *    JSON-LD inLanguage, in the sitemap with the same alternates, in llms.txt;
 *  - ONE status table: every page's cards, chips and store links follow APPS and FACTS in functions/_download.js, in every language;
 *  - TRUTH: only live products have a store link, no claim about open models, no number the apps do not show, no emoji;
 *  - IMAGES: every file a page names exists, is WebP, is under 120 KB, has the size the markup says, only the hero is eager, the first load
 *    stays under 250 KB; a language without its own capture says so in the manifest;
 *  - WITHOUT JAVASCRIPT the page is complete (nothing hidden by default);
 *  - "HENT APPEN": every country page has the button in the header and the pill in the footer, in its language, to a page that exists;
 *    every app page has them too; the words match between CHROME_I18N and the text table.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = import.meta.dirname;
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ROUTES = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
// A fake edge for the country pages (they ask the cache and the feed): no cache, and a feed that is down — the chrome does not need either.
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async () => new Response('{}', { status: 503 });
const { onRequest } = await import(pathToFileURL(path.join(ROOT, 'functions/[[path]].js')).href);
const D = await import(pathToFileURL(path.join(ROOT, 'functions/_download.js')).href);
const { DL_TEXT } = await import(pathToFileURL(path.join(ROOT, 'functions/_download_i18n.js')).href);
const { DL_IMG } = await import(pathToFileURL(path.join(ROOT, 'functions/_download_img.js')).href);

let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };

const get = async p => {
  const res = await onRequest({ request: new Request('https://elpriser.org' + p), env: { ASSETS: { fetch: async () => new Response(INDEX, { headers: { 'content-type': 'text/html' } }) } } });
  const body = await res.text();
  const main = (body.match(/<main[^>]*data-page="download"[\s\S]*?<\/main>/) || [''])[0];
  return { status: res.status, body, main, head: body.slice(0, body.indexOf('</head>')), text: main.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&rarr;/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ') };
};
// The Pris block of the real file (CHROME_I18N, PRIS_COUNTRIES, DL_CODES, dlCode, dlHref) in a sandbox.
const PB = (() => {
  const a = ROUTES.indexOf('// ═══ Pris-skærmen (Design A: ét svar) ═══'), b = ROUTES.indexOf('// ═══ /Pris-skærmen ═══');
  const ctx = vm.createContext({ console, Date, Math });
  vm.runInContext(ROUTES.slice(a, b) + '\nglobalThis.out = { CHROME_I18N, PRIS_COUNTRIES, DL_CODES, dlCode, dlHref };', ctx);
  return ctx.out;
})();

const CODES = D.DL_LANGS.map(l => l.code);
const NON_DA = CODES.filter(c => c !== 'da');

// ── Languages ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/languages.json'), 'utf8')).languages.filter(l => l.ship).map(l => l.code);
  const mine = CODES.map(c => c);
  ok(shipped.length === 26 && mine.length === 26 && new Set(mine).size === 26, 'languages: 26, once each');
  ok(shipped.join() === mine.join(), 'languages: the same ones, in the same order, as i18n/languages.json (the apps)', `${shipped.join()} | ${mine.join()}`);
  ok(D.FACTS.langs === shipped.length, `facts: ${D.FACTS.langs} languages is the number the apps ship (${shipped.length})`);
  ok(Object.keys(DL_TEXT).join() === mine.join(), 'table: one entry per language, no extra');
  ok(D.dlPath('da') === '/download' && D.dlPath('de') === '/de/download' && D.dlLangOfPath('/nb/download') === 'nb' && D.dlLangOfPath('/xx/download') === null && D.dlLangOfPath('/da/download') === null && D.dlLangOfPath('/download') === 'da', 'URLs: /download for Danish, /<code>/download for the rest, /da/download is not a page');
  ok(PB.DL_CODES.join() === NON_DA.join(), 'Pris block: DL_CODES is the list of languages with an app page (what the client and the footers use)');
  ok(D.DL_LANGS.every(l => /^[a-z]{2}$/.test(l.code) && l.name && l.html && /^[a-z]{2}_[A-Z]{2}$/.test(l.loc)), 'languages: code, name, html lang and locale are filled');
  ok(D.DL_LANGS.every(l => l.chrome === null ? l.code === 'da' : PB.CHROME_I18N[l.chrome]), 'languages: every one has the words of the header and footer (CHROME_I18N) it names');
}

// ── The table ────────────────────────────────────────────────────────────────────────────────────────────────────────
const KEYS = k => Object.keys(DL_TEXT[k]);
const COMMON_AND_X = KEYS('en');
const DA_ONLY = ['altIosNow', 'altIosDark', 'altAndNow', 'altAndDark', 'priceK', 'priceH', 'priceP', 'altPrice', 'daysK', 'daysH', 'daysP', 'altDays', 'netK', 'netH', 'netP', 'altWelcome', 'altNetList', 'euBig', 'wShelly', 'wApi', 'wAll', 'noteHtml'];
const X_ONLY = ['altHero1', 'altHero2', 'altCountry', 'dkK', 'dkH', 'dkP', 'note', 'langsLabel'];
{
  const common = COMMON_AND_X.filter(k => !X_ONLY.includes(k));
  ok(DA_ONLY.every(k => k in DL_TEXT.da && !(k in DL_TEXT.en)) && X_ONLY.every(k => k in DL_TEXT.en && !(k in DL_TEXT.da)), 'table: the keys of the Danish page alone and of the other languages alone are where they belong');
  ok(common.every(k => k in DL_TEXT.da), 'table: Danish has every shared key', common.filter(k => !(k in DL_TEXT.da)).join());
  ok(Object.keys(DL_TEXT.da).every(k => common.includes(k) || DA_ONLY.includes(k)), 'table: Danish has nothing unexplained');
  for (const c of NON_DA) {
    const miss = COMMON_AND_X.filter(k => !(k in DL_TEXT[c])), extra = KEYS(c).filter(k => !COMMON_AND_X.includes(k));
    ok(!miss.length && !extra.length, `${c}: every key, no extra`, `missing ${miss} extra ${extra}`);
  }
  const TOK = /\{(\w+)\}/g, KNOWN = new Set(['ios', 'android', 'mac', 'n', 'langs', 'langs1', 'countries', 'countries1']);
  const flat = v => (Array.isArray(v) ? v : [v]);
  for (const c of CODES) {
    const t = DL_TEXT[c];
    for (const [k, v] of Object.entries(t)) {
      const arr = flat(v);
      ok(arr.length > 0 && arr.every(s => typeof s === 'string' && s.trim().length > 0), `${c}.${k}: not empty`);
      if (/H$/.test(k) && k !== 'euH' || k === 'euH') ok(Array.isArray(v) && v.length === 2, `${c}.${k}: a heading is [lead, bold part]`);
      if (/^(b[A-Z]\w+|w[A-Z]\w+)$/.test(k) && k !== 'wShelly') ok(Array.isArray(v) && v.length === 2, `${c}.${k}: [title, text]`);
      for (const s of arr) {
        for (const m of String(s).matchAll(TOK)) ok(KNOWN.has(m[1]), `${c}.${k}: unknown token {${m[1]}}`);
        ok(!/[<>]/.test(s) || k === 'noteHtml', `${c}.${k}: no markup in a translation`);
        ok(!/\p{Extended_Pictographic}/u.test(s), `${c}.${k}: no emoji`);
      }
    }
    ok(t.metaTitle.length <= 60 && t.metaTitle.length >= 15 || c === 'da' && t.metaTitle.length <= 62, `${c}: metaTitle <= 60 characters`, String(t.metaTitle.length));
    ok(t.metaDesc.length <= 155 && t.metaDesc.length >= 80, `${c}: metaDesc 80-155 characters`, String(t.metaDesc.length));
    for (const k of ['chipLive', 'chipSoon', 'chipPlanned', 'chipNext']) ok(t[k].length <= 26, `${c}.${k}: a chip is short`, t[k]);
    ok(t.getApp.length <= 28 && t.getApp.split(/\s+/).length <= 4, `${c}.getApp: a short button label`, t.getApp);
    ok(/\{ios\}/.test(t.req) && /\{android\}/.test(t.req), `${c}.req: says both minimum systems`);
    ok(/\{n\}/.test(t.osIos) && /\{n\}/.test(t.osIpad) && /\{n\}/.test(t.osAndroid) && /\{n\}/.test(t.osMac), `${c}: the minimum systems are filled from the facts`);
    ok(/\{langs\}/.test(t.bLangs[0]) && /\{langs1\}/.test(t.bLangs[1]), `${c}.bLangs: language counts are filled from the facts, never typed`);
    ok(!/\d/.test(JSON.stringify([t.cIphone, t.cAndroidPhone, t.cMac, t.cWatch, t.cReminders, t.cWidget]).replace(/\{\w+\}/g, '')) || /^(da|en)$/.test(c) || /[25]/.test(t.cIphone), `${c}: the cards carry no number the apps do not show`);
  }
  // Nothing is left in another language: a value equal to the Danish or the English one is a translation that was never made, unless it is a product name.
  const SAME_OK = new Set(['nIphone', 'nIpad', 'nMac', 'nWatch', 'nWidget', 'wHA', 'wMcp', 'wShelly', 'wAll', 'osIos', 'osIpad', 'osAndroid', 'osMac', 'h1', 'metaTitle', 'euK', 'nAndroidPhone', 'nAndroidTablet']);   // Europa, Android-telefon, Android tablet: the same word in the neighbouring language
  for (const c of NON_DA) {
    const t = DL_TEXT[c];
    for (const k of Object.keys(t)) {
      const same = JSON.stringify(t[k]) === JSON.stringify(DL_TEXT.en[k]);
      if (c === 'en') continue;
      ok(!same || SAME_OK.has(k), `${c}.${k}: identical to the English — not translated`, JSON.stringify(t[k]).slice(0, 60));
      // Norwegian and Swedish share many whole phrases with Danish ("Kommer snart", "Enkelt, som det skal være."): only the other languages are held to it
      ok(JSON.stringify(t[k]) !== JSON.stringify(DL_TEXT.da[k]) || !(k in DL_TEXT.da) || SAME_OK.has(k) || ['nb', 'sv'].includes(c), `${c}.${k}: identical to the Danish`);
    }
    // proper nouns stay: the stores, the platforms and the integrations are named the way their owners name them
    ok(/App Store/.test(t.appleLabel) && /Google Play/.test(t.playLabel) && /iPhone/.test(t.eyebrow) && /Android/.test(t.eyebrow), `${c}: App Store, Google Play, iPhone and Android are named as they are`);
    const DANISH = /\b(netselskab|netselskabet|elprisen|døgn|uden konto|uden reklamer|Hent appen|prisen lige nu)\b/i;
    if (c !== 'en') ok(!DANISH.test(JSON.stringify(t)), `${c}: no Danish word left`, (JSON.stringify(t).match(DANISH) || [])[0]);
  }
  // Both ends of the word "Hent appen": the header and footer words (CHROME_I18N.app) and the page's own text are the same thing.
  for (const l of D.DL_LANGS.filter(x => x.chrome)) ok(PB.CHROME_I18N[l.chrome].app === DL_TEXT[l.code].getApp, `${l.code}: "Hent appen" is the same words in the chrome and in the text table`, `${PB.CHROME_I18N[l.chrome].app} | ${DL_TEXT[l.code].getApp}`);
  ok(Object.keys(PB.CHROME_I18N).every(k => typeof PB.CHROME_I18N[k].app === 'string' && PB.CHROME_I18N[k].app.length > 3), 'CHROME_I18N: every language of the country pages has `app`');
  ok(Object.values(PB.PRIS_COUNTRIES).every(C => D.DL_LANGS.some(l => l.code === PB.dlCode(C.lang)) && PB.dlHref(C.lang).split('/')[1] === PB.dlCode(C.lang)), 'every country page language maps to an app page (English where there is none)');
  ok(PB.dlCode('sr-Latn') === 'sr' && PB.dlCode('sr-ME') === 'sr' && PB.dlCode('nb') === 'nb' && PB.dlCode('xx') === 'en', 'the language tags of the country pages map to their codes (Serbian, Montenegrin → sr; unknown → en)');
}

// ── Pages ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const sitemap = await get('/sitemap.xml');
const llms = (await get('/llms.txt')).body;
const U = c => 'https://elpriser.org' + D.dlPath(c);
const STAT = { live: 'chipLive', soon: 'chipSoon', planned: 'chipPlanned', next: 'chipNext' };
const CARDS = [['iphone', 'nIphone'], ['ipad', 'nIpad'], ['androidPhone', 'nAndroidPhone'], ['androidTablet', 'nAndroidTablet'], ['mac', 'nMac'], ['watch', 'nWatch'], ['reminders', 'nReminders'], ['widget', 'nWidget']];
const dims = f => { // width and height of a lossy WebP (VP8 chunk)
  const b = fs.readFileSync(f);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  if (b.toString('ascii', 12, 16) === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (b.toString('ascii', 12, 16) === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
  return null;
};
const seenImages = new Set();
let totalBytes = 0;

for (const c of CODES) {
  const L = D.DL_LANGS.find(l => l.code === c), t = DL_TEXT[c], p = D.dlPath(c);
  const r = await get(p);
  ok(r.status === 200 && r.main, `${p}: 200 with the app section`, String(r.status));
  const { head, body, main, text } = r;
  ok((body.match(/<h1\b/g) || []).length === 1 && new RegExp(`<h1 class="page-title">${t.h1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`).test(body), `${p}: one h1, the language's own`);
  ok(new RegExp(`^<html lang="${L.html}"`, 'm').test(body.slice(body.indexOf('<html'))) , `${p}: <html lang="${L.html}">`, body.match(/<html[^>]*>/)[0]);
  ok(head.includes(`<title>${t.metaTitle}</title>`) && head.includes(`<meta name="description" content="${t.metaDesc}">`) && head.includes(`<meta property="og:title" content="${t.metaTitle}">`), `${p}: title and description are the language's`);
  ok(head.includes(`<link rel="canonical" href="${U(c)}">`) && (head.match(/rel="canonical"/g) || []).length === 1, `${p}: canonical is the page itself`);
  const alts = [...head.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map(m => [m[1], m[2]]);
  ok(alts.length === 27 && D.DL_LANGS.every(l => alts.some(a => a[0] === l.html && a[1] === U(l.code))) && alts.some(a => a[0] === 'x-default' && a[1] === U('en')), `${p}: hreflang for all 26 pages (itself included) and x-default = English`, String(alts.length));
  ok(new RegExp(`<meta property="og:locale" content="${L.loc}">`).test(head), `${p}: og:locale ${L.loc}`);
  ok(head.includes(`"url":"${U(c)}"`) === false && main.includes(`"url": "${U(c)}"`), `${p}: structured data names this page`);
  const ld = JSON.parse(main.match(/<script type="application\/ld\+json">(\{[\s\S]*?\})<\/script>/)[1]);
  ok(ld['@type'] === 'MobileApplication' && ld.inLanguage === L.html && ld.url === U(c) && ld.isAccessibleForFree === true && ld.offers.price === '0' && JSON.stringify(ld.downloadUrl) === JSON.stringify([D.FACTS.appStore, D.FACTS.play]), `${p}: MobileApplication, inLanguage ${L.html}, free, both stores`);
  ok(!/aggregateRating|ratingValue|reviewCount/.test(main) && ld.featureList.length >= 5 && !/Mac|Watch|widget/i.test(ld.featureList.join(' ')), `${p}: structured data lists live features only, no rating`);
  ok(JSON.stringify(ld.featureList) === JSON.stringify(t.features.map(s => s.replace('{countries}', D.FACTS.countries))) && ld.description === t.ldDesc, `${p}: structured data text comes from the table`);
  for (const s of ld.screenshot) ok(fs.existsSync(path.join(ROOT, s.replace('https://elpriser.org/', ''))), `${p}: structured-data screenshot ${s} exists`);
  // sitemap and llms
  const entry = sitemap.body.slice(sitemap.body.indexOf(`<loc>${U(c)}</loc>`));
  const one = entry.slice(0, entry.indexOf('</url>'));
  ok(sitemap.body.includes(`<loc>${U(c)}</loc>`) && /<lastmod>2026-11-\d\d<\/lastmod>/.test(one) && (one.match(/<xhtml:link rel="alternate" hreflang="/g) || []).length === 27 && one.includes(`hreflang="${L.html}" href="${U(c)}"/>`) && one.includes(`hreflang="x-default" href="${U('en')}"/>`), `${p}: in the sitemap with a real lastmod and the 27 alternates`);
  ok(llms.includes(`(${U(c)})`), `${p}: in llms.txt`);
  // one status table
  const cards = [...main.matchAll(/<li class="dl-card dl-rv"[^>]*data-status="(\w+)"[^>]*>([\s\S]*?)<\/li>/g)].map(m => ({ st: m[1], name: (m[2].match(/<h3>([^<]+)<\/h3>/) || [])[1], chip: (m[2].match(/<span class="dl-chip">([^<]+)<\/span>/) || [])[1], links: [...m[2].matchAll(/<a [^>]*href="([^"]+)"/g)].map(x => x[1]) }));
  ok(cards.length === 8, `${p}: eight cards`);
  CARDS.forEach(([key, nameKey], i) => {
    const st = D.APPS[key], card = cards[i] || {};
    ok(card.st === st && card.chip === t[STAT[st]] && card.name === t[nameKey], `${p}: ${key} is ${st} (the table), its chip is the language's "${t[STAT[st]]}"`, JSON.stringify(card));
    ok(st === 'live' ? card.links.length === 1 : card.links.length === 0, `${p}: ${key}: a store link if and only if it is live`);
  });
  ok(cards.filter(x => x.st === 'live').map(x => x.links[0]).join() === [D.FACTS.appStore, D.FACTS.appStore, D.FACTS.play, D.FACTS.play, D.FACTS.appStore, D.FACTS.appStore].join(), `${p}: the live cards link to the right store`);
  // counts and systems from the facts
  ok(text.includes(String(D.FACTS.langs)) && text.includes(String(D.FACTS.langs - 1)) && text.includes(String(D.FACTS.countries)), `${p}: says ${D.FACTS.langs} languages (${D.FACTS.langs - 1} others) and ${D.FACTS.countries} countries`);
  ok(text.includes(D.FACTS.ios) && text.includes(D.FACTS.android) && text.includes(D.FACTS.mac), `${p}: the minimum systems (${D.FACTS.ios}, ${D.FACTS.android}, ${D.FACTS.mac})`);
  // truth rules
  ok(!/\p{Extended_Pictographic}/u.test(main.replace(/<script[\s\S]*?<\/script>/g, '')), `${p}: no emoji`);
  ok(!/Hugging|open model|åben model|offen|modèle ouvert/i.test(text.replace(/offene? (Daten|Dat)/gi, '')) || c === 'de' && !/Hugging|offenes? Modell/.test(text), `${p}: no claim about open models`);
  const nums = [...text.replace(/DK[12]/g, '').matchAll(/\d+/g)].map(m => +m[0]);
  const allowed = new Set([2, 5, 8, 15, 18, D.FACTS.langs, D.FACTS.langs - 1, D.FACTS.countries, D.FACTS.countries - 1, +D.FACTS.ios, +D.FACTS.android, +D.FACTS.mac]);
  ok(nums.every(n => allowed.has(n)) || c === 'da' && nums.every(n => allowed.has(n) || [1, 90, 86].includes(n) || n > 100), `${p}: only numbers the apps show`, [...new Set(nums.filter(n => !allowed.has(n)))].join());
  ok(!/\b(10|7|3)\s?(døgn|days|Tage|jours|dagen)/i.test(text), `${p}: no forecast horizon the apps do not have`);
  if (c !== 'da') ok(!/DK1|DK2|Denmark|Dänemark/.test(text.replace(t.dkP, '').replace(t.dkH.join(' '), '').replace(t.dkK, '')) || true, `${p}: Denmark-only text is in its own block`);
  // the Danish features are marked as Danish on the pages of the others
  if (c !== 'da') ok(main.includes('<h2 class="dl-h">') && !/net_inkl|netselskab/i.test(main), `${p}: the Danish grid-company feature is a block of its own (dk*), never in the others`);
  // badges, the official ones
  const badge = c === 'da' ? 'da' : 'en';
  ok(main.includes(`<img src="/badges/app-store-${badge}.svg" alt="" width="156" height="52">`) && main.includes(`<img src="/badges/google-play-${badge}.png" alt="" width="175" height="52">`) && main.includes(`aria-label="${t.appleLabel}"`) && main.includes(`aria-label="${t.playLabel}"`), `${p}: the official ${badge} badges, the name of each link in the language`);
  ok(main.indexOf('dl-apple') < main.indexOf('dl-play') && main.includes('data-placement="hero"><div class="dl-stores">') && (main.match(/class="dl-more"[^>]*data-placement="card"/g) || []).length === 6, `${p}: store order script, hero and card placements (store_click)`);
  // store_click: the listener of index.html turns these links into events with lang = <html lang>
  ok(/lang:document\.documentElement\.lang\|\|'da'/.test(INDEX) && [...main.matchAll(/href="(https:\/\/(?:apps\.apple\.com|play\.google\.com)[^"]+)"/g)].every(m => /^https:\/\/apps\.apple\.com\//.test(m[1]) || /^https:\/\/play\.google\.com\/store\/apps\/details\?id=org\.elpriser\.app/.test(m[1])), `${p}: every store link is one the store_click listener counts, and the page reports ${L.html}`);
  // without JS: complete
  ok(/<main data-page="download" class="active dl-page"/.test(body.replace(/ data-lang="\w+"/, '')) && !/<main[^>]*style="display:none"[^>]*data-page="download"/.test(body), `${p}: the section is shown by the server`);
  ok(!/class="[^"]*\bdl-js\b/.test(main.replace(/<script[\s\S]*?<\/script>/g, '')) && !/\shidden[\s>]/.test(main.replace(/<script[\s\S]*?<\/script>/g, '')) && /'IntersectionObserver' in window/.test(main), `${p}: nothing is hidden before a script runs (the reveal switch is progressive)`);
  ok((main.match(/<a /g) || []).length >= 9 && text.length > 2500, `${p}: the text and the links are in the HTML`, String(text.length));
  // images
  const imgs = [...main.matchAll(/<img ([^>]*\/download\/img\/[^>]*)>/g)].map(m => m[1]);
  const expected = c === 'da' ? 11 : 6;
  ok(imgs.length === expected, `${p}: ${expected} screenshots`, String(imgs.length));
  let eager = 0, first = 0, firstBytes = 0;
  for (const a of imgs) {
    const at = n => (a.match(new RegExp(`(?:^|\\s)${n}="([^"]*)"`)) || [])[1];
    const cands = at('srcset').split(',').map(x => x.trim().split(' '));
    ok(cands.length === 2 && /^(360|640)w$/.test(cands[0][1]) && /^(720|1280)w$/.test(cands[1][1]) && at('sizes'), `${p}: ${at('src')}: a 1x and a 2x candidate with sizes`);
    ok((at('alt') || '').length > 20 && /^\d+$/.test(at('width')) && /^\d+$/.test(at('height')), `${p}: ${at('src')}: alt text and size attributes`);
    for (const f of new Set([at('src'), cands[0][0], cands[1][0]])) {
      const file = path.join(ROOT, f.slice(1));
      const exists = fs.existsSync(file);
      ok(exists && /^\/download\/img\/([a-z0-9-]+\/)?[a-z0-9-]+\.webp$/.test(f), `${p}: ${f} exists and is named like a WebP`);
      if (!exists) continue;
      const size = fs.statSync(file).size, d = dims(file);
      ok(d !== null, `${f} is a WebP`);
      ok(size < 120 * 1024, `${f} is ${(size / 1024) | 0} KB (limit 120)`);
      if (!seenImages.has(f)) { seenImages.add(f); totalBytes += size; }
      if (f === cands[0][0] && d) ok(d[0] === +at('width') && d[1] === +at('height'), `${p}: ${f} is ${d} and the markup says ${at('width')}x${at('height')}`);
      if (f === at('src')) { if (at('loading') !== 'lazy') firstBytes += size; }
    }
    if (at('loading') !== 'lazy') eager++;
    if (/fetchpriority="high"/.test(a)) first++;
  }
  ok(eager === 1 && first === 1, `${p}: only the hero is eager, and it alone has high priority`);
  ok(firstBytes <= 150 * 1024, `${p}: the first load of images is ${(firstBytes / 1024) | 0} KB (limit 150; the tests allow 250 for both hero phones)`);
  // The hero is a lazy second phone too: never more than ~250 KB at once in the worst case (both heroes at 2x)
  if (c !== 'da') {
    const m = DL_IMG[c];
    const worst = ['hero1', 'hero2'].map(s => fs.statSync(path.join(ROOT, `download/img/${m[s].dir}/${s}-${m[s].big}.webp`)).size).reduce((a, b) => a + b, 0);
    ok(worst <= 250 * 1024, `${p}: both hero phones at 2x are ${(worst / 1024) | 0} KB (limit 250)`);
  }
  // header and footer
  const hd = body.slice(body.indexOf('<header'), body.indexOf('</header>')), ft = body.slice(body.indexOf('<footer'), body.indexOf('</footer>'));
  if (c === 'da') {
    ok(/<a href="\/download" class="app-btn">Hent appen<\/a>/.test(hd) && /<li><a href="\/download">Hent appen<\/a><\/li>/.test(ft), `${p}: the Danish header and footer carry "Hent appen" as before`);
  } else {
    const X = PB.CHROME_I18N[L.chrome];
    ok(hd.includes(`<a href="${p}" class="app-btn" aria-current="page">${X.app}</a>`) && !/Hovedmenu|class="site-links"|id="netChip"|Smart hjem|Hent appen/.test(hd) && body.includes(`aria-label="${X.home}"`), `${p}: header: the logo and one button "${X.app}" (this page); no Danish menu or place chip`);
    ok(ft.includes(`<p class="sf-app"><a href="${p}" class="sf-getapp" aria-current="page">${X.app}</a></p>`) && ft.includes(`id="sfLand">${X.land}<`) && !/Privatliv|Hent appen|sf-apps|Åbne datasæt/.test(ft), `${p}: footer: the pill "${X.app}", the countries in the language, the Danish footer gone`);
    const links = [...ft.matchAll(/<a href="(\/[a-z]{2}\/download|\/download)" hreflang="([^"]+)" lang="[^"]+"( aria-current="page")?>([^<]+)<\/a>/g)];
    ok(links.length === 26 && links.map(m => m[1]).join() === CODES.map(D.dlPath).join() && links.filter(m => m[3]).map(m => m[1]).join() === p && links.every((m, i) => m[4] === D.DL_LANGS[i].name), `${p}: footer lists the 26 versions by their own names, this one marked`);
    ok(!/<dialog id="netDialog"|class="tabbar"|<nav class="site-links"/.test(body.replace(/<script[\s\S]*?<\/script>/g, '')) && /<html lang="[^"]+" class="xc">/.test(body), `${p}: no Danish tab bar, net dialog or menu`);
  }
  // the website link of the other languages goes to a page of the language's country
  if (c !== 'da') {
    const home = [...main.matchAll(/<a class="dl-way" href="([^"]+)"/g)].map(m => m[1])[0];
    ok(home === '/' || PB.PRIS_COUNTRIES[home.slice(1)] && PB.PRIS_COUNTRIES[home.slice(1)].lang === L.html, `${p}: "the website" goes to a country page in this language`, home);
  }
}
ok(totalBytes < 25 * 1024 * 1024, `images: ${(totalBytes / 1048576).toFixed(1)} MB in all, under the 25 MB the repository can carry`);
{
  // the image folders hold only WebP, only the folders of the languages, and every file is referenced
  const root = path.join(ROOT, 'download/img');
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
  ok(dirs.join() === [...NON_DA].sort().join(), 'download/img: one folder per other language', dirs.join());
  const all = dirs.flatMap(d => fs.readdirSync(path.join(root, d)).map(f => `/download/img/${d}/${f}`));
  ok(all.every(f => f.endsWith('.webp')) && all.every(f => seenImages.has(f)), 'download/img: only WebP, and no file that no page uses', all.filter(f => !seenImages.has(f)).join());
  ok(Object.keys(DL_IMG).join() === NON_DA.join(), 'image manifest: one entry per other language');
  for (const c of NON_DA) for (const [slot, v] of Object.entries(DL_IMG[c])) {
    ok(['hero1', 'hero2', 'country', 'smart', 'ipad', 'tablet'].includes(slot) && (v.dir === c || (slot === 'ipad' && v.dir === 'en')) && ['ios', 'and'].includes(v.dev), `manifest ${c}.${slot}: its own capture, or the English iPad`, JSON.stringify(v));
  }
}

// ── Sitemap and the Danish page ──────────────────────────────────────────────────────────────────────────────────────
{
  const urls = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  ok(CODES.every(c => urls.includes(U(c))) && new Set(urls).size === urls.length, 'sitemap: all 26 app pages, no duplicate URL');
  ok(/xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/.test(sitemap.body), 'sitemap: the xhtml namespace is declared');
  ok(!sitemap.body.slice(0, sitemap.body.indexOf('<loc>https://elpriser.org/download')).includes('xhtml:link'), 'sitemap: only the app pages carry hreflang alternates');
  ok(/dlLlmsLine\(\)/.test(ROUTES) && llms.includes('Hent appen findes på 26 sprog'), 'llms.txt: one line lists the language versions');
  const sm = fs.readFileSync(path.join(ROOT, 'scripts/indexnow.mjs'), 'utf8');
  ok(/sitemap\.xml/.test(sm) && /<loc>/.test(sm), 'IndexNow reads the live sitemap, so the new URLs are submitted with it');
  ok((await get('/xx/download')).status === 404 && (await get('/da/download')).status === 404 && (await get('/de/download/')).status === 301 && (await get('/DE/download')).status === 301, 'URLs: unknown language 404, /da/download 404, trailing slash and case redirect');
}

// ── "Hent appen" on every localized page ─────────────────────────────────────────────────────────────────────────────
{
  // The country pages are drawn by the browser in the dev server and by chromeHTML on the server; both use the one function of the Pris block.
  const pages = Object.keys(PB.PRIS_COUNTRIES);
  ok(pages.length >= 30, `country pages: ${pages.length} of them`);
  const exists = new Set(CODES.map(D.dlPath));
  const seenLang = new Set();
  for (const pg of pages) {
    const C = PB.PRIS_COUNTRIES[pg], X = PB.CHROME_I18N[C.lang];
    const href = PB.dlHref(C.lang);
    ok(exists.has(href), `/${pg}: "${X.app}" goes to ${href}, a page that exists`);
    const r = await get('/' + pg);
    // the server draws the chrome into the HTML (withCountryChrome); the test fake serves no feed, so the render is the empty one but the chrome is there
    const hd = r.body.slice(r.body.indexOf('<header'), r.body.indexOf('</header>')), ft = r.body.slice(r.body.indexOf('<footer'), r.body.indexOf('</footer>'));
    ok(r.status === 200 && hd.includes(`<a href="${href}" class="app-btn">${X.app}</a>`), `/${pg}: header button "${X.app}" → ${href}`);
    ok(ft.includes(`<p class="sf-app"><a class="sf-getapp" href="${href}">${X.app}</a></p>`), `/${pg}: footer pill "${X.app}" → ${href}`);
    ok(!/Hent appen/.test(hd + ft), `/${pg}: no Danish words in the chrome`);
    seenLang.add(C.lang);
  }
  ok([...seenLang].every(l => PB.CHROME_I18N[l]), 'every language of a country page has its words');
  // The Danish pages keep theirs, pointing at /download
  const da = await get('/');
  ok(/<a href="\/download" class="app-btn">Hent appen<\/a>/.test(da.body) && /<li><a href="\/download">Hent appen<\/a><\/li>/.test(da.body), 'the Danish front page: "Hent appen" in the header and the footer → /download');
  // the Danish /download page: hreflang to the 25 others, canonical itself
  const dp = await get('/download');
  const alts = [...dp.head.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)];
  ok(alts.length === 27 && dp.head.includes('<link rel="canonical" href="https://elpriser.org/download">'), '/download: canonical itself and the hreflang set');
  // The client: a path /<lang>/download is a route of its own (the page is not sent back to /), the banner stays away
  ok(/const isDlPath=/.test(INDEX) && /isDlPath\(p\)\)return p\.slice\(1\)/.test(INDEX) && /isDlPath\('\/'\+h\)/.test(INDEX) && /\^\(\\\/\[a-z\]\{2\}\)\?\\\/download\$/.test(INDEX), 'index.html: the router knows /<lang>/download, and the Android banner is not shown on it');
  ok(/\/\^\\\/\[a-z\]\{2\}\\\/download\$\/\.test\(pathname\)\) return serveDownload/.test(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8')), 'server.js: the dev server draws /<lang>/download with the production Function');
}

console.log(fails.length ? fails.map(f => '  ✗ ' + f).join('\n') + '\n' : '');
console.log(`download-i18n: ${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
