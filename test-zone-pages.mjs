#!/usr/bin/env node
/**
 * The five foreign-area pages: /no/strompris, /sv/elpris, /fi/sahkon-hinta, /nl/stroomprijs and /norden.
 * Run: npm run test:zone   (hermetic: the real Pages Function, index.html, a fake /api/nordic)
 *
 * They replaced eleven thin zone pages (/no1 … /nl). What this guards:
 *  - each page is served 200 with its own title, description, html lang and h1, and with the
 *    SAME Pris screen as the Danish pages drawn into the HTML, in the page's language;
 *  - nothing on them can show the feed's longer horizon: the feed carries ten days, these pages two and five;
 *  - /norden draws all thirteen areas in DKK with the basis stated;
 *  - the render is cached under its own versioned key, and an incomplete render is never remembered;
 *  - the four country pages wear their own chrome (a country navigation and a slim footer in their language; no Danish
 *    menu, net chip, app button, tab bar, net dialog or footer) and the Danish pages' chrome is the fixture, byte for byte;
 *  - the thirteen old URLs answer 301 to the right place.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = import.meta.dirname;
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const { onRequest } = await import(pathToFileURL(path.join(ROOT, 'functions/[[path]].js')).href);

let pass = 0; const fails = [];
const ok = (c, n, d) => { if (c) pass++; else fails.push(`${n}${d ? ' — ' + d : ''}`); };

// ── A fake edge: ASSETS serves index.html, /api/nordic answers from a fixture, caches.default is a Map ──
const cph = { timeZone: 'Europe/Copenhagen' };
const today = new Intl.DateTimeFormat('en-CA', cph).format(new Date());
const NOW_H = +new Intl.DateTimeFormat('en-GB', { ...cph, hour: 'numeric', hourCycle: 'h23' }).format(new Date());
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const RATE = { dk1: 7.5, dk2: 7.5, no: 10, se: 11, eur: 1, pl: 4.4 };
const rateOf = z => /^dk/.test(z) ? RATE.dk1 : z.startsWith('no') ? RATE.no : z.startsWith('se') ? RATE.se : z === 'pl' ? RATE.pl : 1;
const BASE = { no1: 80, no2: 120, no3: 60, no4: 30, no5: 100, se1: 25, se2: 35, se3: 70, se4: 110, fi: 45, nl: 95, dk1: 90, dk2: 100,
  de: 95, fr: 62, pl: 118, 'it-n': 118 };
const EU = ['de', 'fr', 'pl', 'it-n'];
let noTomorrow = false;   // the EU job has not published tomorrow yet
/** Ten days from YESTERDAY, like the live feed; EUR/MWh with a daily swing so there is a cheapest hour. */
const nordic = zone => EU.includes(zone) ? ({
  // The EU job's value: yesterday, today (and tomorrow once published), all `actual`, no model.
  zone, generated: today, trainedThrough: null, unit: 'EUR/MWh',
  zoneInfo: { name: zone.toUpperCase(), currency: zone === 'pl' ? 'PLN' : 'EUR', rate: rateOf(zone), rateSource: 'test' },
  days: Array.from({ length: noTomorrow ? 2 : 3 }, (_, i) => ({
    date: addDays(today, i - 1), type: 'actual',
    prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: +(BASE[zone] + 25 * Math.sin(h / 24 * 6.2832) + i * 2).toFixed(2) })),
  })),
}) : ({
  zone, generated: today, unit: 'EUR/MWh',
  zoneInfo: { name: zone.toUpperCase(), currency: 'X', rate: rateOf(zone), rateSource: 'test' },
  days: Array.from({ length: 10 }, (_, i) => ({
    date: addDays(today, i - 1), type: i < 3 ? 'actual' : 'forecast',
    prices: Array.from({ length: 24 }, (_, h) => ({ hour: h, eur_mwh: +(BASE[zone] + 25 * Math.sin(h / 24 * 6.2832) + i * 2).toFixed(2) })),
  })),
});
const store = new Map();
globalThis.caches = { default: { match: async k => { const r = store.get(k.url); return r ? r.clone() : undefined; }, put: async (k, r) => { store.set(k.url, r); } } };
let upstream = [], missing = new Set();
globalThis.fetch = async u => {
  const url = new URL(String(u));
  upstream.push(url.pathname + url.search);
  const z = url.searchParams.get('zone');
  if (url.pathname === '/api/nordic' && z && !missing.has(z)) return new Response(JSON.stringify(nordic(z)), { headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 404 });
};
// The words of the chrome, lifted from the Pris block of the real file (the same block index.html carries).
const chromeI18n = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const a = src.indexOf('var CHROME_I18N={'), b = src.indexOf('\n};', a) + 3;
  return new Function(src.slice(a, b) + '\nreturn CHROME_I18N;')();
})();
const get = async p => {
  const res = await onRequest({ request: new Request('https://elpriser.org' + p), env: { ASSETS: { fetch: async () => new Response(INDEX, { headers: { 'content-type': 'text/html' } }) } } });
  const body = res.status === 301 ? '' : await res.text();
  // `page`: what the page SAYS — without the script and style (index.html carries the whole app's code,
  // markup strings included). The dialogs stay: on a country page there is none, and that is asserted.
  const page = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  return { status: res.status, headers: res.headers, body, page };
};

// ── The four pages ──────────────────────────────────────────────────────────
const PAGES = {
  '/no/strompris': { lang: 'nb', title: /^Strømpris prognose Norge/, tabs: 5, zones: ['Oslo', 'Kristiansand', 'Trondheim', 'Tromsø', 'Bergen'], unit: 'øre', now: 'Strømpris akkurat nå', p5: '5 døgn', first: 'no1' },
  '/sv/elpris': { lang: 'sv', title: /^Elpris prognos Sverige/, tabs: 4, zones: ['Luleå', 'Sundsvall', 'Stockholm', 'Malmö'], unit: 'öre', now: 'Elpris just nu', p5: '5 dygn', first: 'se3' },
  '/fi/sahkon-hinta': { lang: 'fi', title: /^Sähkön hinta ennuste/, tabs: 0, zones: ['Suomi'], unit: 'snt', now: 'Sähkön hinta juuri nyt', p5: '5 vrk', first: 'fi' },
  '/nl/stroomprijs': { lang: 'nl', title: /^Stroomprijs vandaag en morgen/, tabs: 0, zones: ['Nederland'], unit: 'cent', now: 'Stroomprijs nu', p5: '5 dagen', first: 'nl' },
};
const TEN = /10 (døgn|dager|dage|dygn|vrk|vuorokautta|days)|10-day|tio dygn|kymmenen/i;
for (const [p, w] of Object.entries(PAGES)) {
  store.clear(); upstream = [];
  const r = await get(p), h = r.page, raw = r.body;
  const title = (raw.match(/<title>([^<]*)<\/title>/) || [])[1] || '', desc = (raw.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  ok(r.status === 200, `${p}: 200`, String(r.status));
  ok(w.title.test(title) && title.length <= 62, `${p}: titel under 62 tegn`, `${title.length}: ${title}`);
  ok(desc.length >= 80 && desc.length <= 155, `${p}: beskrivelse 80-155 tegn`, String(desc.length));
  ok(new RegExp(`<html lang="${w.lang}"`).test(h), `${p}: <html lang="${w.lang}">`);
  ok(!/<link rel="alternate"/.test(h.replace(/<!--[\s\S]*?-->/g, '')) && (h.match(/hreflang=/g) || []).length === 1 && /<a href="\/privatliv" hreflang="da">/.test(h), `${p}: ingen hreflang-klynge; det eneste hreflang er privatlivslinkets da`);
  ok(new RegExp(`<link rel="canonical" href="https://elpriser.org${p}">`).test(h), `${p}: canonical peger på siden selv`);
  ok(/"@type":"WebPage"[^<]*"inLanguage":"/.test(raw) && raw.includes(`"@type":"WebPage"`) && /"inLanguage":"(nb|sv|fi|nl)"/.exec(raw.slice(raw.indexOf('"@type":"WebPage"')))[1] === w.lang, `${p}: JSON-LD WebPage med inLanguage ${w.lang}`);
  ok((h.match(/<h1[ >]/g) || []).length === 1 && new RegExp(`<h1 class="vh" id="zH1">[^<&]{20,}</h1>`).test(h), `${p}: én h1, skrevet af serveren`);
  // The very Pris screen of the Danish pages, in this language.
  ok(h.includes('<div class="pris" data-period="2"') && h.includes(`data-key="${w.first}"`), `${p}: Pris-skærmen er tegnet for ${w.first}`);
  ok(h.includes(w.now) && h.includes(`>${w.unit}/kWh</span>`), `${p}: etiket og enhed på sidens sprog`);
  ok(!/data-pris-view|pris-seg|Din pris|kr\/kWh/.test(h.slice(h.indexOf('<main'), h.indexOf('</main>'))), `${p}: ingen Din pris/Spotpris-kontakt og ingen kroner`);
  ok(h.includes(`>${PAGES[p].p5}</button>`) && h.includes('data-pris-period="2"'), `${p}: kun to perioder: 2 og 5`);
  ok((h.match(/data-pris-period="/g) || []).length === 2, `${p}: præcis to periodeknapper`);
  // Five days at most: 120 bars in the five-day card, five rows in the day list, no hidden sixth to tenth day.
  const five = h.slice(h.indexOf('pris-card pp5'), h.indexOf('pris-tiles pp2'));
  ok((five.match(/<span class="pc[ "]/g) || []).length === 120 - (NOW_H > 0 ? NOW_H - Math.min(6, NOW_H) : 0), `${p}: 5 døgn er fem døgn fra seks timer før nu`, String((five.match(/<span class="pc[ "]/g) || []).length));
  // One <tbody> per period over the hours its chart shows: 2 døgn reaches into day three (from hour 1 on), 5 døgn is the five days there are.
  ok((h.match(/<tr><th scope="row">/g) || []).length === (NOW_H > 0 ? 3 : 2) + 5 && !/class="r10"/.test(h), `${p}: dagslisten har tre (to) rækker for 2 døgn og fem for 5 døgn, ingen skjult dag seks-ti`);
  ok(!TEN.test(h), `${p}: ingen tekst om 10 døgn`, (h.match(TEN) || [])[0]);
  // The tab row.
  ok((h.match(/role="tab" id="zt-/g) || []).length === w.tabs, `${p}: ${w.tabs} zone-faner`);
  if (w.tabs) ok(/role="tablist" aria-label="[^"]+"/.test(h) && (h.match(/aria-selected="true" tabindex="0"/g) || []).length === 1 && (h.match(/tabindex="-1"/g) || []).length === w.tabs - 1 && /id="zPanel" role="tabpanel" aria-labelledby="zt-/.test(h),
    `${p}: tablist-semantik med roving tabindex og et tabpanel`);
  // The crawlable text block: every zone, its city, and prices.
  const list = h.slice(h.indexOf('<section class="zl"'), h.indexOf('</section>', h.indexOf('<section class="zl"')));
  ok(w.zones.every(c => list.includes(`<b>${c}</b>`)), `${p}: tekstblokken nævner alle byer`, list.slice(0, 200));
  ok((list.match(/<li>/g) || []).length === w.zones.length && (list.match(new RegExp(`${w.unit}/kWh`, 'g')) || []).length >= w.zones.length, `${p}: ét punkt pr. zone med pris`);
  ok(!/NaN|undefined|Infinity/.test(h.slice(h.indexOf('<main'), h.indexOf('</main>'))), `${p}: ingen NaN/undefined`);
  ok(new RegExp(`<meta property="og:locale" content="${{ nb: 'nb_NO', sv: 'sv_SE', fi: 'fi_FI', nl: 'nl_NL' }[w.lang]}">`).test(raw), `${p}: og:locale på sidens sprog`);
  // The chrome: the globe in the page's language, a slim footer, and none of the Danish site's.
  {
    const hd = h.slice(h.indexOf('<header'), h.indexOf('</header>')), ft = h.slice(h.indexOf('<footer'), h.indexOf('</footer>')), X = chromeI18n[w.lang];
    ok(/<html lang="[a-z]+" class="xc">/.test(h) && /<a href="\/" class="site-logo" aria-label="[^"]+">[\s\S]*<\/svg><\/span>Elpriser<\/a>/.test(hd), `${p}: logoet viser ordmærket Elpriser og linker til /`);
    ok(!/class="site-links"|<nav|countryBtn/.test(hd) && /id="netChip"/.test(hd) && !/Vestdanmark|DK1|Netselskab|netselskab/.test(hd), `${p}: headeren har stedschippen, ingen globus og ingen landerække`);
    ok(hd.includes(`aria-label="${X.home}"`) && hd.includes(`aria-label="${X.place}"`), `${p}: logoets og vælgerens navne på ${w.lang}`);
    ok(!/app-btn|Hent appen|Smart hjem|>Om<|Hovedmenu|href="\/automation"|href="\/om-elpriser"|href="\/download"/.test(hd), `${p}: ingen netchip, ingen app-knap, ingen dansk menu i headeren`);
    ok(!/class="tabbar|Mobilnavigation|Netselskab og indstillinger|id="gpsBtn|netDlgDK/.test(h.replace(/<!--[\s\S]*?-->/g, '')) && (h.match(/<dialog id="netDialog"/g) || []).length === 1 && h.includes(`id="netDialogTitle">${X.place}</h2>`), `${p}: ingen dansk mobilbar og ingen danske netselskaber, men stedsdialogen på ${w.lang}`);
    ok((h.match(/<footer\b/g) || []).length === 1 && ft.includes('class="sf sf-x"') && ft.includes(`id="sfLand">${X.land}<`) && ft.includes(X.privacy) && !/Privatliv|Hent appen|Hent til|Netselskab|Alle guides|Tariffer|Prognose<|Forstå din elpris|Åbne datasæt|class="sf-apps|class="sf-all|<details/.test(ft), `${p}: sidefoden er den slanke på ${w.lang}`);
    ok(ft.includes('&copy; Elpriser.org') && ft.includes(X.src) && ft.includes(X.open) && /href="\/privatliv" hreflang="da"/.test(ft), `${p}: ophavsret, kilder og privatlivslink på ${w.lang}`);
    ok(!/href="\/(automation|om-elpriser|download|tariffer|prognose|blog|api|shelly-tariff|norden)"/.test(hd + ft) && !/href="\/(dk[12]|elpris)\/[a-z]/.test(hd + ft), `${p}: header og fod linker ingen danske undersider, kun landesiderne og /privatliv`);
  }
  ok(upstream.length === (PAGES[p].tabs || 1) && upstream.every(x => x.startsWith('/api/nordic?zone=')), `${p}: serveren henter præcis landets zoner`, upstream.join(' '));
  // The edge cache: a second request is served without touching the feed again, under its own versioned key.
  const n = upstream.length;
  const again = await get(p);
  ok(again.page === h && upstream.length === n, `${p}: andet svar kommer fra cachen`);
  ok([...store.keys()].some(k => new RegExp(`cache\\.local/zone-ssr-v\\d+${p}$`).test(k)), `${p}: egen versioneret cache-nøgle`, [...store.keys()].join(' '));
}
// Norway: prices are the fixture's, converted at the response's rate (÷10 × rate): NO1 hour 0 → 80 EUR/MWh + the day's swing.
{
  store.clear();
  const h = (await get('/no/strompris')).page, d0 = nordic('no1').days[1].prices;
  const nowH = +new Intl.DateTimeFormat('en-GB', { ...cph, hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  const expect = Math.round(d0[nowH].eur_mwh * 10 / 10);
  ok(new RegExp(`class="pris-now">${expect}<`).test(h), 'NO1: prisen nu er EUR/MWh × kurs ÷ 10 i øre (kurs 10 fra svaret)', `${expect} vs ${(h.match(/class="pris-now">([^<]*)</) || [])[1]}`);
  ok(/data-tip="I dag kl\. \d\d · \d+ øre\/kWh"/.test(h) && /data-tip="[a-zæøå]{3} \d+\. [a-z]{3} kl\. \d\d · \d+ øre\/kWh"/.test(h), 'NO1: tooltips på norsk i øre');
}
// Netherlands: EUR, so the rate is 1 and the unit is cent: NL hour h of today is EUR/MWh ÷ 10, in Dutch words.
{
  store.clear();
  const r = await get('/nl/stroomprijs'), h = r.page, d0 = nordic('nl').days[1].prices;
  const nowH = +new Intl.DateTimeFormat('en-GB', { ...cph, hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  const v = d0[nowH].eur_mwh / 10, dec = Math.max(...nordic('nl').days.slice(1, 6).flatMap(d => d.prices.map(p => p.eur_mwh / 10))) >= 10 ? 1 : 2;
  const expect = v.toFixed(dec).replace('.', ',');
  ok(new RegExp(`class="pris-now">${expect}<`).test(h), 'NL: prisen nu er EUR/MWh ÷ 10 i cent, med komma', `${expect} vs ${(h.match(/class="pris-now">([^<]*)</) || [])[1]}`);
  ok(/<h1 class="vh" id="zH1">Stroomprijs in Nederland: vandaag en prognose voor de komende 5 dagen<\/h1>/.test(h) && h.includes('Spotprijs zonder btw, belastingen en netkosten') && /Goedkoop|Gemiddeld|Duur/.test(h) && /Komende 5 dagen/.test(h) && h.includes('Beursprijs') && h.includes('Prognose'), 'NL: h1, billedtekst, niveauer, periodekort og typer på hollandsk');
  ok(/data-tip="Vandaag om \d\d · [\d,]+ cent\/kWh"/.test(h) && /data-tip="Morgen om \d\d · [\d,]+ cent\/kWh"/.test(h) && /data-tip="[a-z]{2} \d+ [a-z]{3} om \d\d · [\d,]+ cent\/kWh"/.test(h), 'NL: tooltips på hollandsk i cent (Vandaag, Morgen, og senere dage som "wo 29 okt")');
  ok(!/\b(øre|snt|kr\/kWh|døgn|dager|dygn|vrk)\b/.test(h.slice(h.indexOf('<main'), h.indexOf('</main>'))), 'NL: ingen ord eller enheder fra de andre sprog i sidens indhold');
  ok(/<li><a href="\/nl\/stroomprijs" data-zone="nl"><b>Nederland<\/b> \(NL\)<\/a>: gem\. vandaag [\d,]+ cent\/kWh, gem\. morgen/.test(h), 'NL: tekstblokken har Nederland med dagens og morgendagens gennemsnit');
}
// The Danish pages' chrome is the fixture, byte for byte: header, phone tab bar, footer and net dialog.
// The fixture is index.html's chrome as it was before the country pages got their own, plus the one intended change:
// Nederland among the other price areas (footer), and the place chip and place dialog (Land, then net) that replaced the net chip, the net dialog and the country picker.
{
  const FIX = fs.readFileSync(path.join(ROOT, 'tests/fixtures/chrome-da.html'), 'utf8');
  const part = n => FIX.split(`<!--@@${n}@@-->\n`)[1].split('\n<!--@@')[0].replace(/\n$/, '');
  const BL = { header: ['<header class="site-nav">', '</header>'], tabbar: ['<nav class="tabbar"', '</nav>'], footer: ['<footer class="sf">', '</footer>'], dialog: ['<dialog id="netDialog"', '</dialog>'] };
  const cut = (html, n) => { const a = html.indexOf(BL[n][0]); return a < 0 ? null : html.slice(a, html.indexOf(BL[n][1], a) + BL[n][1].length); };
  for (const n of Object.keys(BL)) ok(cut(INDEX, n) === part(n), `index.html: ${n} er fixturen, tegn for tegn`, 'ret tests/fixtures/chrome-da.html bevidst hvis den danske chrome skal ændres');
  for (const p of ['/', '/tariffer', '/prognose', '/norden', '/automation', '/blog', '/om-elpriser', '/download', '/api']) {
    store.clear();
    const r = await get(p);
    for (const n of Object.keys(BL)) if (n !== 'header' || p !== '/dk1') ok(cut(r.body, n) === part(n), `${p}: dansk ${n} er uændret, tegn for tegn`);
    ok(/<html lang="da">/.test(r.body) && !/ class="xc"/.test(r.body.slice(0, 200)), `${p}: dansk side uden xc-kroge`);
  }
  // The per-net and per-city pages change only the text of the net chip (their own net), nothing else in the header.
  for (const p of ['/dk1', '/dk2/radius', '/elpris/aarhus']) {
    store.clear();
    const r = await get(p), hd = cut(r.body, 'header');
    ok(hd.replace(/(id="netChip(?:Long|Short)">)[^<]*</g, '$1<') === part('header').replace(/(id="netChip(?:Long|Short)">)[^<]*</g, '$1<'), `${p}: headeren er den danske, kun netchippens tekst er sidens egen`);
    ok(cut(r.body, 'footer') === part('footer') && cut(r.body, 'tabbar') === part('tabbar') && cut(r.body, 'dialog') === part('dialog'), `${p}: fod, mobilbar og netdialog er uændrede`);
  }
}
// A missing zone: the page still renders (the others show) but is NOT remembered.
{
  store.clear(); missing = new Set(['no3']);
  const r = await get('/no/strompris');
  ok(r.status === 200 && r.page.includes('<div class="pris"') && !r.page.includes('<b>Trondheim</b>: '), 'Norge uden NO3: siden kommer stadig, uden NO3-priser');
  ok(store.size === 0, 'en ufuldstændig side huskes ikke i cachen');
  missing = new Set(['no1']);
  store.clear();
  const r2 = await get('/no/strompris');
  ok(r2.status === 200 && !r2.page.includes('<div class="pris"') && /role="tablist"/.test(r2.page) && store.size === 0, 'uden NO1 (førstevalget) ingen skærm, men fanerne og teksten er der, og intet huskes');
  missing = new Set();
}

// ── The five EU pages: actual day-ahead prices only ─────────────────────────────────────────
// Germany, France, Poland, Italy (seven zones) and Ireland, each in its own language, on the very same Pris screen but with
// ONE period (no pill), no forecast anywhere, the source ENTSO-E named, and the first zone drawn by the server.
const ACT = {
  '/de/strompreis': { lang: 'de', title: /^Strompreis aktuell und morgen/, zones: ['Deutschland'], unit: 'ct', now: 'Strompreis jetzt', first: 'de', card: 'Heute und morgen', one: 'Heute', kind: 'Day-Ahead-Preis', loc: 'de_DE', h1: 'Strompreis in Deutschland: heute und morgen' },
  '/fr/prix-electricite': { lang: 'fr', title: /^Prix de l’électricité aujourd’hui et demain/, zones: ['France'], unit: 'c€', now: 'Prix de l’électricité maintenant', first: 'fr', card: 'Aujourd’hui et demain', one: 'Aujourd’hui', kind: 'Prix day-ahead', loc: 'fr_FR', h1: 'Prix de l’électricité en France\u00a0: aujourd’hui et demain' },
  '/pl/ceny-pradu': { lang: 'pl', title: /^Cena prądu dziś i jutro/, zones: ['Polska'], unit: 'gr', now: 'Cena prądu teraz', first: 'pl', card: 'Dziś i jutro', one: 'Dziś', kind: 'Cena RDN', loc: 'pl_PL', h1: 'Cena prądu w Polsce: dziś i jutro' },
  '/it/prezzo-luce': { lang: 'it', title: /^Prezzo dell’energia elettrica oggi e domani – Italia del Nord/, zones: ['Italia del Nord'], unit: 'c€', now: 'Prezzo della luce adesso', first: 'it-n', card: 'Oggi e domani', one: 'Oggi', kind: 'Prezzo day-ahead', loc: 'it_IT', h1: 'Prezzo dell’energia elettrica in Italia del Nord: oggi e domani' },
};
// What the text block says about the data's change and its source, per language (the words before the credit links).
const PRISNOTE = {
  de: 'Stundenmittel der Viertelstundenpreise, von elpriser.org berechnet (gegenüber den Originaldaten verändert). Deutschland und Luxemburg bilden eine gemeinsame Gebotszone. Quelle:',
  fr: 'Moyennes horaires des prix au quart d’heure, calculées par elpriser.org (données modifiées par rapport à l’original). Source\u00a0:',
  pl: 'Średnie godzinowe z cen kwadransowych, przeliczone z euro według dziennego kursu referencyjnego EBC przez elpriser.org (dane zmienione względem oryginału). Źródło:',
  it: 'Zona di mercato Nord. Medie orarie dei prezzi al quarto d’ora, calcolate da elpriser.org (dati modificati rispetto all’originale). Fonte:' };
const PRISCAP = {
  de: 'Börsenstrompreis (Day-Ahead) ohne MwSt., Steuern, Abgaben und Netzentgelte', fr: 'Prix spot day-ahead hors TVA, taxes et frais de réseau',
  pl: 'Cena giełdowa na rynku dnia następnego (RDN) bez VAT, podatków i opłat sieciowych', it: 'Prezzo day-ahead al netto di IVA, imposte e costi di rete' };
// "<avg word> <tomorrow word> <number>" — what a text block would say about tomorrow.
const PRISTOM = { de: 'Ø morgen', fr: 'moy\\. demain', pl: 'śr\\. jutro', it: 'media domani' };
const FORECAST = /prognos|vorhersage|vorschau|prévision|previsi|prognoz|przewid|forecast|prediction|predict|modell?o?\b|machine|maskinl|hugging/i;
// The CC BY 4.0 attribution of the four pages and the note that the site changed the data; ENTSO-E is named on none of them.
const CREDIT = '<a href="https://www.smard.de" target="_blank" rel="noopener">Bundesnetzagentur | SMARD.de</a> (<a href="https://www.energy-charts.info" target="_blank" rel="noopener">Energy-Charts.info</a>), <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>';
const CHANGED = { de: 'Änderung: Stundenmittel von elpriser.org berechnet', fr: 'Modifié\u00a0: moyennes horaires calculées par elpriser.org', pl: 'Zmiany: średnie godzinowe i przeliczenie na grosze wykonane przez elpriser.org', it: 'Modifiche: medie orarie calcolate da elpriser.org' };
const X9 = ['dk', 'no', 'sv', 'fi', 'nl', 'de', 'fr', 'pl', 'it'];
for (const [p, w] of Object.entries(ACT)) {
  store.clear(); upstream = []; noTomorrow = false;
  const r = await get(p), h = r.page, raw = r.body, X = chromeI18n[w.lang];
  const title = (raw.match(/<title>([^<]*)<\/title>/) || [])[1] || '', desc = (raw.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  const noc = h.replace(/<!--[\s\S]*?-->/g, ''), main = noc.slice(noc.indexOf('<main'), noc.indexOf('</main>'));
  ok(r.status === 200, `${p}: 200`, String(r.status));
  ok(w.title.test(title) && title.length <= 62, `${p}: titel under 62 tegn`, `${title.length}: ${title}`);
  ok(desc.length >= 80 && desc.length <= 155, `${p}: beskrivelse 80-155 tegn`, String(desc.length));
  ok(new RegExp(`<html lang="${w.lang}" class="xc"`).test(h) || new RegExp(`<html lang="${w.lang}"`).test(h), `${p}: <html lang="${w.lang}">`);
  ok(new RegExp(`<link rel="canonical" href="https://elpriser.org${p}">`).test(h), `${p}: canonical peger på siden selv`);
  ok(new RegExp(`<meta property="og:locale" content="${w.loc}">`).test(raw), `${p}: og:locale ${w.loc}`);
  const ld = raw.slice(raw.indexOf('"@type":"WebPage"') - 40, raw.indexOf('"@type":"WebPage"') + 600);
  ok(new RegExp(`"inLanguage":"${w.lang}"`).test(ld), `${p}: JSON-LD WebPage med inLanguage ${w.lang}`);
  ok(!/<link rel="alternate"/.test(h.replace(/<!--[\s\S]*?-->/g, '')) && (h.match(/hreflang=/g) || []).length === 1, `${p}: ingen hreflang-klynge`);
  ok((h.match(/<h1[ >]/g) || []).length === 1 && h.includes(`<h1 class="vh" id="zH1">${w.h1}</h1>`), `${p}: én h1 på sidens sprog`);
  // The Pris screen, drawn by the server: one period, so NO period pill (not even a disabled one).
  ok(h.includes('<div class="pris" data-period="2"') && h.includes(`data-key="${w.first}"`) && h.includes(w.now) && h.includes(`>${w.unit}/kWh</span>`), `${p}: Pris-skærmen er tegnet for ${w.first}, med etiket og enhed på sidens sprog`);
  ok(!/data-pris-period|pris-period|role="tab" aria-selected="(true|false)" data-pris/.test(h), `${p}: ingen periodeknap`);
  ok(h.includes(`aria-label="${w.card}"`) && h.includes(`<p class="pris-ct">${w.card}</p>`) && !h.includes('pris-card pp5') && !h.includes('pris-card pp7'), `${p}: ét kort, "${w.card}"`);
  ok(!/class="pris-fc/.test(h) && !/<td class="fc">/.test(h) && (h.match(/<td class="real">/g) || []).length === 2 && (h.match(new RegExp(`<td class="real">${w.kind}</td>`, 'g')) || []).length === 2, `${p}: ingen prognose-skillelinje, to rækker med typen "${w.kind}"`);
  ok((h.match(/<tr><th scope="row">/g) || []).length === 2 && !/class="r10"/.test(h), `${p}: dagslisten har to rækker (i dag og i morgen)`);
  const bars = (h.slice(h.indexOf('pris-card pp2'), h.indexOf('pris-tiles pp2')).match(/<span class="pc[ "]/g) || []).length;
  ok(bars === 48, `${p}: 48 søjler for to døgn`, String(bars));
  ok(!FORECAST.test(main) && !FORECAST.test(desc) && !FORECAST.test(title) && !FORECAST.test(ld), `${p}: ingen prognose-ord i indhold, titel, beskrivelse eller JSON-LD`, (main.match(FORECAST) || [])[0]);
  ok(!/\b(øre|kr\/kWh|døgn|snt|cent\/kWh|Prognose|Børspris|Spotpris)\b/.test(main.replace(/Spotpr/g, '')), `${p}: ingen danske ord eller enheder i indholdet`, (main.match(/\b(øre|kr\/kWh|døgn|snt)\b/) || [])[0]);
  ok(!/NaN|undefined|Infinity/.test(main), `${p}: ingen NaN/undefined`);
  ok(!/data-pris-view|pris-seg|Din pris/.test(main), `${p}: ingen Din pris/Spotpris-kontakt`);
  // The honest basis, in the page's language, with the source named and linked.
  const list = h.slice(h.indexOf('<section class="zl"'), h.indexOf('</section>', h.indexOf('<section class="zl"')));
  ok(h.includes(PRISCAP[w.lang]) && list.includes(CREDIT.replace(/ target="_blank"/g, '')) === false && list.includes(CREDIT) && list.includes(PRISNOTE[w.lang]), `${p}: billedtekst og tekstblok siger hvad prisen er, at dataene er ændret, og har kilden med licenslink`, list.slice(-420));
  ok(!/ENTSO/.test(raw.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '')), `${p}: ENTSO-E nævnes ikke noget sted på siden`);
  ok(w.zones.every(c => list.includes(`<b>${c}</b>`)) && (list.match(/<li>/g) || []).length === w.zones.length, `${p}: tekstblokken nævner zonen`, list.slice(0, 160));
  ok(new RegExp(`${w.unit}/kWh`).test(list) && /(Ø|moy\.|śr\.|media) \S+ [\d.,]+/.test(list), `${p}: tekstblokken har dagens og morgendagens gennemsnit`);
  ok((h.match(/role="tab" id="zt-/g) || []).length === 0, `${p}: ingen zone-faner (én zone)`);
  // The chrome: the nine countries (footer list) in the page's language, a slim footer whose data line names ENTSO-E and not Energi Data Service.
  const hd = h.slice(h.indexOf('<header'), h.indexOf('</header>')), ft = h.slice(h.indexOf('<footer'), h.indexOf('</footer>'));
  const nav = [...ft.matchAll(/<li><a href="([^"]+)"([^>]*)>([^<]+)<\/a><\/li>/g)];
  ok(!/class="site-links"/.test(hd) && nav.length === 9 && nav.map(m => m[3]).join() === X9.map(c => X.cn[c]).join() && nav.filter(m => /aria-current="page"/.test(m[2])).map(m => m[1]).join() === p, `${p}: headeren har ingen landerække; fodens landeliste har ni lande på ${w.lang}, den aktuelle er aria-current`, nav.map(m => m[3]).join());
  ok(ft.includes(`&copy; Elpriser.org &mdash; ${X.src} ${CREDIT} &mdash; ${CHANGED[w.lang]}. ${X.open}`) && !/Energi Data Service|energidataservice|ENTSO/.test(ft + hd) && ft.includes(X.privacy), `${p}: fodens kilde er Bundesnetzagentur | SMARD.de (CC BY 4.0, med licenslink) og siger at dataene er ændret — hverken ENTSO-E eller Energi Data Service`, ft.slice(ft.indexOf('sf-legal')));
  ok(!/class="tabbar|id="gpsBtn|netDlgDK|Hent appen|Smart hjem/.test(h.replace(/<!--[\s\S]*?-->/g, '')), `${p}: ingen dansk chrome`);
  ok(upstream.length === 1 && upstream.every(x => x.startsWith('/api/nordic?zone=')), `${p}: serveren henter præcis landets zone`, upstream.join(' '));
  const n = upstream.length, again = await get(p);
  ok(again.page === h && upstream.length === n && [...store.keys()].some(k => new RegExp(`cache\\.local/zone-ssr-v\\d+${p}$`).test(k)), `${p}: andet svar kommer fra cachen, under egen versioneret nøgle`);
  // Tomorrow not published yet: one day, and the text and the chart title stay true.
  store.clear(); noTomorrow = true;
  const one = (await get(p)).page.replace(/<!--[\s\S]*?-->/g, ''), om = one.slice(one.indexOf('<main'), one.indexOf('</main>'));
  const oneBars = (om.slice(om.indexOf('pris-card pp2'), om.indexOf('pris-tiles pp2')).match(/<span class="pc[ "]/g) || []).length;
  ok(om.includes(`<p class="pris-ct">${w.one}</p>`) && !om.includes(`<p class="pris-ct">${w.card}</p>`) && oneBars === 24 && (om.match(/<tr><th scope="row">/g) || []).length === 1, `${p}: uden i morgen: titlen er "${w.one}", 24 søjler og én række`, `${oneBars}`);
  ok(!/NaN|undefined/.test(om) && !FORECAST.test(om) && /avg|Ø|moy|śr|media/.test(om) && !new RegExp(`${PRISTOM[w.lang]}`).test(om), `${p}: uden i morgen: ingen i-morgen-tal i tekstblokken, ingen NaN`, (om.match(new RegExp(PRISTOM[w.lang])) || [])[0]);
  noTomorrow = false;
}
// Poland: PLN, grosze, at the response's rate (÷10 × 4,4): the zone's hour h of today is EUR/MWh × 4,4 ÷ 10 gr/kWh.
{
  store.clear();
  const h = (await get('/pl/ceny-pradu')).page, d0 = nordic('pl').days[1].prices;
  const nowH = +new Intl.DateTimeFormat('en-GB', { ...cph, hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  const v = d0[nowH].eur_mwh * 4.4 / 10, all = nordic('pl').days.slice(1).flatMap(d => d.prices.map(q => q.eur_mwh * 4.4 / 10));
  const dec = Math.max(...all) >= 100 ? 0 : Math.max(...all) >= 10 ? 1 : 2;
  ok(new RegExp(`class="pris-now">${v.toFixed(dec).replace('.', ',')}<`).test(h), 'PL: prisen nu er EUR/MWh × PLN-kursen ÷ 10 i grosze', `${v.toFixed(dec)} vs ${(h.match(/class="pris-now">([^<]*)</) || [])[1]}`);
  ok(/data-tip="Dziś godz\. \d\d · [\d,]+ gr\/kWh"/.test(h) && /data-tip="Jutro godz\. \d\d · [\d,]+ gr\/kWh"/.test(h), 'PL: tooltips på polsk i grosze');
}
// Germany: ct with a comma and "Uhr" after the hour.
{
  store.clear();
  const de = (await get('/de/strompreis')).page;
  ok(/data-tip="Heute um \d\d Uhr · -?\d+,\d ct\/kWh"/.test(de) && /<td>um \d\d–\d\d Uhr<\/td>/.test(de) && /<small>ct · um \d\d Uhr<\/small>/.test(de), 'DE: tooltips, dagsliste og felter på tysk, med "Uhr" efter timen');
}
// Italy is ONE zone, IT-North: no tabs, and the page says "Nord" — it never claims to be all of Italy.
{
  store.clear(); upstream = [];
  const r = await get('/it/prezzo-luce'), h = r.page;
  ok((h.match(/role="tab"/g) || []).length === 0 && upstream.length === 1 && upstream[0] === '/api/nordic?zone=it-n' && h.includes('data-key="it-n"'), 'IT: én zone (it-n), ingen faner, serveren henter kun den');
  const t = (r.body.match(/<title>([^<]*)<\/title>/) || [])[1], d = (r.body.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  ok(/Nord/.test(t) && /Nord Italia/.test(d) && /Nord/.test(h.slice(h.indexOf('<h1'), h.indexOf('</h1>'))), 'IT: titel, beskrivelse og h1 siger Nord');
  ok(!/\b(ie|it-cn|it-cs|it-sic|it-sar|it-cal)\b/.test(h.replace(/<!--[\s\S]*?-->/g, '')) && !/electricity-price|Irland|Ireland/.test(h.replace(/<!--[\s\S]*?-->/g, '').slice(h.indexOf('<header'), h.indexOf('</footer>'))), 'IT: ingen rester af de andre italienske zoner eller af Irland');
}
// Ireland is not served any more: its page is a 404 and appears nowhere.
{
  ok((await get('/ie/electricity-price')).status === 404, '/ie/electricity-price: 404 (Irlands prisdata er ikke CC BY 4.0 hos kilden)');
  const sm = (await get('/sitemap.xml')).body, llms = (await get('/llms.txt')).body;
  ok(!/electricity-price|\/ie\//.test(sm + llms) && !/Irland/.test(llms.slice(llms.indexOf('[Elpriser i Europa]'), llms.indexOf('[Automation]'))), 'sitemap og llms.txt nævner ikke Irland');
}

// ── /norden ─────────────────────────────────────────────────────────────────
{
  store.clear(); upstream = [];
  const r = await get('/norden'), h = r.page;
  const title = (r.body.match(/<title>([^<]*)<\/title>/) || [])[1] || '', desc = (r.body.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  ok(r.status === 200 && /^Elpriser i Norden/.test(title) && title.length <= 62 && desc.length >= 80 && desc.length <= 155, '/norden: 200, titel og beskrivelse', `${title.length}/${desc.length}`);
  ok(/<html lang="da"/.test(h) && (h.match(/<h1[ >]/g) || []).length === 1 && /<h1 class="page-title">Elpriser i Norden/.test(h), '/norden: dansk, én h1');
  ok(upstream.length === 13, '/norden: serveren henter alle 13 områder', String(upstream.length));
  const rows = [...h.matchAll(/<tr id="(\w+)"><th scope="row">(?:<a href="([^"]+)">)?([^<]+)(?:<\/a>)?<\/th><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)];
  ok(rows.length === 13, '/norden: tabellen har 13 rækker (11 udenlandske + DK1 og DK2 til sammenligning)', String(rows.length));
  ok(rows.map(m => m[1]).join(',') === 'no1,no2,no3,no4,no5,se1,se2,se3,se4,fi,nl,dk1,dk2', '/norden: rækkefølgen er NO, SE, FI, NL, DK');
  const href = Object.fromEntries(rows.map(m => [m[1], m[2]]));
  ok(href.no2 === '/no/strompris#no2' && href.se4 === '/sv/elpris#se4' && href.fi === '/fi/sahkon-hinta' && href.nl === '/nl/stroomprijs' && href.dk1 === '/dk1' && href.dk2 === '/dk2', '/norden: rækkerne linker til landesidens anker', JSON.stringify(href));
  ok(href.nl === '/nl/stroomprijs', '/norden: NL-rækken linker til /nl/stroomprijs ligesom de andre lande', String(href.nl));
  // DKK/kWh = EUR/MWh ÷ 1000 × 7,5 (kursen i DK1-svaret): NO2 hour h of today.
  const nowH = +new Intl.DateTimeFormat('en-GB', { ...cph, hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  const no2 = rows.find(m => m[1] === 'no2'), eur = nordic('no2').days[1].prices[nowH].eur_mwh;
  ok(no2[4] === (eur / 1000 * RATE.dk1).toFixed(2).replace('.', ','), '/norden: NO2 nu i kr/kWh med DK1-svarets eurokurs', `${no2[4]} vs ${(eur / 1000 * RATE.dk1).toFixed(2)}`);
  ok(rows.every(m => /^\d+,\d\d$/.test(m[4]) && /^\d+,\d\d$/.test(m[5]) && /^\d+,\d\d$/.test(m[6]) && /^\d+,\d\d–\d+,\d\d$/.test(m[7])), '/norden: alle tal er kr med komma og to decimaler, og 5 døgn er et spænd', rows.map(m => m[7]).join(' '));
  ok(/<p class="nt-cap">Spotpris i DKK\/kWh uden moms, afgifter og nettariffer/.test(h) && /Centralbanks dagskurs \(7,50 kr pr\. euro\)/.test(h), '/norden: grundlaget står i teksten, med kursen');
  ok(!TEN.test(h), '/norden: ingen tekst om 10 døgn');
  const n = upstream.length; const again = await get('/norden');
  ok(again.page === h && upstream.length === n && [...store.keys()].some(k => /zone-ssr-v\d+\/norden$/.test(k)), '/norden: cachet som forsiden, med egen nøgle');
  // One area down: the table still draws, the row shows dashes, and nothing is cached.
  store.clear(); missing = new Set(['nl']);
  const part = (await get('/norden')).page;
  ok(/<tr id="nl"><th scope="row"><a href="\/nl\/stroomprijs">NL Nederland<\/a><\/th><td>—<\/td><td>—<\/td><td>—<\/td><td>—<\/td>/.test(part) && store.size === 0, '/norden uden NL: en tom række og ingen cache');
  missing = new Set();
}

// ── The old URLs, the sitemap, the language of the rest of the site ───────────────
const OLD = { '/no1': '/no/strompris#no1', '/no2': '/no/strompris#no2', '/no3': '/no/strompris#no3', '/no4': '/no/strompris#no4', '/no5': '/no/strompris#no5',
  '/se1': '/sv/elpris#se1', '/se2': '/sv/elpris#se2', '/se3': '/sv/elpris#se3', '/se4': '/sv/elpris#se4', '/fi': '/fi/sahkon-hinta', '/nl': '/nl/stroomprijs',
  // the first spelling of the country pages (live for a day) goes straight to the final URL too
  '/norge': '/no/strompris', '/sverige': '/sv/elpris', '/finland': '/fi/sahkon-hinta' };
for (const [from, to] of Object.entries(OLD)) {
  const r = await get(from + '?utm_source=x');
  ok(r.status === 301 && r.headers.get('location') === 'https://elpriser.org' + to.replace(/(#.*)?$/, m => '?utm_source=x' + m), `${from} → 301 ${to}`, `${r.status} ${r.headers.get('location')}`);
}
{
  const sm = (await get('/sitemap.xml')).body;
  const locs = [...sm.matchAll(/<loc>https:\/\/elpriser\.org([^<]*)<\/loc>/g)].map(m => m[1]);
  ok(['/no/strompris', '/sv/elpris', '/fi/sahkon-hinta', '/nl/stroomprijs', '/norden'].every(p => locs.includes(p)), 'sitemap: de fem sider');
  ok(Object.keys(OLD).every(p => !locs.includes(p)), 'sitemap: ingen af de 11 gamle zone-adresser eller de tre første sidenavne');
  const prio = p => +sm.match(new RegExp(`<loc>https://elpriser\\.org${p}</loc>[\\s\\S]*?<priority>([\\d.]+)`))[1];
  ok(['/no/strompris', '/sv/elpris', '/fi/sahkon-hinta', '/nl/stroomprijs', '/norden'].every(p => prio(p) < prio('/dk1') && prio(p) < prio('/dk1/n1') + 0.01), 'sitemap: de fem ligger under de danske sider i prioritet');
  const llms = (await get('/llms.txt')).body;
  ok(['/norden', '/no/strompris', '/sv/elpris', '/fi/sahkon-hinta', '/nl/stroomprijs'].every(p => llms.includes(`https://elpriser.org${p})`)) && Object.keys(OLD).every(p => !llms.includes(`elpriser.org${p})`)) && !/10 døgn[^.]*(Norge|Sverige|Finland|prisområder)/.test(llms.slice(llms.indexOf('[Elpriser i Norden]'), llms.indexOf('[Automation]'))),
    'llms.txt: de fem sider, ingen gamle adresser og ingen 10 døgn om dem');
  ok((await get('/no6')).status === 404, 'et ukendt zone-nummer er stadig 404');
  ok((await get('/no')).status === 404 && (await get('/sv')).status === 404 && (await get('/no/strompris/')).status === 301 && (await get('/no/ukendt')).status === 404, 'sprogmapperne alene er 404, en skråstreg efter siden er 301, en ukendt side under mappen er 404');
}

console.log(`${pass} beståede, ${fails.length} fejl`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
