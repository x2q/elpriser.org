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
};

const SITEMAP_URLS = ['/', '/dk1', '/dk2', '/tariffer', '/automation', '/prognose', '/om-elpriser'];

const STATIC_ROUTES = {
  '/sitemap.xml': {
    body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITEMAP_URLS.map(p => `  <url>
    <loc>https://elpriser.org${p}</loc>
    <changefreq>daily</changefreq>
    <priority>${p === '/' ? '1.0' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>`,
    type: 'application/xml; charset=utf-8',
  },
  '/robots.txt': {
    body: `User-agent: *
Allow: /

Sitemap: https://elpriser.org/sitemap.xml`,
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

  // Static routes (sitemap, robots, og-image)
  const staticRoute = STATIC_ROUTES[url.pathname];
  if (staticRoute) {
    return new Response(staticRoute.body, {
      headers: {
        'Content-Type': staticRoute.type,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  // SEO sub-pages — serve index.html with modified title/description
  const page = SEO_PAGES[url.pathname];
  if (page) {
    const indexUrl = new URL('/', context.request.url);
    const res = await context.env.ASSETS.fetch(indexUrl);
    let html = await res.text();
    html = html.replace(
      /<title>[^<]*<\/title>/,
      `<title>${page.title}</title>`
    );
    html = html.replace(
      /<meta name="description" content="[^"]*">/,
      `<meta name="description" content="${page.description}">`
    );
    html = html.replace(
      /<link rel="canonical" href="[^"]*">/,
      `<link rel="canonical" href="https://elpriser.org${url.pathname}">`
    );
    // Inject script to set hash route for SPA navigation
    html = html.replace(
      '</head>',
      `<script>if(!location.hash)location.replace('/${page.hash}');</script>\n</head>`
    );
    return new Response(html, {
      headers: res.headers,
    });
  }

  return context.next();
}
