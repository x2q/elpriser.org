import { activateDataPage, stripInactiveMains, promoteSectionTitle } from './_spa.js';
import { CITIES } from './_cities.js';

const OG_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1b57f5"/>
      <stop offset="100%" style="stop-color:#19338f"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="600" y="250" text-anchor="middle" font-family="system-ui,sans-serif" font-size="120" font-weight="900" fill="#fff">⚡ Elpriser</text>
  <text x="600" y="350" text-anchor="middle" font-family="system-ui,sans-serif" font-size="44" fill="#bcdaff">Aktuelle spotpriser for Danmark</text>
  <text x="600" y="420" text-anchor="middle" font-family="system-ui,sans-serif" font-size="32" fill="#8ec2ff">DK1 Vest · DK2 Øst · Time for time</text>
  <text x="600" y="540" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" fill="#59a0ff">elpriser.org</text>
</svg>`;

// Pages with unique SEO metadata, served as modified index.html
const SEO_PAGES = {
  // /dk1 and /dk2 open on "inkl alt" — the same figure as the front page hero,
  // so following "DK1 Vest" from there does not change the number. That view
  // is spot + Energinet's tariffs + elafgift + moms, NOT the local nettarif,
  // which depends on the grid company; title and description must not say it.
  '/dk1': {
    title: 'Elpris Vest (DK1) i dag — spotpris inkl. alt, time for time',
    description: 'Elpris Vest (DK1) lige nu og i morgen, time for time — spotpris inkl. alt: Energinets tariffer, elafgift og moms. Vælg netselskab for prisen med nettarif.',
    hash: '#DK1/inkl_alt',
  },
  '/dk2': {
    title: 'Elpris Øst (DK2) i dag — spotpris inkl. alt, time for time',
    description: 'Elpris Øst (DK2) lige nu og i morgen, time for time — spotpris inkl. alt: Energinets tariffer, elafgift og moms. Vælg netselskab for prisen med nettarif.',
    hash: '#DK2/inkl_alt',
  },
  '/tariffer': {
    title: 'Nettariffer 2026: Nettarif C for alle 16 netselskaber, pr. kWh',
    description: 'Nettarif 2026 (nettarif C) for N1, Radius, Trefor, Cerius, RAH, Konstant m.fl. — lav-, høj- og spidslast i øre/kWh. Se hvad dit netselskab koster.',
    hash: '#tariffer',
  },
  '/automation': {
    title: 'Elpriser API til Home Assistant og Shelly — gratis, med kode',
    description: 'Gratis elpriser-API (JSON, ingen nøgle) og færdig kode til Home Assistant og Shelly. Styr varmepumpe, elbil og vandvarmer efter de billigste timer.',
    hash: '#automation',
  },
  '/om-elpriser': {
    title: 'Om elpriser i Danmark — Spotpris, tariffer og afgifter',
    description: 'Forstå din elpris: spotpris, nettarif, systemtarif, elafgift og moms. Sådan fungerer prisområderne DK1 og DK2, og sådan finder du dit netselskab.',
    hash: '#om-elpriser',
  },
  // The app page: the "Hent appen" button in the header and a link in the footer lead here.
  // Titles of the other pages lead with their topic; this one leads with the action.
  '/download': {
    title: 'Hent Elpriser-appen — iPhone og Android, gratis',
    description: 'Elprisen lige nu, i morgen og de næste 5 døgn — med dit netselskab. Gratis app til iPhone, iPad og Android, uden konto, i App Store og Google Play.',
    hash: '#download',
  },
  // Four pages for the foreign price areas, each on the same Pris screen as the Danish pages
  // and in its country's language (lang → <html lang>, JSON-LD inLanguage); /norden is the
  // Danish hub that compares them. Only 2 and 5 døgn are ever shown on them.
  '/no/strompris': {
    title: 'Strømpris prognose Norge: NO1–NO5, i dag og 5 dager frem',
    description: 'Strømpris nå og prognose for de neste 5 døgnene, time for time: NO1 Oslo, NO2 Kristiansand, NO3 Trondheim, NO4 Tromsø og NO5 Bergen. Spotpris uten mva.',
    hash: '#no/strompris',
    lang: 'nb',
    zonePage: 'no/strompris',
  },
  '/sv/elpris': {
    title: 'Elpris prognos Sverige: SE1–SE4, idag och 5 dygn framåt',
    description: 'Elpris just nu och prognos för de närmaste 5 dygnen, timme för timme: SE1 Luleå, SE2 Sundsvall, SE3 Stockholm och SE4 Malmö. Spotpris utan moms.',
    hash: '#sv/elpris',
    lang: 'sv',
    zonePage: 'sv/elpris',
  },
  '/fi/sahkon-hinta': {
    title: 'Sähkön hinta ennuste Suomi: tänään ja 5 vrk eteenpäin',
    description: 'Sähkön hinta juuri nyt ja ennuste seuraaville 5 vuorokaudelle tunneittain, koko Suomi. Pörssihinta ilman arvonlisäveroa, veroja ja siirtomaksua.',
    hash: '#fi/sahkon-hinta',
    lang: 'fi',
    zonePage: 'fi/sahkon-hinta',
  },
  '/norden': {
    title: 'Elpriser i Norden: sammenlign Norge, Sverige og Finland',
    description: 'Spotpris nu og i morgen i alle prisområder i Norge (NO1–NO5), Sverige (SE1–SE4), Finland og Holland, omregnet til kr/kWh så du kan sammenligne dem.',
    hash: '#norden',
    norden: true,
  },
  '/prognose': {
    // The page shows ten days, and every forecast day comes from the daily-
    // trained model (weather forecasts for wind and sun, plus the same weekday
    // over the last four weeks), not "historical price patterns" alone.
    // "elpriser prognose 7 dage" is the biggest query this page ranks for (667
    // impressions, 49 clicks in Search Console's three months to 2026-10-04,
    // position 6.5), and the first rewrite of this title — "…de næste 10 døgn" —
    // dropped the words people type. Both are true: the page forecasts ten days,
    // and the first seven are in the list and the curve above its table.
    title: 'Elpriser prognose 7 dage — time for time, op til 10 døgn frem',
    description: 'Elpriser prognose for de næste 7 dage — og op til 10 døgn frem — time for time for DK1 og DK2. Laves dagligt af en maskinlæringsmodel ud fra vejrprognoser for vind og sol. Skifter til faktiske børspriser, når de offentliggøres ca. kl. 13.',
    hash: '#prognose',
  },
  '/api': {
    title: 'elpriser.org API — Gratis JSON API for danske elpriser',
    description: 'Gratis JSON API for danske elpriser: aktuel pris, time-for-time-priser, 10-dages prognose, CO₂-udledning, nettariffer og Tibber-kompatibel Shelly-tarif. Ingen nøgle, fuld CORS, OpenAPI 3.1.',
    hash: '#api',
  },
  '/shelly-tariff': {
    title: 'Shelly Live Tariff — Tibber-kompatibel elpris-JSON',
    description: 'Vis aktuelle danske elpriser direkte på din Shelly med Live Tariff: Tibber-kompatibel JSON fra elpriser.org, opdateret time for time inkl. nettarif, elafgift og moms.',
    hash: '#shelly-tariff',
  },
  '/blog': {
    title: 'Blog — Guides og analyser om elpriser',
    description: 'Analyser af danske elpriser: hvornår strømmen er billigst og grønnest, hvad elafgiften gør ved regningen, og hvordan spotprisen har rykket sig siden 2019.',
    hash: '#blog',
  },
  '/blog/hvornaar-er-stroemmen-billigst': {
    title: 'Hvornår er strømmen billigst? Nattestrøm er ikke længere svaret',
    description: 'Nattestrøm er ikke længere billigst: i 2026 ligger døgnets billigste time midt på dagen på 68 % af dagene mod 23 % om natten. Analyse af 48.594 timers forbrugs- og prisdata — og hvad det betyder for din elbil og varmepumpe.',
    hash: '#blog/hvornaar-er-stroemmen-billigst',
  },
  '/blog/groennest-og-dyrest': {
    title: 'Hvorfor er strømmen grønnest netop i den dyreste time?',
    description: 'Den dyreste time på døgnet er ofte også den grønneste — mens den billigste er blandt de mest CO₂-tunge. Analyse af 22.504 timers data: prisen sættes marginalt på et europæisk marked, mens CO₂ er et gennemsnit, der afhænger af hvilke naboer Danmark handler med.',
    hash: '#blog/groennest-og-dyrest',
  },
  '/blog/elafgift-og-spotpris': {
    title: 'Elafgift og spotpris: sådan er elprisen ændret siden 2019',
    description: 'Spotprisen er 36 % højere i år end i 2025, mens elafgiften er 0,8 øre. Tal siden 2019 for DK1 og DK2 og hvad der sker, når afgiften vender tilbage i 2028.',
    hash: '#blog/elafgift-og-spotpris',
  },
  '/blog/elafgift-2028': {
    // Questions like "kommer elafgiften tilbage" rank this post 1.7–3.6 yet
    // click at 1.6–2.4 %: the page answers in its first paragraph, the snippet
    // did not. Title and description now say yes, with the figures from the post.
    title: 'Elafgift 2028: Elafgiften stiger igen, fra 0,8 til 60+ øre/kWh',
    description: 'Kommer elafgiften tilbage? Ja — fra 2028 stiger den fra 0,8 til 60,9 øre/kWh (2015-prisniveau, pristalsreguleret). Regeringen har endnu ikke planer om at forlænge den lave afgift. Se satserne og hvad det koster dig.',
    hash: '#blog/elafgift-2028',
  },
};

// The ten pilot city pages, /elpris/<by>: one entry each, generated from the table in _cities.js. They share
// one section (data-page="city"), one generator (cityHTML) and one template for title and description;
// what differs between them is data: the name, the price area, the main net company and how sure we are of it.
const CITY_PATH = /^\/elpris\/([a-z0-9-]+)$/;
function cityMeta(c) {
  return {
    title: `Elpris i ${c.name} i dag — time for time inkl. nettarif`,
    description: `Elpris i ${c.name} nu og i morgen, time for time — spotpris plus nettarif fra ${c.nets[0].name} (${c.area}), afgifter og moms. Tjek netselskabet for din adresse.`,
    hash: `#elpris/${c.slug}`,
  };
}
for (const c of CITIES) SEO_PAGES['/elpris/' + c.slug] = { ...cityMeta(c), city: c };
const CITY_URLS = CITIES.map(c => '/elpris/' + c.slug);

// Mirrors NETS in index.html. Used to (a) mint per-net clean URLs
// /dk1/<slug> and /dk2/<slug> that are crawlable, and (b) include those
// URLs in the sitemap so Google/Bing find them. Keep in sync with index.html.
const NETS = {
  DK1: [
    { name: 'N1',          slug: 'n1',          gln: '5790001089030' },
    { name: 'Trefor',      slug: 'trefor',      gln: '5790000392261' },
    { name: 'Konstant',    slug: 'konstant',    gln: '5790000704842' },
    { name: 'Dinel',       slug: 'dinel',       gln: '5790000610099' },
    { name: 'Vores Elnet', slug: 'vores-elnet', gln: '5790000610976' },
    { name: 'Ravdex',      slug: 'ravdex',      gln: '5790000836727' },
    { name: 'RAH Net',     slug: 'rah-net',     gln: '5790000681327' },
    { name: 'Elværk',      slug: 'elvaerk',     gln: '5790000681358' },
    { name: 'Nord Energi', slug: 'nord-energi', gln: '5790000610877' },
    { name: 'NOE Net',     slug: 'noe-net',     gln: '5790000395620' },
    { name: 'Elnet Midt',  slug: 'elnet-midt',  gln: '5790001100520' },
    { name: 'Flow Elnet',  slug: 'flow-elnet',  gln: '5790000392551' },
    { name: 'LNet',        slug: 'lnet',        gln: '5790001090111' },
  ],
  DK2: [
    { name: 'Cerius',      slug: 'cerius',      gln: '5790000705184' },
    { name: 'Trefor Øst',  slug: 'trefor-ost',  gln: '5790000706686' },
    { name: 'Radius',      slug: 'radius',      gln: '5790000705689' },
  ],
};
const AREA_LABEL = { DK1: 'DK1 Vest', DK2: 'DK2 Øst' };
const AREA_REGION = { DK1: 'Vestdanmark (Jylland og Fyn)', DK2: 'Østdanmark (Sjælland, Lolland-Falster og Bornholm)' };

function netPageMeta(area, net) {
  const areaLabel = AREA_LABEL[area];
  const region = AREA_REGION[area];
  return {
    title:       `Elpris ${net.name} i dag (${area}) — time for time inkl. nettarif`,
    description: `Aktuel elpris og spotpris lige nu hos ${net.name} i ${region} — time for time. Den reelle pris pr. kWh du betaler inkl. ${net.name}-nettarif, elafgift og moms. Opdateret dagligt fra Energi Data Service.`,
    hash:        `#${area}/net_inkl_alt/${net.slug}`,
  };
}

const NET_URLS = [];
for (const area of ['DK1', 'DK2']) {
  for (const net of NETS[area]) {
    NET_URLS.push('/' + area.toLowerCase() + '/' + net.slug);
  }
}

const SITEMAP_URLS = [
  '/', '/dk1', '/dk2', '/tariffer', '/automation', '/api', '/prognose', '/om-elpriser', '/shelly-tariff', '/download',
  '/blog',
  '/blog/elafgift-2028', '/blog/elafgift-og-spotpris', '/norden', '/no/strompris', '/sv/elpris', '/fi/sahkon-hinta', '/blog/hvornaar-er-stroemmen-billigst', '/blog/groennest-og-dyrest',
  ...NET_URLS,
  ...CITY_URLS,
];

// Real lastmod dates for content pages (from git history / last substantive
// edit). Price-bearing pages legitimately change daily and use today's date.
// Update these when a page's content actually changes — an always-today
// lastmod for everything teaches Google to ignore the field.
const CONTENT_LASTMOD = {
  '/automation': '2026-10-17',  // gained the Shelly and Home Assistant guides
  '/api': '2026-07-24',
  '/om-elpriser': '2026-10-17',  // absorbed the Forstå din elpris guide
  '/shelly-tariff': '2026-07-24',
  '/download': '2026-10-23',
  '/blog/elafgift-2028': '2026-07-24',
  '/blog/elafgift-og-spotpris': '2026-10-17',
  // /no/strompris, /sv/elpris, /fi/sahkon-hinta and /norden are deliberately NOT listed here: they are
  // drawn with today's prices, so they change every day and fall through to
  // lastmod=today / changefreq=daily like /dk1 and /dk2.
  '/blog/hvornaar-er-stroemmen-billigst': '2026-07-28',
  '/blog/groennest-og-dyrest': '2026-08-01',
  '/blog': '2026-10-17',   // the newest post it lists
};

function buildSitemap() {
  const today = new Date().toISOString().split('T')[0];
  // Crawl budget follows priority. The four foreign-area pages stay below the
  // per-net pages: this is a Danish site, and those are the pages searched for by name.
  const ZONE_ONLY = /^\/(no\/strompris|sv\/elpris|fi\/sahkon-hinta|norden)$/;
  const priorityFor = p => {
    if (p === '/') return '1.0';
    if (ZONE_ONLY.test(p)) return '0.5';                    // foreign-market pages
    if (/^\/(dk[12])\/[a-z0-9-]+$/.test(p)) return '0.6'; // per-net long-tail pages
    if (CITY_PATH.test(p)) return '0.5';                    // the pilot city pages: a test, not yet a bet
    return '0.8';
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITEMAP_URLS.map(p => {
    const isDaily = !CONTENT_LASTMOD[p];
    return `  <url>
    <loc>https://elpriser.org${p}</loc>
    <lastmod>${CONTENT_LASTMOD[p] || today}</lastmod>
    <changefreq>${isDaily ? 'daily' : 'monthly'}</changefreq>
    <priority>${priorityFor(p)}</priority>
  </url>`;
  }).join('\n')}
</urlset>`;
}

const LLMS_TXT = `# elpriser.org

> Aktuelle elpriser (spotpriser) for Danmark — DK1 og DK2 — time for time.

elpriser.org viser den reelle elpris du betaler per kWh i Danmark, opdateret dagligt med data fra Energi Data Service (Energinet). Med dit netselskab valgt er prisen spotpris + dit netselskabs nettarif + Energinets systemtarif og transmissionstarif + elafgift + moms. Uden netselskab ("inkl alt") er det alt undtagen den lokale nettarif, som afhænger af netselskabet.

## Sider

- [Forside](https://elpriser.org/): Overblik over dagens elpriser for DK1 og DK2 med aktuel pris og netselskaber.
- [Elpriser DK1 Vest](https://elpriser.org/dk1): Elpris time for time for Vestdanmark (Jylland og Fyn) — åbner på "inkl alt" (spot + Energinets tariffer + elafgift + moms); ren spotpris og netselskaber vælges i menuen. Viser i dag og i morgen time for time og prognosen op til 10 døgn frem.
- [Elpriser DK2 Øst](https://elpriser.org/dk2): Samme for Østdanmark (Sjælland, Lolland-Falster, Bornholm).
- Per-netselskab priser: \`/dk1/<slug>\` eller \`/dk2/<slug>\` viser dagens pris inkl. nettarif for det valgte netselskab (fx https://elpriser.org/dk1/n1, https://elpriser.org/dk2/radius).
- Elpris pr. by (pilot): \`/elpris/<by>\` viser elprisen time for time hos byens hyppigste netselskab, med dagens nettarif-profil og netselskabets andel af de adresser vi har tjekket — ${CITIES.map(c => `[${c.name}](https://elpriser.org/elpris/${c.slug})`).join(', ')}.
- [Nettariffer](https://elpriser.org/tariffer): Sammenligning af nettariffer for alle danske netselskaber.
- [Elprisprognose](https://elpriser.org/prognose): Forventede elpriser for DK1 og DK2 time for time de næste 10 døgn. Laves dagligt af en maskinlæringsmodel ud fra vejrprognoser (vind og sol) og prisen samme ugedag de seneste fire uger; skifter til faktiske børspriser, når de offentliggøres ca. kl. 13.
- [Elpriser i Norden](https://elpriser.org/norden): Alle prisområder i Norge, Sverige, Finland og Holland side om side i kr/kWh uden moms, så de kan sammenlignes. Landesiderne er på landets eget sprog og viser spotpris time for time for i dag og i morgen og prognose for de næste 2 og 5 døgn: [Norge](https://elpriser.org/no/strompris) (NO1 Oslo, NO2 Kristiansand, NO3 Trondheim, NO4 Tromsø, NO5 Bergen), [Sverige](https://elpriser.org/sv/elpris) (SE1 Luleå, SE2 Sundsvall, SE3 Stockholm, SE4 Malmö) og [Finland](https://elpriser.org/fi/sahkon-hinta). Prognosen kommer fra én åben maskinlæringsmodel for alle 13 prisområder ([model på Hugging Face](https://huggingface.co/Elpriser/nordic-price-forecast)); omregnet til lokal valuta med Den Europæiske Centralbanks daglige referencekurs, uden moms, afgifter og nettariffer.
- [Automation](https://elpriser.org/automation): REST API og kodeeksempler til Home Assistant, Shelly og smart home. Guides: [Shelly](https://elpriser.org/automation#shelly) (script, der henter døgnets plan én gang) og [Home Assistant](https://elpriser.org/automation#home-assistant) (REST-sensor og automation).
- [Hent appen](https://elpriser.org/download): Gratis app til iPhone, iPad og Android — elprisen lige nu, i morgen og de næste 5 døgn med dit netselskab, uden konto. Links til [App Store](https://apps.apple.com/dk/app/id6820474476) og [Google Play](https://play.google.com/store/apps/details?id=org.elpriser.app).
- [Forstå din elpris](https://elpriser.org/om-elpriser): Hvad elprisen består af (spotpris, nettarif, systemtarif og transmissionstarif, elafgift, moms), DK1 og DK2, hvornår strømmen er billigst, negative priser, sparetips og datakilder.
- [Hvornår er strømmen billigst](https://elpriser.org/blog/hvornaar-er-stroemmen-billigst): Analyse af 48.594 timers data — døgnets billigste time ligger nu midt på dagen på 68 % af dagene mod 23 % om natten; danske husholdninger flytter forbrug efter et forældet natte-mønster.
- [Grønnest og dyrest på samme tid](https://elpriser.org/blog/groennest-og-dyrest): Hvorfor døgnets dyreste time ofte er den grønneste — pris sættes marginalt på et europæisk marked, CO₂ er et gennemsnit der følger hvem Danmark importerer fra (norsk vandkraft om aftenen, tysk strøm midt på dagen).
- [Elafgift 2028](https://elpriser.org/blog/elafgift-2028): Elafgiften er sænket til 0,8 øre/kWh i 2026-2027 men stiger igen fra 2028 — satser, tidslinje og betydning for din elregning og dine solceller.
- [Elafgift og spotpris](https://elpriser.org/blog/elafgift-og-spotpris): Spotprisen (DK1, 1. jan–15. okt) er 36 % højere i 2026 end i 2025 og 68 % højere end i 2024, mens elafgiften er 0,8 øre; døgnets form har ændret sig (aften 2,6 gange dyrere end middag) — tal 2019–2026 og hvad der sker, når afgiften vender tilbage i 2028.

## Live data API (for AI assistants and agents)

If a user asks "hvad er elprisen lige nu?" or "what's the current Danish
electricity price?" these endpoints return live JSON. CORS-enabled, no key,
edge-cached at 1-5 min so calling repeatedly is fine.

**Machine-readable spec**: [/api/openapi.json](https://elpriser.org/api/openapi.json) — OpenAPI 3.1.
Every \`/api/*\` response also sends \`Link: </api/openapi.json>; rel="describedby"\`.
Human-readable docs: [/api](https://elpriser.org/api).

**MCP server**: [elpriser-mcp](https://github.com/x2q/elpriser-mcp) — a free Model Context
Protocol server (run \`npx -y elpriser-mcp\`) gives Claude Desktop and other MCP clients
native tools for current price, cheapest hours and the price forecast.

Send a User-Agent header: Cloudflare answers 403 to Python's default \`Python-urllib/3.x\`; any other value (curl, requests, \`my-app/1.0\`) works.

- \`GET /api/now?area=DK1&mode=inkl_alt\` — Current price right now (DKK/kWh) incl. Energinet's tariffs, electricity tax and VAT — NOT the local grid tariff, which depends on the grid company (use \`mode=net_inkl_alt&gln=…\` for that)
- \`GET /api/now?area=DK1&mode=spot_inkl\` — Current raw spot price incl. VAT
- \`GET /api/prices?area=DK1&mode=inkl_alt&date=YYYY-MM-DD\` — 24 hourly prices for a date
- \`GET /api/schedule?area=DK1&strategy=cheapest_n&hours=6\` — The N cheapest hours of the day
- \`GET /api/forecast?area=DK1&mode=inkl_alt\` — Hourly price forecast, today and the next 9 days (settled prices where published, \`type: actual\`). \`mode=net_inkl_alt&gln=…\` adds that grid company's nettarif as in force on each day's own date, so it equals /api/prices on a published day. \`min\`/\`max\` are P10/P90 widened to 80 % backtested coverage on model days; \`model.generatedAt\` names the run.
- \`GET /api/forecast/archive?area=DK1[&issued=2026-10-06]\` — Past forecast runs (400 days, from 2026-10-06): list the run dates, or fetch one as it was issued (raw spot, DKK/MWh excl. VAT), to measure error by horizon
- \`GET /api/nordic?zone=se3\` — Same for any of the 13 Nordic/NL bidding zones (dk1, dk2, no1–no5, se1–se4, fi, nl), in EUR/MWh, with the ECB rate to the local currency in \`zoneInfo\`
- \`GET /api/shelly/tariff?area=DK1&mode=inkl_alt\` — Tibber-compatible 24h JSON
- \`GET /api/raw/prices?area=DK1&start=YYYY-MM-DD&end=YYYY-MM-DD\` — Raw DayAheadPrices records
- \`GET /api/raw/tariff?gln=5790000704842\` — Single net company's Nettarif C (24 values)
- \`GET /api/raw/co2?area=DK1\` — CO₂-udledning pr. kWh (g/kWh), time for time, i dag + ca. 1 døgn frem
- \`GET /api/supplierlookup?lat=…&lng=…\` — Reverse-geocode an address to a netselskab

### Example: /api/now?area=DK1&mode=inkl_alt

\`\`\`json
{
  "on": true,
  "price": 1.23,
  "hour": 14,
  "area": "DK1",
  "mode": "inkl_alt",
  "strategy": "cheapest_n"
}
\`\`\`

\`price\` is DKK/kWh including spotpris + Energinet system & transmission
tariffs + elafgift + 25 % VAT. \`hour\` is the current Danish local hour
(0-23). To get the pure market spot price use \`mode=spot_ex\`.

## Detaljer

- Opdateres dagligt ca. kl. 13 når Nord Pool offentliggør næste døgns priser
- Datakilde: [Energi Data Service](https://www.energidataservice.dk) (Energinet)
- Gratis, ingen registrering påkrævet
- Sprog: Dansk · CORS-headers: \`Access-Control-Allow-Origin: *\`
`;

/** "Elpriser lige nu" for llms-full.txt: each figure in a sentence that names
 *  its basis and carries the date and hour, so it stays true when quoted out
 *  of context. Any source failing drops its line, never the file. */
async function llmsNowSection(context) {
  try { return await llmsNowSectionUnsafe(context); } catch { return ''; }   // the static text is the file; the figures are a bonus
}
async function llmsNowSectionUnsafe(context) {
  const origin = new URL(context.request.url).origin;
  // A source that errors, throws (even before it returns a promise), times out or answers with something that is not
  // JSON is "no data", never a failure of the file.
  const get = async u => { try { const r = await fetch(origin + u); return r.ok ? await r.json() : null; } catch { return null; } };
  const f = v => (v == null ? null : v.toFixed(2).replace('.', ',').replace(/^-(0,00)$/, '$1'));
  const cph = { timeZone: 'Europe/Copenhagen' };
  const today = new Intl.DateTimeFormat('en-CA', cph).format(new Date());
  const hh = new Intl.DateTimeFormat('en-GB', { ...cph, hour: '2-digit', hour12: false }).format(new Date());
  const areas = [['DK1', 'Vestdanmark'], ['DK2', 'Østdanmark']];
  const rows = await Promise.all(areas.map(async ([a, name]) => { try {
    const [spot, alt, day, fc] = await Promise.all([
      get(`/api/now?area=${a}&mode=spot_inkl`), get(`/api/now?area=${a}&mode=inkl_alt`),
      get(`/api/prices?area=${a}&mode=inkl_alt&date=${today}`), get(`/api/forecast?area=${a}&mode=inkl_alt`)]);
    const out = [];
    if (spot && alt && spot.price != null && alt.price != null)
      out.push(`- ${a} (${name}), kl. ${hh}:00: spotpris ${f(spot.price)} kr/kWh inkl. moms; med Energinets tariffer, elafgift og moms ${f(alt.price)} kr/kWh — før nettariffen fra det lokale netselskab.`);
    const dayList = day && (day.prices || day.hours);
    const ps = (Array.isArray(dayList) ? dayList : []).map((p, h) => ({ h: p?.hour ?? h, p: p?.price ?? p?.total ?? p }))
      .filter(x => typeof x.p === 'number');
    if (ps.length >= 20) {
      const lo = ps.reduce((a, b) => (b.p < a.p ? b : a)), hi = ps.reduce((a, b) => (b.p > a.p ? b : a));
      const t = h => `${String(h).padStart(2, '0')}–${String((h + 1) % 24).padStart(2, '0')}`;
      out.push(`- ${a} i dag (${today}): billigst kl. ${t(lo.h)} (${f(lo.p)} kr/kWh), dyrest kl. ${t(hi.h)} (${f(hi.p)} kr/kWh), begge inkl. Energinets tariffer, elafgift og moms.`);
    }
    const tm = fc && Array.isArray(fc.days) ? fc.days.find(d => d && d.date > today && Array.isArray(d.prices)) : null;
    const tv = tm && tm.prices.map(p => p && p.price).filter(v => typeof v === 'number');
    if (tv && tv.length)
      out.push(`- ${a} i morgen (${tm.date}): ${f(Math.min(...tv))}–${f(Math.max(...tv))} kr/kWh inkl. Energinets tariffer, elafgift og moms (${tm.type === 'actual' ? 'faktiske børspriser' : 'prognose'}).`);
    return out.join('\n');
  } catch { return ''; } }));   // one area's figures failing leaves the other's
  const body = rows.filter(Boolean).join('\n');
  if (!body) return '';
  return `\n## Elpriser lige nu (${today} kl. ${hh}:00, dansk tid)\n\n` +
    `Tallene skifter hver time. Citér dem med dato og time, eller hent dem live fra /api/now.\n\n${body}\n`;
}

const LLMS_FULL_TXT = LLMS_TXT + `
## Prisområder

Danmark er delt i to el-prisområder på den nordiske elbørs Nord Pool:
- **DK1 (Vestdanmark)**: Jylland og Fyn
- **DK2 (Østdanmark)**: Sjælland, Lolland-Falster og Bornholm

Priserne kan variere mellem områderne pga. forskellige forbindelser til nabolande og lokal produktion fra vindmøller og solceller.

## Priskomponenter

Den samlede elpris per kWh består af:
- **Spotpris**: Markedsprisen fra Nord Pool, ændrer sig time for time
- **Nettarif**: Betaling til dit lokale netselskab (varierer efter tidspunkt, lav/mellem/spids)
- **Systemtarif**: Til Energinet for drift af det overordnede elsystem
- **Transmissionstarif**: Til Energinet for transport af strøm
- **Elafgift**: Statslig afgift på elforbrug
- **Moms**: 25% af den samlede pris

## Prisvisninger

- **Elspot inkl. moms** = Spotpris + 25% moms
- **Elspot ex. moms** = Ren spotpris uden moms
- **Inkl. alt** = Spot + systemtarif + transmission + elafgift + moms
- **Inkl. alt minus afgift** = Som ovenfor, uden elafgift
- **Net inkl. alt** = Alt inkl. dit netselskabs tarif

## Netselskaber

Understøttede netselskaber i DK1: N1, Trefor, Konstant, Dinel, Vores Elnet, Ravdex, RAH Net, Elværk, Nord Energi, NOE Net, Elnet Midt, Flow Elnet og LNet.
Understøttede netselskaber i DK2: Radius, Cerius og Trefor Øst.

GPS-funktionen finder automatisk dit netselskab ud fra din position via OpenStreetMap (adresseopslag) og Green Power Denmark. Positionen bruges kun ét øjeblik og gemmes aldrig — kun netselskabets navn gemmes.

## Hvornår er strømmen billigst?

I 2026 ligger døgnets billigste time midt på dagen (kl. 10-16) på 68 % af dagene og om natten (kl. 00-06) på 23 %; dyrest er typisk aftenspidsen kl. 17-21. Den faktiske pris afhænger af vejr, vind og forbrug og varierer fra dag til dag.

## Nøgletal og statistik for elpriser i Danmark

- Gennemsnitlig elpris: 1,50–4,00 kr/kWh inkl. alt (afhængig af sæson og netselskab)
- Gennemsnitlig spotpris 2024: ca. 0,55 kr/kWh (ex. moms)
- Dyreste time nogensinde: 16,69 kr/kWh — DK2, 5. september 2022 kl. 19
- Billigste time nogensinde: −2,76 kr/kWh — DK1, 2. juli 2023 kl. 14
- Negative elpriser opstår ved høj vind og lavt forbrug

### Prisfordeling ved typisk elpris (2,50 kr/kWh)

- Spotpris (Nord Pool): ~0,65 kr (26%)
- Nettarif (netselskab): ~0,45 kr (18%)
- System- og transmissionstarif: ~0,14 kr (6%)
- Elafgift: ~0,76 kr (30%)
- Moms: ~0,50 kr (20%)
- Over halvdelen af elprisen er afgifter, tariffer og moms

### Nettarif-sammenligning (spidslast / lavlast, ex. moms)

| Netselskab | Område | Spidstarif | Lavlast |
|------------|--------|-----------|---------|
| N1         | DK1    | ~46 øre   | ~16 øre |
| Trefor     | DK1    | ~37 øre   | ~13 øre |
| Radius     | DK2    | ~65 øre   | ~16 øre |
| Cerius     | DK2    | ~47 øre   | ~13 øre |
| RAH Net    | DK1    | ~33 øre   | ~11 øre |
| Konstant   | DK1    | ~37 øre   | ~14 øre |

Forskellen mellem billigste og dyreste netselskab: 15-25 øre/kWh, ca. 500-1.000 kr/år for en typisk husstand (4.000 kWh).

### Prismønstre

- Billigst: kl. 00-06 (nat), weekender, sommer, blæsende dage
- Dyrest: kl. 17-21 (aftenspids), hverdage, vinter
- Vind: Danmark har ~55% vindandel. Blæsende dage giver 50-80% lavere priser

## Ofte stillede spørgsmål

**Hvad er den aktuelle spotpris på el lige nu?**
Spotprisen opdateres time for time og varierer mellem DK1 (Vest) og DK2 (Øst). Prisen offentliggøres dagen før af Nord Pool. Tjek den aktuelle spotpris live på elpriser.org.

**Hvad er nettariffen hos Trefor, RAH, N1 og Radius?**
Nettariffen varierer efter netselskab og tidspunkt (lav-, mellem- og spidslast). Største netselskaber: N1 og Trefor (DK1/Vest), Radius og Cerius (DK2/Øst). Mindre selskaber: RAH Net, Konstant, Nord Energi, Vores Elnet m.fl.

**Kan jeg se elpriser live og time for time?**
Ja. Elpriser.org viser elpriser opdateret time for time fra Energi Data Service. Se priserne for dagens 24 timer, sammenlign med morgendagens priser (efter kl. 13) og se prognosen for de næste døgn.

## API-eksempler

### Hent dagens priser
\`\`\`
GET https://elpriser.org/api/prices?area=DK1&date=2025-01-15
\`\`\`

### Hent aktuel pris
\`\`\`
GET https://elpriser.org/api/now?area=DK2
\`\`\`

### Find billigste timer (til automation)
\`\`\`
GET https://elpriser.org/api/schedule?area=DK1&hours=4
\`\`\`

### Shelly-kompatibelt tariff-endpoint
\`\`\`
GET https://elpriser.org/api/shelly/tariff?area=DK1
\`\`\`

## Ofte stillede spørgsmål (fuld tekst)

**Hvad er elprisen i dag?**
Elprisen i Danmark skifter time for time og fastsættes dagen i forvejen på den nordiske elbørs Nord Pool. Prisen kaldes spotprisen og offentliggøres dagligt omkring kl. 13 for det kommende døgn. Her på elpriser.org kan du se den aktuelle elpris live for både DK1 (Vestdanmark) og DK2 (Østdanmark), opdateret med data fra Energi Data Service.

**Hvad koster strøm lige nu?**
Hvad strøm koster lige nu afhænger af spotprisen på Nord Pool samt dit netselskabs nettarif, elafgift og moms — tilsammen den reelle pris pr. kWh. El priser og strømpriser dækker reelt det samme: prisen på elektricitet, opdateret time for time. Se de aktuelle el priser for i dag på [DK1 Vest](https://elpriser.org/dk1) eller [DK2 Øst](https://elpriser.org/dk2), eller vælg dit netselskab for at se præcis, hvad strøm koster hos dig lige nu.

**Er energipriser det samme som elpriser?**
"Energipriser" bruges ofte i daglig tale om elpriser — altså prisen på strøm (el) per kWh. Strengt taget dækker energipriser bredt over al energi (el, gas og fjernvarme), men når folk søger på energipriser mener de typisk den aktuelle elpris. På elpriser.org viser vi netop elpriser/strømpriser time for time for hele Danmark, inkl. nettariffer, elafgift og moms — så du kan se hvad strøm reelt koster lige nu.

**Hvad er forskellen på DK1 og DK2?**
Danmark er delt i to prisområder: DK1 dækker Vestdanmark (Jylland og Fyn) og DK2 dækker Østdanmark (Sjælland, Lolland-Falster og Bornholm). Priserne kan variere mellem de to områder, da de har forskellige forbindelser til nabolande og forskellige produktionsforhold med vindmøller og solceller.

**Hvornår er strømmen billigst?**
Strømmen er typisk billigst om natten mellem kl. 00 og 06, og dyrest i spidstimerne kl. 17-21 hvor mange husholdninger bruger mest energi. Men den faktiske pris afhænger af vejr, vind og forbrug, så det kan variere fra dag til dag. Med elpriser.org kan du se præcis hvilke timer der er billigst i dag og planlægge dit forbrug — f.eks. opladning af elbil, varmepumpe eller vaskemaskine.

**Hvad indgår i den samlede elpris?**
Den samlede elpris består af flere dele: spotprisen (den rene markedspris fra Nord Pool), nettariffer (betaling til dit lokale netselskab for transport af strøm), systemtarif og transmissionstarif (til Energinet for det overordnede elnet), elafgift (statslig afgift) og moms (25%). På elpriser.org kan du se prisen med alle dele inkluderet, så du kender den reelle pris du betaler per kWh.

**Hvad er den aktuelle spotpris på el lige nu?**
Spotprisen på el opdateres time for time og varierer mellem DK1 (Vest) og DK2 (Øst). Prisen offentliggøres dagen før af Nord Pool. Tjek den aktuelle spotpris live på [DK1 Vest](https://elpriser.org/dk1) eller [DK2 Øst](https://elpriser.org/dk2). Du kan også se prisen inkl. nettariffer, elafgift og moms — den reelle pris du betaler per kWh.

**Hvad er nettariffen hos Trefor, RAH, N1 og Radius?**
Nettariffen varierer efter dit netselskab og tidspunkt på dagen (lav-, mellem- og spidslast). De største netselskaber i Danmark er N1 og Trefor (DK1/Vest) samt Radius og Cerius (DK2/Øst). Mindre selskaber som RAH Net, Konstant, Nord Energi og Vores Elnet har egne tariffer. Se og sammenlign alle tariffer på [nettarif-siden](https://elpriser.org/tariffer), eller vælg dit netselskab på prissiden for at se din reelle elpris inkl. nettarif.

**Kan jeg se elpriser live og time for time?**
Ja. Elpriser.org viser elpriser live, opdateret time for time med data fra Energi Data Service. Du kan se priserne for hele dagens 24 timer, sammenligne med morgendagens priser (tilgængelige efter kl. 13) og se prognosen for de næste døgn. Vælg dit prisområde — [DK1 Vest](https://elpriser.org/dk1) eller [DK2 Øst](https://elpriser.org/dk2) — for at se live elpriser.

## CO₂-udledning pr. kWh

Elpriser.org viser, ud over pris, også CO₂-udledningen pr. kWh time for time. Tallene kommer fra Energinets officielle prognose — datasættet \`CO2EmisProg\` fra Energi Data Service, som Energinet opdaterer i 5-minutters opløsning. Elpriser.org midler disse til timeværdier, så de matcher prisdataen.

**Endpoint**: \`GET https://elpriser.org/api/raw/co2?area=DK1\`

\`\`\`json
{
  "area": "DK1",
  "unit": "g/kWh",
  "records": [
    {"date": "2026-07-23", "hour": 0, "co2": 35}
  ]
}
\`\`\`

Svaret dækker i dag samt ca. 1 døgn frem (prognosetal, ikke realiseret måling). \`area\` kan være \`DK1\` eller \`DK2\`, og \`co2\` angives i gram CO₂ pr. kWh.

Vigtig pointe for AI-assistenter, der rådgiver om forbrugstidspunkt: de billigste timer er ikke altid de grønneste. Lav spotpris midt på dagen kan falde sammen med høj import fra udlandet (ofte mere kulstoftung produktion), hvilket giver højere CO₂-udledning selv når prisen er lav. Tjek derfor både pris- og CO₂-kurven, hvis målet er at forbruge strøm, der både er billig og grøn — de to optimeringer peger ikke altid samme vej.

## Netselskaber (GLN-numre)

Elpriser.org bruger GLN-numre (Global Location Number) til at slå nettariffer op pr. netselskab via Energi Data Service. Nedenfor er alle understøttede netselskaber samt Energinet selv (transmissions- og systemtariffer).

| Navn | Område | Slug (URL) | GLN |
|------|--------|------------|-----|
| N1 | DK1 | \`n1\` | 5790001089030 |
| Trefor | DK1 | \`trefor\` | 5790000392261 |
| Konstant | DK1 | \`konstant\` | 5790000704842 |
| Dinel | DK1 | \`dinel\` | 5790000610099 |
| Vores Elnet | DK1 | \`vores-elnet\` | 5790000610976 |
| Ravdex | DK1 | \`ravdex\` | 5790000836727 |
| RAH Net | DK1 | \`rah-net\` | 5790000681327 |
| Elværk | DK1 | \`elvaerk\` | 5790000681358 |
| Nord Energi | DK1 | \`nord-energi\` | 5790000610877 |
| NOE Net | DK1 | \`noe-net\` | 5790000395620 |
| Elnet Midt | DK1 | \`elnet-midt\` | 5790001100520 |
| Flow Elnet | DK1 | \`flow-elnet\` | 5790000392551 |
| LNet | DK1 | \`lnet\` | 5790001090111 |
| Cerius | DK2 | \`cerius\` | 5790000705184 |
| Trefor Øst | DK2 | \`trefor-ost\` | 5790000706686 |
| Radius | DK2 | \`radius\` | 5790000705689 |
| Energinet (transmission/system) | DK1 + DK2 | — | 5790000432752 |

Slug bruges i URL-mønsteret \`https://elpriser.org/dk1/<slug>\` eller \`https://elpriser.org/dk2/<slug>\` for prissiden inkl. det pågældende netselskabs nettarif, og GLN bruges i \`GET https://elpriser.org/api/raw/tariff?gln=<gln>\` for rå tarifdata (24 timeværdier).

## Åbne datasæt og værktøjer

- **Hugging Face** — [huggingface.co/Elpriser](https://huggingface.co/Elpriser): historiske pris-, produktions- og markedsdatasæt som parquet-filer, ét datasæt pr. land, licenseret under CC BY 4.0. Velegnet til backtesting, ML-træning og statistisk analyse uden at skulle scrape API'et for historik.
- **MCP-server** — [github.com/x2q/elpriser-mcp](https://github.com/x2q/elpriser-mcp): en Model Context Protocol-server til LLM-agenter. Kør \`npx -y elpriser-mcp\` for at give Claude Desktop og andre MCP-klienter native værktøjer til aktuel pris, billigste timer og prisprognosen — uden selv at skulle bygge HTTP-kald.
- **JS/TS-klient** — [github.com/x2q/elpriser-client](https://github.com/x2q/elpriser-client): en letvægts JavaScript/TypeScript-klient til elpriser.org's API, til brug i Node.js, browser eller edge-funktioner.
`;

// Pages that were folded into others. They answer 301, not 404: they had inbound
// links and shares, and each target holds the content that replaced it. Nothing on
// the site links to these paths any more, and they are not in the sitemap. server.js
// mirrors this table for local development; test-static.js keeps the two equal.
const LEGACY_REDIRECTS = {
  '/blog/v2g-v2h-bidirektional-opladning': '/blog',
  '/blog/biler-ladere-v2h-v2g': '/blog',
  '/blog/shelly-elpris-automation': '/automation#shelly',
  '/blog/home-assistant-elpriser': '/automation#home-assistant',
  '/blog/forsta-din-elpris': '/om-elpriser',
  // The eleven foreign zone pages became four: /no/strompris and /sv/elpris carry the zone as a hash
  // (their tabs), /fi/sahkon-hinta has one zone, and NL — which has no page of its own — is a row of /norden.
  '/no1': '/no/strompris#no1',
  '/no2': '/no/strompris#no2',
  '/no3': '/no/strompris#no3',
  '/no4': '/no/strompris#no4',
  '/no5': '/no/strompris#no5',
  '/se1': '/sv/elpris#se1',
  '/se2': '/sv/elpris#se2',
  '/se3': '/sv/elpris#se3',
  '/se4': '/sv/elpris#se4',
  '/fi': '/fi/sahkon-hinta',
  '/nl': '/norden#nl',
  // The first spelling of the three country pages, live for a day.
  '/norge': '/no/strompris',
  '/sverige': '/sv/elpris',
  '/finland': '/fi/sahkon-hinta',
};

const INDEXNOW_KEY = 'ede0d7c16ca973f60282b7079da12804';

const STATIC_ROUTES = {
  '/sitemap.xml': {
    body: () => buildSitemap(),
    type: 'application/xml; charset=utf-8',
  },
  '/robots.txt': {
    body: `# AI-agenter: se https://elpriser.org/llms.txt og https://elpriser.org/llms-full.txt
# for maskinlæsbare sidebeskrivelser, live-API-endpoints og fuld tekst til citering.

User-agent: *
Allow: /

# OpenAI
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

# Anthropic
User-agent: ClaudeBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: anthropic-ai
Allow: /

# Perplexity
User-agent: PerplexityBot
Allow: /

User-agent: Perplexity-User
Allow: /

# Google
User-agent: Google-Extended
Allow: /

# Apple
User-agent: Applebot-Extended
Allow: /

# Common Crawl
User-agent: CCBot
Allow: /

# Meta
User-agent: meta-externalagent
Allow: /

# ByteDance
User-agent: Bytespider
Allow: /

Sitemap: https://elpriser.org/sitemap.xml`,
    type: 'text/plain; charset=utf-8',
  },
  '/llms.txt': {
    body: LLMS_TXT,
    type: 'text/plain; charset=utf-8',
  },
  '/llms-full.txt': {
    // Static text plus today's figures, dated to the hour, so an answer engine
    // quoting this file quotes numbers that were true when it read them.
    body: async context => LLMS_FULL_TXT + await llmsNowSection(context),
    type: 'text/plain; charset=utf-8',
    maxAge: 900,
  },
  // IndexNow ownership proof: the key, served as plain text at /<key>.txt.
  // Public by design — it only proves this host may submit its own URLs.
  // scripts/indexnow.mjs carries the same key; test-static.js checks they match.
  '/ede0d7c16ca973f60282b7079da12804.txt': {
    body: INDEXNOW_KEY,
    type: 'text/plain; charset=utf-8',
  },
  '/og-image': {
    body: OG_IMAGE,
    type: 'image/svg+xml',
  },
};

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // HTTP → HTTPS redirect (skip on localhost — wrangler dev is HTTP-only,
  // and Cloudflare's edge terminates HTTPS before the function runs in prod).
  if (url.protocol === 'http:' && !/^(localhost|127\.|\[::1\])/.test(url.hostname)) {
    url.protocol = 'https:';
    return new Response(null, {
      status: 301,
      headers: { 'Location': url.toString() },
    });
  }

  // www → apex redirect
  if (url.hostname === 'www.elpriser.org') {
    url.hostname = 'elpriser.org';
    return new Response(null, {
      status: 301,
      headers: { 'Location': url.toString() },
    });
  }

  // ── URL normalisation ───────────────────────────────────────────────────
  // Every page had a silent twin. `_routes.json` only listed the canonical
  // spellings, so anything else — a trailing slash, the wrong case, a path
  // that no longer exists — fell through to Pages' SPA fallback and was served
  // index.html with HTTP 200 and the *homepage's* canonical tag. Google reports
  // exactly that as "Alternate page with proper canonical tag": a page it
  // fetched successfully, then dropped because the page told it to look
  // elsewhere. The canonical tag was doing its job; the URL should never have
  // answered 200 in the first place.

  // Trailing slash: /dk1/ and /dk1 are the same page, so say so with a 301
  // rather than serving both and letting a link tag arbitrate.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    const to = new URL(url);
    to.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return new Response(null, { status: 301, headers: { 'Location': to.toString() } });
  }

  // Case: paths are lowercase by construction, so /DK1 is a typo for a real
  // page rather than a page of its own. Only redirect when the lowercase form
  // actually exists — otherwise it falls through to the 404 below.
  if (/[A-Z]/.test(url.pathname)) {
    const lower = url.pathname.toLowerCase();
    if (isKnownPath(lower)) {
      const to = new URL(url);
      to.pathname = lower;
      return new Response(null, { status: 301, headers: { 'Location': to.toString() } });
    }
  }

  // Retired pages → the page that replaced them (permanent, before any rendering).
  const legacyTo = LEGACY_REDIRECTS[url.pathname];
  if (legacyTo) {
    const to = new URL(legacyTo, url);
    to.search = url.search;   // keep utm_* and friends; the fragment comes from the table
    return new Response(null, {
      status: 301,
      headers: { 'Location': to.toString(), 'Cache-Control': 'public, max-age=3600' },
    });
  }

  // Static routes (sitemap, robots, og-image)
  const staticRoute = STATIC_ROUTES[url.pathname];
  if (staticRoute) {
    const body = typeof staticRoute.body === 'function' ? await staticRoute.body(context) : staticRoute.body;
    return new Response(body, {
      headers: {
        'Content-Type': staticRoute.type,
        'Cache-Control': `public, max-age=${staticRoute.maxAge || 3600}`,
      },
    });
  }

  // Per-netselskab clean URLs: /dk1/<slug> and /dk2/<slug>
  // These are indexable entry points — Google can't follow hash fragments
  // (#DK1/net_inkl_alt/n1 is invisible to crawlers), so each net gets its
  // own crawlable URL that hydrates to the same SPA view.
  const netMatch = url.pathname.match(/^\/(dk[12])\/([a-z0-9-]+)$/);
  if (netMatch) {
    const area = netMatch[1].toUpperCase();
    const net  = NETS[area].find(n => n.slug === netMatch[2]);
    if (net) {
      return renderSPA(context, url.pathname, netPageMeta(area, net), { pricesIntro: { area, net } });
    }
    // Unknown net under a valid area → 404 not redirect, so we don't serve
    // a generic index with wrong metadata.
    return notFound();
  }

  // Homepage — server-render the live price snapshot into the HTML.
  // Lets Google / Bing / LLMs index the actual current spot price + total
  // without waiting for client-side JS. ~5-20ms overhead per request,
  // edge-cached at 5 min so most requests skip even that.
  if (url.pathname === '/') {
    return renderHomepage(context);
  }

  // SEO sub-pages — serve index.html with modified metadata for crawlers
  const page = SEO_PAGES[url.pathname];
  if (page) {
    const opts = {};
    if (url.pathname === '/dk1' || url.pathname === '/dk2') {
      opts.pricesIntro = { area: url.pathname.slice(1).toUpperCase(), net: null };
    }
    if (url.pathname === '/tariffer') opts.tariffFacts = true;
    if (url.pathname === '/prognose') opts.forecastChart = true;
    if (page.zonePage) opts.zonePage = page.zonePage;
    if (page.norden) opts.norden = true;
    if (page.city) { opts.city = page.city; return renderCachedPage(context, url.pathname, page, opts, CITY_SSR_VERSION); }
    if (opts.zonePage || opts.norden) return renderCachedPage(context, url.pathname, page, opts, ZONE_SSR_VERSION);
    return renderSPA(context, url.pathname, page, opts);
  }

  // Static assets pass through by name, not by "looks like a filename".
  // Matching any extension meant every path with a dot in it was handed to the
  // asset server — which, while the whole repository was being deployed, served
  // the Python scripts, the test files and wrangler.toml over HTTPS. The build
  // no longer ships those, and this makes a stray file unreachable rather than
  // merely unlinked. Keep in step with the exclude list in _routes.json.
  if (STATIC_ASSETS.has(url.pathname)) return context.next();
  return notFound();
}

// The complete set of files served as-is. Anything not listed 404s.
const STATIC_ASSETS = new Set([
  '/style.css', '/favicon.ico', '/favicon.svg', '/favicon-32.png',
  '/favicon-192.png', '/favicon-512.png', '/apple-touch-icon.png',
  '/og-image.png', '/manrope.woff2', '/privatliv', '/privatliv.html',
]);

/** Paths that resolve to a page, for the case-normalising redirect. */
function isKnownPath(path) {
  if (path === '/' || SEO_PAGES[path] || STATIC_ROUTES[path] || LEGACY_REDIRECTS[path]) return true;
  const m = path.match(/^\/(dk[12])\/([a-z0-9-]+)$/);
  return !!(m && NETS[m[1].toUpperCase()].some(n => n.slug === m[2]));
}

function notFound() {
  // Inline styles, not Tailwind classes. This markup is generated in the
  // Function, so Tailwind never scans it and the purged stylesheet does not
  // contain the utilities it would need — max-w-lg, py-20 and text-5xl are all
  // absent from style.css today.
  const body = `<!doctype html><html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Siden findes ikke — elpriser.org</title>
<style>
  :root { color-scheme: light dark; --bg:#f9fafb; --fg:#111827; --muted:#6b7280; --dim:#d1d5db; --link:#0ea5e9; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0b1220; --fg:#f3f4f6; --muted:#9ca3af; --dim:#374151; }
  }
  body { margin:0; background:var(--bg); color:var(--fg);
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  main { max-width:32rem; margin:0 auto; padding:5rem 1rem; text-align:center; }
  .code { font-size:3rem; font-weight:700; color:var(--dim); margin:0; }
  h1 { font-size:1.25rem; margin:1rem 0 .5rem; }
  p.lead { color:var(--muted); font-size:.875rem; margin:0; }
  nav { margin-top:1.5rem; font-size:.875rem; }
  a { color:var(--link); }
</style>
</head><body>
<main>
  <p class="code">404</p>
  <h1>Siden findes ikke</h1>
  <p class="lead">Adressen fører ikke til en side her. Prøv en af disse:</p>
  <nav>
    <a href="/">Forsiden</a> ·
    <a href="/dk1">DK1</a> ·
    <a href="/dk2">DK2</a> ·
    <a href="/tariffer">Nettariffer</a> ·
    <a href="/api">API</a>
  </nav>
</main></body></html>`;
  return new Response(body, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// ─── Homepage SSR with live-price injection ────────────────────────────────

/** Fetch the current (spot, total) price for one area via our own /api/now. */
async function fetchAreaSnapshot(context, area) {
  const origin = new URL(context.request.url).origin;
  const get = (mode) => fetch(`${origin}/api/now?area=${area}&mode=${mode}`)
    .then(r => r.ok ? r.json() : null).catch(() => null);
  const [spot, total] = await Promise.all([get('spot_inkl'), get('inkl_alt')]);
  if (!spot || !total) return null;
  return {
    spot:  spot.price,
    total: total.price,
    hour:  spot.hour,
  };
}

/** The homepage's price curve: today's settled hours and three days of forecast.
 *
 *  Rendered here rather than left to the client because the reason the section
 *  exists is search: the homepage was receiving "elpriser prognose" queries and
 *  ranking 18th on them with nothing on the page that answered them, while
 *  /prognose ranked 7th. A chart that only appears after JS runs would not fix
 *  that — which is also why the per-day figures below it stay as text. */
// ═══ Forsidens kurve: nu og 2 døgn frem ═══
// This function is CANONICAL and exists verbatim in two places: here and in
// functions/[[path]].js. The server draws it so a crawler gets the numbers on
// /prognose and the front page, the client redraws it from the table's data —
// and neither runtime can import from the other. test-forecast-chart.mjs runs both copies
// over the same fixtures and fails on the first differing byte, so the
// duplication cannot rot quietly.
//
// Everything here is deterministic on purpose: weekday and month names come
// from the arrays below rather than toLocaleDateString, whose output depends
// on the ICU build and would differ between Workers and a browser.
/** Round price-axis values between lo and hi: steps of 1, 2, 2.5 or 5 times a
 *  power of ten, aiming at about four. */
function fcTicks(lo, hi){
  var span=hi-lo;
  if(!(span>0))return [lo];
  var raw=span/4, mag=Math.pow(10,Math.floor(Math.log(raw)/Math.LN10)), n=raw/mag;
  var step=(n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*mag;
  var out=[];
  for(var v=Math.ceil(lo/step-1e-9)*step;v<=hi+1e-9;v+=step)out.push(+v.toFixed(6));
  return out;
}
/** The scale's labels, as HTML beside the svg. Like the day names, they cannot
 *  be <text> inside it: the svg is stretched with preserveAspectRatio="none"
 *  and glyphs would be squashed on a phone. Each sits at the same fraction of
 *  the height the svg draws its gridline at. */
function fcYaxis(ticks, Y, H){
  return ticks.map(function(v){
    var s=v.toFixed(2);if(/^-0\.?0*$/.test(s))s=s.slice(1);
    return '<span style="top:'+(Y(v)/H*100).toFixed(2)+'%">'+s.replace('.',',')+'</span>';
  }).join('');
}
/** The next days as text, one row per day: range and cheapest hour. The curve
 *  is a picture; this is what a crawler — and a reader who wants the week at a
 *  glance — can actually read. Same contiguity rule as the curve: it starts on
 *  today and stops at the first missing day, so a hole never closes up and
 *  shifts "I morgen" onto the wrong date. */
function fcWeekHTML(days, todayStr, n){
  var WD=['Søndag','Mandag','Tirsdag','Onsdag','Torsdag','Fredag','Lørdag'];
  var MON=['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
  var f2=function(v){var s=v.toFixed(2);if(/^-0\.?0*$/.test(s))s=s.slice(1);return s.replace('.',',');};
  var hh=function(h){return (h<10?'0':'')+h;};
  var dayNo=function(x){
    return Math.round((Date.parse(x+'T12:00:00Z')-Date.parse(todayStr+'T12:00:00Z'))/86400000);};
  var rows='',got=0;
  for(var k=0;k<days.length&&got<n;k++){
    var d=days[k];
    if(!d||!d.date||!d.prices)continue;
    var i=dayNo(d.date);
    if(i<0)continue;
    if(i!==got)break;
    var lo=null,hi=null,loH=0;
    for(var p=0;p<d.prices.length;p++){
      var pr=d.prices[p], v=pr&&pr.price!=null?pr.price:null;
      if(v==null)continue;
      if(lo==null||v<lo){lo=v;loH=pr.hour!=null?pr.hour:p;}
      if(hi==null||v>hi)hi=v;
    }
    if(lo==null)break;
    var dt=new Date(d.date+'T12:00:00Z');
    var label=got===0?'I dag':got===1?'I morgen':WD[dt.getUTCDay()];
    var real=d.type==='actual';
    rows+='<tr><th scope="row">'+label+'<small>'+dt.getUTCDate()+'. '+MON[dt.getUTCMonth()]+'</small></th>'
      +'<td>'+f2(lo)+'–'+f2(hi)+'</td>'
      +'<td>kl. '+hh(loH)+'–'+hh((loH+1)%24)+'</td>'
      +'<td class="'+(real?'real':'fc')+'">'+(real?'Børspris':'Prognose')+'</td></tr>';
    got++;
  }
  if(got<2)return '';
  return '<table class="fcweek"><thead><tr><th scope="col">Dag</th><th scope="col">Spænd</th>'
    +'<th scope="col">Billigst</th><th scope="col">Type</th></tr></thead><tbody>'+rows+'</tbody></table>';
}

function fcChartHTML(days, todayStr, nowHour){
  var WD=['Søndag','Mandag','Tirsdag','Onsdag','Torsdag','Fredag','Lørdag'];
  var MON=['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
  // A price that rounds to zero is printed without its minus: "-0" is not a
  // price anyone should have to read. Real negative prices keep their sign.
  var f2=function(v){var s=v.toFixed(2);if(/^-0\.?0*$/.test(s))s=s.slice(1);return s.replace('.',',');};
  var dm=function(dt){return dt.getUTCDate()+'. '+MON[dt.getUTCMonth()];};
  var dayName=function(n,dt){return n===0?'I dag':n===1?'I morgen':WD[dt.getUTCDay()];};
  // The feed opens on yesterday, so the window is keyed off today's date, not
  // off row 0. A day is only taken when it is exactly the next one expected:
  // skipping a hole and carrying on would splice non-adjacent days into one
  // continuous line, which reads as a price movement that never happened, and
  // would slide "I morgen" onto the wrong date.
  var dayNo=function(x){
    return Math.round((Date.parse(x+'T12:00:00Z')-Date.parse(todayStr+'T12:00:00Z'))/86400000);};
  var WINDOW=3;                  // i dag + 2 døgn frem
  var sel=[];
  for(var k=0;k<days.length&&sel.length<WINDOW;k++){
    var d=days[k];
    if(!d||!d.date||!d.prices)continue;
    var n=dayNo(d.date);
    if(n<0)continue;
    if(n!==sel.length)break;
    var ps=d.prices.map(function(p){return p&&p.price!=null?p.price:null;});
    if(!ps.some(function(p){return p!=null;}))break;
    sel.push({date:d.date,real:d.type==='actual',ps:ps});
  }
  if(sel.length<2)return '';
  var N=sel.length*24, W=720, H=190, PT=14, PB=10;
  var pts=[];
  for(var di=0;di<sel.length;di++)for(var h=0;h<24;h++){
    var p=sel[di].ps[h];
    if(p!=null)pts.push({i:di*24+h,p:p,di:di,real:sel[di].real});
  }
  if(pts.length<24)return '';
  var lo=Math.min.apply(null,pts.map(function(x){return x.p;}));
  var hi=Math.max.apply(null,pts.map(function(x){return x.p;}));
  var span=(hi-lo)||1;
  var X=function(i){return +(i/(N-1)*W).toFixed(1);};
  var Y=function(p){return +(PT+(1-(p-lo)/span)*(H-PT-PB)).toFixed(1);};
  var xy=function(x){return X(x.i)+','+Y(x.p);};
  // The colour language is the hero curve's, so the two charts read the same.
  var col=function(p){var t=(p-lo)/span;
    return t<.25?'#34c759':t<.5?'#a8d84a':t<.75?'#ffcc00':t<.9?'#ff9500':'#ff3b30';};
  // One stop per hour, exactly as the hero curve does it. Emitting only the
  // ends of each colour run is fewer stops, but it stops adjacent stops
  // interpolating and the curve comes out in hard-edged bands instead of the
  // blend the hero has — and the two charts sit on the same page.
  var stops=pts.map(function(x){
    return '<stop offset="'+(x.i/(N-1)*100).toFixed(1)+'%" stop-color="'+col(x.p)+'"/>';}).join('');
  // Split at the last settled hour. The two polylines share that point, so the
  // solid and dashed halves meet with no gap.
  var lastReal=-1;
  for(var j=0;j<pts.length;j++)if(pts[j].real)lastReal=j;
  var solid=lastReal>=0?pts.slice(0,lastReal+1):[];
  var dashed=lastReal>=0?pts.slice(lastReal):pts;
  var poly=function(a){return a.map(xy).join(' ');};
  var svg='<defs><linearGradient id="fcg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="'+W+'" y2="0">'+stops+'</linearGradient>'
    +'<linearGradient id="fcf" x1="0" y1="0" x2="0" y2="1">'
    +'<stop offset="0%" stop-color="#5b8bff" stop-opacity=".22"/>'
    +'<stop offset="100%" stop-color="#5b8bff" stop-opacity="0"/></linearGradient></defs>';
  var ticks=fcTicks(lo,hi);
  for(var ti=0;ti<ticks.length;ti++)
    svg+='<line x1="0" y1="'+Y(ticks[ti])+'" x2="'+W+'" y2="'+Y(ticks[ti])+'" stroke="currentColor" stroke-opacity=".07"/>';
  svg+='<polygon points="'+X(pts[0].i)+','+(H-PB+12)+' '+poly(pts)+' '+X(pts[pts.length-1].i)+','+(H-PB+12)+'" fill="url(#fcf)"/>';
  if(solid.length>1)
    svg+='<polyline points="'+poly(solid)+'" fill="none" stroke="url(#fcg)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>';
  if(dashed.length>1)
    svg+='<polyline points="'+poly(dashed)+'" fill="none" stroke="url(#fcg)" stroke-width="2.6" stroke-dasharray="5 4" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>';
  // Midnight separators and the day names between them.
  for(var s=1;s<sel.length;s++)
    svg+='<line x1="'+X(s*24)+'" y1="'+PT+'" x2="'+X(s*24)+'" y2="'+(H-PB+6)+'" stroke="currentColor" stroke-opacity=".12"/>';
  // Six-hour gridlines, fainter than midnight so the days still read as days.
  // Their labels go in HTML like the day names, for the same reason: text
  // inside this stretched svg is squashed on a phone.
  var hours='';
  for(var g=0;g<N;g+=6){
    var hh=g%24;
    if(hh)svg+='<line x1="'+X(g)+'" y1="'+PT+'" x2="'+X(g)+'" y2="'+(H-PB+6)+'" stroke="currentColor" stroke-opacity=".06" stroke-dasharray="2 4"/>';
    hours+='<span'+(g===0?' class="first"':'')+' style="left:'+(g/(N-1)*100).toFixed(2)+'%">'+(hh<10?'0':'')+hh+'</span>';
  }
  var labels='';
  for(var t=0;t<sel.length;t++){
    var dt=new Date(sel[t].date+'T12:00:00Z');
    labels+='<span>'+dayName(t,dt)+'<small>'+dm(dt)+'</small></span>';
  }
  // "Nu" sits on today's curve, and only when today is settled.
  if(nowHour!=null&&sel[0].real&&sel[0].ps[nowHour]!=null){
    svg+='<line x1="'+X(nowHour)+'" y1="'+(PT-6)+'" x2="'+X(nowHour)+'" y2="'+(H-PB+6)+'" stroke="currentColor" stroke-opacity=".2" stroke-dasharray="3 4"/>'
      +'<circle cx="'+X(nowHour)+'" cy="'+Y(sel[0].ps[nowHour])+'" r="5.5" fill="#1b57f5" stroke="#fff" stroke-width="2.5"/>';
  }
  // The per-day figures stay as text. They are what the front page answers
  // "elpriser prognose" with, and an SVG path answers nothing.
  var dayLo=sel.map(function(d){return Math.min.apply(null,d.ps.filter(function(p){return p!=null;}));});
  var cheap=dayLo.indexOf(Math.min.apply(null,dayLo));
  var cards=sel.map(function(d,n){
    var v=d.ps.filter(function(p){return p!=null;});
    var dt=new Date(d.date+'T12:00:00Z');
    return '<div class="mini'+(n===cheap?' best':'')+'">'
      +'<div class="k">'+dayName(n,dt)+' · '+(d.real?'Børspris':'Prognose')+'</div>'
      +'<div class="v">'+f2(Math.min.apply(null,v))+'–'+f2(Math.max.apply(null,v))+'</div>'
      +'<div class="s">'+dm(dt)+' · '+'kr/kWh'+'</div></div>';
  }).join('');
  return '<div class="yplot"><svg id="fcCurve" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" style="min-height:160px" role="img" aria-label="Elpris time for time i dag og '+(sel.length-1)+' døgn frem">'+svg+'</svg>'
    +'<div class="yax">'+fcYaxis(ticks,Y,H)+'</div></div>'
    +'<div class="fc-hours ygut">'+hours+'</div>'
    +'<div class="fc-days ygut">'+labels+'</div>'
    +'<div class="minirow">'+cards+'</div>';
}

/** Build the live-price JSON-LD block + Reader-summary prose. */
function buildLivePriceMarkup(dk1, dk2) {
  const hh = String(dk1.hour).padStart(2, '0');
  const fmt = (p) => p == null ? '—' : p.toFixed(2).replace('.', ',');
  // Prose version of the live snapshot for the Reader-summary <article> —
  // what Safari Reader (and crawlers) see as the page's article text.
  const summary = `Lige nu kl. ${hh}:00 koster strøm ${fmt(dk1.spot)} kr/kWh i ren spotpris i DK1 (Vestdanmark) og ${fmt(dk2.spot)} kr/kWh i DK2 (Østdanmark). Med systemtarif, transmissionstarif, elafgift og moms er prisen ${fmt(dk1.total)} kr/kWh i DK1 og ${fmt(dk2.total)} kr/kWh i DK2 — før nettariffen fra dit lokale netselskab.`;

  const iso = new Date().toISOString();
  const priceLd = (name, price) => ({
    "@type": "PriceSpecification",
    name,
    price: price.toFixed(4),
    priceCurrency: "DKK",
    unitText: "kWh",
    validFrom: iso,
  });
  const jsonLd = `<script type="application/ld+json">
${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": "https://elpriser.org/", "dateModified": iso },
      priceLd("Aktuel spotpris DK1 (Vestdanmark) inkl. moms", dk1.spot),
      priceLd("Aktuel spotpris DK2 (Østdanmark) inkl. moms", dk2.spot),
      { ...priceLd("Samlet elpris DK1 (Vestdanmark) inkl. alt", dk1.total),
        description: "Spotpris + nettarif + systemtarif + transmissionstarif + elafgift + moms" },
      { ...priceLd("Samlet elpris DK2 (Østdanmark) inkl. alt", dk2.total),
        description: "Spotpris + nettarif + systemtarif + transmissionstarif + elafgift + moms" },
    ],
  }, null, 2)}
</script>`;
  return { jsonLd, summary };
}

// ═══ Pris-skærmen (Design A: ét svar) ═══
// CANONICAL, like fcChartHTML: verbatim in index.html and functions/[[path]].js.
// The server draws it, so a crawler is served the price, the sentence, the
// bars' numbers and the day list as text; the browser redraws it from the same
// /api/forecast shape when the visitor switches Din pris / Spotpris or the area.
// Neither runtime can import from the other; test-static.js diffs the two copies
// and test-forecast-chart.mjs runs both over the same fixtures.
//
// ONE screen for every price area. The Danish pages call prisHTML with a net and a
// view; /no/strompris, /sv/elpris and /fi/sahkon-hinta call it with `zone` (a key of ZONES) and get
// the same markup in that zone's language (PRIS_I18N), in its sub-unit (øre, öre,
// snt), spot price only. zoneToPrisDays turns an /api/nordic response into the
// days[] the screen draws and keeps the first five days, so nothing on those
// pages can show the feed's longer horizon.
//
// Deterministic on purpose: weekday and month names come from the table below
// rather than toLocaleDateString, whose output depends on the ICU build and would
// differ between Workers and a browser.

/** Every word the screen shows, per language. Same keys in every language
 *  (test-forecast-chart.mjs). The Din pris / Spotpris switch and the breakdown
 *  panel are Danish-only features and keep their Danish text in their functions. */
var PRIS_I18N={
  da:{wd:['søndag','mandag','tirsdag','onsdag','torsdag','fredag','lørdag'],ws:['søn','man','tir','ons','tor','fre','lør'],
    mon:['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'],dot:'.',
    now:'Elpris lige nu',hourly:'Elpris time for time',at:'kl.',today:'i dag',tomorrow:'i morgen',evening:'i aften',
    verdict:['Billig lige nu','Middel lige nu','Dyr lige nu'],tier:['Billig','Middel','Dyr'],
    cheaper:'Billigere',cheapest24:'Billigste time de næste 24 timer',lo:'billigst',hi:'dyrest',
    next:'Næste',p2:'2 døgn',p5:'5 døgn',period:'Periode',fc:'Prognose',actual:'Børspris',
    byDay:'Dag for dag',day:'Dag',range:'Spænd',type:'Type',none:'Priserne kunne ikke hentes lige nu.',
    cap:'Spotpris uden moms, afgifter og nettarif',h1:'Elpriser i Danmark i dag',zoneTabs:'Prisområde',
    zonesH:'Elpriser i Danmark',avg:'gns.',note:'Prognosen kommer fra én åben maskinlæringsmodel for alle 13 prisområder. Omregnet fra EUR med Den Europæiske Centralbanks dagskurs.',model:'Se modellen på Hugging Face'},
  nb:{wd:['søndag','mandag','tirsdag','onsdag','torsdag','fredag','lørdag'],ws:['søn','man','tir','ons','tor','fre','lør'],
    mon:['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'],dot:'.',
    now:'Strømpris akkurat nå',hourly:'Strømpris time for time',at:'kl.',today:'i dag',tomorrow:'i morgen',evening:'i kveld',
    verdict:['Billig akkurat nå','Middels akkurat nå','Dyr akkurat nå'],tier:['Billig','Middels','Dyr'],
    cheaper:'Billigere',cheapest24:'Billigste time de neste 24 timene',lo:'billigst',hi:'dyrest',
    next:'Neste',p2:'2 døgn',p5:'5 døgn',period:'Periode',fc:'Prognose',actual:'Børspris',
    byDay:'Dag for dag',day:'Dag',range:'Spenn',type:'Type',none:'Prisene kunne ikke hentes akkurat nå.',
    cap:'Spotpris uten mva, avgifter og nettleie',h1:'Strømpris i Norge: i dag og prognose for de neste 5 døgnene',zoneTabs:'Prisområde',
    zonesH:'Strømpriser i Norge etter by og prisområde',avg:'snitt',note:'Prognosen kommer fra én åpen maskinlæringsmodell for alle 13 prisområder. Omregnet fra EUR med Den europeiske sentralbankens daglige kurs.',model:'Se modellen på Hugging Face'},
  sv:{wd:['söndag','måndag','tisdag','onsdag','torsdag','fredag','lördag'],ws:['sön','mån','tis','ons','tors','fre','lör'],
    mon:['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'],dot:'',
    now:'Elpris just nu',hourly:'Elpris timme för timme',at:'kl.',today:'idag',tomorrow:'imorgon',evening:'ikväll',
    verdict:['Billigt just nu','Medel just nu','Dyrt just nu'],tier:['Billigt','Medel','Dyrt'],
    cheaper:'Billigare',cheapest24:'Billigaste timmen de närmaste 24 timmarna',lo:'billigast',hi:'dyrast',
    next:'Kommande',p2:'2 dygn',p5:'5 dygn',period:'Period',fc:'Prognos',actual:'Börspris',
    byDay:'Dag för dag',day:'Dag',range:'Spann',type:'Typ',none:'Priserna kunde inte hämtas just nu.',
    cap:'Spotpris utan moms, skatter och nätavgift',h1:'Elpris i Sverige: idag och prognos för de närmaste 5 dygnen',zoneTabs:'Elområde',
    zonesH:'Elpriser i Sverige per stad och elområde',avg:'snitt',note:'Prognosen kommer från en öppen maskininlärningsmodell för alla 13 elområden. Omräknat från EUR med Europeiska centralbankens dagliga kurs.',model:'Se modellen på Hugging Face'},
  fi:{wd:['sunnuntai','maanantai','tiistai','keskiviikko','torstai','perjantai','lauantai'],ws:['su','ma','ti','ke','to','pe','la'],
    mon:['tammik.','helmik.','maalisk.','huhtik.','toukok.','kesäk.','heinäk.','elok.','syysk.','lokak.','marrask.','jouluk.'],dot:'.',
    now:'Sähkön hinta juuri nyt',hourly:'Sähkön hinta tunneittain',at:'klo',today:'tänään',tomorrow:'huomenna',evening:'illalla',
    verdict:['Halpa juuri nyt','Keskihintainen juuri nyt','Kallis juuri nyt'],tier:['Halpa','Keskihintainen','Kallis'],
    cheaper:'Halvempi',cheapest24:'Halvin tunti seuraavan 24 tunnin aikana',lo:'halvin',hi:'kallein',
    next:'Seuraavat',p2:'2 vrk',p5:'5 vrk',period:'Jakso',fc:'Ennuste',actual:'Pörssihinta',
    byDay:'Päivä päivältä',day:'Päivä',range:'Vaihteluväli',type:'Tyyppi',none:'Hintoja ei voitu hakea juuri nyt.',
    cap:'Pörssihinta ilman arvonlisäveroa, veroja ja siirtomaksua',h1:'Sähkön hinta Suomessa: tänään ja ennuste seuraaville 5 vuorokaudelle',zoneTabs:'Hinta-alue',
    zonesH:'Sähkön hinta Suomessa',avg:'keskihinta',note:'Ennuste tulee yhdestä avoimesta koneoppimismallista, joka kattaa kaikki 13 hinta-aluetta. Muunnettu euroista Euroopan keskuspankin päiväkurssilla.',model:'Katso malli Hugging Facessa'}
};

/** The price areas: the single source of names, cities, currency and sub-unit.
 *  `rate` is the fallback for the ECB rate /api/nordic returns (zoneInfo.rate).
 *  `lang` picks the PRIS_I18N table for a zone's own page; DK and NL have none. */
var ZONES={
  dk1:{name:'DK1',city:'Vestdanmark',lang:'da',cur:'DKK',rate:7.4755,sub:'øre'},
  dk2:{name:'DK2',city:'Østdanmark',lang:'da',cur:'DKK',rate:7.4755,sub:'øre'},
  no1:{name:'NO1',city:'Oslo',lang:'nb',cur:'NOK',rate:10.84,sub:'øre'},
  no2:{name:'NO2',city:'Kristiansand',lang:'nb',cur:'NOK',rate:10.84,sub:'øre'},
  no3:{name:'NO3',city:'Trondheim',lang:'nb',cur:'NOK',rate:10.84,sub:'øre'},
  no4:{name:'NO4',city:'Tromsø',lang:'nb',cur:'NOK',rate:10.84,sub:'øre'},
  no5:{name:'NO5',city:'Bergen',lang:'nb',cur:'NOK',rate:10.84,sub:'øre'},
  se1:{name:'SE1',city:'Luleå',lang:'sv',cur:'SEK',rate:11.29,sub:'öre'},
  se2:{name:'SE2',city:'Sundsvall',lang:'sv',cur:'SEK',rate:11.29,sub:'öre'},
  se3:{name:'SE3',city:'Stockholm',lang:'sv',cur:'SEK',rate:11.29,sub:'öre'},
  se4:{name:'SE4',city:'Malmö',lang:'sv',cur:'SEK',rate:11.29,sub:'öre'},
  fi:{name:'FI',city:'Suomi',lang:'fi',cur:'EUR',rate:1,sub:'snt'},
  nl:{name:'NL',city:'Nederland',lang:'da',cur:'EUR',rate:1,sub:'cent'}
};
/** The three country pages: their language, their zones left to right, and the one shown first. */
var PRIS_COUNTRIES={
  'no/strompris':{lang:'nb',zones:['no1','no2','no3','no4','no5'],def:'no1'},
  'sv/elpris':{lang:'sv',zones:['se1','se2','se3','se4'],def:'se3'},
  'fi/sahkon-hinta':{lang:'fi',zones:['fi'],def:'fi'}
};

/** A price with d decimals and a Danish comma; never "-0,00". */
function prisNum(v,d){var s=v.toFixed(d);if(/^-0\.?0*$/.test(s))s=s.slice(1);return s.replace('.',',');}
function prisHH(h){return (h<10?'0':'')+h;}
function prisEsc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function prisCap(s){return s.charAt(0).toUpperCase()+s.slice(1);}
function prisDate(date,L){
  var dt=new Date(date+'T12:00:00Z');
  L=L||PRIS_I18N.da;
  return {wd:L.wd[dt.getUTCDay()],ws:L.ws[dt.getUTCDay()],d:dt.getUTCDate(),m:L.mon[dt.getUTCMonth()]};
}

/** The period pill: 2 (næste 2 døgn) or 5 (næste 5 døgn). The pill used to read
 *  "3–10 døgn" and its value was 10, so 10, "10" and "3–10" — anything an old
 *  link, a stored setting or a test still carries — resolve to the 5 døgn view. */
function prisPeriod(p){
  var s=String(p==null?'':p);
  return /(^|[^0-9])(5|10)([^0-9]|$)/.test(s)?5:2;
}

/** /api/nordic as the days[] this screen draws. Prices go from EUR/MWh to the
 *  zone's sub-unit per kWh (÷ 10 × rate) at the ECB rate the response carries
 *  (`info`, the response's zoneInfo), falling back to ZONES. Days before
 *  `todayStr` are dropped — the feed opens on yesterday — and only the FIRST
 *  FIVE days are kept: the feed carries ten, this site shows two and five. */
function zoneToPrisDays(raw,info,todayStr){
  var rate=(info&&info.rate>0&&info.rate)||(ZONES[raw&&raw.zone]||{}).rate||1;
  var src=(raw&&raw.days)||[],out=[];
  for(var k=0;k<src.length&&out.length<5;k++){
    var d=src[k];
    if(!d||!d.date||!d.prices||(todayStr&&d.date<todayStr))continue;
    out.push({date:d.date,type:d.type,prices:d.prices.map(function(p){
      return p&&p.eur_mwh!=null?{hour:p.hour,price:p.eur_mwh*rate/10}:null;})});
  }
  return out;
}

/** The forecast feed as up to ten consecutive days from today, 24 slots each.
 *  Same contiguity rule as fcChartHTML: it starts on today and stops at the first
 *  missing day, so a hole never closes up and shifts "I morgen" onto the wrong
 *  date. */
function prisDays(days,todayStr){
  var out=[];
  var dayNo=function(x){
    return Math.round((Date.parse(x+'T12:00:00Z')-Date.parse(todayStr+'T12:00:00Z'))/86400000);};
  for(var k=0;k<days.length&&out.length<10;k++){
    var d=days[k];
    if(!d||!d.date||!d.prices)continue;
    var n=dayNo(d.date);
    if(n<0)continue;
    if(n!==out.length)break;
    var ps=[];
    for(var h=0;h<24;h++)ps.push(null);
    for(var j=0;j<d.prices.length;j++){
      var p=d.prices[j];
      if(!p||p.price==null)continue;
      var hr=p.hour!=null?p.hour:j;
      if(hr>=0&&hr<24)ps[hr]=p.price;
    }
    // The nettarif per hour (net modes only), kept only when all 24 are real numbers.
    var gt=null;
    if(d.grid_tariff&&d.grid_tariff.length===24){
      gt=[];
      for(var g=0;g<24;g++){
        var gv=d.grid_tariff[g];
        if(typeof gv!=='number'||!isFinite(gv)){gt=null;break;}
        gt.push(gv);
      }
    }
    out.push({date:d.date,real:d.type==='actual',ps:ps,gt:gt});
  }
  return out;
}

/** 0 cheap, 1 middle, 2 dear: by how many of the reference hours are cheaper —
 *  the verdict the apps use too (tests/golden/reference.mjs). */
function prisTier(p,ref){
  if(!ref.length)return 1;
  var c=0;
  for(var i=0;i<ref.length;i++)if(ref[i]<p)c++;
  var pct=Math.round(c/ref.length*100);
  return pct<=33?0:pct<=66?1:2;
}

/** What differs between a Danish screen and a zone's: the language table, the unit,
 *  the decimals (about three significant figures of the largest price, as øre and
 *  snt run from 5 to 300) and the axis grain `sc` — a power of ten that scales the
 *  axis rule below. Danish is kr/kWh with two decimals and grain 1. */
function prisDec(mx){return mx>=100?0:mx>=10?1:2;}
function prisCtx(o,all){
  var z=o.zone?ZONES[o.zone]:null,mx=0,i,h,v;
  if(z)for(i=0;i<all.length;i++)for(h=0;h<24;h++){v=all[i].ps[h];if(v!=null&&Math.abs(v)>mx)mx=Math.abs(v);}
  return {z:!!z,L:PRIS_I18N[z?z.lang:'da'],u:z?z.sub:'kr',d:z?prisDec(mx):2,
    sc:z&&mx>0?Math.pow(10,Math.floor(Math.log(mx)/Math.LN10)):1};
}

/** The axis: zero-based, top at the highest price + ~12 % rounded up to the next
 *  half grain so the tallest bar never touches the frame. Whole-grain steps, halves
 *  only when the whole axis is two and a half grains or less (the grain is 1 krone;
 *  see prisCtx). A negative price extends it below zero by the same rule. */
function prisAxis(vals,sc){
  sc=sc||1;
  var q=0.5*sc,mx=0,mn=0;
  for(var i=0;i<vals.length;i++){if(vals[i]>mx)mx=vals[i];if(vals[i]<mn)mn=vals[i];}
  var hi=Math.ceil(mx*1.12/q-1e-9)*q;
  if(hi<q)hi=q;
  var lo=mn<0?-Math.ceil(-mn*1.12/q-1e-9)*q:0;
  var span=hi-lo,step=span<=2.5*sc?q:span<=10*sc?sc:span<=20*sc?2*sc:5*sc;
  var ticks=[];
  for(var t=Math.ceil(lo/step-1e-9)*step;t<=hi+1e-9;t+=step)ticks.push(+t.toFixed(6));
  return {lo:lo,hi:hi,step:step,ticks:ticks};
}

/** The cheapest and the dearest hour among `slots` ({d:day index,h:hour,p:price}). */
function prisExtremes(slots){
  var lo=null,hi=null;
  for(var i=0;i<slots.length;i++){
    var s=slots[i];
    if(s.p==null)continue;
    if(lo==null||s.p<lo.p)lo=s;
    if(hi==null||s.p>hi.p)hi=s;
  }
  return {lo:lo,hi:hi};
}
/** The day an hour falls on, in words: i dag, i morgen, then "søn 17." */
function prisWhen(s,all,C){
  if(s.d===0)return C.L.today;
  if(s.d===1)return C.L.tomorrow;
  var dt=prisDate(all[s.d].date,C.L);
  return dt.ws+' '+dt.d+C.L.dot;
}

/** The one sentence under the verdict: the cheapest hour of the next 24 if it is
 *  cheaper than now, otherwise that now is it. */
function prisSentence(all,nowHour,nowP,C){
  if(nowP==null)return '';
  var win=[];
  for(var k=1;k<24;k++){
    var a=nowHour+k,d=a<24?0:1,h=a%24;
    if(all[d])win.push({d:d,h:h,p:all[d].ps[h]});
  }
  var best=prisExtremes(win).lo;
  if(best&&best.p<nowP)
    return C.L.cheaper+' '+prisWhen(best,all,C)+' '+C.L.at+' '+prisHH(best.h)+' — <b>'+prisNum(best.p,C.d)+' '+C.u+'</b>';
  return C.L.cheapest24;
}

/** Two tiles: cheapest and dearest of the hours still to come (this one on)
 *  within the first `nDays` days — the window the period pill shows. */
function prisTiles(all,nowHour,nDays,cls,C){
  var up=[];
  for(var d=0;d<all.length&&d<nDays;d++)
    for(var h=0;h<24;h++)if(d>0||h>=nowHour)up.push({d:d,h:h,p:all[d].ps[h]});
  var ex=prisExtremes(up),out='';
  var tile=function(k,s){
    return '<div class="pris-tile"><div class="k">'+k+'</div><div class="v">'+prisNum(s.p,C.d)
      +' <small>'+C.u+' · '+C.L.at+' '+prisHH(s.h)+'</small></div></div>';};
  if(ex.lo)out+=tile(prisCap(C.L.lo)+' '+prisWhen(ex.lo,all,C),ex.lo);
  if(ex.hi)out+=tile(prisCap(C.L.hi)+' '+(ex.hi.d===0&&ex.hi.h>=17?C.L.evening:prisWhen(ex.hi,all,C)),ex.hi);
  return out?'<div class="pris-tiles '+cls+'">'+out+'</div>':'';
}

/** The caption under the Din pris / Spotpris switch. */
function prisCaption(view,net){
  if(view==='spot')return 'Spotpris inkl. moms';
  return net?'Inkl. nettarif, afgifter og moms':'Inkl. Energinets tariffer, afgifter og moms';
}

/** What one hour's price is made of, as integers in tenths of an øre so nothing
 *  drifts. `price` is kr/kWh incl. VAT in the active view; `ch` is the response's
 *  `charges` {sys,trans,afg,vat} (DKK/kWh excl. VAT); `tariff` the hour's nettarif
 *  (DKK/kWh excl. VAT) and `withNet` whether a net company is chosen.
 *  Din pris:  vat = price - price/(1+vat); spot = price/(1+vat) - sys - trans - afg - tariff.
 *  Spotpris:  spot = price/(1+vat); vat = price - spot.
 *  Every part but the spot is rounded to 0.1 øre; the spot row takes what is left, so the
 *  rows sum EXACTLY to `total` (the price rounded to 0.1 øre). Null when anything needed is
 *  missing — the caption then stays plain text. */
function prisParts(price,view,ch,tariff,withNet){
  var num=function(x){return typeof x==='number'&&isFinite(x);};
  if(!num(price)||!ch||!num(ch.vat)||ch.vat<0)return null;
  var t10=function(x){var n=Math.round(x*1000);return n===0?0:n;};
  var total=t10(price),vat=t10(price-price/(1+ch.vat)),rows=[],rest=total-vat,n;
  if(view!=='spot'){
    if(!num(ch.sys)||!num(ch.trans)||!num(ch.afg)||(withNet&&!num(tariff)))return null;
    var sys=t10(ch.sys),trans=t10(ch.trans),afg=t10(ch.afg),net=withNet?t10(tariff):0;
    rest=total-vat-sys-trans-afg-net;
    rows=[{k:'spot',v:rest},{k:'sys',v:sys},{k:'trans',v:trans}];
    if(withNet)rows.push({k:'net',v:net});
    rows.push({k:'afg',v:afg},{k:'vat',v:vat});
  }else rows=[{k:'spot',v:rest},{k:'vat',v:vat}];
  for(n=0;n<rows.length;n++)if(rows[n].v===0)rows[n].v=0;
  return {total:total,vat:ch.vat,rows:rows};
}

/** The folded-out panel for one hour: heading, a thin stacked bar, the rows and the total.
 *  `all` from prisDays, `di` day index, `h` hour; `sel` true when it is a bar the visitor picked
 *  (the heading then names the day, like the tooltip, and there is a way back to now).
 *  Returns '' when the hour cannot be split. */
function prisPanel(all,di,h,sel,o){
  o=o||{};
  var d=all[di],p=d?d.ps[h]:null;
  if(p==null)return '';
  var view=o.view==='spot'?'spot':'din';
  var pt=prisParts(p,view,o.charges,d.gt?d.gt[h]:null,!!o.net);
  if(!pt)return '';
  var when='';
  if(sel){
    var dt=prisDate(d.date);
    when=(di===0?'i dag':di===1?'i morgen':dt.ws+' '+dt.d+'. '+dt.m)+' ';
  }
  var names={spot:d.real?'Spotpris (Nord Pool)':'Spotpris (prognose)',sys:'Systemtarif (Energinet)',
    trans:'Transmissionstarif (Energinet)',net:'Nettarif ('+prisEsc(o.net||'')+', kl. '+prisHH(h)+')',
    afg:'Elafgift',vat:'Moms ('+Math.round(pt.vat*100)+' %)'};
  var cls={spot:'spot',sys:'en',trans:'en',net:'net',afg:'afg',vat:'vat'};
  var pos=0,i;
  for(i=0;i<pt.rows.length;i++)if(pt.rows[i].v>0)pos+=pt.rows[i].v;
  var bar='',list='';
  for(i=0;i<pt.rows.length;i++){
    var r=pt.rows[i];
    if(pos>0&&r.v>0)bar+='<i class="bd-'+cls[r.k]+'" style="width:'+(r.v/pos*100).toFixed(2)+'%"></i>';
    list+='<li><i class="bd-dot bd-'+cls[r.k]+'"></i><span class="l">'+names[r.k]+'</span><b>'+prisNum(r.v/10,1)+' øre</b></li>';
  }
  return '<div class="pris-bdhd"><p class="pris-bdh">Sådan er prisen '+when+'kl. '+prisHH(h)+' sammensat</p>'
    +(sel?'<button type="button" class="pris-bdback" data-pris-back>Tilbage til nu</button>':'')+'</div>'
    +(bar?'<div class="pris-bdbar" aria-hidden="true">'+bar+'</div>':'')
    +'<ul class="pris-bdrows">'+list+'<li class="tot"><span class="l">I alt</span><b>'+prisNum(p,2)+' kr/kWh</b></li></ul>';
}

/** The caption: plain text when there is no panel, otherwise a native <details> whose
 *  <summary> is the caption itself (works without JS, and the text is crawlable). */
function prisCapHTML(card,caption,panel,open){
  if(!panel)return '<p class="pris-cap'+(card?' pris-cap-card':'')+'">'+caption+'</p>';
  return '<details class="pris-bd'+(card?' pris-bd-card':'')+'"'+(open?' open':'')+'><summary class="pris-cap">'+caption
    +'<i class="pris-chev" aria-hidden="true"></i></summary><div class="pris-bdp">'+panel+'</div></details>';
}

function prisSwitch(view,cls,spotLabel){
  var b=function(v,label){
    return '<button type="button" data-pris-view="'+v+'" aria-pressed="'+(view===v)+'"'+(view===v?' class="on"':'')+'>'+label+'</button>';};
  return '<div class="pris-seg '+cls+'" role="group" aria-label="Prisvisning">'+b('din','Din pris')+b('spot',spotLabel)+'</div>';
}

/** One chart card: bars coloured by tier, the hours already gone dimmed, a dot
 *  over the current hour, a zero-based axis with gridlines, and the exact price
 *  of every hour in data-tip for the browser's hover/tap tooltip. The first two
 *  days read "I dag" / "I morgen", later ones "søn 17. okt". */
function prisChart(rows,nDays,o){
  var C=o.C,L=C.L,n=nDays*24,vals=[],i;
  for(i=0;i<rows.length;i++)for(var h0=0;h0<24;h0++)if(rows[i].ps[h0]!=null)vals.push(rows[i].ps[h0]);
  var ax=prisAxis(vals,C.sc),span=ax.hi-ax.lo;
  var ref=o.ref||vals;
  var y=function(v){return (v-ax.lo)/span*100;};
  var grid='',yl='';
  for(i=0;i<ax.ticks.length;i++){
    var top=(100-y(ax.ticks[i])).toFixed(2);
    grid+='<span class="pris-gl" style="top:'+top+'%"></span>';
    yl+='<span style="top:'+top+'%">'+prisNum(ax.ticks[i],ax.step%1?1:0)+'</span>';
  }
  var cols='',seps='',fcAt=-1;
  for(var s=0;s<n;s++){
    var r=rows[Math.floor(s/24)],h=s%24,p=r?r.ps[h]:null;
    if(fcAt<0&&r&&!r.real)fcAt=s;
    if(s%24===0&&s>0&&o.seps)seps+='<span class="pris-sep" style="left:'+(s/n*100).toFixed(2)+'%"></span>';
    if(p==null){cols+='<span class="pc"></span>';continue;}
    var base=y(Math.min(p,0)),ht=Math.abs(p)/span*100,dt=prisDate(r.date,L);
    var dn=Math.floor(s/24);
    var tip=(dn===0?prisCap(L.today):dn===1?prisCap(L.tomorrow):dt.ws+' '+dt.d+L.dot+' '+dt.m)
      +' '+L.at+' '+prisHH(h)+' · '+prisNum(p,C.d)+' '+C.u+'/kWh';
    cols+='<span class="pc'+(s<o.nowSlot?' past':'')+'" data-tip="'+prisEsc(tip)+'"><i class="pb t'+prisTier(p,ref)
      +'" style="bottom:'+base.toFixed(1)+'%;height:'+ht.toFixed(1)+'%"></i>'
      +(s===o.nowSlot?'<b class="pd" style="bottom:calc('+(base+ht).toFixed(1)+'% + 3px)"></b>':'')+'</span>';
  }
  // "Prognose" where the settled prices end: a thin divider with its label.
  var fc=fcAt>=0?'<span class="pris-fc'+(fcAt>0?' mid':'')+'" style="left:'+(fcAt/n*100).toFixed(2)+'%"><i></i>'+L.fc+'</span>':'';
  var xl='';
  if(o.xDays){
    for(i=0;i<nDays;i++){
      var dd=rows[i]?prisDate(rows[i].date,L):null;
      if(dd)xl+='<span class="xd" style="left:'+((i*24+12)/n*100).toFixed(2)+'%">'+dd.ws+' '+dd.d+'</span>';
    }
  }else{
    for(var hx=0;hx<n;hx+=6){
      var lbl=hx===0?prisCap(L.today)+' 00':hx===24?prisCap(L.tomorrow)+' 00':prisHH(hx%24);
      xl+='<span class="'+(hx%12?'x6':'x12')+(hx===0?' first':'')+'" style="left:'+(hx/n*100).toFixed(2)+'%">'+lbl+'</span>';
    }
  }
  var ex=prisExtremes(prisFlat(rows));
  var at=function(s){return ' '+C.u+'/kWh '+L.at+' '+prisHH(s.h);};
  var aria=o.title+': '+(ex.lo?L.lo+' '+prisNum(ex.lo.p,C.d)+at(ex.lo)+', ':'')
    +(ex.hi?L.hi+' '+prisNum(ex.hi.p,C.d)+at(ex.hi)+'.':'');
  return '<div class="pris-plotwrap"><span class="pris-unit">'+C.u+'/kWh</span><div class="pris-yl">'+yl+'</div>'
    +'<div class="pris-plot" role="img" tabindex="0" aria-label="'+prisEsc(aria)+'" data-n="'+n+'">'
    +grid+seps+'<div class="pris-cols">'+cols+'</div>'+fc+'<div class="pris-tip" role="status" hidden></div></div>'
    +'<div class="pris-xl'+(o.xDays?' days':'')+'">'+xl+'</div></div>';
}
function prisFlat(rows){
  var out=[];
  for(var d=0;d<rows.length;d++)for(var h=0;h<24;h++)out.push({d:d,h:h,p:rows[d].ps[h]});
  return out;
}

/** Per-day range and cheapest hour, as text. */
function prisDayRows(all,C){
  var L=C.L,rows='';
  for(var i=0;i<all.length;i++){
    var d=all[i],lo=null,hi=null,loH=0;
    for(var h=0;h<24;h++){
      var v=d.ps[h];
      if(v==null)continue;
      if(lo==null||v<lo){lo=v;loH=h;}
      if(hi==null||v>hi)hi=v;
    }
    if(lo==null)continue;
    var dt=prisDate(d.date,L);
    var name=i===0?prisCap(L.today):i===1?prisCap(L.tomorrow):prisCap(dt.wd);
    // r2: shown in both periods, r5: only in 5 døgn, r10: days 6-10, kept in the
    // markup as text for crawlers and never shown on this screen.
    rows+='<tr class="'+(i<2?'r2':i<5?'r5':'r10')+'"><th scope="row">'+name+'<small>'+dt.d+L.dot+' '+dt.m+'</small></th>'
      +'<td>'+prisNum(lo,C.d)+'–'+prisNum(hi,C.d)+'</td>'
      +'<td>'+L.at+' '+prisHH(loH)+'–'+prisHH((loH+1)%24)+'</td>'
      +'<td class="'+(d.real?'real':'fc')+'">'+(d.real?L.actual:L.fc)+'</td></tr>';
  }
  if(!rows)return '';
  return '<section class="pris-days" aria-label="'+L.byDay+'"><p class="pris-dt">'+L.byDay+'</p>'
    +'<table class="pris-week"><thead><tr><th scope="col">'+L.day+'</th><th scope="col">'+L.range+', '+C.u+'/kWh</th>'
    +'<th scope="col">'+prisCap(L.lo)+'</th><th scope="col">'+L.type+'</th></tr></thead><tbody>'+rows+'</tbody></table></section>';
}

/** The whole screen. `o`: {view:'din'|'spot', period:2|5 (legacy 10 reads as 5), net:name|null, where:'DK1 Vest', key,
 *  charges:{sys,trans,afg,vat} from the same response (without it the caption stays plain), open:true to draw the breakdown unfolded,
 *  zone:key of ZONES for a foreign area — its language, its unit, spot only, no switch}. */
function prisHTML(days,todayStr,nowHour,o){
  o=o||{};
  var view=o.view==='spot'?'spot':'din',period=prisPeriod(o.period);
  var all=prisDays(days||[],todayStr),C=prisCtx(o,all),L=C.L;
  var today=all.length?all[0]:null;
  var nowP=today?today.ps[nowHour]:null;
  var td=today?[]:null,i;
  if(today)for(i=0;i<24;i++)if(today.ps[i]!=null)td.push(today.ps[i]);
  var verdict=nowP!=null?prisTier(nowP,td):1;
  var sentence=prisSentence(all,nowHour,nowP,C);
  var caption=C.z?L.cap:prisCaption(view,o.net);
  var panel=today?prisPanel(all,0,nowHour,false,o):'';
  var wd=today?prisDate(todayStr,L).wd:'';
  var hero='<section class="pris-hero" aria-label="'+L.now+(o.where?' — '+prisEsc(o.where):'')+'">'
    +'<p class="pris-label">'+L.now+' · '+(wd?'<span class="pris-wd">'+wd+' </span>':'')+L.at+' '+prisHH(nowHour)+'</p>'
    +'<p class="pris-price"><span class="pris-now">'+(nowP!=null?prisNum(nowP,C.d):'—')+'</span><span class="pris-u">'+C.u+'/kWh</span></p>'
    +'<div class="pris-vrow">'
    +(nowP!=null?'<span class="pris-pill t'+verdict+'"><i></i>'+L.verdict[verdict]+'</span>':'')
    +(sentence?'<p class="pris-sent">'+sentence+'</p>':'<p class="pris-sent">'+(today?'':L.none)+'</p>')
    +'</div>'
    +'<div class="pris-modebox">'+(C.z?'':prisSwitch(view,'pris-seg-hero','Kun spotpris'))
    +prisCapHTML(false,caption,panel,o.open)+'</div></section>';
  var tabs='<div class="pris-period" role="tablist" aria-label="'+L.period+'">'
    +'<button type="button" role="tab" aria-selected="'+(period===2)+'" data-pris-period="2">'+L.p2+'</button>'
    +'<button type="button" role="tab" aria-selected="'+(period===5)+'" data-pris-period="5">'+L.p5+'</button></div>';
  var legend='<div class="pris-legend"><span><i class="t0"></i>'+L.tier[0]+'</span><span><i class="t1"></i>'+L.tier[1]+'</span><span><i class="t2"></i>'+L.tier[2]+'</span></div>';
  var head=function(t){
    return '<div class="pris-ch"><p class="pris-ct">'+t+'</p>'+legend+(C.z?'':prisSwitch(view,'pris-seg-card','Spotpris'))+'</div>'
      +prisCapHTML(true,caption,panel,o.open);};
  var two=all.slice(0,2),nFive=all.length?Math.min(5,all.length):5,five=all.slice(0,nFive);
  var nowSlot=today&&today.date===todayStr?nowHour:-1;
  var t2=L.next+' '+L.p2,t5=L.next+' '+L.p5,ttl=L.hourly+' '+L.next.toLowerCase()+' ';
  var card2='<section class="pris-card pp2" aria-label="'+t2+'">'+head(t2)
    +prisChart(two,2,{ref:td||[],nowSlot:nowSlot,title:ttl+L.p2,C:C})+'</section>';
  var card5='<section class="pris-card pp5" aria-label="'+t5+'">'+head(t5)
    +prisChart(five,nFive,{nowSlot:nowSlot,xDays:true,seps:true,title:ttl+L.p5,C:C})+'</section>';
  return '<div class="pris" data-period="'+period+'" data-view="'+view+'" data-key="'+prisEsc(o.key||'')
    +'" data-hour="'+nowHour+'" data-date="'+todayStr+'">'+hero
    +'<div class="pris-right">'+tabs+card2+card5+prisTiles(all,nowHour,2,'pp2',C)+prisTiles(all,nowHour,5,'pp5',C)+'</div>'
    +prisDayRows(all,C)+'</div>';
}

// ── The country pages and /norden: everything around the screen ──

/** The mean of a day's available prices, or null. */
function prisAvg(ps){
  var s=0,n=0;
  for(var h=0;h<ps.length;h++)if(ps[h]!=null){s+=ps[h];n++;}
  return n?s/n:null;
}
/** Where a zone's own page is: /no/strompris#no2, /fi/sahkon-hinta, /dk1; NL has none. */
function prisHref(k){
  for(var p in PRIS_COUNTRIES)if(PRIS_COUNTRIES[p].zones.indexOf(k)>=0)return '/'+p+(PRIS_COUNTRIES[p].zones.length>1?'#'+k:'');
  return /^dk/.test(k)?'/'+k:'';
}

/** The zone tabs of a country page (none for a single zone): real links with the
 *  tablist roles; the page's script moves the selection. */
function prisZoneTabs(pg,sel){
  var C=PRIS_COUNTRIES[pg];
  if(C.zones.length<2)return '';
  return '<div class="zt" role="tablist" aria-label="'+PRIS_I18N[C.lang].zoneTabs+'">'+C.zones.map(function(k){
    return '<a role="tab" id="zt-'+k+'" href="#'+k+'" data-zone="'+k+'" aria-selected="'+(k===sel)+'" tabindex="'+(k===sel?0:-1)+'">'
      +ZONES[k].name+'<small>'+ZONES[k].city+'</small></a>';}).join('')+'</div>';
}

/** The country page's text block, for crawlers and for anyone who wants every zone at a glance:
 *  each zone's city and name with today's and tomorrow's average, then the basis and the model. */
function prisZoneList(pg,raws,todayStr){
  var C=PRIS_COUNTRIES[pg],L=PRIS_I18N[C.lang],rows='';
  C.zones.forEach(function(k){
    var z=ZONES[k],raw=raws[k],all=raw?prisDays(zoneToPrisDays(raw,raw.zoneInfo,todayStr),todayStr):[];
    var v=[0,1].map(function(i){return all[i]?prisAvg(all[i].ps):null;});
    var mx=Math.max(Math.abs(v[0]||0),Math.abs(v[1]||0));
    var part=function(w,x){return x==null?'':L.avg+' '+w+' '+prisNum(x,prisDec(mx))+' '+z.sub+'/kWh';};
    rows+='<li><a href="'+prisHref(k)+'" data-zone="'+k+'"><b>'+z.city+'</b> ('+z.name+')</a>'
      +(v[0]==null&&v[1]==null?'':': '+[part(L.today,v[0]),part(L.tomorrow,v[1])].filter(Boolean).join(', '))+'</li>';
  });
  return '<section class="zl" data-date="'+todayStr+'"><h2>'+L.zonesH+'</h2><ul>'+rows+'</ul>'
    +'<p class="zl-n">'+L.cap+'. '+L.note+' <a href="https://huggingface.co/Elpriser/nordic-price-forecast" rel="noopener">'+L.model+'</a>.</p></section>';
}

/** /norden: one row per area in DKK/kWh excl. VAT and taxes — the price now, the average of
 *  today and of tomorrow, and the lowest to highest of the five days — so the areas can be compared
 *  across currencies. Danish only. `raws`: zone key → /api/nordic response. */
function prisNordenHTML(raws,todayStr,nowHour){
  var dkk=(raws.dk1&&raws.dk1.zoneInfo&&raws.dk1.zoneInfo.rate)||ZONES.dk1.rate;
  var f=function(x){return x==null?'—':prisNum(x/100,2);};
  var rows='';
  ['no1','no2','no3','no4','no5','se1','se2','se3','se4','fi','nl','dk1','dk2'].forEach(function(k){
    var z=ZONES[k],raw=raws[k],all=raw?prisDays(zoneToPrisDays(raw,{rate:dkk},todayStr),todayStr):[];
    var lo=null,hi=null,i,h,v;
    for(i=0;i<all.length;i++)for(h=0;h<24;h++){v=all[i].ps[h];if(v==null)continue;if(lo==null||v<lo)lo=v;if(hi==null||v>hi)hi=v;}
    var href=prisHref(k),name=z.name+' '+z.city;
    rows+='<tr id="'+k+'"><th scope="row">'+(href?'<a href="'+href+'">'+name+'</a>':name)+'</th>'
      +'<td>'+f(all[0]?all[0].ps[nowHour]:null)+'</td><td>'+f(all[0]?prisAvg(all[0].ps):null)+'</td>'
      +'<td>'+f(all[1]?prisAvg(all[1].ps):null)+'</td><td>'+(lo==null?'—':f(lo)+'–'+f(hi))+'</td></tr>';
  });
  return '<div class="nt" data-hour="'+nowHour+'" data-date="'+todayStr+'"><div class="nt-s"><table>'
    +'<thead><tr><th scope="col">Prisområde</th><th scope="col">Nu</th><th scope="col">I dag<br>gns.</th><th scope="col">I morgen<br>gns.</th>'
    +'<th scope="col">5 døgn<br>laveste–højeste</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
    +'<p class="nt-cap">Spotpris i DKK/kWh uden moms, afgifter og nettariffer — omregnet fra EUR med Den Europæiske Centralbanks dagskurs ('
    +prisNum(dkk,2)+' kr pr. euro). De danske sider viser prisen inkl. moms, så tallene her er lavere.</p></div>';
}
// ═══ /Pris-skærmen ═══

// Per-netselskab coverage prose for the SSR price-page intros. Deliberately
// number-free (live numbers are injected separately) and hedged for the small
// companies where coverage isn't common knowledge.
const NET_COVERAGE = {
  'n1': 'N1 driver elnettet i store dele af Jylland, herunder Nordjylland og flere midt- og vestjyske egne.',
  'trefor': 'Trefor står for eldistributionen i Trekantområdet omkring Vejle, Kolding og Fredericia.',
  'konstant': 'Konstant leverer elnettet i Aarhus-området og store dele af Østjylland.',
  'dinel': 'Dinel er et lokalt netselskab, der forsyner et afgrænset område i Vestdanmark med el, bl.a. dele af Aarhus.',
  'ravdex': 'Ravdex er et lokalt netselskab, der forsyner et afgrænset område i Vestdanmark med el, bl.a. dele af Odense.',
  'vores-elnet': 'Vores Elnet dækker elforsyningen på Fyn.',
  'rah-net': 'RAH Net dækker elnettet i Vestjylland omkring Ringkøbing.',
  'elvaerk': 'Elværk er et lokalt netselskab, der står for eldistributionen i et afgrænset område af Vestdanmark.',
  'nord-energi': 'Nord Energi driver elnettet i Nordjylland, herunder Vendsyssel.',
  'noe-net': 'NOE Net dækker elnettet i Nordvestjylland omkring Holstebro.',
  'elnet-midt': 'Elnet Midt er et lokalt netselskab, der forsyner et afgrænset område i Vestdanmark med el.',
  'flow-elnet': 'Flow Elnet er et lokalt netselskab, der står for eldistributionen i et afgrænset område af Vestdanmark.',
  'lnet': 'LNet er et lokalt netselskab, der forsyner et afgrænset område i Vestdanmark med el.',
  'cerius': 'Cerius driver elnettet på Sjælland uden for hovedstadsområdet.',
  'trefor-ost': 'Trefor Øst er et netselskab, der forsyner et afgrænset område på Sjælland med el.',
  'radius': 'Radius driver elnettet i Storkøbenhavn og Nordsjælland.',
};

const DA_MONTHS = ['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
function daDateLabel() {
  const now = new Date();
  return `${DA_MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
}

// ═══ Pris lige nu, i ord ═══
// CANONICAL, like fcChartHTML: verbatim in index.html and functions/[[path]].js.
// The server writes this sentence for the URL's own view so a crawler reads
// it; the browser rewrites it whenever the view changes, so the sentence, the
// dropdown, the big number and the chart always describe the same price.
// test-static.js diffs the two copies.
//
// Each sentence names exactly what the figure includes. "Inkl alt" without a
// grid company is spot + Energinet's tariffs + elafgift + moms — NOT the local
// nettarif, which is per company — and it used to be described as including
// it.
function priceNowText(mode, hh, price, area, net){
  var R={DK1:'Vestdanmark (Jylland og Fyn)',DK2:'Østdanmark (Sjælland, Lolland-Falster og Bornholm)'};
  var p=price.toFixed(2);if(/^-0\.?0*$/.test(p))p=p.slice(1);p=p.replace('.',',');
  var at='Lige nu (kl. '+hh+':00) er ';
  var where='i '+area+', '+R[area]+', ';
  var local=' Nettariffen fra dit lokale netselskab kommer oveni — vælg netselskab øverst på siden for den fulde pris.';
  switch(mode){
    case 'spot_ex': return at+'spotprisen '+where+p+' kr/kWh ekskl. moms. Moms, nettarif, systemtarif, transmissionstarif og elafgift kommer oveni.';
    case 'spot_inkl': return at+'spotprisen '+where+p+' kr/kWh inkl. moms. Nettarif, systemtarif, transmissionstarif og elafgift kommer oveni.';
    case 'inkl_alt': return at+'elprisen '+where+p+' kr/kWh inkl. systemtarif, transmissionstarif, elafgift og moms.'+local;
    case 'inkl_alt_minus': return at+'elprisen '+where+p+' kr/kWh inkl. systemtarif, transmissionstarif og moms, men uden elafgift.'+local;
    case 'net_inkl_alt': return at+'den samlede elpris hos '+net+' '+p+' kr/kWh inkl. '+net+'-nettarif, systemtarif, transmissionstarif, elafgift og moms.';
    case 'net_inkl_tarif': return at+'elprisen hos '+net+' '+p+' kr/kWh inkl. '+net+'-nettarif, systemtarif, transmissionstarif og moms, men uden elafgift.';
  }
  return '';
}

/**
 * SSR intro for the 18 price pages: a real H1, a dated answer sentence with
 * the live price, per-net coverage prose + current tariff rates, and a
 * PriceSpecification JSON-LD block. This is what makes each price URL carry
 * unique, quotable content for crawlers and answer engines.
 */
async function buildPricesIntro(context, area, net) {
  const origin = new URL(context.request.url).origin;
  const fmt = (p) => p == null ? null : p.toFixed(2).replace('.', ',');
  const areaLabel = AREA_LABEL[area];
  const region = AREA_REGION[area];
  // The view each URL opens in: pathToHash in index.html sends /dk1 and /dk2 to
  // inkl alt and a grid-company page to its all-in price. The sentence must
  // describe that same figure, or it contradicts the number under it.
  const mode = net ? 'net_inkl_alt' : 'inkl_alt';
  const glnQ = net ? `&gln=${net.gln}` : '';

  const [now, tariff] = await Promise.all([
    fetch(`${origin}/api/now?area=${area}&mode=${mode}${glnQ}`).then(r => r.ok ? r.json() : null).catch(() => null),
    net ? fetch(`${origin}/api/raw/tariff?gln=${net.gln}`).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
  ]);

  const h1 = net
    ? `Elpris hos ${net.name} i dag — ${areaLabel}`
    : `Elpriser ${areaLabel} i dag — time for time`;

  // Always present, even empty: the browser rewrites it when the view changes.
  const ps = [(now && now.price != null)
    ? priceNowText(mode, String(now.hour).padStart(2, '0'), now.price, area, net && net.name)
    : ''];
  if (net) {
    ps.push(`${NET_COVERAGE[net.slug] || `${net.name} er et dansk netselskab i ${region}.`} Bor du i området, betaler du ${net.name}s nettarif oven i spotprisen — grafen ovenfor viser den samlede pris time for time.`);
    const rec = tariff?.records?.[0];
    if (rec) {
      const t = (i) => (rec['Price' + i] ?? 0).toFixed(2).replace('.', ',');
      ps.push(`${net.name}s aktuelle Nettarif C (${daDateLabel()}) er ${t(1)} kr/kWh i lavlast (kl. 00–06), ${t(7)} kr/kWh i højlast (kl. 06–17) og ${t(18)} kr/kWh i spidslast (kl. 17–21), ekskl. moms. Sammenlign alle netselskaber på <a href="/tariffer" class="text-brand-500 underline">tarifsiden</a>.`);
    }
    // The cities (pilot pages) whose most common net company this is, and those where it serves a good
    // part of the addresses we looked up (CITY_LINK_SHARE) — Aarhus is Konstant's, but 40 % Dinel's.
    const towns = CITIES.filter(c => c.area === area && c.nets.some((x, i) => x.slug === net.slug && (i === 0 || x.share >= CITY_LINK_SHARE)));
    if (towns.length) ps.push(`Byer i området: ${towns.map(c => `<a href="/elpris/${c.slug}" class="text-brand-500 underline">${c.name}</a>`).join(', ')}.`);
  } else {
    ps.push(`${area} dækker ${region}. Priserne fastsættes dagen i forvejen på elbørsen Nord Pool og opdateres her time for time — vælg dit netselskab øverst på siden for den præcise pris inkl. din lokale nettarif.`);
  }

  const jsonLd = (now && now.price != null) ? `<script type="application/ld+json">
${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'PriceSpecification',
    name: net ? `Aktuel samlet elpris hos ${net.name} (${areaLabel}) inkl. alt` : `Aktuel elpris ${areaLabel} inkl. Energinets tariffer, elafgift og moms`,
    price: now.price.toFixed(4),
    priceCurrency: 'DKK',
    unitText: 'kWh',
    validFrom: new Date().toISOString(),
  })}
</script>` : '';

  return `<header class="max-w-2xl mx-auto text-center mt-2 mb-4 px-2">
    <h1 class="page-title" style="font-size:1.35rem">${h1}</h1>
    <div class="mt-2 text-sm text-gray-600 dark:text-gray-400 leading-relaxed text-left sm:text-center">
      ${ps.map((p, i) => `<p class="mt-2"${i === 0 ? ' id="priceNowText"' : ''}>${p}</p>`).join('')}
    </div>
  </header>${jsonLd}`;
}

/**
 * SSR answer sentences for /tariffer: which net company is cheapest/most
 * expensive at peak right now — dated, quotable, and unique to the page.
 */
async function buildTariffFacts(context) {
  const origin = new URL(context.request.url).origin;
  try {
    const j = await fetch(`${origin}/api/raw/tariffs`).then(r => r.ok ? r.json() : null);
    if (!j?.records?.length) return '';
    const allNets = [...NETS.DK1, ...NETS.DK2];
    const glnMap = { };
    for (const rec of j.records) glnMap[rec.GLN_Number] ??= rec;
    const rows = allNets.map(n => {
      const rec = glnMap[n.gln];
      return rec ? { name: n.name, peak: rec.Price18 ?? 0 } : null;
    }).filter(Boolean).filter(r => r.peak > 0);
    if (rows.length < 3) return '';
    const lo = rows.reduce((a, b) => b.peak < a.peak ? b : a);
    const hi = rows.reduce((a, b) => b.peak > a.peak ? b : a);
    const f = (v) => v.toFixed(2).replace('.', ',');
    return `<p class="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">Lige nu (${daDateLabel()}) har <strong>${lo.name}</strong> den laveste spidslasttarif på ${f(lo.peak)} kr/kWh, mens <strong>${hi.name}</strong> har den højeste på ${f(hi.peak)} kr/kWh (kl. 17–21, ekskl. moms). Forskellen mellem billigste og dyreste netselskab svarer typisk til flere hundrede kroner om året for en almindelig husstand.</p>`;
  } catch { return ''; }
}

/** A net company's page lists a city under "Byer i området" when it is the city's main net company or has at
 *  least this share of the addresses we looked up there (so Aalborg's 6 % Nord Energi is not a "Nord Energi city"). */
const CITY_LINK_SHARE = 0.25;
/** The NETS entry of a city's main net company. */
function cityNet(c) {
  return NETS[c.area].find(n => n.slug === c.nets[0].slug);
}
/** The page address of a net company in the NETS table. */
function netPath(slug) {
  return '/' + (NETS.DK1.some(n => n.slug === slug) ? 'dk1' : 'dk2') + '/' + slug;
}
/** Runs of consecutive hours whose value satisfies `want`, as "17–21" (start hour to the hour it ends). */
function hourRuns(vals, want) {
  const out = [];
  for (let h = 0; h < vals.length; h++) {
    if (!want(vals[h])) continue;
    let e = h; while (e + 1 < vals.length && want(vals[e + 1])) e++;
    out.push(`${prisHH(h)}–${prisHH(e + 1)}`); h = e;
  }
  return out.join(' og ');
}
/** "Anders A, Bo B og Cid C". */
function daList(xs) { return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' og ' + xs[xs.length - 1]; }

/**
 * The ten /elpris/<by> pages: ONE generator, no per-city markup. Returns the heading (above the Pris
 * screen) and the text block (below it). Everything city-specific is data: the name, the price area, the
 * main net company, how many of the addresses we looked up belong to which net company (_cities.js), and the
 * figures the forecast for that net gives today — its nettarif by the hour and its cheapest and dearest
 * hours. Nothing else is claimed. `fc` is /api/forecast?mode=net_inkl_alt for the main net; null when the
 * feed is down, and the page then has no figures but keeps the facts from the table.
 */
function cityHTML(c, net, fc, todayDk, nowH) {
  const p = (t, cls) => `<p class="${cls || 'mt-3'}">${t}</p>`;
  const link = (href, t) => '<a href="' + href + '" class="text-brand-500 underline">' + t + '</a>';
  const kr = v => prisNum(v, 2);
  const main = c.nets[0], n = c.samples, cnt = x => Math.round(x.share * n);
  // Who owns the addresses we looked up: the main net company, the others (with a page of their own
  // when they are one of the 14 we price), and the ones we do not.
  const parts = [...c.nets.slice(1).map(x => `${cnt(x)} til ${link(netPath(x.slug), x.name)}`), ...(c.other || []).map(x => `${cnt(x)} til ${x.name}`)];
  const varies = main.share < 0.75;
  let who;
  if (varies) {
    who = `Netselskabet i ${c.name} afhænger af adressen. Af de ${n} adresser vi slog op i byen, hørte ${cnt(main)} til ${main.name}, ${daList(parts)}.`;
  } else {
    who = `${main.name} er netselskab for ${cnt(main) === n ? `alle de ${n}` : `${cnt(main)} af de ${n}`} adresser vi slog op i ${c.name}` + (parts.length ? `; de sidste hørte ${daList(parts)}` : '') + '. Netselskabet følger adressen, så tjek dit eget.';
  }
  if ((c.other || []).length) who += ` ${daList(c.other.map(x => x.name))} har vi endnu ikke tariffer for.`;
  const head = `<p class="page-eyebrow">${AREA_LABEL[c.area]} · ${net.name}</p><h1 class="page-title">Elpris i ${c.name} i dag — time for time</h1>`;
  const ps = [];
  ps.push(p(`${c.name} ligger i prisområde ${AREA_LABEL[c.area]} — ${AREA_REGION[c.area]}. ${who}`, 'mt-2'));
  ps.push(`<p class="mt-3"><button type="button" class="gps-light" onclick="openNetDialog()" aria-haspopup="dialog">Er dit netselskab et andet? Skift</button></p>`);

  const all = fc ? prisDays(fc.days || [], todayDk) : [];
  const today = all[0], gt = today && today.gt;
  if (gt) {
    const lo = Math.min(...gt), hi = Math.max(...gt);
    ps.push(p(hi - lo < 0.0005
      ? `Hos ${net.name} er nettariffen den samme hele døgnet i dag: ${kr(lo)} kr/kWh ekskl. moms.`
      : `Hos ${net.name} er nettariffen i dag lavest kl. ${hourRuns(gt, v => v - lo < 0.0005)} (${kr(lo)} kr/kWh) og højest kl. ${hourRuns(gt, v => hi - v < 0.0005)} (${kr(hi)} kr/kWh), ekskl. moms.`));
  }
  const C = prisCtx({}, all);
  const slot = e => `kl. ${prisHH(e.h)}–${prisHH(e.h + 1)} (${kr(e.p)} kr/kWh)`;
  const ex = i => prisExtremes(all[i].ps.map((q, h) => ({ d: i, h, p: q })));
  if (today && ex(0).lo) {
    let t = `Hos ${net.name} er den billigste time i dag ${slot(ex(0).lo)} og den dyreste ${slot(ex(0).hi)}`;
    if (all[1] && ex(1).lo) t += `. I morgen ${all[1].real ? 'er' : 'forventes'} den billigste ${slot(ex(1).lo)} og den dyreste ${slot(ex(1).hi)}`;
    t += '. Priserne er inkl. nettarif, afgifter og moms.';
    ps.push(p(t));
  }
  const days = Math.min(5, all.length);
  if (days >= 3) {
    const win = []; for (let i = 0; i < days; i++) all[i].ps.forEach((q, h) => win.push({ d: i, h, p: q }));
    const e = prisExtremes(win), when = s => { const w = prisWhen(s, all, C); return s.d > 1 ? prisDate(all[s.d].date).wd + ' ' + w.split(' ')[1] : w; };
    ps.push(p(`Set over de næste ${days} døgn er den billigste time ${when(e.lo)} ${slot(e.lo)} og den dyreste ${when(e.hi)} ${slot(e.hi)} — de døgn, børsen endnu ikke har prissat, er prognose.`));
  }
  ps.push(p(`Sådan regnes prisen: spotprisen på elbørsen Nord Pool for ${AREA_LABEL[c.area]} plus nettariffen hos ${net.name}, Energinets system- og transmissionstarif, elafgift og 25 % moms. ${link('/om-elpriser', 'Læs mere i Forstå din elpris')}.`));
  const cls = 'text-sm text-gray-600 dark:text-gray-400 leading-relaxed text-left';
  return { head, body: `<div class="${cls}">${ps.join('')}</div>` };
}

/** The Danish calendar date and clock hour, whatever zone the Worker runs in. */
function danishClock() {
  const cph = { timeZone: 'Europe/Copenhagen' };
  return {
    todayDk: new Intl.DateTimeFormat('en-CA', cph).format(new Date()),
    nowH: cphHourOf(new Date()),
  };
}

async function renderHomepage(context) {
  // Edge-cache the fully-rendered homepage. Pages Function responses aren't
  // CDN-cached automatically (cf-cache-status: DYNAMIC), so without this every
  // hit re-runs the render + the live-price subrequests. The Cache API holds it
  // for s-maxage (5 min) — fine since the SSR'd price is a "lige nu" snapshot.
  const cache = caches.default;
  // Bump the version segment when index.html's homepage markup changes, so a
  // deploy isn't masked by a previous render cached at the same key.
  const cacheKey = new Request('https://cache.local/homepage-ssr-v72');
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const indexUrl = new URL('/', context.request.url);
  const origin = new URL(context.request.url).origin;
  const [resHtml, dk1, dk2, fc] = await Promise.all([
    context.env.ASSETS.fetch(indexUrl),
    fetchAreaSnapshot(context, 'DK1'),
    fetchAreaSnapshot(context, 'DK2'),
    fetch(`${origin}/api/forecast?area=DK1&mode=inkl_alt`)
      .then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  let html = await resHtml.text();
  if (dk1 && dk2) {
    const { jsonLd, summary } = buildLivePriceMarkup(dk1, dk2);
    html = html.replace('<!--SSR_LIVE_PRICE_JSONLD-->', jsonLd);
    html = html.replace('<!--SSR_READER_SUMMARY-->', summary);
  }
  html = stripInactiveMains(html, 'start');
  if (fc) {
    // The Pris screen, drawn for the front page's own view: DK1, Din pris with no
    // net company chosen. Danish calendar date and hour, for the "I dag" /
    // "I morgen" labels and the current bar. fmtUTC and danishNow live in the API
    // function, not this one — calling them here threw a ReferenceError and took
    // the whole homepage down with a 500.
    const { todayDk, nowH } = danishClock();
    html = html.replace('<!--SSR_PRIS-->', prisHTML(fc.days || [], todayDk, nowH,
      { view: 'din', period: 2, net: null, where: 'DK1 Vest', key: 'DK1|din|', charges: fc.charges }));
  }
  const res = new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 60s browser cache, 5min edge cache — prices revise hourly so this is fine.
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  });
  // Only cache a fully-rendered page (both snapshots and the forecast present);
  // never cache a fallback that's missing the live strip or the chart.
  if (dk1 && dk2 && fc) {
    try { await cache.put(cacheKey, res.clone()); } catch {}
  }
  return res;
}

/** /no/strompris, /sv/elpris, /fi/sahkon-hinta, /norden and the ten /elpris/<by> pages, cached at the edge for
 *  five minutes like the homepage, each family under a key of its own. Bump the version when index.html's
 *  markup for them changes, so a deploy is not masked by a render cached under the old key. Only a render
 *  that has all its data is kept: a page missing a zone is served once, never remembered. */
const ZONE_SSR_VERSION = 'zone-ssr-v7';
const CITY_SSR_VERSION = 'city-ssr-v3';
async function renderCachedPage(context, pathname, meta, opts, version) {
  const cache = caches.default;
  const key = new Request(`https://cache.local/${version}${pathname}`);
  const cached = await cache.match(key);
  if (cached) return cached;
  opts.done = {};
  const res = await renderSPA(context, pathname, meta, opts);
  if (opts.done.full) { try { await cache.put(key, res.clone()); } catch {} }
  return res;
}

// Mirrors the client router's hash → data-page mapping (index.html's
// PATH_ROUTES/route()). Without this, every SEO_PAGES route served the exact
// same body markup as the homepage (only <head> differed) until client JS
// hydrated and picked the right section — Google's crawl-time HTML showed a
// <title> for e.g. "Tariffer" wrapped around the *homepage's* visible content,
// which is a plausible cause of it collapsing these URLs onto one canonical.
const HASH_TO_DATA_PAGE = {
  'blog': 'blog',
  'tariffer': 'tariffer',
  'automation': 'automation',
  'api': 'api',
  'shelly-tariff': 'shelly-tariff',
  'om-elpriser': 'om-elpriser',
  'download': 'download',
  'prognose': 'prognose',
  'blog/elafgift-2028': 'blog-elafgift-2028',
  'blog/elafgift-og-spotpris': 'blog-elafgift-og-spotpris',
  'no/strompris': 'zone',
  'sv/elpris': 'zone',
  'fi/sahkon-hinta': 'zone',
  'norden': 'norden',
  'blog/hvornaar-er-stroemmen-billigst': 'blog-hvornaar-er-stroemmen-billigst',
  'blog/groennest-og-dyrest': 'blog-groennest-og-dyrest',
};

function dataPageForHash(hash) {
  const h = (hash || '').replace(/^#/, '');
  if (HASH_TO_DATA_PAGE[h]) return HASH_TO_DATA_PAGE[h];
  if (/^DK[12]\//.test(h)) return 'prices';
  if (/^elpris\//.test(h)) return 'city';
  return 'start';
}

/** BreadcrumbList for every page but the front page, built from the URL:
 *  Elpriser › DK1 Vest › N1, Elpriser › Blog › <post>, Elpriser › <page>. */
function breadcrumbLd(pathname, meta, opts) {
  if (pathname === '/') return '';
  const short = t => String(t || '').split(' — ')[0].split(': ')[0].trim();
  const items = [{ name: 'Elpriser', url: 'https://elpriser.org/' }];
  const pi = opts.pricesIntro;
  if (pi && pi.net) {
    items.push({ name: AREA_LABEL[pi.area], url: `https://elpriser.org/${pi.area.toLowerCase()}` });
    items.push({ name: pi.net.name, url: `https://elpriser.org${pathname}` });
  } else if (pi) {
    items.push({ name: AREA_LABEL[pi.area], url: `https://elpriser.org${pathname}` });
  } else if (opts.city) {
    items.push({ name: opts.city.name, url: `https://elpriser.org${pathname}` });
  } else if (pathname.startsWith('/blog/')) {
    items.push({ name: 'Blog', url: 'https://elpriser.org/blog' });
    items.push({ name: short(meta.title), url: `https://elpriser.org${pathname}` });
  } else {
    // /automation is "Smart hjem" in the interface; its search title stays the one
    // that was tuned for the queries, so the breadcrumb names it the way the site does.
    const label = pathname === '/automation' ? 'Smart hjem' : short(meta.title);
    items.push({ name: label, url: `https://elpriser.org${pathname}` });
  }
  const ld = { '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })) };
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
}

/** A meta description Google will show whole. Search results cut a snippet at
 *  about 155 characters (less on a phone); 34 of the 43 pages ran past that and
 *  were cut mid-clause. Keep whole sentences while they fit; if not even the
 *  first sentence fits, cut at a word and say so with an ellipsis. */
const DESC_MAX = 155;
function tidyDescription(d) {
  if (!d || d.length <= DESC_MAX) return d;
  let out = '';
  for (const part of d.split(/(?<=[.!?])\s+/)) {
    const next = out ? out + ' ' + part : part;
    if (next.length > DESC_MAX) break;
    out = next;
  }
  if (out.length >= 70) return out;
  const cut = d.slice(0, DESC_MAX - 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:—-]+$/, '') + '…';
}

// Hour (0–23) in Copenhagen, read from formatToParts() with digit-only fallbacks — never by
// coercing format()'s whole string (+"07 h" is NaN). Same idea as cphHourOf in index.html.
function cphHourOf(d) {
  const tz = { timeZone: 'Europe/Copenhagen' };
  const tries = [
    () => { const p = new Intl.DateTimeFormat('en-GB', { ...tz, hour: 'numeric', hourCycle: 'h23' }).formatToParts(d).find(x => x.type === 'hour'); return p && p.value; },
    () => new Intl.DateTimeFormat('en-GB', { ...tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d),
  ];
  for (const t of tries) {
    try { const m = /\d{1,2}/.exec(String(t())); if (m) { const h = +m[0]; if (h >= 0 && h <= 24) return h % 24; } } catch (_) { /* next */ }
  }
  return (d.getUTCHours() + 2) % 24;  // last resort: CEST; the page is still better than 'NaN'
}

/** The forecast the Pris screen draws for a net page or an area page: Din pris, with the net's tariff when there is a net. */
function fetchNetForecast(context, area, net) {
  const origin = new URL(context.request.url).origin;
  return fetch(`${origin}/api/forecast?area=${area}&mode=${net ? 'net_inkl_alt' : 'inkl_alt'}${net ? `&gln=${net.gln}` : ''}`)
    .then(r => (r.ok ? r.json() : null)).catch(() => null);
}
/** The Pris screen for a price page, drawn for the Danish date and hour. */
function prisScreen(fc, area, net) {
  const { todayDk, nowH } = danishClock();
  return prisHTML(fc.days || [], todayDk, nowH, {
    view: 'din', period: 2, net: net ? net.name : null,
    where: AREA_LABEL[area] + (net ? ' · ' + net.name : ''),
    key: `${area}|din|${net ? net.slug : ''}`,
    charges: fc.charges,
  });
}
/** The net chip in the header, for the page's own net (or area). */
function withNetChip(html, pre, area) {
  return html
    .replace(/id="netChipLong">[^<]*</, `id="netChipLong">${pre} · ${area === 'DK2' ? 'Østdanmark' : 'Vestdanmark'}<`)
    .replace(/id="netChipShort">[^<]*</, `id="netChipShort">${pre} · ${area === 'DK2' ? 'Øst' : 'Vest'}<`);
}

async function renderSPA(context, pathname, meta, opts = {}) {
  meta = { ...meta, description: tidyDescription(meta.description) };
  const pageUrl = `https://elpriser.org${pathname}`;
  const indexUrl = new URL('/', context.request.url);
  const res = await context.env.ASSETS.fetch(indexUrl);
  let html = await res.text();
  const dataPage = dataPageForHash(meta.hash);
  html = activateDataPage(html, dataPage);
  html = stripInactiveMains(html, dataPage);
  // Section titles are h2 in the shared markup (only one section per page
  // after stripping) — promote the served section's title to the page's h1.
  html = promoteSectionTitle(html);
  html = html.replace('</head>', `  ${breadcrumbLd(pathname, meta, opts)}\n</head>`);
  if (opts.pricesIntro) {
    const { area, net } = opts.pricesIntro;
    // The Pris screen for the URL's own view — Din pris, which is the net
    // company's all-in price on a net page and the area's otherwise.
    const [intro, fc] = await Promise.all([
      buildPricesIntro(context, area, net),
      fetchNetForecast(context, area, net),
    ]);
    html = html.replace('<!--SSR_PRICES_INTRO-->', intro);
    if (fc) html = html.replace('<!--SSR_PRIS-->', prisScreen(fc, area, net));
    html = withNetChip(html, net ? net.name : area, area);
  }
  if (opts.city) {
    // A city page: the Pris screen for the city's main net company, then the text the generator
    // writes from the same forecast. The section carries the area and net for the browser's router.
    const c = opts.city, net = cityNet(c);
    const fc = await fetchNetForecast(context, c.area, net);
    const { todayDk, nowH } = danishClock();
    const { head, body } = cityHTML(c, net, fc, todayDk, nowH);
    html = html.replace('<!--SSR_CITY_HEAD-->', () => head).replace('<!--SSR_CITY-->', () => body);
    if (fc) html = html.replace('<!--SSR_PRIS-->', () => prisScreen(fc, c.area, net));
    html = html.replace('<main data-page="city"', `<main data-page="city" data-area="${c.area}" data-net="${net.slug}"`);
    html = withNetChip(html, net.name, c.area);
    const page = { '@context': 'https://schema.org', '@type': 'WebPage', name: meta.title, description: meta.description,
      url: pageUrl, inLanguage: 'da', isPartOf: { '@type': 'WebSite', name: 'elpriser.org', url: 'https://elpriser.org' },
      about: { '@type': 'City', name: c.name, containedInPlace: { '@type': 'Country', name: 'Danmark' } } };
    html = html.replace('</head>', `  <script type="application/ld+json">${JSON.stringify(page).replace(/</g, '\\u003c')}</script>\n</head>`);
    if (opts.done) opts.done.full = !!fc;
  }
  if (opts.zonePage || opts.norden) {
    // The foreign price areas: the same Pris screen as the Danish pages, drawn from /api/nordic
    // for the country's first zone, plus the text block that lists every zone of the country (or,
    // on /norden, the comparison table). The browser swaps the screen when a tab is picked.
    const pg = opts.zonePage;
    const C = pg && PRIS_COUNTRIES[pg];
    const keys = C ? C.zones : Object.keys(ZONES);
    const origin = new URL(context.request.url).origin;
    const got = await Promise.all(keys.map(k => fetch(`${origin}/api/nordic?zone=${k}`)
      .then(r => (r.ok ? r.json() : null)).catch(() => null)));
    const raws = {};
    keys.forEach((k, i) => { if (got[i]) raws[k] = got[i]; });
    const { todayDk, nowH } = danishClock();
    if (C) {
      const L = PRIS_I18N[C.lang], raw = raws[C.def];
      html = html.replace('id="zH1">&nbsp;<', `id="zH1">${L.h1}<`);
      html = html.replace('<!--SSR_ZONE_TABS-->', prisZoneTabs(pg, C.def));
      if (C.zones.length > 1) html = html.replace('id="zPanel"', `id="zPanel" role="tabpanel" aria-labelledby="zt-${C.def}"`);
      if (raw) html = html.replace('<!--SSR_PRIS-->', prisHTML(zoneToPrisDays(raw, raw.zoneInfo, todayDk), todayDk, nowH,
        { zone: C.def, period: 2, key: C.def, where: `${ZONES[C.def].name} ${ZONES[C.def].city}` }));
      html = html.replace('<!--SSR_ZONE_LIST-->', prisZoneList(pg, raws, todayDk));
    } else {
      html = html.replace('<!--SSR_NORDEN-->', prisNordenHTML(raws, todayDk, nowH));
    }
    const page = { '@context': 'https://schema.org', '@type': 'WebPage', name: meta.title, description: meta.description,
      url: pageUrl, inLanguage: C ? C.lang : 'da', isPartOf: { '@type': 'WebSite', name: 'elpriser.org', url: 'https://elpriser.org' } };
    html = html.replace('</head>', `  <script type="application/ld+json">${JSON.stringify(page).replace(/</g, '\\u003c')}</script>\n</head>`);
    if (opts.done) opts.done.full = keys.every(k => raws[k]);
  }
  if (opts.tariffFacts) {
    html = html.replace('<!--SSR_TARIFF_FACTS-->', await buildTariffFacts(context));
  }
  if (opts.forecastChart) {
    // The same curve as the front page, drawn here for /prognose's default view
    // (DK1, inkl alt — the page's own dropdown defaults) so the numbers are in
    // the HTML; the browser redraws it from the table's data on any change.
    const origin = new URL(context.request.url).origin;
    const fc = await fetch(`${origin}/api/forecast?area=DK1&mode=inkl_alt`)
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (fc) {
      const cph = { timeZone: 'Europe/Copenhagen' };
      const todayDk = new Intl.DateTimeFormat('en-CA', cph).format(new Date());
      const nowH = cphHourOf(new Date());
      html = html.replace('<!--SSR_PROGNOSE_CHART-->', fcChartHTML(fc.days || [], todayDk, nowH));
      // The next seven days as text — what "elpriser prognose 7 dage" asks for,
      // and the part of the page's ten-day forecast a crawler can otherwise not read.
      html = html.replace('<!--SSR_PROGNOSE_WEEK-->', fcWeekHTML(fc.days || [], todayDk, 7));
    }
  }
  // The foreign-area pages are served in their country's language, so the document has
  // to say so — a Norwegian page still labelled lang="da" gets read (and indexed, and
  // spoken by screen readers) as Danish.
  if (meta.lang) {
    html = html.replace(/<html lang="[^"]*"/, `<html lang="${meta.lang}"`);
    html = html.replace(/(<meta property="og:locale" content=")[^"]*"/, `$1${{ nb: 'nb_NO', sv: 'sv_SE', fi: 'fi_FI' }[meta.lang]}"`);
    // No hreflang here: the pages are not translations of one another — NO1 and SE3 are
    // different markets with different prices — so a cluster would make /no/strompris "the
    // Norwegian version" of /sv/elpris. The base template's hreflang="da" is removed too:
    // it would otherwise be rewritten to point at the page itself. The html lang
    // attribute above is what states the page's language.
    html = html.replace(/\s*<link rel="alternate" hreflang="[^"]*" href="[^"]*">/g, '');
  }

  html = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${meta.title}</title>`
  );
  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${meta.description}">`
  );
  html = html.replace(
    /<link rel="canonical" href="[^"]*">/,
    '<link rel="canonical" href="' + pageUrl + '">'
  );
  html = html.replace(
    /<link rel="alternate" hreflang="da" href="[^"]*">/,
    '<link rel="alternate" hreflang="da" href="' + pageUrl + '">'
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*">/,
    `<meta property="og:title" content="${meta.title}">`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*">/,
    `<meta property="og:description" content="${meta.description}">`
  );
  html = html.replace(
    /<meta property="og:url" content="[^"]*">/,
    `<meta property="og:url" content="${pageUrl}">`
  );
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*">/,
    `<meta name="twitter:title" content="${meta.title}">`
  );
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*">/,
    `<meta name="twitter:description" content="${meta.description}">`
  );
  // Explicit headers only — spreading the asset's headers previously produced
  // a duplicated `Content-Type` (the asset's lowercase `content-type` plus our
  // `Content-Type`). Short max-age keeps the inline SPA JS from going stale on
  // returning visitors while still allowing cheap edge/browser caching.
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, must-revalidate',
    },
  });
}
