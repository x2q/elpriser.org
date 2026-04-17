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
    title: 'Elpriser DK1 Vest i dag - Spotpriser Jylland og Fyn | elpriser.org',
    description: 'Se dagens elpriser for DK1 (Vestdanmark) time for time. Aktuelle spotpriser for Jylland og Fyn inkl. tariffer, elafgift og moms.',
    hash: '#DK1/spot_inkl',
  },
  '/dk2': {
    title: 'Elpriser DK2 Øst i dag - Spotpriser Sjælland | elpriser.org',
    description: 'Se dagens elpriser for DK2 (Østdanmark) time for time. Aktuelle spotpriser for Sjælland, Lolland-Falster og Bornholm inkl. tariffer og moms.',
    hash: '#DK2/spot_inkl',
  },
  '/tariffer': {
    title: 'Nettariffer - Tariffer for alle danske netselskaber | elpriser.org',
    description: 'Sammenlign nettariffer (Nettarif C) for alle danske netselskaber. Se lav-, mellem- og spidstariffer for N1, Radius, Trefor, Cerius og flere.',
    hash: '#tariffer',
  },
  '/automation': {
    title: 'Elpris Automation - Styr elforbrug efter spotpriser | elpriser.org',
    description: 'Automatiser dit elforbrug efter de billigste timer. Klar-til-brug kode til Home Assistant, Shelly og andre smart home systemer.',
    hash: '#automation',
  },
  '/om-elpriser': {
    title: 'Om elpriser i Danmark - Hvad koster strøm og hvordan beregnes prisen | elpriser.org',
    description: 'Forstå din elpris: spotpris, nettarif, systemtarif, elafgift og moms. Lær om prisområder DK1 og DK2, og hvordan du finder dit netselskab i Danmark.',
    hash: '#om-elpriser',
  },
  '/prognose': {
    title: 'Elprisprognose - Forventede elpriser de næste 7 dage | elpriser.org',
    description: 'Se forventede elpriser for DK1 og DK2 de næste 7 dage. Prognose baseret på historiske prismønstre og vindprognoser fra Energi Data Service.',
    hash: '#prognose',
  },
  '/blog/forsta-din-elpris': {
    title: 'Forstå din elpris: Hvad bestemmer elprisen i Danmark? | elpriser.org',
    description: 'Komplet guide til elpriser i Danmark. Lær om spotpriser, nettariffer, elafgift, DK1 vs DK2, hvornår strømmen er billigst, og hvordan du sparer penge.',
    hash: '#blog/forsta-din-elpris',
  },
  '/blog/shelly-elpris-automation': {
    title: 'Shelly og elpriser: Automatisk tænd og sluk efter spotprisen | elpriser.org',
    description: 'Styr din Shelly efter elprisen med elpriser.org gratis API. Guide til Shelly Plus, Pro og Plug — automatiser elbil, varmepumpe og vandvarmer efter billig strøm.',
    hash: '#blog/shelly-elpris-automation',
  },
  '/blog/home-assistant-elpriser': {
    title: 'Home Assistant og elpriser: Komplet guide til smart elforbrug | elpriser.org',
    description: 'Opsæt Home Assistant med danske elpriser fra elpriser.org. REST sensorer, automations og dashboard til at spare penge på strøm automatisk.',
    hash: '#blog/home-assistant-elpriser',
  },
};

// Mirrors NETS in index.html. Used to (a) mint per-net clean URLs
// /dk1/<slug> and /dk2/<slug> that are crawlable, and (b) include those
// URLs in the sitemap so Google/Bing find them. Keep in sync with index.html.
const NETS = {
  DK1: [
    { name: 'N1',          slug: 'n1'           },
    { name: 'Trefor',      slug: 'trefor'       },
    { name: 'Konstant',    slug: 'konstant'     },
    { name: 'Vores Elnet', slug: 'vores-elnet'  },
    { name: 'RAH Net',     slug: 'rah-net'      },
    { name: 'Elværk',      slug: 'elvaerk'      },
    { name: 'Nord Energi', slug: 'nord-energi'  },
    { name: 'NOE Net',     slug: 'noe-net'      },
    { name: 'Elnet Midt',  slug: 'elnet-midt'   },
    { name: 'Flow Elnet',  slug: 'flow-elnet'   },
    { name: 'LNet',        slug: 'lnet'         },
  ],
  DK2: [
    { name: 'Cerius',      slug: 'cerius'       },
    { name: 'Trefor Øst',  slug: 'trefor-ost'   },
    { name: 'Radius',      slug: 'radius'       },
  ],
};
const AREA_LABEL = { DK1: 'DK1 Vest', DK2: 'DK2 Øst' };
const AREA_REGION = { DK1: 'Vestdanmark (Jylland og Fyn)', DK2: 'Østdanmark (Sjælland, Lolland-Falster og Bornholm)' };

function netPageMeta(area, net) {
  const areaLabel = AREA_LABEL[area];
  const region = AREA_REGION[area];
  return {
    title:       `Elpris ${net.name} (${areaLabel}) i dag - Aktuelle priser inkl. netselskab | elpriser.org`,
    description: `Se dagens elpriser for netselskab ${net.name} i ${areaLabel}. Komplet pris pr. kWh inkl. spotpris, ${net.name}-nettarif, systemtarif, elafgift og moms — time for time, opdateret dagligt fra Energi Data Service. Gælder ${region}.`,
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
  '/', '/dk1', '/dk2', '/tariffer', '/automation', '/prognose', '/om-elpriser',
  '/blog/forsta-din-elpris', '/blog/shelly-elpris-automation', '/blog/home-assistant-elpriser',
  ...NET_URLS,
];

function buildSitemap() {
  const today = new Date().toISOString().split('T')[0];
  const priorityFor = p => {
    if (p === '/') return '1.0';
    if (/^\/(dk[12])\/[a-z0-9-]+$/.test(p)) return '0.6'; // per-net long-tail pages
    return '0.8';
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITEMAP_URLS.map(p => `  <url>
    <loc>https://elpriser.org${p}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>${priorityFor(p)}</priority>
  </url>`).join('\n')}
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
- [Elprisprognose](https://elpriser.org/prognose): Forventede elpriser de næste 7 dage baseret på historik og vindprognoser.
- [Automation](https://elpriser.org/automation): REST API og kodeeksempler til Home Assistant, Shelly og smart home.
- [Om elpriser](https://elpriser.org/om-elpriser): Forklaring af priskomponenter, prisområder og datakilder.
- [Forstå din elpris](https://elpriser.org/blog/forsta-din-elpris): Guide til hvad der bestemmer elprisen, spotpriser, tariffer, afgifter og sparetips.
- [Shelly automation](https://elpriser.org/blog/shelly-elpris-automation): Guide til Shelly-styring efter elprisen med gratis API.
- [Home Assistant guide](https://elpriser.org/blog/home-assistant-elpriser): Komplet opsætning af Home Assistant med elpriser, sensorer og automations.

## API

- \`GET /api/prices?area=DK1&date=YYYY-MM-DD\` — Timepriser for et prisområde og dato
- \`GET /api/now?area=DK1\` — Aktuel elpris lige nu
- \`GET /api/schedule?area=DK1&hours=4\` — De billigste timer i dag

## Detaljer

- Opdateres dagligt ca. kl. 13 når Nord Pool offentliggør næste døgns priser
- Datakilde: [Energi Data Service](https://www.energidataservice.dk) (Energinet)
- Gratis, ingen registrering påkrævet
- Sprog: Dansk
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
`;

const STATIC_ROUTES = {
  '/sitemap.xml': {
    body: () => buildSitemap(),
    type: 'application/xml; charset=utf-8',
  },
  '/robots.txt': {
    body: `User-agent: *
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

  // HTTP → HTTPS redirect
  if (url.protocol === 'http:') {
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
      return renderSPA(context, url.pathname, netPageMeta(area, net));
    }
    // Unknown net under a valid area → 404 not redirect, so we don't serve
    // a generic index with wrong metadata.
    return new Response('Not found', { status: 404 });
  }

  // SEO sub-pages — serve index.html with modified metadata for crawlers
  const page = SEO_PAGES[url.pathname];
  if (page) {
    return renderSPA(context, url.pathname, page);
  }

  return context.next();
}

async function renderSPA(context, pathname, meta) {
  const pageUrl = `https://elpriser.org${pathname}`;
  const indexUrl = new URL('/', context.request.url);
  const res = await context.env.ASSETS.fetch(indexUrl);
  let html = await res.text();
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
  html = html.replace(
    '</head>',
    `<script>if(!location.hash)location.replace('/${meta.hash}');</script>\n</head>`
  );
  return new Response(html, {
    headers: {
      ...Object.fromEntries(res.headers.entries()),
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}
