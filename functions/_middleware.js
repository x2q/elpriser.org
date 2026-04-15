const STATIC_ROUTES = {
  '/sitemap.xml': {
    body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://elpriser.org/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`,
    type: 'application/xml; charset=utf-8',
  },
  '/robots.txt': {
    body: `User-agent: *
Allow: /

Sitemap: https://elpriser.org/sitemap.xml`,
    type: 'text/plain; charset=utf-8',
  },
};

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const route = STATIC_ROUTES[url.pathname];
  if (route) {
    return new Response(route.body, {
      headers: {
        'Content-Type': route.type,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }
  return context.next();
}
