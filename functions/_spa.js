/**
 * Shared SPA-rendering helpers.
 *
 * index.html carries every section of the site; each URL is meant to be served
 * with only its own. That trimming lived in functions/[[path]].js, so /api —
 * which is handled by functions/api/[[catchall]].js instead, because that route
 * also matches the bare path — shipped all 18 sections and 10 <h1> elements
 * under the API page's title. Both entry points now share one implementation
 * rather than each keeping a copy that can drift.
 *
 * A leading underscore keeps this file out of Pages' route table.
 */

/** Server-side equivalent of route()'s classList.add('active'). */
export function activateDataPage(html, dataPage) {
  if (dataPage === 'start') return html;
  // Non-start mains carry an inline display:none, which keeps hidden pages'
  // text out of Safari Reader's article detection — swap it to the start main
  // and strip it from the section being activated.
  return html
    .replace('<main data-page="start" class="active">',
             '<main style="display:none" data-page="start" class="">')
    .replace(`<main style="display:none" data-page="${dataPage}" class="`,
             `<main data-page="${dataPage}" class="active `);
}

/** Remove every <main> except the active one, so each URL serves only its own
 *  content (~40 KB instead of ~260 KB) rather than 18 near-identical bodies. */
export function stripInactiveMains(html, dataPage) {
  return html.replace(
    /<main[^>]*data-page="([^"]+)"[\s\S]*?<\/main>/g,
    (block, page) => (page === dataPage ? block : '')
  );
}

/** Section titles are h2 in the shared markup; after stripping there is only
 *  one section, so its title becomes the page's h1. */
export function promoteSectionTitle(html) {
  return html
    .replace(/<h2 class="page-title/, '<h1 class="page-title')
    .replace(/(<h1 class="page-title[^>]*>[^<]*)<\/h2>/, '$1</h1>');
}
