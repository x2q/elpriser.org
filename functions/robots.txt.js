export function onRequest() {
  const robots = `User-agent: *
Allow: /

Sitemap: https://elpriser.org/sitemap.xml`;

  return new Response(robots, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
