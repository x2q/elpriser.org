/**
 * The share images (Open Graph / Twitter cards), as DATA and as HTML. No browser in here: scripts/make-og-images.mjs renders the HTML,
 * test-og-images.mjs checks the result against the same specs, functions/_og_manifest.js (generated) tells the Function which file a page gets.
 *
 *   cardSpecs()      one spec per page that has its own image: the text comes from the repo's own tables (DL_TEXT for the app page, the country table
 *                    PRIS_COUNTRIES in the Pris block of functions/[[path]].js for the price pages) so a changed headline is a changed image; the
 *                    Danish pages' short headlines are the table DA below.
 *   cardHtml(spec)   the 1200 x 630 page for a spec (Manrope from the Android app's variable font, which has Latin, Latin Extended, Cyrillic and Greek;
 *                    the screenshots are the localized ones of download/img).
 *   specHash(spec)   a short hash of everything the picture is made of (the spec, the screenshot files, this file): the manifest keeps it, the
 *                    gate recomputes it, so an image that is older than its text or its screenshots fails the tests until `npm run og` is run.
 *
 * The path of an image is the path of the page: /de/download -> /og/de/download.png, /prognose -> /og/prognose.png, / -> /og/index.png.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const W = 1200, H = 630;
export const FONT = path.join(ROOT, 'ElpriserAndroid/app/src/main/res/font/manrope.ttf');   // Manrope variable (wght 200-800), SIL OFL 1.1; the web font manrope.woff2 is a Latin-only subset
const SELF = import.meta.filename;

export const ogPath = key => `/og${key === '/' ? '/index' : key}.png`;

// ── The tables the cards are made from ────────────────────────────────────────────────────────────────────────────────────────────────────────
const imp = f => import(pathToFileURL(path.join(ROOT, f)).href);
async function loadData() {
  const D = await imp('functions/_download.js');
  const { DL_TEXT } = await imp('functions/_download_i18n.js');
  const { DL_IMG } = await imp('functions/_download_img.js');
  // The Pris block of the Function: the country table and the zone names, run in a sandbox (the tests read it the same way).
  const src = fs.readFileSync(path.join(ROOT, 'functions/[[path]].js'), 'utf8');
  const a = src.indexOf('// ═══ Pris-skærmen (Design A: ét svar) ═══'), b = src.indexOf('// ═══ /Pris-skærmen ═══');
  const ctx = vm.createContext({ console, Date, Math });
  vm.runInContext(src.slice(a, b) + '\nglobalThis.out = { PRIS_COUNTRIES, ZONES };', ctx);
  return { DL_LANGS: D.DL_LANGS, FACTS: D.FACTS, DL_TEXT, DL_IMG, PRIS_COUNTRIES: ctx.out.PRIS_COUNTRIES, ZONES: ctx.out.ZONES };
}

/** The language of the download text table for a page language (Serbian in Latin script and the Montenegrin page share the table's `sr`). */
const dlKey = lang => (lang === 'sr-Latn' || lang === 'sr-ME' ? 'sr' : lang);
const fill = (s, facts) => String(s).replace(/\{(\w+)\}/g, (m, k) => {
  const all = { ...facts, langs1: facts.langs - 1, countries1: facts.countries - 1 };
  return k in all ? all[k] : m;
});

// ── The Danish pages: headline in two tones (the second is blue), a line under it, what the picture shows ───────────────────────────────────────────
// layout  duo = two phones, solo = one phone, chart = the price bars along the bottom, chips = names of what the page connects to
const PHONES = {
  now: ['iphone-nu-720', 'android-nu-720'],
  days: ['iphone-5dage-720'],
  net: ['iphone-netselskab-720'],
};
const INTEGRATIONS = ['Home Assistant', 'Shelly', 'evcc', 'openHAB', 'Node-RED', 'Homey', 'ESPHome', 'MCP'];
const DA = {
  '/': { layout: 'duo', phones: 'now', a: 'Elprisen lige nu,', b: 'time for time', sub: 'Inkl. Energinets tariffer, elafgift og moms, og med dit netselskab', chips: ['DK1 Vest', 'DK2 Øst', 'iPhone og Android'] },
  '/dk1': { layout: 'duo', phones: 'now', a: 'Elpris Vest (DK1)', b: 'i dag, time for time', sub: 'Spotpris inkl. Energinets tariffer, elafgift og moms', chips: ['Jylland og Fyn'] },
  '/dk2': { layout: 'duo', phones: 'now', a: 'Elpris Øst (DK2)', b: 'i dag, time for time', sub: 'Spotpris inkl. Energinets tariffer, elafgift og moms', chips: ['Sjælland, Lolland-Falster og Bornholm'] },
  '/prognose': { layout: 'solo', phones: 'days', a: 'Elpriser prognose', b: '2, 5 eller 7 døgn frem', sub: 'Time for time, DK1 og DK2', chips: ['Opdateres dagligt'] },
  '/elpriser-i-morgen': { layout: 'chart', a: 'Elpriser i morgen,', b: 'time for time', sub: 'Billigste og dyreste time for DK1 og DK2', chips: ['DK1 Vest', 'DK2 Øst'] },
  '/tariffer': { layout: 'solo', phones: 'net', a: 'Nettariffer 2026', b: 'for alle netselskaber', sub: 'Nettarif C pr. kWh: lav-, høj- og spidslast', chips: ['N1', 'Radius', 'Trefor', 'Cerius'] },
  '/automation': { layout: 'chips', a: 'Elpriser til', b: 'Home Assistant og Shelly', sub: 'Gratis API og færdig kode: styr varmepumpe, elbil og vandvarmer efter de billigste timer' },
  '/api': { layout: 'chips', a: 'Gratis API for', b: 'danske elpriser', sub: 'JSON uden nøgle, fuld CORS, OpenAPI 3.1', chips: ['Aktuel pris', 'Time for time', '10-dages prognose', 'CO₂', 'Nettariffer'] },
  '/shelly-tariff': { layout: 'chips', a: 'Shelly Live Tariff', b: 'med danske elpriser', sub: 'Tibber-kompatibel JSON, time for time inkl. nettarif, elafgift og moms', chips: ['Shelly', 'Tibber-kompatibel', 'DK1 og DK2'] },
  '/integrationer': { layout: 'chips', a: 'Integrationer og', b: 'API-biblioteker', sub: 'Plugins, klienter i Python og JavaScript og MCP: gratis og uden nøgle, med sand status' },
  '/norden': { layout: 'chart', a: 'Elpriser i Norden,', b: 'sammenlignet', sub: 'Norge, Sverige, Finland og Holland i kr/kWh', chips: ['NO1–NO5', 'SE1–SE4', 'FI', 'NL'] },
  '/om-elpriser': { layout: 'chart', a: 'Forstå din elpris:', b: 'spot, tarif og afgifter', sub: 'Spotpris, nettarif, systemtarif, elafgift og moms', chips: ['DK1 Vest', 'DK2 Øst'] },
  '/blog': { layout: 'chart', a: 'Guides og analyser', b: 'om elpriser', sub: 'Hvornår strømmen er billigst og grønnest, og hvad afgifterne gør' },
  '/blog/hvornaar-er-stroemmen-billigst': { layout: 'chart', a: 'Hvornår er strømmen billigst?', b: 'Nattestrøm er ikke længere svaret', sub: 'Analyse af 48.594 timers forbrugs- og prisdata' },
  '/blog/groennest-og-dyrest': { layout: 'chart', a: 'Hvorfor er strømmen grønnest', b: 'netop i den dyreste time?', sub: 'Analyse af 22.504 timers data' },
  '/blog/elafgift-og-spotpris': { layout: 'chart', a: 'Elafgift og spotpris:', b: 'sådan er elprisen ændret siden 2019', sub: 'Tal for DK1 og DK2' },
  '/blog/elafgift-2028': { layout: 'chart', a: 'Elafgift 2028:', b: 'fra 0,8 til 60+ øre/kWh', sub: 'Kommer elafgiften tilbage? Ja, fra 2028' },
};
const DA_LANG = { lang: 'da', html: 'da' };

/** What an image says, for og:image:alt: its words, in its language. */
const dot = t => (/[.!?]$/.test(t) ? t : t + '.');
const altOf = s => `${dot(`${s.head.a} ${s.head.b}`.replace(/\s+/g, ' ').trim().replace(/[:,]$/, ''))} ${dot(s.sub)}`;

export async function cardSpecs() {
  const { DL_LANGS, FACTS, DL_TEXT, DL_IMG, PRIS_COUNTRIES, ZONES } = await loadData();
  const specs = [];
  const shot = (file, kind) => ({ file, kind });
  const dl = p => `download/img/${p}.webp`;

  // 1. The app page, /download and /<lang>/download: the app on an iPhone and an Android phone, each in the language's own capture.
  for (const l of DL_LANGS) {
    const t = DL_TEXT[l.code], key = l.code === 'da' ? '/download' : `/${l.code}/download`;
    const shots = l.code === 'da'
      ? [shot(dl('iphone-nu-720'), 'ios'), shot(dl('android-nu-720'), 'and')]
      : ['hero1', 'hero2'].map((slot, i) => { const s = DL_IMG[l.code][slot]; return shot(dl(`${s.dir}/${slot}-${s.big}`), i ? 'and' : 'ios'); });
    const spec = { key, family: 'download', lang: l.html, layout: 'duo',
      head: { a: t.h1, b: '', mark: 'Elpriser' }, sub: t.eyebrow,
      chips: [t.bFree[0], t.bNoAccount[0], t.bNoAds[0]], shots };
    spec.alt = altOf(spec);
    specs.push(spec);
  }

  // 2. The price pages of the countries, in the country's language: the page's own h1 (before and after the colon in two tones), the line the app page
  //    says about the countries, the zones, and a price chart that is a drawing (the same shape for every page, only its wobble differs), not data.
  for (const [pg, C] of Object.entries(PRIS_COUNTRIES)) {
    const t = DL_TEXT[dlKey(C.lang)];
    const h1 = C.tx.h1, cut = h1.indexOf(': ');
    const head = cut > 0 ? { a: h1.slice(0, cut + 1), b: h1.slice(cut + 2) } : { a: h1, b: '' };
    const zones = C.zones.length > 1 ? C.zones.map(z => ZONES[z].name) : [];
    const spec = { key: '/' + pg, family: 'country', lang: C.lang, layout: 'chart', head, sub: fill(t.euH.join(' '), FACTS), chips: zones };
    spec.alt = altOf(spec);
    specs.push(spec);
  }

  // 3. The Danish pages.
  for (const [key, d] of Object.entries(DA)) {
    const spec = { key, family: 'da', lang: DA_LANG.lang, layout: d.layout, head: { a: d.a, b: d.b }, sub: d.sub, chips: d.chips || [] };
    if (d.layout === 'chips' && !d.chips) spec.chips = INTEGRATIONS;
    if (d.phones) spec.shots = PHONES[d.phones].map((f, i) => shot(dl(f), f.startsWith('android') ? 'and' : 'ios'));
    spec.alt = altOf(spec);
    specs.push(spec);
  }
  for (const s of specs) s.file = ogPath(s.key);
  return specs;
}

const sha = b => crypto.createHash('sha1').update(b).digest('hex');
export const specHash = spec => sha(JSON.stringify(spec)
  + (spec.shots || []).map(s => sha(fs.readFileSync(path.join(ROOT, s.file)))).join()
  + sha(fs.readFileSync(SELF))).slice(0, 8);

// ── The picture ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MARK = `<svg viewBox="0 0 512 512" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b57f5"/><stop offset="1" stop-color="#19338f"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><path d="M294 60 L150 290 h82 l-26 162 l168 -246 h-96 l26 -106 z" fill="#fff"/></svg>`;

/** Words joined by a hyphen stay on one line ("Elpriser-App", "iPhone-ra"): a break after the hyphen reads as two words. */
const keep = t => esc(t).replace(/[^\s]*[-‑][^\s]*/g, m => `<span class="nb">${m}</span>`);

/** The headline: part a in ink, part b in brand blue; `mark` is a word of a that is blue too (the product's name). */
function headline(h) {
  const a = keep(h.a).replace(h.mark ? esc(h.mark) : '\0', m => `<i>${m}</i>`);
  return a + (h.b ? `<em>${keep(h.b)}</em>` : '');
}

/** A day of prices as bars, 48 of them (today and tomorrow): the shape every day has (a morning and an evening peak, the middle of the day cheap) with a
 *  wobble that depends on the page, coloured by thirds like the app (cheap green, middle amber, expensive red). A drawing, not a price. */
function bars(seed, n = 48) {
  let x = parseInt(sha(seed).slice(0, 6), 16) || 1;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const g = (h, m, s) => Math.exp(-(((h - m) / s) ** 2));
  const shift = rnd() * 1.6 - .8, amp = .85 + rnd() * .3;
  const v = Array.from({ length: n }, (_, i) => {
    const h = i % 24, day = i < 24 ? 0 : 1;
    const p = .42 + .26 * g(h, 8 + shift, 2.1) + .4 * amp * g(h, 19 + shift, 2.3) - .24 * g(h, 13.5, 3) - .1 * g(h, 3, 3) + (day ? .06 * Math.sin(h / 3) - .04 : 0) + (rnd() - .5) * .07;
    return Math.max(.12, p);
  });
  const sorted = [...v].sort((a, b) => a - b), lo = sorted[Math.floor(n / 3)], hi = sorted[Math.floor(2 * n / 3)], top = Math.max(...v);
  const out = v.map(p => ({ h: p / top, c: p <= lo ? 'lo' : p >= hi ? 'hi' : 'mi' }));
  out.now = 17 + Math.floor(rnd() * 4);   // the app marks the hour it is now with a dot above its bar
  return out;
}

function phone(s, i, count) {
  return `<div class="ph ${s.kind} p${i}${count === 1 ? ' solo' : ''}"><img src="${pathToFileURL(path.join(ROOT, s.file)).href}" alt=""></div>`;
}

export function cardHtml(spec) {
  const { layout } = spec;
  const font = pathToFileURL(FONT).href;
  const dev = layout === 'duo' || layout === 'solo';
  const bottom = dev ? 104 : layout === 'chart' ? 208 : 62;       // where the text column ends (the bars, the URL or the edge below it)
  const width = dev ? 600 : 1072;
  const bars_ = layout === 'chart' ? bars(spec.key) : null;
  const chips = (spec.chips || []).map(c => `<span class="chip">${esc(c)}</span>`).join('');
  return `<!doctype html><html lang="${esc(spec.lang)}"><head><meta charset="utf-8"><style>
@font-face{font-family:Manrope;src:url("${font}");font-weight:200 800}
*{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#0e1530;--ink2:#2b3354;--muted:#5b6480;--brand:#1b57f5;--lo:#1e9e5a;--mi:#f0a30a;--hi:#e5484d}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#f4f6fb;font-family:Manrope,system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
.card{position:relative;width:${W}px;height:${H}px;overflow:hidden}
.top{position:absolute;left:64px;right:64px;top:50px;height:64px;display:flex;align-items:center;gap:12px}
.brand{display:flex;align-items:center;gap:16px;font-weight:800;font-size:34px;letter-spacing:-.02em;margin-right:auto}
.top .chip{font-size:21px;padding:7px 15px}
.brand svg{display:block;border-radius:15px}
.url{font-weight:700;letter-spacing:-.005em;${dev ? 'position:absolute;left:64px;bottom:46px;font-size:27px;color:var(--brand)' : 'margin-left:12px;font-size:25px;color:var(--muted)'}}
.col{position:absolute;left:64px;top:136px;bottom:${bottom}px;width:${width}px;display:flex;flex-direction:column}
h1{margin-top:auto;font-weight:800;letter-spacing:-.035em;line-height:1.04;color:var(--ink);text-wrap:balance;overflow-wrap:normal;hyphens:manual}
h1 i,h1 em{font-style:normal;color:var(--brand)}
h1 em{display:block;font-weight:500}
.nb{white-space:nowrap}
.sub{margin-top:20px;font-weight:500;font-size:${dev ? 29 : 34}px;line-height:1.28;color:var(--ink2);text-wrap:balance;max-width:${dev ? 580 : 900}px}
.chips{margin-top:auto;padding-top:22px;display:flex;flex-wrap:wrap;gap:12px}
.chip{display:inline-block;padding:9px 18px;border-radius:99px;background:#fff;border:2px solid #dde2ee;font-weight:700;font-size:${layout === 'chips' ? 27 : 23}px;line-height:1.1;color:var(--ink)}
${dev ? `
.panel{position:absolute;top:0;bottom:0;left:700px;right:0;background:var(--brand);clip-path:polygon(72px 0,100% 0,100% 100%,0 100%)}
.ph{position:absolute;padding:9px;border-radius:50px;background:#0b0f1a;box-shadow:inset 0 0 0 2px rgba(255,255,255,.16),0 0 0 1px rgba(14,21,48,.5),0 30px 60px -12px rgba(8,16,60,.55)}
.ph img{display:block;width:100%;height:auto;border-radius:41px;background:#fff}
.ph.ios::after{content:"";position:absolute;left:50%;top:21px;width:27%;height:27px;transform:translateX(-50%);border-radius:99px;background:#05070d}
.ph.p0{left:772px;top:58px;width:292px}
.ph.p1{left:948px;top:196px;width:238px;border-radius:44px}
.ph.p1 img{border-radius:36px}
.ph.solo{left:810px;top:44px;width:318px}
` : bars_ ? `
.bars{position:absolute;left:64px;right:64px;bottom:0;height:178px;display:flex;align-items:flex-end;gap:6px}
.bars b{position:relative;flex:1;border-radius:6px 6px 0 0}
.bars b.now::before{content:"";position:absolute;left:50%;top:-24px;width:13px;height:13px;margin-left:-6.5px;border-radius:50%;background:var(--ink)}
.bars .lo{background:var(--lo)}.bars .mi{background:var(--mi)}.bars .hi{background:var(--hi)}
` : ''}
</style></head><body><div class="card">
${dev ? '<div class="panel"></div>' : ''}
<div class="top"><div class="brand">${MARK}<span>Elpriser</span></div>${bars_ ? chips : ''}${dev ? '' : '<div class="url">elpriser.org</div>'}</div>
${dev ? '<div class="url">elpriser.org</div>' : ''}
<div class="col" id="col"><h1 id="h" data-max="${dev ? 80 : 92}" data-min="36" data-lines="3">${headline(spec.head)}</h1><p class="sub">${keep(spec.sub)}</p>${chips && !bars_ ? `<div class="chips">${chips}</div>` : ''}</div>
${dev ? (spec.shots || []).map((s, i) => phone(s, i, spec.shots.length)).join('') : ''}
${bars_ ? `<div class="bars">${bars_.map((b, i) => `<b class="${b.c}${i === bars_.now ? ' now' : ''}" style="height:${Math.round(b.h * 100)}%"></b>`).join('')}</div>` : ''}
</div>
<script>
// Make the headline as large as fits: at most three lines, no word sticking out of the box, and the column not taller than its room.
(async () => {
  await document.fonts.load('800 40px Manrope', 'Aa Ąą Ђђ Αα Ωω Ъъ');
  await document.fonts.ready;
  const h = document.getElementById('h'), col = document.getElementById('col');
  const lines = () => Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight));
  let size = +h.dataset.max;
  for (; size > +h.dataset.min; size -= 1) {
    h.style.fontSize = size + 'px';
    if (lines() <= +h.dataset.lines && h.scrollWidth <= h.clientWidth + 1 && col.scrollHeight <= col.clientHeight + 1) break;
  }
  await Promise.all(Array.from(document.images).map(i => i.decode().catch(() => {})));
  document.documentElement.dataset.size = size;
  document.documentElement.dataset.lines = lines();
  document.documentElement.dataset.ready = '1';
})();
</script></body></html>`;
}
