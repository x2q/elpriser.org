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
  '/dk1': {
    title: 'Elpriser DK1 Vest i dag — Aktuel spotpris lige nu (Jylland og Fyn)',
    description: 'Aktuel elpris og spotpris lige nu for DK1 (Vestdanmark) — time for time for Jylland og Fyn. Den reelle pris på el inkl. nettariffer, elafgift og moms. Opdateret dagligt fra Energi Data Service.',
    hash: '#DK1/spot_inkl',
  },
  '/dk2': {
    title: 'Elpriser DK2 Øst i dag — Aktuel spotpris lige nu (Sjælland)',
    description: 'Aktuel elpris og spotpris lige nu for DK2 (Østdanmark) — time for time for Sjælland, Lolland-Falster og Bornholm. Den reelle pris på el inkl. nettariffer, elafgift og moms.',
    hash: '#DK2/spot_inkl',
  },
  '/tariffer': {
    title: 'Nettariffer 2026: Sammenlign 14 netselskaber — op til 25 øre/kWh forskel',
    description: 'Se aktuelle nettariffer (Nettarif C) for alle 14 danske netselskaber — lav-, høj- og spidslast for N1, Radius, Trefor, Cerius, RAH, Konstant m.fl. Forskellen kan koste dig flere hundrede kroner om året.',
    hash: '#tariffer',
  },
  '/automation': {
    title: 'Elpris Automation — Home Assistant, Shelly & REST API',
    description: 'Automatisér elforbrug efter de billigste timer. Gratis REST API og klar-til-brug kode til Home Assistant, Shelly, Tibber-kompatibel tariff og smart home.',
    hash: '#automation',
  },
  '/om-elpriser': {
    title: 'Om elpriser i Danmark — Spotpris, tariffer og afgifter',
    description: 'Forstå din elpris: spotpris, nettarif, systemtarif, elafgift og moms. Sådan fungerer prisområderne DK1 og DK2, og sådan finder du dit netselskab.',
    hash: '#om-elpriser',
  },
  '/prognose': {
    title: 'Elprisprognose — Forventede elpriser næste 7 dage',
    description: 'Se forventede elpriser for DK1 og DK2 de næste 7 dage. Prognose baseret på historiske prismønstre fra Energi Data Service.',
    hash: '#prognose',
  },
  '/api': {
    title: 'elpriser.org API — Gratis JSON API for danske elpriser',
    description: 'Gratis JSON API for danske elpriser: aktuel pris, time-for-time-priser, 7-dages prognose, CO₂-udledning, nettariffer og Tibber-kompatibel Shelly-tarif. Ingen nøgle, fuld CORS, OpenAPI 3.1.',
    hash: '#api',
  },
  '/shelly-tariff': {
    title: 'Shelly Live Tariff — Tibber-kompatibel elpris-JSON',
    description: 'Vis aktuelle danske elpriser direkte på din Shelly med Live Tariff: Tibber-kompatibel JSON fra elpriser.org, opdateret time for time inkl. nettarif, elafgift og moms.',
    hash: '#shelly-tariff',
  },
  '/blog/forsta-din-elpris': {
    title: 'Forstå din elpris — Guide til spotpris og tariffer',
    description: 'Komplet guide til elpriser i Danmark: spotpris, nettarif, elafgift, DK1 vs DK2, hvornår strømmen er billigst, negative elpriser og sådan sparer du penge.',
    hash: '#blog/forsta-din-elpris',
  },
  '/blog/shelly-elpris-automation': {
    title: 'Shelly & elpriser — Automatisér forbrug efter spotpris',
    description: 'Styr Shelly Plus, Pro og Plug efter elprisen med gratis API. Script- og tidsbaseret automation af elbil, varmepumpe og vandvarmer efter billig strøm.',
    hash: '#blog/shelly-elpris-automation',
  },
  '/blog/home-assistant-elpriser': {
    title: 'Home Assistant & elpriser — Smart elforbrug i Danmark',
    description: 'Opsæt Home Assistant med danske elpriser: REST-sensorer, schedule-automations og dashboards — spar automatisk penge på strøm efter de billigste timer.',
    hash: '#blog/home-assistant-elpriser',
  },
  '/blog/v2g-v2h-bidirektional-opladning': {
    title: 'V2G, V2H og V2L — Bidirektional elbilopladning forklaret',
    description: 'Forstå Vehicle-to-Grid (V2G), Vehicle-to-Home (V2H) og Vehicle-to-Load (V2L). Sådan kan din elbil sælge strøm til nettet eller forsyne dit hus, og hvordan det fungerer med spotpriser i Danmark.',
    hash: '#blog/v2g-v2h-bidirektional-opladning',
  },
  '/blog/biler-ladere-v2h-v2g': {
    title: 'Elbiler og ladere med V2H/V2G — Komplet liste 2026',
    description: 'Opdateret liste over elbiler og bidirektionale ladere der understøtter V2L, V2H og V2G. Inkluderer Hyundai Ioniq 5, Kia EV9, Nissan Leaf, Wallbox Quasar 2, Sigenergy og flere.',
    hash: '#blog/biler-ladere-v2h-v2g',
  },
  '/blog/elafgift-2028': {
    title: 'Elafgift 2028: Sådan stiger elafgiften igen',
    description: 'Elafgiften er sænket til 0,8 øre/kWh i 2026-2027, men stiger igen fra 2028. Se de nye satser, hvorfor regeringen endnu ikke har forlænget den lave afgift, og hvad det betyder for din elregning og dine solceller.',
    hash: '#blog/elafgift-2028',
  },
};

// Mirrors NETS in index.html. Used to (a) mint per-net clean URLs
// /dk1/<slug> and /dk2/<slug> that are crawlable, and (b) include those
// URLs in the sitemap so Google/Bing find them. Keep in sync with index.html.
const NETS = {
  DK1: [
    { name: 'N1',          slug: 'n1',          gln: '5790001089030' },
    { name: 'Trefor',      slug: 'trefor',      gln: '5790000392261' },
    { name: 'Konstant',    slug: 'konstant',    gln: '5790000704842' },
    { name: 'Vores Elnet', slug: 'vores-elnet', gln: '5790000610976' },
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
    title:       `Elpris ${net.name} ${areaLabel} i dag — Aktuel pris lige nu inkl. nettarif`,
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
  '/', '/dk1', '/dk2', '/tariffer', '/automation', '/api', '/prognose', '/om-elpriser', '/shelly-tariff',
  '/blog/forsta-din-elpris', '/blog/shelly-elpris-automation', '/blog/home-assistant-elpriser',
  '/blog/v2g-v2h-bidirektional-opladning', '/blog/biler-ladere-v2h-v2g', '/blog/elafgift-2028',
  ...NET_URLS,
];

// Real lastmod dates for content pages (from git history / last substantive
// edit). Price-bearing pages legitimately change daily and use today's date.
// Update these when a page's content actually changes — an always-today
// lastmod for everything teaches Google to ignore the field.
const CONTENT_LASTMOD = {
  '/automation': '2026-07-24',
  '/api': '2026-07-24',
  '/om-elpriser': '2026-07-24',
  '/shelly-tariff': '2026-07-24',
  '/blog/forsta-din-elpris': '2026-07-24',
  '/blog/shelly-elpris-automation': '2026-07-24',
  '/blog/home-assistant-elpriser': '2026-07-24',
  '/blog/v2g-v2h-bidirektional-opladning': '2026-07-24',
  '/blog/biler-ladere-v2h-v2g': '2026-07-24',
  '/blog/elafgift-2028': '2026-07-24',
};

function buildSitemap() {
  const today = new Date().toISOString().split('T')[0];
  const priorityFor = p => {
    if (p === '/') return '1.0';
    if (/^\/(dk[12])\/[a-z0-9-]+$/.test(p)) return '0.6'; // per-net long-tail pages
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

elpriser.org viser den reelle elpris du betaler per kWh i Danmark, opdateret dagligt med data fra Energi Data Service (Energinet). Prisen inkluderer spotpris, nettariffer, systemtarif, transmissionstarif, elafgift og moms.

## Sider

- [Forside](https://elpriser.org/): Overblik over dagens elpriser for DK1 og DK2 med aktuel pris og netselskaber.
- [Elpriser DK1 Vest](https://elpriser.org/dk1): Time-for-time spotpriser for Vestdanmark (Jylland og Fyn).
- [Elpriser DK2 Øst](https://elpriser.org/dk2): Time-for-time spotpriser for Østdanmark (Sjælland, Lolland-Falster, Bornholm).
- Per-netselskab priser: \`/dk1/<slug>\` eller \`/dk2/<slug>\` viser dagens pris inkl. nettarif for det valgte netselskab (fx https://elpriser.org/dk1/n1, https://elpriser.org/dk2/radius).
- [Nettariffer](https://elpriser.org/tariffer): Sammenligning af nettariffer for alle danske netselskaber.
- [Elprisprognose](https://elpriser.org/prognose): Forventede elpriser de næste 7 dage baseret på historiske prismønstre.
- [Automation](https://elpriser.org/automation): REST API og kodeeksempler til Home Assistant, Shelly og smart home.
- [Om elpriser](https://elpriser.org/om-elpriser): Forklaring af priskomponenter, prisområder og datakilder.
- [Forstå din elpris](https://elpriser.org/blog/forsta-din-elpris): Guide til hvad der bestemmer elprisen, spotpriser, tariffer, afgifter og sparetips.
- [Shelly automation](https://elpriser.org/blog/shelly-elpris-automation): Guide til Shelly-styring efter elprisen med gratis API.
- [Home Assistant guide](https://elpriser.org/blog/home-assistant-elpriser): Komplet opsætning af Home Assistant med elpriser, sensorer og automations.
- [V2G & V2H](https://elpriser.org/blog/v2g-v2h-bidirektional-opladning): Forklaring af bidirektional elbilopladning (V2G/V2H/V2L) og hvordan det udnytter spotpriser.
- [Biler & ladere med V2H/V2G](https://elpriser.org/blog/biler-ladere-v2h-v2g): Opdateret liste over elbiler og bidirektionale ladere der understøtter V2H/V2G i Danmark.
- [Elafgift 2028](https://elpriser.org/blog/elafgift-2028): Elafgiften er sænket til 0,8 øre/kWh i 2026-2027 men stiger igen fra 2028 — satser, tidslinje og betydning for din elregning og dine solceller.

## Live data API (for AI assistants and agents)

If a user asks "hvad er elprisen lige nu?" or "what's the current Danish
electricity price?" these endpoints return live JSON. CORS-enabled, no key,
edge-cached at 1-5 min so calling repeatedly is fine.

**Machine-readable spec**: [/api/openapi.json](https://elpriser.org/api/openapi.json) — OpenAPI 3.1.
Every \`/api/*\` response also sends \`Link: </api/openapi.json>; rel="describedby"\`.
Human-readable docs: [/api](https://elpriser.org/api).

**MCP server**: [elpriser-mcp](https://github.com/x2q/elpriser-mcp) — a free Model Context
Protocol server (run \`npx -y elpriser-mcp\`) gives Claude Desktop and other MCP clients
native tools for current price, cheapest hours and the 7-day forecast.

- \`GET /api/now?area=DK1&mode=inkl_alt\` — Current total price right now (DKK/kWh, incl. all tariffs + VAT)
- \`GET /api/now?area=DK1&mode=spot_inkl\` — Current raw spot price incl. VAT
- \`GET /api/prices?area=DK1&mode=inkl_alt&date=YYYY-MM-DD\` — 24 hourly prices for a date
- \`GET /api/schedule?area=DK1&strategy=cheapest_n&hours=6\` — The N cheapest hours of the day
- \`GET /api/forecast?area=DK1&mode=inkl_alt\` — 7-day price forecast
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

Understøttede netselskaber i DK1: N1, Trefor, Konstant, Vores Elnet, RAH Net, Elværk, Nord Energi, NOE Net, Elnet Midt m.fl.
Understøttede netselskaber i DK2: Radius, Cerius, Dinel, Midtfyns Elforsyning m.fl.

GPS-funktionen finder automatisk dit netselskab via DAWA (Danmarks Adressers Web API) og Green Power Denmark.

## Hvornår er strømmen billigst?

Strømmen er typisk billigst om natten mellem kl. 00 og 06, og dyrest i spidstimerne kl. 17-21. Den faktiske pris afhænger af vejr, vind og forbrug og varierer fra dag til dag.

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
Ja. Elpriser.org viser elpriser opdateret time for time fra Energi Data Service. Se priserne for dagens 24 timer, sammenlign med morgendagens priser (efter kl. 13), og se historik uge for uge.

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
Ja. Elpriser.org viser elpriser live, opdateret time for time med data fra Energi Data Service. Du kan se priserne for hele dagens 24 timer som tabel eller graf, sammenligne med morgendagens priser (tilgængelige efter kl. 13), og se historiske priser uge for uge. Vælg dit prisområde — [DK1 Vest](https://elpriser.org/dk1) eller [DK2 Øst](https://elpriser.org/dk2) — for at se live elpriser.

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
| Vores Elnet | DK1 | \`vores-elnet\` | 5790000610976 |
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
- **MCP-server** — [github.com/x2q/elpriser-mcp](https://github.com/x2q/elpriser-mcp): en Model Context Protocol-server til LLM-agenter. Kør \`npx -y elpriser-mcp\` for at give Claude Desktop og andre MCP-klienter native værktøjer til aktuel pris, billigste timer og 7-dages prognose — uden selv at skulle bygge HTTP-kald.
- **JS/TS-klient** — [github.com/x2q/elpriser-client](https://github.com/x2q/elpriser-client): en letvægts JavaScript/TypeScript-klient til elpriser.org's API, til brug i Node.js, browser eller edge-funktioner.
`;

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
    body: LLMS_FULL_TXT,
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

  // Static routes (sitemap, robots, og-image)
  const staticRoute = STATIC_ROUTES[url.pathname];
  if (staticRoute) {
    const body = typeof staticRoute.body === 'function' ? staticRoute.body() : staticRoute.body;
    return new Response(body, {
      headers: {
        'Content-Type': staticRoute.type,
        'Cache-Control': 'public, max-age=3600',
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
    return new Response('Not found', { status: 404 });
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
    return renderSPA(context, url.pathname, page, opts);
  }

  return context.next();
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

/** Build the live-price JSON-LD block + Reader-summary prose. */
function buildLivePriceMarkup(dk1, dk2) {
  const hh = String(dk1.hour).padStart(2, '0');
  const fmt = (p) => p == null ? '—' : p.toFixed(2).replace('.', ',');
  // Prose version of the live snapshot for the Reader-summary <article> —
  // what Safari Reader (and crawlers) see as the page's article text.
  const summary = `Lige nu kl. ${hh}:00 koster strøm ${fmt(dk1.spot)} kr/kWh i ren spotpris i DK1 (Vestdanmark) og ${fmt(dk2.spot)} kr/kWh i DK2 (Østdanmark). Den samlede elpris inkl. nettarif, systemtarif, transmissionstarif, elafgift og moms er ${fmt(dk1.total)} kr/kWh i DK1 og ${fmt(dk2.total)} kr/kWh i DK2.`;

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

// Per-netselskab coverage prose for the SSR price-page intros. Deliberately
// number-free (live numbers are injected separately) and hedged for the small
// companies where coverage isn't common knowledge.
const NET_COVERAGE = {
  'n1': 'N1 driver elnettet i store dele af Jylland, herunder Nordjylland og flere midt- og vestjyske egne.',
  'trefor': 'Trefor står for eldistributionen i Trekantområdet omkring Vejle, Kolding og Fredericia.',
  'konstant': 'Konstant leverer elnettet i Aarhus-området og store dele af Østjylland.',
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

/**
 * SSR intro for the 16 price pages: a real H1, a dated answer sentence with
 * the live price, per-net coverage prose + current tariff rates, and a
 * PriceSpecification JSON-LD block. This is what makes each price URL carry
 * unique, quotable content for crawlers and answer engines.
 */
async function buildPricesIntro(context, area, net) {
  const origin = new URL(context.request.url).origin;
  const fmt = (p) => p == null ? null : p.toFixed(2).replace('.', ',');
  const areaLabel = AREA_LABEL[area];
  const region = AREA_REGION[area];
  const mode = net ? 'net_inkl_alt' : 'inkl_alt';
  const glnQ = net ? `&gln=${net.gln}` : '';

  const [now, tariff] = await Promise.all([
    fetch(`${origin}/api/now?area=${area}&mode=${mode}${glnQ}`).then(r => r.ok ? r.json() : null).catch(() => null),
    net ? fetch(`${origin}/api/raw/tariff?gln=${net.gln}`).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
  ]);

  const h1 = net
    ? `Elpris hos ${net.name} i dag — ${areaLabel}`
    : `Elpriser ${areaLabel} i dag — time for time`;

  const ps = [];
  if (now && now.price != null) {
    const hh = String(now.hour).padStart(2, '0');
    ps.push(net
      ? `Lige nu (kl. ${hh}:00) er den samlede elpris hos ${net.name} ${fmt(now.price)} kr/kWh inkl. ${net.name}-nettarif, systemtarif, transmissionstarif, elafgift og moms.`
      : `Lige nu (kl. ${hh}:00) er den samlede elpris i ${area} (${region}) ${fmt(now.price)} kr/kWh inkl. nettarif, systemtarif, transmissionstarif, elafgift og moms.`);
  }
  if (net) {
    ps.push(`${NET_COVERAGE[net.slug] || `${net.name} er et dansk netselskab i ${region}.`} Bor du i området, betaler du ${net.name}s nettarif oven i spotprisen — tabellen nedenfor viser den samlede pris time for time.`);
    const rec = tariff?.records?.[0];
    if (rec) {
      const t = (i) => (rec['Price' + i] ?? 0).toFixed(2).replace('.', ',');
      ps.push(`${net.name}s aktuelle Nettarif C (${daDateLabel()}) er ${t(1)} kr/kWh i lavlast (kl. 00–06), ${t(7)} kr/kWh i højlast (kl. 06–17) og ${t(18)} kr/kWh i spidslast (kl. 17–21), ekskl. moms. Sammenlign alle netselskaber på <a href="/tariffer" class="text-brand-500 underline">tarifsiden</a>.`);
    }
  } else {
    ps.push(`${area} dækker ${region}. Priserne fastsættes dagen i forvejen på elbørsen Nord Pool og opdateres her time for time — vælg dit netselskab i menuen ovenfor for den præcise pris inkl. din lokale nettarif.`);
  }

  const jsonLd = (now && now.price != null) ? `<script type="application/ld+json">
${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'PriceSpecification',
    name: net ? `Aktuel samlet elpris hos ${net.name} (${areaLabel}) inkl. alt` : `Aktuel samlet elpris ${areaLabel} inkl. alt`,
    price: now.price.toFixed(4),
    priceCurrency: 'DKK',
    unitText: 'kWh',
    validFrom: new Date().toISOString(),
  })}
</script>` : '';

  return `<header class="max-w-2xl mx-auto text-center mt-2 mb-4 px-2">
    <h1 class="page-title" style="font-size:1.35rem">${h1}</h1>
    <div class="mt-2 text-sm text-gray-600 dark:text-gray-400 leading-relaxed text-left sm:text-center">
      ${ps.map(p => `<p class="mt-2">${p}</p>`).join('')}
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

async function renderHomepage(context) {
  // Edge-cache the fully-rendered homepage. Pages Function responses aren't
  // CDN-cached automatically (cf-cache-status: DYNAMIC), so without this every
  // hit re-runs the render + the live-price subrequests. The Cache API holds it
  // for s-maxage (5 min) — fine since the SSR'd price is a "lige nu" snapshot.
  const cache = caches.default;
  // Bump the version segment when index.html's homepage markup changes, so a
  // deploy isn't masked by a previous render cached at the same key.
  const cacheKey = new Request('https://cache.local/homepage-ssr-v12');
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const indexUrl = new URL('/', context.request.url);
  const [resHtml, dk1, dk2] = await Promise.all([
    context.env.ASSETS.fetch(indexUrl),
    fetchAreaSnapshot(context, 'DK1'),
    fetchAreaSnapshot(context, 'DK2'),
  ]);
  let html = await resHtml.text();
  if (dk1 && dk2) {
    const { jsonLd, summary } = buildLivePriceMarkup(dk1, dk2);
    html = html.replace('<!--SSR_LIVE_PRICE_JSONLD-->', jsonLd);
    html = html.replace('<!--SSR_READER_SUMMARY-->', summary);
  }
  html = stripInactiveMains(html, 'start');
  const res = new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 60s browser cache, 5min edge cache — prices revise hourly so this is fine.
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  });
  // Only cache a fully-rendered page (both snapshots present); never cache a
  // fallback that's missing the live strip.
  if (dk1 && dk2) {
    try { await cache.put(cacheKey, res.clone()); } catch {}
  }
  return res;
}

// Mirrors the client router's hash → data-page mapping (index.html's
// PATH_ROUTES/route()). Without this, every SEO_PAGES route served the exact
// same body markup as the homepage (only <head> differed) until client JS
// hydrated and picked the right section — Google's crawl-time HTML showed a
// <title> for e.g. "Tariffer" wrapped around the *homepage's* visible content,
// which is a plausible cause of it collapsing these URLs onto one canonical.
const HASH_TO_DATA_PAGE = {
  'tariffer': 'tariffer',
  'automation': 'automation',
  'api': 'api',
  'shelly-tariff': 'shelly-tariff',
  'om-elpriser': 'om-elpriser',
  'prognose': 'prognose',
  'blog/forsta-din-elpris': 'blog-forsta-din-elpris',
  'blog/shelly-elpris-automation': 'blog-shelly-elpris-automation',
  'blog/home-assistant-elpriser': 'blog-home-assistant-elpriser',
  'blog/v2g-v2h-bidirektional-opladning': 'blog-v2g-v2h-bidirektional-opladning',
  'blog/biler-ladere-v2h-v2g': 'blog-biler-ladere-v2h-v2g',
  'blog/elafgift-2028': 'blog-elafgift-2028',
};

function dataPageForHash(hash) {
  const h = (hash || '').replace(/^#/, '');
  if (HASH_TO_DATA_PAGE[h]) return HASH_TO_DATA_PAGE[h];
  if (/^DK[12]\//.test(h)) return 'prices';
  return 'start';
}

// Server-side equivalent of route()'s `classList.add('active')` — makes the
// pre-hydration HTML show the section that actually matches the URL/title,
// instead of always showing the homepage section underneath a different title.
function activateDataPage(html, dataPage) {
  if (dataPage === 'start') return html;
  // Non-start mains carry an inline display:none (keeps hidden pages' text out
  // of Safari Reader's article detection) — swap it over to the start main and
  // strip it from the page being activated.
  html = html.replace('<main data-page="start" class="active">', '<main style="display:none" data-page="start" class="">');
  html = html.replace(`<main style="display:none" data-page="${dataPage}" class="`, `<main data-page="${dataPage}" class="active `);
  return html;
}

// Remove every <main> section except the active one. Each URL then serves ONLY
// its own content (unique per URL, ~40 KB instead of ~260 KB) instead of the
// whole SPA with 13 hidden sections — which Google saw as near-identical
// duplicate bodies across all 28 URLs. The client router detects a missing
// section and falls back to a full-page navigation (MPA-style), so in-page
// hash routing keeps working within the served section.
function stripInactiveMains(html, dataPage) {
  return html.replace(
    /<main[^>]*data-page="([^"]+)"[\s\S]*?<\/main>/g,
    (block, page) => (page === dataPage ? block : '')
  );
}

async function renderSPA(context, pathname, meta, opts = {}) {
  const pageUrl = `https://elpriser.org${pathname}`;
  const indexUrl = new URL('/', context.request.url);
  const res = await context.env.ASSETS.fetch(indexUrl);
  let html = await res.text();
  const dataPage = dataPageForHash(meta.hash);
  html = activateDataPage(html, dataPage);
  html = stripInactiveMains(html, dataPage);
  // Section titles are h2 in the shared markup (only one section per page
  // after stripping) — promote the served section's title to the page's h1.
  html = html.replace(/<h2 class="page-title/, '<h1 class="page-title')
             .replace(/(<h1 class="page-title[^>]*>[^<]*)<\/h2>/, '$1</h1>');
  if (opts.pricesIntro) {
    html = html.replace('<!--SSR_PRICES_INTRO-->',
      await buildPricesIntro(context, opts.pricesIntro.area, opts.pricesIntro.net));
  }
  if (opts.tariffFacts) {
    html = html.replace('<!--SSR_TARIFF_FACTS-->', await buildTariffFacts(context));
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
    `<link rel="canonical" href="${pageUrl}">`
  );
  html = html.replace(
    /<link rel="alternate" hreflang="da" href="[^"]*">/,
    `<link rel="alternate" hreflang="da" href="${pageUrl}">`
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
