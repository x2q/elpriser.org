/**
 * /integrationer: the one list of plugins, API libraries and the MCP server, with the TRUE install status of each.
 *
 * ALL STATUS LIVES IN THIS FILE, in INTEGRATIONS below. Changing a status (a package lands on PyPI, the HACS
 * pull request is merged, the Rust crate gets its first tag) is ONE edit here: the Function draws the finished
 * HTML from this table (integrationsHTML), so the page works without JavaScript and a crawler reads the same
 * statuses a visitor does. The dev server (server.js) draws it with the same function. Nothing here is fetched
 * live: a status is what somebody checked on INTEGRATIONS_CHECKED and wrote down.
 *
 * Status values (STATUS below):
 *   registry  "Live"          published on its own registry (npm, the MCP registry, the HACS default list) and installed from there
 *   github    "Fra GitHub"    installable from the GitHub repository (tag v0.1.0), not in a registry
 *   applied   "Afventer"      submitted to a registry or default list, waiting; works as a custom source meanwhile
 *   soon      "Kommer"        planned, does not exist yet: no link, no install line
 *   site      "Fra elpriser.org"  served by this website (the Shelly script)
 *
 * Install lines and coverage claims are copied from each repository's README (read 2026-11-03), never invented.
 * A leading underscore keeps this file out of Pages' route table.
 */

export const INTEGRATIONS_CHECKED = '2026-11-03';

export const STATUS = {
  registry: { label: 'Live', tone: 'ok',
    text: 'Ligger i et officielt register (npm, MCP-registret eller HACS’ standardliste) og installeres derfra.' },
  github: { label: 'Fra GitHub', tone: 'brand',
    text: 'Installeres direkte fra GitHub (tag v0.1.0). Ligger ikke i et register endnu.' },
  applied: { label: 'Afventer', tone: 'wait',
    text: 'Ansøgt om optagelse, svar afventes. Virker allerede som tilpasset kilde.' },
  soon: { label: 'Kommer', tone: 'soon',
    text: 'Planlagt, men findes ikke endnu.' },
  site: { label: 'Fra elpriser.org', tone: 'brand',
    text: 'Hentes her fra siden.' },
};

export const GROUPS = [
  { id: 'smart-home', title: 'Smart home og automatisering',
    lead: 'Færdige plugins, så prisen dukker op i det system, du allerede bruger.' },
  { id: 'biblioteker', title: 'Biblioteker til din egen kode',
    lead: 'API-implementationer, når du selv skriver programmet.' },
  { id: 'ai', title: 'AI-assistenter',
    lead: 'Så Claude og andre assistenter kan svare med de rigtige priser.' },
];

const GH = 'https://github.com/x2q/';
const ZONES40 = '40 prisområder: Danmark (DK1 og DK2), resten af Norden, Holland, det meste af Europa, Storbritannien og Irland.';

/**
 * One entry per item, in the order shown.
 *   id, group, name, platform   what it is and where it runs
 *   blurb                       one line on what it does
 *   status                      a key of STATUS
 *   version                     latest tag on GitHub (shown), or null
 *   coverage                    only what the README states
 *   how                         one or two sentences: how it is installed
 *   codes                       copyable lines [{ label?, text }], exactly as the README has them
 *   note                        an honest limit, or null
 *   repo                        GitHub repository under x2q, or null (then no "Se på GitHub")
 *   links                       extra links [{ label, href }]
 *   llms                        the install line as one plain sentence for llms.txt (optional)
 */
export const INTEGRATIONS = [
  {
    id: 'home-assistant', group: 'smart-home', name: 'Home Assistant', platform: 'Integration via HACS',
    blurb: 'Prisen nu og næste time, billigste time og en “billig time nu”-sensor til dine automationer. Virker med Energy-dashboardet.',
    status: 'registry', version: 'v0.1.3',
    coverage: ZONES40,
    how: 'I HACS: søg efter Elpriser og tryk Download. Genstart Home Assistant, og vælg Settings, Devices & services, Add integration, Elpriser.',
    codes: [{ label: 'Søg i HACS efter', text: 'Elpriser' }],
    note: 'Ligger på HACS’ standardliste siden 4. november 2026 (optaget i pull request 13196). Dukker den ikke op ved søgning, så opdatér HACS’ liste, eller tilføj https://github.com/x2q/ha-elpriser som tilpasset repository med kategorien Integration.',
    repo: 'ha-elpriser',
    llms: 'i HACS: søg efter Elpriser og tryk Download (på HACS’ standardliste siden 4. november 2026; ellers Custom repositories med https://github.com/x2q/ha-elpriser og kategorien Integration)',
    links: [
      { label: 'Optagelsen hos HACS', href: 'https://github.com/hacs/default/pull/13196' },
      { label: 'Uden installation: REST-sensor', href: '/automation#home-assistant' },
    ],
  },
  {
    id: 'node-red', group: 'smart-home', name: 'Node-RED', platform: 'Noder',
    blurb: 'Noder til prisen nu, de billigste timer (eller det billigste sammenhængende vindue) og prognosen.',
    status: 'registry', version: null,
    coverage: ZONES40,
    how: 'Installeres fra npm: kør i Node-REDs brugermappe (typisk ~/.node-red), og genstart Node-RED. Noderne ligger i paletten under elpriser.',
    codes: [{ text: 'npm install node-red-contrib-elpriser' }],
    note: null,
    repo: 'node-red-contrib-elpriser',
    llms: '`npm install node-red-contrib-elpriser` i ~/.node-red',
    links: [{ label: 'Pakken på npm', href: 'https://www.npmjs.com/package/node-red-contrib-elpriser' }],
  },
  {
    id: 'homey', group: 'smart-home', name: 'Homey', platform: 'App til Homey Pro',
    blurb: 'Pris nu og næste time, prisniveau, en “billig time”-kontakt og flowkort til “kør, når strømmen er billig”.',
    status: 'github', version: 'v0.1.0',
    coverage: ZONES40,
    how: 'Installeres fra kildekoden på en Homey Pro. Du skal bruge Node.js 18 eller nyere. Derefter: Devices, plus, Elpriser, og vælg prisområde.',
    codes: [{ text: 'git clone https://github.com/x2q/homey-elpriser.git\ncd homey-elpriser\nnpm install\nnpx homey login\nnpx homey app install' }],
    note: 'Uofficiel og ikke i Homey App Store. Endnu ikke afprøvet på en rigtig Homey.',
    repo: 'homey-elpriser', links: [],
    llms: '`git clone https://github.com/x2q/homey-elpriser.git`, derefter `npm install` og `npx homey app install`; uofficiel, endnu ikke afprøvet på en rigtig Homey',
  },
  {
    id: 'evcc', group: 'smart-home', name: 'evcc', platform: 'Dynamisk tarif',
    blurb: 'Elprisen som dynamisk nettarif i evcc, så planlæggeren kan lade elbilen i de billigste timer. Prognosen er med.',
    status: 'applied', version: 'v0.1.0',
    coverage: ZONES40,
    how: 'Kopiér en af eksempelfilerne ind i din evcc.yaml og genstart evcc. Der er eksempler for Danmark (også med netselskabets tarif), Tyskland og Sverige.',
    codes: [],
    note: 'Indsendt til evcc som skabelon den 3. november 2026 og afventer gennemgang; endnu ikke en del af evcc. Testet mod evcc bygget fra master samme dag.',
    repo: 'evcc-elpriser',
    llms: 'kopiér et eksempel fra examples/ ind i evcc.yaml; indsendt til evcc (pull request 35753), endnu ikke en del af evcc',
    links: [{ label: 'Eksempelfiler', href: GH + 'evcc-elpriser/tree/main/examples' }, { label: 'Pull request hos evcc', href: 'https://github.com/evcc-io/evcc/pull/35753' }],
  },
  {
    id: 'openhab', group: 'smart-home', name: 'openHAB', platform: 'Konfigurationspakke',
    blurb: 'Filer til det indbyggede HTTP-binding: pris nu, næste time, billigste time og prognose. Ingen Java og ingen egen binding.',
    status: 'github', version: 'v0.1.0',
    coverage: 'Danmark med ren JSONPATH. Alle 40 prisområder med JavaScript-transformationen.',
    how: 'Kopiér filerne fra conf/ til din openHAB-konfiguration: things, items, regel og sitemap. README’en viser de to veje trin for trin.',
    codes: [],
    note: 'Ikke afprøvet på en kørende openHAB endnu. Kontrolleret mod optagelser af tjenesten og i CI.',
    repo: 'openhab-elpriser',
    llms: 'kopiér filerne fra conf/ til openHAB; endnu ikke afprøvet på en kørende openHAB',
    links: [{ label: 'Filerne i conf/', href: GH + 'openhab-elpriser/tree/main/conf' }],
  },
  {
    id: 'esphome', group: 'smart-home', name: 'ESPHome', platform: 'Pakke til ESP32 og ESP8266',
    blurb: 'Pris nu, billigste time og en “billig time nu”-kontakt direkte på en ESP32 eller ESP8266, til et relæ.',
    status: 'github', version: 'v0.1.0',
    coverage: '39 prisområder (ikke Storbritannien). ESP8266 kan kun DK1 og DK2.',
    how: 'Tilføj pakken til din enhedskonfiguration. Du skal stadig have de sædvanlige blokke: esphome, esp32 eller esp8266, wifi.',
    codes: [{ text: 'packages:\n  elpriser: github://x2q/esphome-elpriser/elpriser.yaml@main\n\nsubstitutions:\n  elpriser_zone: dk1\n  elpriser_currency: DKK\n  elpriser_cheap_hours: "4"' }],
    note: 'Uofficiel. Kompilerer og er testet mod tjenesten, men er endnu ikke flashet på en rigtig ESP. Læs sikkerhedsnoten i README’en, før den styrer noget.',
    repo: 'esphome-elpriser', links: [],
    llms: '`packages: elpriser: github://x2q/esphome-elpriser/elpriser.yaml@main`; endnu ikke flashet på en rigtig ESP',
  },
  {
    id: 'shelly', group: 'smart-home', name: 'Shelly', platform: 'Script og Live Tariff',
    blurb: 'Et script, der henter døgnets plan og styrer et relæ, eller Live Tariff, der viser prisen i Shelly-appen.',
    status: 'site', version: null,
    coverage: 'Danmark (DK1 og DK2).',
    how: 'Til Shelly Gen2 eller nyere. Vælg din enhed og strategi på siden Smart hjem, og kopiér scriptet ind i Shelly under Scripts.',
    codes: [],
    note: null,
    repo: null,
    links: [
      { label: 'Shelly-script', href: '/automation#shelly' },
      { label: 'Shelly Live Tariff', href: '/shelly-tariff' },
    ],
  },
  {
    id: 'python', group: 'biblioteker', name: 'Python', platform: 'Bibliotek og kommandolinje',
    blurb: 'Typet klient: pris nu, billigste timer, bedste sammenhængende vindue og prognose. Synkron uden afhængigheder, og async.',
    status: 'github', version: 'v0.1.0',
    coverage: '40 europæiske prisområder.',
    how: 'Installeres fra GitHub. Ligger ikke på PyPI endnu.',
    codes: [{ text: 'pip install "git+https://github.com/x2q/elpriser-python"' }],
    note: null,
    repo: 'elpriser-python', links: [],
    llms: '`pip install "git+https://github.com/x2q/elpriser-python"` (ikke på PyPI)',
  },
  {
    id: 'javascript', group: 'biblioteker', name: 'JavaScript og TypeScript', platform: 'npm-pakke',
    blurb: 'Typet klient uden afhængigheder: pris nu, billigste timer, bedste sammenhængende vindue og prognose. Virker i browseren, Node.js 18 eller nyere, Deno, Bun og Cloudflare Workers.',
    status: 'registry', version: null,
    coverage: '40 europæiske prisområder.',
    how: 'Installeres fra npm.',
    codes: [{ text: 'npm install elpriser-client' }],
    note: null,
    repo: 'elpriser-client',
    llms: '`npm install elpriser-client`',
    links: [{ label: 'Pakken på npm', href: 'https://www.npmjs.com/package/elpriser-client' }],
  },
  {
    id: 'rust', group: 'biblioteker', name: 'Rust', platform: 'Crate',
    blurb: 'Typet klient: pris nu, billigste timer, bedste sammenhængende vindue og prognose. Blokerende som standard, valgfri async.',
    status: 'registry', version: null,
    coverage: '40 europæiske prisområder.',
    how: 'Installeres fra crates.io.',
    codes: [{ text: 'cargo add elpriser' }],
    note: null,
    repo: 'elpriser-rust',
    llms: '`cargo add elpriser`',
    links: [{ label: 'Crate på crates.io', href: 'https://crates.io/crates/elpriser' }],
  },
  {
    id: 'go', group: 'biblioteker', name: 'Go', platform: 'Modul',
    blurb: 'Typet klient uden afhængigheder: pris nu, billigste timer, bedste sammenhængende vindue og prognose. Med context og timeouts.',
    status: 'github', version: 'v0.1.0',
    coverage: '40 europæiske prisområder.',
    how: 'Hentes direkte fra GitHub med Go-værktøjet (Go 1.21 eller nyere).',
    codes: [{ text: 'go get github.com/x2q/elpriser-go@v0.1.0' }],
    note: null,
    repo: 'elpriser-go', links: [],
    llms: '`go get github.com/x2q/elpriser-go@v0.1.0`',
  },
  {
    id: 'mcp', group: 'ai', name: 'MCP-server', platform: 'Claude, ChatGPT og andre MCP-klienter',
    blurb: 'Giver assistenten værktøjer til prisen lige nu, de billigste timer og prognosen, uden at du bygger HTTP-kald.',
    status: 'registry', version: null,
    coverage: 'Danmark (DK1 og DK2, med nettariffer) og spotpriser for 40 europæiske prisområder.',
    how: 'Kør lokalt med npx, eller brug den hostede server uden installation: tilføj adressen som connector i Claude eller ChatGPT. Registernavn i MCP-registret: io.github.x2q/elpriser-mcp.',
    codes: [
      { label: 'Lokalt', text: 'npx -y elpriser-mcp' },
      { label: 'Hostet (Streamable HTTP, ingen nøgle)', text: 'https://elpriser.org/mcp' },
    ],
    note: null,
    repo: 'elpriser-mcp',
    llms: '`npx -y elpriser-mcp`, eller den hostede server https://elpriser.org/mcp; MCP-registret: io.github.x2q/elpriser-mcp',
    links: [
      { label: 'Pakken på npm', href: 'https://www.npmjs.com/package/elpriser-mcp' },
      { label: 'Opslag i MCP-registret', href: 'https://registry.modelcontextprotocol.io/v0/servers?search=io.github.x2q/elpriser-mcp' },
    ],
  },
];

/** The curl example of "Direkte mod API'et". Checked against the live API on INTEGRATIONS_CHECKED. */
export const CURL_EXAMPLE = 'curl "https://elpriser.org/api/now?area=DK1&mode=inkl_alt"';
export const ISSUES_URL = 'https://github.com/x2q/elpriser.org/issues';
export const CONTACT_MAIL = 'hello@elpriser.org';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isExternal = h => /^https?:/.test(h);
const link = (href, label) => `<a href="${esc(href)}"${isExternal(href) ? ' rel="noopener"' : ''}>${esc(label)}</a>`;

function codeBlock(c, item) {
  const name = `${c.label ? c.label + ': ' : ''}${item.name}`;
  return `<div class="ig-code">${c.label ? `<p class="ig-codel">${esc(c.label)}</p>` : ''}`
    + `<pre tabindex="0" aria-label="${esc(name)}"><code>${esc(c.text)}</code></pre>`
    + `<button type="button" class="ig-copy" data-ig-copy aria-label="Kopiér: ${esc(name)}">Kopiér</button></div>`;
}

function itemHTML(it) {
  const st = STATUS[it.status];
  const soon = it.status === 'soon';
  const meta = [it.coverage, it.version ? `Seneste version på GitHub: ${it.version}` : null].filter(Boolean);
  const links = [
    it.repo ? link(GH + it.repo, 'Se på GitHub') : null,
    ...it.links.map(l => link(l.href, l.label)),
  ].filter(Boolean);
  return `<li class="ig-item${soon ? ' ig-item-soon' : ''}" id="${esc(it.id)}">
        <div class="ig-main">
          <div class="ig-head"><h3 class="ig-name">${esc(it.name)}</h3><span class="ig-chip ig-${st.tone}"><span class="vh">Status: </span>${esc(st.label)}</span></div>
          <p class="ig-plat">${esc(it.platform)}</p>
          <p class="ig-blurb">${esc(it.blurb)}</p>
          ${meta.length ? `<p class="ig-meta">${meta.map(esc).join(' ')}</p>` : ''}
          ${it.note ? `<p class="ig-note">${esc(it.note)}</p>` : ''}
          ${links.length ? `<p class="ig-links">${links.join('')}</p>` : ''}
        </div>
        ${soon ? '' : `<div class="ig-how">
          ${it.how ? `<p class="ig-howt">${esc(it.how)}</p>` : ''}
          ${it.codes.map(c => codeBlock(c, it)).join('')}
        </div>`}
      </li>`;
}

/** The finished body of the page: the status legend, one section per group, the API section and the "missing platform" box.
 *  Replaces <!--SSR_INTEGRATIONER--> in index.html's <main data-page="integrationer">. */
export function integrationsHTML() {
  const legend = Object.values(STATUS).map(s =>
    `<div class="ig-lg"><dt><span class="ig-chip ig-${s.tone}">${esc(s.label)}</span></dt><dd>${esc(s.text)}</dd></div>`).join('');
  const groups = GROUPS.map(g => `<section class="ig-sec" aria-labelledby="ig-${g.id}">
      <h2 class="ig-h" id="ig-${g.id}">${esc(g.title)}</h2>
      <p class="ig-lead">${esc(g.lead)}</p>
      <ul class="ig-list">
      ${INTEGRATIONS.filter(i => i.group === g.id).map(itemHTML).join('\n      ')}
      </ul>
    </section>`).join('\n    ');
  return `<section class="ig-sec ig-key" aria-labelledby="ig-status">
      <h2 class="ig-h" id="ig-status">Hvad står der på mærkaten?</h2>
      <dl class="ig-legend">${legend}</dl>
      <p class="ig-asof">Status tjekket ${esc(dkDate(INTEGRATIONS_CHECKED))}.</p>
    </section>
    ${groups}
    <section class="ig-sec" aria-labelledby="ig-api">
      <h2 class="ig-h" id="ig-api">Direkte mod API’et</h2>
      <p class="ig-lead">Ingen nøgle og ingen konto. Det her virker i en terminal:</p>
      <div class="ig-how ig-wide">
        <div class="ig-code"><pre tabindex="0" aria-label="curl-eksempel"><code>${esc(CURL_EXAMPLE)}</code></pre><button type="button" class="ig-copy" data-ig-copy aria-label="Kopiér: curl-eksempel">Kopiér</button></div>
      </div>
      <p class="ig-links ig-links-solo">${link('/api', 'Dokumentation af API’et')}${link('/api/openapi.json', 'OpenAPI-beskrivelse (JSON)')}</p>
    </section>
    <section class="ig-sec ig-missing" aria-labelledby="ig-mangler">
      <h2 class="ig-h" id="ig-mangler">Mangler din platform?</h2>
      <p class="ig-lead">Skriv til ${link('mailto:' + CONTACT_MAIL, CONTACT_MAIL)}, eller åbn et ${link(ISSUES_URL, 'issue på GitHub')}. Så ser vi på det.</p>
    </section>`;
}

function dkDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
  return `${d}. ${months[m - 1]} ${y}`;
}

/** CollectionPage with an ItemList, for the items that really exist (everything but "Kommer"). */
export function integrationsLd(pageUrl, meta) {
  const real = INTEGRATIONS.filter(i => i.status !== 'soon');
  const entry = i => {
    const o = { '@type': 'SoftwareSourceCode', name: `Elpriser: ${i.name}`, description: i.blurb, inLanguage: 'da' };
    if (i.repo) o.codeRepository = GH + i.repo;
    o.url = i.repo ? GH + i.repo : 'https://elpriser.org' + i.links[0].href;
    return o;
  };
  return {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: meta.title, description: meta.description,
    url: pageUrl, inLanguage: 'da',
    isPartOf: { '@type': 'WebSite', name: 'elpriser.org', url: 'https://elpriser.org' },
    mainEntity: {
      '@type': 'ItemList', numberOfItems: real.length,
      itemListElement: real.map((i, n) => ({ '@type': 'ListItem', position: n + 1, item: entry(i) })),
    },
  };
}

/** The names of the items that exist now (not "Kommer"), for a running sentence. */
export function integrationsNames() {
  return INTEGRATIONS.filter(i => i.status !== 'soon').map(i => i.name).join(', ');
}

/** The llms.txt lines for the page: every item, its status in words, and where to get it. */
export function integrationsLlms() {
  return INTEGRATIONS.map(i => {
    const st = STATUS[i.status].label;
    if (i.status === 'soon') return `  - ${i.name}: ${st} (findes endnu ikke)`;
    const where = i.repo ? `${GH}${i.repo}` : `https://elpriser.org${i.links[0].href}`;
    return `  - ${i.name}: ${st} — ${where}${i.llms ? '. Installation: ' + i.llms : ''}`;
  }).join('\n');
}
