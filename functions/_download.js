/**
 * The app page in every language: /download (Danish, the source) and /<lang>/download for the other 25.
 *
 * ONE template (downloadMain) draws every language from ONE translations table (_download_i18n.js, DL_TEXT) and ONE status table
 * (APPS and FACTS below). What is true of the apps today lives only here:
 *
 *   APPS   status of each product: live | soon | planned | next. The card's data-status, its chip and its store link follow; flip a status
 *          here and run `node scripts/sync-download-page.mjs` (it rewrites the Danish page in index.html; the other languages are drawn
 *          by the Function and need nothing).
 *   FACTS  the numbers every language says: 26 languages, 30 countries, the minimum systems, the two store links.
 *
 * The Danish page is the source of the text: its wording is the `da` entry of the table. index.html carries the Danish <main> as plain
 * HTML (the single-page router shows it without a round trip, and a crawler reads it without script); scripts/sync-download-page.mjs writes it
 * from this template, and the gate fails when it is out of date. The Function draws the other languages into the same shell (index.html) with
 * a header and footer in their language (chromeHTML's sibling in the Pris block). A leading underscore keeps this file out of Pages' route table.
 */
import { DL_TEXT } from './_download_i18n.js';
import { DL_IMG } from './_download_img.js';

export const DL_BASE = 'https://elpriser.org';

/** What is released. The one place to change a status (see the header). */
export const APPS = {
  iphone: 'live',
  ipad: 'live',
  androidPhone: 'live',
  androidTablet: 'live',
  mac: 'live',          // macOS 1.3.0 Ready for Distribution 2026-11-08 (same App Store page as the iPhone app: universal purchase)
  watch: 'live',        // in iOS 1.3.0, live 2026-11-04 (installs from the iPhone app)
  reminders: 'live',    // in iOS and Android 1.3.0 (live since 2026-11-04)
  widget: 'live',       // iPhone widget in iOS 1.3.0; the Android widget is not built yet
};

/** The facts every language states. test-static.js checks the counts against i18n/languages.json and the apps. */
export const FACTS = {
  langs: 26, countries: 30, ios: '18', android: '8', mac: '15',
  appStore: 'https://apps.apple.com/dk/app/id6820474476',
  play: 'https://play.google.com/store/apps/details?id=org.elpriser.app',
};

/**
 * The languages with a page. code = the URL (/<code>/download; Danish is /download), html = <html lang>, loc = og:locale, name = the
 * language in itself, chrome = the key of CHROME_I18N in the Pris block (header and footer words), hreflang. The list is the one of
 * i18n/languages.json; test-download-i18n.mjs keeps them equal.
 */
export const DL_LANGS = [
  { code: 'da', html: 'da', loc: 'da_DK', name: 'Dansk', chrome: null },
  { code: 'en', html: 'en', loc: 'en_GB', name: 'English', chrome: 'en' },
  { code: 'de', html: 'de', loc: 'de_DE', name: 'Deutsch', chrome: 'de' },
  { code: 'fr', html: 'fr', loc: 'fr_FR', name: 'Français', chrome: 'fr' },
  { code: 'nl', html: 'nl', loc: 'nl_NL', name: 'Nederlands', chrome: 'nl' },
  { code: 'it', html: 'it', loc: 'it_IT', name: 'Italiano', chrome: 'it' },
  { code: 'pl', html: 'pl', loc: 'pl_PL', name: 'Polski', chrome: 'pl' },
  { code: 'sv', html: 'sv', loc: 'sv_SE', name: 'Svenska', chrome: 'sv' },
  { code: 'nb', html: 'nb', loc: 'nb_NO', name: 'Norsk bokmål', chrome: 'nb' },
  { code: 'fi', html: 'fi', loc: 'fi_FI', name: 'Suomi', chrome: 'fi' },
  { code: 'cs', html: 'cs', loc: 'cs_CZ', name: 'Čeština', chrome: 'cs' },
  { code: 'hu', html: 'hu', loc: 'hu_HU', name: 'Magyar', chrome: 'hu' },
  { code: 'sl', html: 'sl', loc: 'sl_SI', name: 'Slovenščina', chrome: 'sl' },
  { code: 'es', html: 'es', loc: 'es_ES', name: 'Español', chrome: 'es' },
  { code: 'pt', html: 'pt', loc: 'pt_PT', name: 'Português', chrome: 'pt' },
  { code: 'sk', html: 'sk', loc: 'sk_SK', name: 'Slovenčina', chrome: 'sk' },
  { code: 'el', html: 'el', loc: 'el_GR', name: 'Ελληνικά', chrome: 'el' },
  { code: 'ro', html: 'ro', loc: 'ro_RO', name: 'Română', chrome: 'ro' },
  { code: 'bg', html: 'bg', loc: 'bg_BG', name: 'Български', chrome: 'bg' },
  { code: 'hr', html: 'hr', loc: 'hr_HR', name: 'Hrvatski', chrome: 'hr' },
  { code: 'sr', html: 'sr-Latn', loc: 'sr_RS', name: 'Srpski', chrome: 'sr-Latn' },
  { code: 'et', html: 'et', loc: 'et_EE', name: 'Eesti', chrome: 'et' },
  { code: 'lv', html: 'lv', loc: 'lv_LV', name: 'Latviešu', chrome: 'lv' },
  { code: 'lt', html: 'lt', loc: 'lt_LT', name: 'Lietuvių', chrome: 'lt' },
  { code: 'mk', html: 'mk', loc: 'mk_MK', name: 'Македонски', chrome: 'mk' },
  { code: 'sq', html: 'sq', loc: 'sq_AL', name: 'Shqip', chrome: 'sq' },
];
const BY_CODE = Object.fromEntries(DL_LANGS.map(l => [l.code, l]));

/** The path of a language's page: /download for Danish, /<code>/download for the rest. */
export const dlPath = code => (code === 'da' ? '/download' : `/${code}/download`);
export const dlLang = code => BY_CODE[code] || null;
/** The language of the page at `pathname` ('/de/download' → 'de', '/download' → 'da'), or null. */
export function dlLangOfPath(pathname) {
  if (pathname === '/download') return 'da';
  const m = /^\/([a-z]{2})\/download$/.exec(pathname);
  return m && BY_CODE[m[1]] && m[1] !== 'da' ? m[1] : null;
}
// ── Small helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Fill the {tokens} of a string: the facts, plus `n` (the minimum version) where the caller has one. */
const fill = (s, extra = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => {
  const all = { ...FACTS, langs1: FACTS.langs - 1, countries1: FACTS.countries - 1, ...extra };
  return k in all ? all[k] : m;
});
const T = (t, k, extra) => {
  const v = t[k];
  if (v === undefined) throw new Error(`download text: missing key ${k}`);
  return Array.isArray(v) ? v.map(x => fill(x, extra)) : fill(v, extra);
};
const heading = ([a, b]) => `${esc(a)} <b>${esc(b)}</b>`;

/** JSON-LD in the file's own style: one key per line, nested values on one line. */
const inl = v => (Array.isArray(v) ? `[${v.map(inl).join(', ')}]` : v && typeof v === 'object'
  ? `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inl(x)}`).join(', ')}}` : JSON.stringify(v));
const ldBlock = o => `{\n${Object.entries(o).map(([k, v]) => `  ${JSON.stringify(k)}: ${inl(v)}`).join(',\n')}\n}`.replace(/</g, '\\u003c');

// ── The pieces of the page ────────────────────────────────────────────────────────────────────────────────────────────
const REVEAL_SCRIPT = `<script>(function(){var m=document.currentScript.parentNode;if(!('IntersectionObserver' in window)||(window.matchMedia&&matchMedia('(prefers-reduced-motion:reduce)').matches))return;m.classList.add('dl-js');function go(){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('is-in');io.unobserve(e.target);}});},{rootMargin:'0px 0px -6% 0px',threshold:.06});m.querySelectorAll('.dl-rv').forEach(function(el){io.observe(el);});addEventListener('beforeprint',function(){m.querySelectorAll('.dl-rv').forEach(function(el){el.classList.add('is-in');});});}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();})();</script>`;
const STORE_ORDER_SCRIPT = `<script>(function(){var b=document.currentScript.previousElementSibling,u=navigator.userAgent;if(/Android/i.test(u))b.className+=' is-android';else if(/iPhone|iPad|iPod/.test(u)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))b.className+=' is-ios';})();</script>`;
/** One screenshot in its CSS device frame. `img` = { base: '/download/img/x', w, h, dev: 'ios' | 'and' } (files base-360.webp and base-720.webp). */
function phone(img, { sizes, alt, eager }) {
  const big = img.big || img.w * 2;
  return `<div class="dl-phone${img.dev === 'ios' ? ' dl-ios' : ''}"><img src="${img.base}-${big}.webp" srcset="${img.base}-${img.w}.webp ${img.w}w, ${img.base}-${big}.webp ${big}w" sizes="${sizes}" width="${img.w}" height="${img.h}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} alt="${esc(alt)}"></div>`;
}
const SZ = { one: '(min-width:860px) 300px, 270px', two: '(min-width:860px) 260px, 50vw' };

function feat(t, { k, rev, band, media, one }) {
  const [a, b] = [T(t, `${k}K`), T(t, `${k}H`)];
  return `  <section class="dl-sec${band ? ' dl-band' : ''}">
    <div class="dl-in dl-feat${rev ? ' dl-rev' : ''}">
      <div class="dl-copy dl-rv">
        <p class="dl-kicker">${esc(a)}</p>
        <h2 class="dl-h">${heading(b)}</h2>
        <p class="dl-p">${esc(T(t, `${k}P`))}</p>
      </div>
      <div class="dl-media${one ? ' dl-media-one' : ''} dl-rv" style="--d:.1s">
        ${media.map(m => phone(m.img, { sizes: one ? SZ.one : SZ.two, alt: T(t, m.alt) })).join('\n        ')}
      </div>
    </div>
  </section>`;
}
function headOnly(t, { k, band }) {
  return `  <section class="dl-sec${band ? ' dl-band' : ''}">
    <div class="dl-in">
      <div class="dl-head dl-mid dl-rv">
        <p class="dl-kicker">${esc(T(t, `${k}K`))}</p>
        <h2 class="dl-h">${heading(T(t, `${k}H`))}</h2>
        <p class="dl-p">${esc(T(t, `${k}P`))}</p>
      </div>
    </div>
  </section>`;
}

function basics(t, band) {
  const items = ['bFree', 'bNoAccount', 'bNoAds', 'bLangs', 'bTheme'];
  const delays = ['', ' style="--d:.05s"', ' style="--d:.1s"', ' style="--d:.15s"', ' style="--d:.2s"'];
  return `  <!-- ── The basics ── -->
  <section class="dl-sec${band ? ' dl-band' : ''}" aria-labelledby="dlBasics">
    <div class="dl-in">
      <div class="dl-head dl-rv"><p class="dl-kicker">${esc(T(t, 'basicsKicker'))}</p><h2 class="dl-h" id="dlBasics">${heading(T(t, 'basicsH'))}</h2></div>
      <ul class="dl-basics" style="margin-top:2.5rem">
${items.map((k, i) => { const [s, d] = T(t, k); return `        <li class="dl-rv"${delays[i]}><strong>${esc(s)}</strong><span>${esc(d)}</span></li>`; }).join('\n')}
      </ul>
    </div>
  </section>`;
}

function europeBig(t) {
  return `  <!-- ── Europe ── -->
  <section class="dl-sec" data-status="live" aria-labelledby="dlEu">
    <div class="dl-in dl-eu">
      <p class="dl-big dl-rv" aria-hidden="true">${FACTS.countries}<small>${esc(T(t, 'euBig'))}</small></p>
      <div class="dl-copy dl-rv" style="--d:.1s">
        <p class="dl-kicker">${esc(T(t, 'euK'))}</p>
        <h2 class="dl-h" id="dlEu">${heading(T(t, 'euH'))}</h2>
        <p class="dl-p">${esc(T(t, 'euP'))}</p>
      </div>
    </div>
  </section>`;
}

function tablets(t, img) {
  const frame = (i, caption, delay, alt) => `        <figure class="dl-tab dl-rv"${delay}>
          <div class="dl-frame"><img src="${i.base}-${i.big}.webp" srcset="${i.base}-${i.w}.webp ${i.w}w, ${i.base}-${i.big}.webp ${i.big}w" sizes="(min-width:860px) 520px, calc(100vw - 52px)" width="${i.w}" height="${i.h}" loading="lazy" alt="${esc(alt)}"></div>
          <figcaption>${caption}</figcaption>
        </figure>`;
  return `  <!-- ── Tablets ── -->
  <section class="dl-sec dl-band" aria-labelledby="dlTablet">
    <div class="dl-in">
      <div class="dl-head dl-mid dl-rv">
        <p class="dl-kicker">${esc(T(t, 'tabKicker'))}</p>
        <h2 class="dl-h" id="dlTablet">${heading(T(t, 'tabH'))}</h2>
        <p class="dl-p">${esc(T(t, 'tabP'))}</p>
      </div>
      <div class="dl-tabs">
${frame(img.ipad, `<b>${esc(T(t, 'nIpad'))}</b> · ${esc(T(t, 'osIpad', { n: FACTS.ios }))}`, '', T(t, 'altIpad'))}
${frame(img.tablet, `<b>${esc(T(t, 'nAndroidTablet'))}</b> · ${esc(T(t, 'osAndroid', { n: FACTS.android }))}`, ' style="--d:.1s"', T(t, 'altTablet'))}
      </div>
    </div>
  </section>`;
}

/** The bars of a mini chart: r = expensive, a = average, none = cheap; one height in % per bar. */
const bars = list => list.map(([c, h]) => `<i${c ? ` class="${c}"` : ''} style="height:${h}%"></i>`).join('');
const DAY = [['r', 90], ['r', 80], ['a', 60], ['', 45], ['', 40], ['a', 55], ['r', 85], ['r', 70]];

/** One image of a card's device: the 1x/2x pair of the page's screenshots. */
function cardImg(i, { sizes, alt }) {
  const big = i.big || i.w * 2;
  return `<img src="${i.base}-${big}.webp" srcset="${i.base}-${i.w}.webp ${i.w}w, ${i.base}-${big}.webp ${big}w" sizes="${sizes}" width="${i.w}" height="${i.h}" loading="lazy" alt="${esc(alt)}">`;
}

/**
 * The scene at the top of a card: the device with the app on it (a real screenshot in a CSS frame), or, where there is no capture of the
 * thing (Apple Watch, reminders, widget), a drawing built from the app's own words. Everything drawn is aria-hidden; the numbers of a
 * drawing sit in data-v / data-t and are painted by CSS, so they are not part of the page's text.
 */
function stage(t, key, img, da) {
  const alt = k => T(t, k);
  switch (key) {
    case 'iphone': return phone(da ? img.iosNow : img.hero1, { sizes: '150px', alt: alt(da ? 'altIosNow' : 'altHero1') });
    case 'androidPhone': return phone(da ? img.andNow : img.hero2, { sizes: '150px', alt: alt(da ? 'altAndNow' : 'altHero2') });
    case 'ipad': return `<div class="dl-dtab">${cardImg(img.ipad, { sizes: '(min-width:960px) 280px, 70vw', alt: alt('altIpad') })}</div>`;
    case 'androidTablet': return `<div class="dl-dtab">${cardImg(img.tablet, { sizes: '(min-width:960px) 280px, 70vw', alt: alt('altTablet') })}</div>`;
    case 'mac': return `<div class="dl-mac"><div class="dl-lid">${cardImg(img.mac, { sizes: '(min-width:960px) 300px, 80vw', alt: alt('altMac') })}</div><div class="dl-mbase"></div></div>`;
    case 'watch': return `<div class="dl-watch" aria-hidden="true"><div class="dl-wcase"><div class="dl-wscr"><span class="dl-wpr" data-v="${esc(T(t, 'mkPrice'))}"></span><span class="dl-wbars">${bars(DAY.slice(0, 7))}</span></div></div></div>`;
    case 'reminders': return `<div class="dl-notif" aria-hidden="true"><span class="dl-nic"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M13.5 2 5 13.5h5.5L9.5 22 19 9.5h-5.7z"/></svg></span><b>${esc(T(t, 'mkTitle'))}</b><span>${esc(T(t, 'mkLead'))}<br><span class="dl-ct" data-t="${esc(T(t, 'mkLine'))}"></span></span></div>`;
    case 'widget': return `<div class="dl-wdg" aria-hidden="true"><div class="dl-wsm"><span class="dl-wlab">${esc(T(t, 'mkVerdict'))}</span><span class="dl-wbig" data-v="${esc(T(t, 'mkPrice'))}"></span><span class="dl-wun">${esc(T(t, 'mkUnit'))}</span><span class="dl-wmini">${bars(DAY)}</span></div><div class="dl-wlock"><span class="dl-wl" data-v="${esc(T(t, 'mkPrice'))}"></span><small>${esc(T(t, 'mkUnit'))}</small></div></div>`;
    default: throw new Error(`no stage for ${key}`);
  }
}

function cards(t, img, da) {
  const chip = st => T(t, { live: 'chipLive', soon: 'chipSoon', planned: 'chipPlanned', next: 'chipNext' }[st]);
  const link = (store, aria) => {
    const href = store === 'apple' ? FACTS.appStore : FACTS.play;
    return `          <a class="dl-more" href="${href}" rel="noopener" aria-label="${esc(T(t, aria))}" data-placement="card">${store === 'apple' ? 'App Store' : 'Google Play'} <span aria-hidden="true">&rarr;</span></a>`;
  };
  const card = ({ key, name, desc, os, store, aria, delay }) => {
    const st = APPS[key];
    return `        <li class="dl-card dl-rv" data-status="${st}"${delay ? ` style="--d:${delay}s"` : ''}>
          <div class="dl-stage">${stage(t, key, img, da)}</div>
          <h3>${esc(T(t, name))}</h3><span class="dl-chip">${esc(chip(st))}</span>
          <p>${esc(T(t, desc))}</p>${os ? `\n          <p class="dl-os">${esc(T(t, os[0], { n: os[1] }))}</p>` : ''}${st === 'live' && store ? '\n' + link(store, aria) : ''}
        </li>`;
  };
  const all = [
    { key: 'iphone', name: 'nIphone', desc: 'cIphone', os: ['osIos', FACTS.ios], store: 'apple', aria: 'openIphone' },
    { key: 'ipad', name: 'nIpad', desc: 'cIpad', os: ['osIpad', FACTS.ios], store: 'apple', aria: 'openIpad', delay: '.05' },
    { key: 'androidPhone', name: 'nAndroidPhone', desc: 'cAndroidPhone', os: ['osAndroid', FACTS.android], store: 'play', aria: 'openAndroidPhone', delay: '.1' },
    { key: 'androidTablet', name: 'nAndroidTablet', desc: 'cAndroidTablet', os: ['osAndroid', FACTS.android], store: 'play', aria: 'openAndroidTablet' },
    { key: 'mac', name: 'nMac', desc: 'cMac', os: ['osMac', FACTS.mac], store: 'apple', aria: 'openMac', delay: '.05' },
    { key: 'watch', name: 'nWatch', desc: 'cWatch', store: 'apple', aria: 'openWatch', delay: '.1' },
    { key: 'reminders', name: 'nReminders', desc: 'cReminders' },
    { key: 'widget', name: 'nWidget', desc: 'cWidget', delay: '.05' },
  ];
  return `  <!-- ── Overview of all the apps ──
       STATUS SWITCH: each card carries data-status="live | soon | planned | next". The chip text and the store link follow the status: flip it in APPS in functions/_download.js, then run node scripts/sync-download-page.mjs.
       Today (2026-11-08): everything is live. Every card has a scene on top: the app on its device (iPhone, iPad, Android phone and tablet, Mac: real screenshots) or a drawing (Apple Watch, reminders, widget). -->
  <section class="dl-sec" aria-labelledby="dlApps">
    <div class="dl-in">
      <div class="dl-head dl-rv"><p class="dl-kicker">${esc(T(t, 'appsKicker'))}</p><h2 class="dl-h" id="dlApps">${heading(T(t, 'appsH'))}</h2>
        <p class="dl-p">${esc(T(t, 'appsP'))}</p></div>
      <ul class="dl-cards">
${all.map(card).join('\n')}
      </ul>
    </div>
  </section>`;
}

function ways(t, list, count) {
  const delays = ['', ' style="--d:.05s"', ' style="--d:.1s"', ' style="--d:.15s"', ' style="--d:.2s"', ' style="--d:.25s"'];
  return `  <!-- ── Other ways to get the prices ── -->
  <section class="dl-sec dl-band" aria-labelledby="dlWays">
    <div class="dl-in">
      <div class="dl-head dl-rv"><p class="dl-kicker">${esc(T(t, 'waysKicker'))}</p><h2 class="dl-h" id="dlWays">${heading(T(t, 'waysH'))}</h2></div>
      <ul class="dl-ways"${count ? ` data-n="${list.length}"` : ''}>
${list.map(([key, href, ext], i) => { const [b, s] = T(t, key); return `        <li class="dl-rv"${delays[i]}><a class="dl-way" href="${href}"${ext ? ' rel="noopener"' : ''}><b>${esc(b)} <i aria-hidden="true">&rarr;</i></b><span>${esc(s)}</span></a></li>`; }).join('\n')}
      </ul>
    </div>
  </section>`;
}

/** The images of the Danish page (the old file names, the Danish captures). */
const daImg = (name, h, dev) => ({ base: `/download/img/${name}`, w: 360, h, big: 720, dev });
const DA = {
  iosNow: daImg('iphone-nu', 782, 'ios'), iosDark: daImg('iphone-moerk', 782, 'ios'), andNow: daImg('android-nu', 720, 'and'), andDark: daImg('android-moerk', 720, 'and'),
  price: daImg('iphone-opdeling', 782, 'ios'), days: daImg('iphone-5dage', 782, 'ios'), welcome: daImg('android-velkommen', 720, 'and'),
  netList: daImg('iphone-netselskab', 782, 'ios'), smart: daImg('iphone-smart-hjem', 782, 'ios'),
  ipad: { base: '/download/img/ipad-nu', w: 640, h: 480, big: 1280 }, tablet: { base: '/download/img/android-tablet-nu', w: 640, h: 400, big: 1280 },
  mac: { base: '/download/img/mac-da', w: 640, h: 407, big: 1280 },
};
/** The images of another language, from the manifest the image script writes. */
function xImg(code) {
  const m = DL_IMG[code];
  if (!m) throw new Error(`no screenshots for ${code}`);
  const o = {};
  for (const [slot, v] of Object.entries(m)) o[slot] = { base: `/download/img/${v.dir}/${slot}`, w: v.w, h: v.h, big: v.big, dev: v.dev };
  // The Mac window exists in Danish and English only; every other language shows the English one (the layout is the same)
  o.mac = { base: '/download/img/mac-en', w: 640, h: 407, big: 1280 };
  return o;
}

function ldFor(code, t, img, url) {
  const da = code === 'da';
  const shots = da ? [DA.iosNow, DA.price, DA.days, DA.andNow] : [img.hero1, img.country, img.smart, img.hero2];
  return {
    '@context': 'https://schema.org',
    '@type': 'MobileApplication',
    name: da ? 'Elpriser – time for time' : 'Elpriser',
    url,
    description: T(t, 'ldDesc'),
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: `${T(t, 'osIos', { n: FACTS.ios })}, ${T(t, 'osMac', { n: FACTS.mac })}, ${T(t, 'osAndroid', { n: FACTS.android })}`,
    inLanguage: BY_CODE[code].html,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: da ? 'DKK' : 'EUR' },
    downloadUrl: [FACTS.appStore, FACTS.play],
    featureList: T(t, 'features'),
    screenshot: shots.map(s => `${DL_BASE}${s.base}-${s.big || s.w * 2}.webp`),
    publisher: { '@type': 'Organization', name: 'elpriser.org', url: 'https://elpriser.org' },
  };
}

/**
 * The <main data-page="download"> of a language. `opts.homeHref` is where "the website" goes in the other languages (the page of the
 * country in this language; the caller knows PRIS_COUNTRIES), `opts.privacy` the footer's word for the privacy page.
 */
export function downloadMain(code, opts = {}) {
  const lang = BY_CODE[code];
  const t = DL_TEXT[code];
  if (!lang || !t) throw new Error(`no download page for ${code}`);
  const da = code === 'da';
  const img = da ? null : xImg(code);
  const url = DL_BASE + dlPath(code);
  const badge = da ? 'da' : 'en';
  const hero = da
    ? [phone(DA.iosNow, { sizes: '(min-width:640px) 300px, 230px', alt: T(t, 'altIosNow'), eager: true }), phone(DA.iosDark, { sizes: '300px', alt: T(t, 'altIosDark') })]
    : [phone(img.hero1, { sizes: '(min-width:640px) 300px, 230px', alt: T(t, 'altHero1'), eager: true }), phone(img.hero2, { sizes: '300px', alt: T(t, 'altHero2') })];

  const head = `<main style="display:none" data-page="download" class="dl-page"${da ? '' : ` data-lang="${code}"`}>
  <!-- Reveal-on-scroll switch. It runs first so the class is on before anything is painted; without JS, with reduced motion or without IntersectionObserver nothing is ever hidden. -->
  ${REVEAL_SCRIPT}
  <!-- The live apps (iPhone, iPad, Mac and Watch in App Store, Android phone and tablet on Google Play; the same two store pages), described once. -->
  <script type="application/ld+json">${ldBlock(ldFor(code, t, img, url))}</script>

  <!-- ── Hero ── -->
  <section class="dl-hero">
    <div class="dl-in">
      <div class="page-eyebrow dl-rv">${esc(T(t, 'eyebrow'))}</div>
      <div class="dl-rv" style="--d:.05s"><h2 class="page-title">${esc(T(t, 'h1'))}</h2></div>
      <p class="dl-lead dl-rv" style="--d:.1s">${esc(T(t, 'lead'))}</p>
      <div class="dl-rv" style="--d:.15s" data-placement="hero"><div class="dl-stores">
        <a class="dl-badge dl-apple" href="${FACTS.appStore}" rel="noopener" aria-label="${esc(T(t, 'appleLabel'))}"><img src="/badges/app-store-${badge}.svg" alt="" width="156" height="52"></a>
        <a class="dl-badge dl-play" href="${FACTS.play}" rel="noopener" aria-label="${esc(T(t, 'playLabel'))}"><img src="/badges/google-play-${badge}.png" alt="" width="175" height="52"></a>
      </div>
      ${STORE_ORDER_SCRIPT}</div>
      <p class="dl-req">${esc(T(t, 'req'))}</p>
      <div class="dl-hero-dev">
        ${hero.join('\n        ')}
      </div>
    </div>
  </section>

  <!-- ── Features ── -->`;

  let body;
  if (da) {
    body = [
      feat(t, { k: 'now', media: [{ img: DA.andNow, alt: 'altAndNow' }, { img: DA.andDark, alt: 'altAndDark' }] }),
      feat(t, { k: 'price', band: true, rev: true, one: true, media: [{ img: DA.price, alt: 'altPrice' }] }),
      feat(t, { k: 'days', one: true, media: [{ img: DA.days, alt: 'altDays' }] }),
      feat(t, { k: 'net', band: true, rev: true, media: [{ img: DA.welcome, alt: 'altWelcome' }, { img: DA.netList, alt: 'altNetList' }] }),
      feat(t, { k: 'smart', one: true, media: [{ img: DA.smart, alt: 'altSmart' }] }),
      basics(t, true),
      europeBig(t),
      tablets(t, DA),
      cards(t, DA, true),
      ways(t, [['wWeb', '/'], ['wHA', 'https://github.com/x2q/ha-elpriser', 1], ['wShelly', '/automation#shelly'], ['wApi', '/api'], ['wMcp', 'https://github.com/x2q/elpriser-mcp', 1], ['wAll', '/integrationer']]),
      `  <section class="dl-sec" style="padding-top:3rem;padding-bottom:3rem">
    <div class="dl-in">
      <p class="dl-note dl-rv" style="text-align:center">${t.noteHtml}</p>
    </div>
  </section>`,
    ];
  } else {
    body = [
      headOnly(t, { k: 'now' }),
      feat(t, { k: 'eu', band: true, rev: true, one: true, media: [{ img: img.country, alt: 'altCountry' }] }),
      feat(t, { k: 'smart', one: true, media: [{ img: img.smart, alt: 'altSmart' }] }),
      headOnly(t, { k: 'dk', band: true }),
      basics(t, false),
      tablets(t, img),
      cards(t, img, false),
      ways(t, [['wWeb', opts.homeHref || '/'], ['wHA', 'https://github.com/x2q/ha-elpriser', 1], ['wMcp', 'https://github.com/x2q/elpriser-mcp', 1]], true),
      `  <section class="dl-sec" style="padding-top:3rem;padding-bottom:3rem">
    <div class="dl-in">
      <p class="dl-note dl-rv" style="text-align:center">${esc(T(t, 'note'))} <a href="/privacy" hreflang="en">${esc(opts.privacy || '')}</a></p>
    </div>
  </section>`,
    ];
  }
  // The Danish markup closes the tablets and cards without a blank line in between only where the original did; sections are separated by one.
  return head + '\n' + body.join('\n\n') + '\n</main>';
}

/** Title, description and language of a page, for the SEO entry. */
export function downloadMeta(code) {
  const t = DL_TEXT[code], l = BY_CODE[code];
  return { title: t.metaTitle, description: t.metaDesc, hash: '#download', lang: l.html, loc: l.loc, download: code };
}

/** <link rel="alternate" hreflang> for the whole set (every language incl. itself, x-default = English). */
export function dlAlternates() {
  const tag = (hl, href) => `<link rel="alternate" hreflang="${hl}" href="${DL_BASE}${href}">`;
  return [...DL_LANGS.map(l => tag(l.html, dlPath(l.code))), tag('x-default', dlPath('en'))];
}

/** The hreflang set for the sitemap's xhtml:link lines. */
export const dlSitemapLinks = () => [...DL_LANGS.map(l => ({ hl: l.html, href: DL_BASE + dlPath(l.code) })), { hl: 'x-default', href: DL_BASE + dlPath('en') }];

/** One line for llms.txt (which is Danish): every language version of the page. */
export const dlLlmsLine = () => `- Hent appen findes på ${DL_LANGS.length} sprog, samme side med skærmbilleder på hvert sprog: ${DL_LANGS.map(l => `${l.name} (${DL_BASE}${dlPath(l.code)})`).join(', ')}.`;
