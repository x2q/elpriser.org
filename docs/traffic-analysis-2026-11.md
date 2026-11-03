# Trafikanalyse for elpriser.org, 3. november 2026

Skrevet 2026-11-03 (formiddag). Kun læsning: intet på sitet, i repoet (undtagen denne fil), på Cloudflare eller Spark er ændret. Filen er ikke committet.

## 1. Kort fortalt

- **Rigtige besøgende vokser hurtigt, men fra lavt niveau.** Sidevisninger fra browsere (HTML, status 200, ikke verificeret bot) steg fra ca. 440 pr. dag i begyndelsen af oktober til ca. 800 pr. dag i ugen fra 26. okt. og 1.237 den 2. nov. (ca. 980 besøg og 633 unikke IP-adresser). Det er cirka 1,3 % af alle forespørgsler; resten er maskiner.
- **Google-henvisninger firedoblede sig fra 28. okt.** (RUM: 530 sideindlæsninger pr. uge omkring 12. okt. til ca. 1.850 i ugen fra 26. okt.), næsten alt på `/prognose`. Årsagen kan ikke aflæses uden Search Console (se datahuller).
- **`/prognose` bærer sitet:** 39 % af menneskelige sidevisninger og 87 % af Google-landinger. Forsiden har 22 %.
- **Én fejl skiller sig ud:** `https://www.elpriser.org/` svarer 522 (testet nu). Det er ca. 4.700 mislykkede forespørgsler på 27 dage og praktisk talt alle 5xx (ca. 97 %).
- **API-trafikken er meget koncentreret:** de to største IP-adresser stod for 42 % af API-kaldene de seneste seks dage (én Home Assistant, én Shelly Pro4PM). 10 IP-adresser = 65 %.
- **Telemetrien (`npm run clients`) ser kun cache-misses** siden API-svar blev cachet på kanten omkring 13. okt. Den undertæller kald groft, og versionsfordelingen skal læses med det in mente.
- **Europa-siderne (33 URL'er, lanceret 2. nov.) er 1,5 døgn gamle.** 185 browser-forespørgsler (SE 69, NL 41, DE 40, DK 18), Googlebot har kun hentet dem 2 gange, Bingbot 37 gange, AI-crawlere 90 gange. Indeksering og visninger kan endnu ikke måles her.
- **Core Web Vitals er gode** (LCP p75 0,48 s, INP 48 ms, CLS 0, TTFB p75 290 ms). Undtagelse: `/automation` har CLS p75 0,27 (dårlig).
- **Butiks-klik fra sitet kan ikke måles** med de data, jeg har adgang til.

## 2. Datakilder og huller (læs før tallene)

| Kilde | Bruges til | Dækning |
|---|---|---|
| Cloudflare GraphQL, `httpRequests1dGroups` | dagstal: forespørgsler, cache, unikke IP | 90 dage (fra 5. aug.) |
| Cloudflare GraphQL, `httpRequestsAdaptiveGroups` (eyeball, stikprøve) | bots, UA, stier, status, lande, enheder | maks. 32 dage: 4. okt. – 3. nov. (3. nov. er delvis) |
| Cloudflare Web Analytics (RUM, `rum*AdaptiveGroups`) | rigtige JS-sideindlæsninger, henvisninger, Core Web Vitals | fra 27. sep.; stikprøve, afrundet til 10/100 |
| Pages Functions-metrikker (`pagesFunctionsInvocationsAdaptiveGroups`) | invokationer, fejl, CPU | 30 dage |
| `scripts/clients.mjs`, `kv-usage.mjs`, `traffic.mjs apps` | app/Shelly/HA, KV, apps | se hul 8 |
| Search Console-eksport `~/Downloads/elpriser.org-Performance-on-Search-2026-10-13.xlsx` | baseline for søgning | data til 11. okt. |
| npm download-API (offentligt) | `elpriser-mcp`, `elpriser-client` | 30 dage |
| Egne `curl`-målinger | TTFB, headers | enkeltmålinger i dag |

**Hvad der ikke er målt, og hvorfor det betyder noget:**

1. **Search Console og Bing Webmaster:** ingen API-adgang og ingen eksport nyere end 13. okt. (data til 11. okt.). Derfor kan jeg ikke måle: effekten af ændringerne 27. sep., 6., 9. og 13. okt., `/prognose`-svarblokken 1. nov., Europa-sidernes indeksering/visninger, eller lokationseksperimentet. Jeg bruger RUM-henvisninger fra Google som grov stedfortræder.
2. **GA4 (G-3WE5CL1ZTV):** ingen adgang. `outbound_click`, `nav_click`, GPS-hændelser og `scroll_depth` findes i koden, men kan ikke læses her.
3. **Klik fra sitet til App Store/Google Play:** udgående klik forlader Cloudflare og logges ikke. Kun GA4 (`outbound_click` med `link_domain`) og butikkernes egne konsoller kan se dem. Play-banneret har UTM-referrer, men `/download`-badges og footer-badges har ingen kampagneparameter. Installationer ses heller ikke.
4. **Forespørgselsstrenge** (område, net, mode) er skjult på denne Cloudflare-plan, og `clientRefererHost`, `edgeTimeToFirstByteMs`, `botScore` og ASN er spærret. Det giver: ingen kantlatens, ingen botscore (bot/menneske er gættet ud fra UA og `verifiedBotCategory`), ingen forklaring på præcis hvilke parametre der giver HTTP 400.
5. **"Browser-UA" er ikke det samme som et menneske.** Headless-scrapere bruger Chrome-UA. Fremmede lande i browsertallene (US, NL, FR, DE) er for en stor del scrapere; RUM (JS kørt) viser 95,6 % Danmark mod 77 % i kanttallet.
6. **RUM** er stikprøve og afrundet; kvantiler på stier med under ca. 200 indlæsninger er ikke pålidelige. Safari rapporterer ikke LCP/INP, så Core Web Vitals er Chromium-vægtet.
7. **Unikke IP-adresser** (Cloudflares "uniques") er ikke personer (NAT, mobilnet). Adaptive-loggen er stikprøve ved høj volumen; 6.-7. okt. har usædvanligt få IP-grupper i min optælling og er ikke brugt.
8. **Analytics Engine-telemetrien tæller kun kald, der når Function'en.** Siden cachen på API-svar (ca. 13. okt.) er 1,02 mio. af 1,76 mio. API-kald serveret fra kanten uden at komme forbi `recordUsage`. `npm run clients` viste 1.382 HA-kald på 30 dage, mens kanten så ca. 740.000 med HA-UA. Fordelinger er ikke repræsentative for kaldmængder.
9. **Egen testtrafik:** UA `elpriser-urltest/1.0` er 0,8 % af alle forespørgsler og 9,8 % af HTML (12.000 stk., op til 3.400 på én dag). Den er trukket fra, hvor det er angivet.
10. **MCP:** `/mcp` blev først committet 3. nov. Der er ingen reel brugsdata, og `_usage.js` tæller ikke `/mcp`.

## 3. Trafik over tid

Alle tal er Cloudflare-dagstal (alle forespørgsler, også API og bots) pr. kalenderuge. "Menneske-sidevisninger" er HTML, status 200, browser-UA, ikke verificeret bot (kun fra 8. okt., se hul 7).

| Uge (mandag) | Forespørgsler/dag | Cachet | Unikke IP/dag | Menneske-sidevisninger/dag | Google-henvisning (RUM, pr. uge) |
|---|---|---|---|---|---|
| 3. aug. | 26.950 | 0 % | 227 | – | – |
| 10. aug. | 28.198 | 0 % | 265 | – | – |
| 17. aug. | 29.703 | 0 % | 289 | – | – |
| 24. aug. | 28.818 | 0 % | 306 | – | – |
| 31. aug. | 32.600 | 0 % | 351 | – | – |
| 7. sep. | 34.597 | 0 % | 342 | – | – |
| 14. sep. | 37.071 | 0 % | 511 | – | – |
| 21. sep. | 42.742 | 0 % | 513 | – | – |
| 28. sep. | 48.874 | 0 % | 650 | – | 480 |
| 5. okt. | 70.476 | 0 % | 740 | 439 (4 dage) | 540 |
| 12. okt. | 66.110 | 60 % | 1.030 | 555 | 530 |
| 19. okt. | 53.507 | 82 % | 1.160 | 571 | 780 |
| 26. okt. | 66.570 | 79 % | 1.403 | 803 | 1.850 |
| 2. nov. (1 dag) | 92.483 | 77 % | 1.821 | 1.237 | 440 (2.-3. nov.) |

Læsning:
- Forespørgsler 3,4 gange op på tre måneder, men uge 5. okt. skyldes enkeltklienter: en klient uden User-Agent (fra Tyskland) lavede ca. 17.600 `/api/prices`-kald pr. dag 5.-12. okt. og forsvandt derefter (UA-tomt: 17.601 pr. dag, 970 pr. dag i ugen 19.-27. okt.). 31. okt. dukkede en Shelly Pro4PM op med ca. 24.000 kald pr. dag.
- 31. okt. (95.541) rummer desuden en scannerbølge: ca. 12.700 Windows-forespørgsler på én time (kl. 08 UTC) mod stier som `/js`, `/static`, `/assets`, `/build` (sourcemaps), næsten alle 301/404.
- Cache-andelen hopper fra 0 til 60-80 % omkring 13. okt. Pages Functions-invokationer faldt fra 65-80.000 pr. dag til 8-22.000 (22.000 den 2. nov.), 0 fejl, CPU p50 ca. 2,5 ms, p99 ca. 30 ms.
- KV: 404 skrivninger 2. nov. (40 % af gratisgrænsen på 1.000), læsninger 5 %.

## 4. Mennesker, bots og enheder

Fordeling af alle forespørgsler (1,96 mio. mellem 4. okt. og 2. nov.) efter klienttype (gættet ud fra UA):

| Klient | Andel | Andel af HTML (112.000) |
|---|---|---|
| Home Assistant | 37,9 % | 0,0 % |
| Shelly | 28,7 % | 7,4 % |
| Tomt UA, scripts, curl, python | 18,9 % | 19,1 % |
| Browser-UA | 11,2 % | 47,9 % |
| Bots/crawlere (verificerede og UA-genkendte) | 1,4 % | 15,8 % |
| Egne apps (ElpriserAndroid/IOS) | 1,1 % | – |
| Egen test (`elpriser-urltest`) | 0,8 % | 9,8 % |

HTML-svar: kun 45 % er 200 (48.200 af 107.800). 34 % er 404 og 19 % 301, næsten alt scannertrafik (`.env`, `wp-*.php` m.m.).

### Bots og AI-crawlere (4. okt. – 2. nov., antal hentninger, UA-baseret)

| Gruppe | Hentninger | Bemærkning |
|---|---|---|
| AI-svar, brugerudløst (ChatGPT-User, Claude-User, Perplexity-User, MistralAI-User, DuckAssistBot) | 3.631 | ingen stigning: 1.213 (uge 5. okt.) -> 586 -> 718 -> 415 |
| AI-søgning/indeks (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Exa, Linkup, YouBot m.fl.) | 3.101 | 679 -> 537 -> 781 -> 841 (stigende) |
| AI-træning/crawl (GPTBot, ClaudeBot, CCBot, Bytespider, Amazonbot, Meta, Applebot, Qwen/Hunyuan/Kimi m.fl.) | 4.088 | 1.401 -> 957 -> 1.218 -> 473 |
| Bingbot | 2.734 | ca. 94 pr. dag |
| Googlebot | 2.490 | ca. 86 pr. dag; omkring 20 % af hentningerne går til noindex-`/api/*` |
| SEO-værktøjer (Ahrefs, Semrush m.fl.) | 1.064 | |
| Andre søgemaskiner (DuckDuckBot, Yandex, Baidu m.fl.) | 980 | |

- Mængden af AI-UA'er inkluderer scannere, der låner navnet (fx 300 "AI"-hentninger af `/api/..;/.env`). Cloudflares verificerede kategori "AI Assistant" ses for ChatGPT-User 941 af 1.159 UA-hentninger.
- AI-crawlerne henter `llms.txt` (ca. 520), `llms-full.txt` (170), `/api/openapi.json` (ca. 485), `robots.txt` og forsiden. `robots.txt` tillader alle AI-bots.
- **AI-henvisninger til sitet er ca. nul:** RUM viser kun 10 indlæsninger fra Copilot og 10 fra Hugging Face på fem uger. Der er ingen henvisninger fra chatgpt.com, perplexity eller claude.ai i data.

### Enheder, styresystemer, browsere (menneske-sidevisninger, 8. okt. – 3. nov.)

| | Kant (16.829 visninger) | RUM (JS kørt, stikprøve) |
|---|---|---|
| Mobil | 53 % | 68 % |
| Desktop | 45 % | 31 % |
| Tablet | 2 % | 2 % |

OS (kant): iOS 33 %, Windows 24 %, Android 22 %, macOS 18 %, Linux 3 %. Browsere (RUM): MobileSafari 34 %, ChromeMobile 28 %, Chrome desktop 14 %, Edge 7 %, Safari desktop 7 %, Samsung Internet 2 %. Søgetrafik er mobiltung: i Search Console-baseline (13. okt.) har mobil CTR 7,8 % og position 6 mod desktop 3,4 % og position 15.

## 5. Sider, lande og sprog

### Mest besøgte sider (menneske-sidevisninger, kant, 8. okt. – 3. nov.)

| Side | Visninger | Andel |
|---|---|---|
| `/prognose` | 6.636 | 39,4 % |
| `/` | 3.759 | 22,3 % |
| `/automation` | 824 | 4,9 % |
| `/dk1/n1` | 621 | 3,7 % |
| `/dk2/radius` | 606 | 3,6 % |
| `/dk1` | 532 | 3,2 % |
| `/dk2` | 384 | 2,3 % |
| `/blog/elafgift-2028` | 305 | 1,8 % |
| `/api` | 237 | 1,4 % |
| `/dk2/cerius` | 225 | 1,3 % |
| `/tariffer` | 209 | 1,2 % |
| `/download` | 113 | 0,7 % |

Grupper: netselskabssider `/dk1/*` og `/dk2/*` 2.228 (13 %), blog 631 (4 %), de ti `/elpris/<by>`-sider 208 i alt (ca. 5 pr. by pr. uge, så lokationseksperimentet har ingen statistisk styrke, som forventet), Europa-sider 422 (2,5 %, hvoraf `/sv/elpris` 113 og `/no/strompris` 93).

Uge 12. okt. -> uge 26. okt.: `/prognose` 1.225 -> 2.669 visninger (x2,2), forsiden 1.040 -> 1.133 (flad), `/automation` 202 -> 242. Væksten er næsten kun `/prognose`.

### Lande og sprog

- Alle forespørgsler (4. okt. – 2. nov.): Danmark 76 %, Tyskland 9,6 % (næsten udelukkende den tomme-UA-klient, 127.000 `/api/prices`-kald), USA 1,4 %, Holland 1,1 %, Sydkorea og Australien (bots).
- RUM (rigtige sideindlæsninger, 27. sep. – 3. nov.): DK 95,6 %, SE 1,9 %, US 1,0 %, DE 0,8 %, FI 0,5 %, NL 0,2 %.
- Search Console (3 mdr. til 11. okt.): Danmark 1.393 klik af 1.436 (97 %) og 22.132 af 25.388 visninger. Norge 641 visninger/8 klik (position 35), Sverige 233/7, Tyskland 217/6 (position 5,9).
- Sprog: Accept-Language kan ikke ses. Via stipræfiks er ca. 97,5 % af menneskelige visninger danske sider. Svensk og norsk er de eneste fremmede sprog med mærkbart trafik.
- 2. nov.: Sverige var #2 land for sidevisninger (81, mod 94 på hele ugen før), Tyskland 112 (formentlig scrapere, ikke fulgt op i RUM).

## 6. Henvisninger og søgning

### Henvisninger (RUM, 28. sep. – 3. nov., ca. 19.300 sideindlæsninger)

| Kilde | Indlæsninger | Andel |
|---|---|---|
| Direkte/ingen | 6.900 | 36 % |
| Internt (elpriser.org) | 6.800 | 35 % |
| Google | 4.620 | 24 % |
| Bing | 290 | 1,5 % |
| DuckDuckGo | 90 | 0,5 % |
| Facebook (alle varianter) | ca. 150 | 0,8 % |
| Yahoo, Qwant, X/t.co m.fl. | ca. 150 | 0,8 % |

Google-landing (RUM): `/prognose` 4.000 (87 %), `/blog/elafgift-2028` 140, `/` 130, `/automation` 120, `/tariffer` 90, `/dk1` 80. Bing: `/prognose` 110, `/` 100. Direkte landing: `/prognose` 3.360, `/` 1.770, `/dk2/radius` 370 og `/dk1/n1` 370 (husket netselskab/bogmærke).

35 % interne henvisninger og 11 % genindlæsninger (`reload` 2.100 af 19.300) betyder, at mange kommer for at tjekke prisen igen.

### Søgning: hvad der kan og ikke kan siges

Seneste Search Console-eksport (13. okt., data 12. jul. – 11. okt.): 1.436 klik, 25.388 visninger, 8 % CTR, position ca. 7. Ugeklik 14-24 (juli), 57-78 (aug.), 347 (uge 28. sep.), 318 (uge 5. okt.). Top-forespørgsler: "elpriser prognose 7 dage" (864 visninger, 83 klik, pos. 5,9), "elafgift 2028" (467/64), "elpriser" (318/41). Forsiden: 6.184 visninger, CTR 2,6 %, position 17.

- **27. sep.-ændringerne og titelrettelserne 6./9./13. okt.:** i RUM er Google-henvisningerne flade omkring 480-540 pr. uge frem til uge 12. okt., så effekten ligger i 28. okt.-springet og ikke i oktober-ændringerne. Uden Search Console kan jeg ikke afgøre, om 28. okt.-springet skyldes `/prognose`-svarblokken (deployet 1. nov., kommer for sent), vintertid/prisinteresse efter 25. okt., AI-oversigtsplacering eller rangering. Tidspunktet (28.-29. okt.) peger ikke på nogen af vores egne ændringer.
- **Bing:** 290 henvisninger på fem uger (6 % af Googles), men Bingbot crawler mere end Googlebot (94 mod 86 pr. dag). Ingen Bing-data tilgængelig.
- **Zonesiderne** (`/no1`..`/nl`, uden hreflang siden 27. sep.): 13. okt. stadig 0-4 klik med positioner 18-52. Ingen nyere data.

## 7. Europa-siderne (lanceret 2. nov.)

Sitemap har nu 89 URL'er (79 med `lastmod` 2026-11-03), heraf 33 landesider i 27 sprog plus `/norden`. Alle svarer 200 med `index, follow`; forsiden og landesiderne linker indbyrdes (35 links fra en landeside).

Kanten, 2. nov. 00:00 til 3. nov. ca. 08:00 UTC (egen test trukket fra) mod seks dage før (27. okt. – 1. nov.):

| | 6 dage før | 1,3 døgn efter |
|---|---|---|
| Browser-forespørgsler | 169 (ca. 28/dag) | 185 (ca. 140/dag) |
| Bingbot | 68 | 37 |
| Googlebot | 24 | 2 |
| Andre søgecrawlere (Exa, Linkup, Awario, Yandex m.fl.) | 34 | 68 |
| AI-bots (Perplexity, OAI-SearchBot, Claude m.fl.) | 66 | 90 |

- Besøg 2.-3. nov. kommer fra Sverige (69), Holland (41), Tyskland (40) og Danmark (18). Hollandsk og tysk trafik er sandsynligvis for en stor del scrapere (RUM viser kun SE 70 og DK 10).
- RUM (rigtige indlæsninger, stikprøve) 2.-3. nov.: ca. 80 indlæsninger, fordelt `/sv/elpris` 40, `/at/strompreis` 20, `/it/prezzo-luce` 10, `/gb/electricity-price` 10. Henvisning: internt 60, Google 20.
- Før lanceringen hentede Google `/sv/elpris`, `/no/strompris`, `/norden`, `/fi`, `/nl` m.fl. 24 gange. Siden lanceringen er kun `/nl/stroomprijs` set hentet af Googlebot (2 gange); de øvrige nye URL'er er ikke set hentet endnu (stikprøve).
- Mest set: `/sv/elpris` (113 visninger på 4 uger), `/no/strompris` (93), `/norden` (38), `/fi/sahkon-hinta` (34), `/nl/stroomprijs` (22), `/gb/electricity-price` (19).
- **Indeksering og visninger kan ikke måles her** (hul 1). Forventning: de nye sider vil i de første uger stå som "Discovered - currently not indexed", ligesom de 17 sider i oktober.

## 8. Apps og butiks-klik

- **Klik fra sitet til butikkerne kan ikke måles** (hul 3). Stedfortrædere: `/download` har 113 menneske-visninger på 4 uger (0,7 %), og 22 % af besøgene er Android og 33 % iOS, så Play-banneret (live siden 2. nov. for Android på alle sider) og Apple-metatagget når ca. 55 % af trafikken. Footer-badges er først skiftet 3. nov.
- **App-trafik fra kanten** (unikke IP/dag, grov): Android 10-30 (20.-23. okt.) -> 58-82 (29. okt. – 2. nov.); iOS 25-40 -> 86-137. Springet begynder 29. okt. (butiksudgivelser), altså før badge-ændringen, og kan ikke tilskrives sitet. Appkald: Android 8.466 og iOS 8.894 på 14 dage; Android: 85 % DK / 13 % US (testenheder), iOS: 96 % DK / 3 % SE.
- **Versioner** (kun cache-misses, hul 8): Android 1.0 (111), 1.1.0 (5) (101), 1.0.3 (4) (10); iOS 1.0 (325), 1.1.0 (8) (25), 1.0.5 (7) (4). Europa-versionerne er altså kun lige begyndt at nå ud.
- `outbound_click` til `apps.apple.com` og `play.google.com` findes i GA4, men `link_text` bliver tom for badge-billeder. `link_url` er nok.

## 9. API og MCP

API-kald, 4. okt. – 2. nov. (kant, inklusive cachede): `/api/now` 1.220.840 (68 %), `/api/prices` 278.113, `/api/forecast` 138.696, `/api/schedule` 92.189, `/api/raw/*` ca. 24.000, `/api/nordic` 2.429, `/api/forecast/archive` 2.453, `/api/supplierlookup` 919, `/api/shelly/tariff` 552, `/api/openapi.json` 485. Unikke API-IP pr. dag: 619-1.192 (20. okt. – 1. nov.).

- Koncentration (6 dage, 385.000 kald, 4.443 IP): top 1 = 22,5 %, top 2 = 42,4 %, top 10 = 65 %, top 100 = 92 %. De to største er en Home Assistant (ca. 14.000 kald/dag, ét kald hver 6. sekund) og en Shelly Pro4PM (ca. 12.700-24.000/dag).
- Home Assistant er den største klient (743.000 forespørgsler; versionerne 2026.10.1 og 2026.10.4 er de mest brugte). Shelly: Pro3, Mini1G4, Pro4PM, S1G3, Pro2PM, Mini1PMG3.
- Tredjepartsklienter, der kalder `/api/forecast/archive` regelmæssigt: SpotWatch (ca. 1.180), elpris-prognose (ca. 320), elpris-familie (ca. 60). Andre navngivne tredjepartsklienter (thermia-*, janus-dashboard, evmrecorder, mining-dash, EvField, Inkplate) bruger API'et.
- **400-fejl:** 6.304 (0,32 %). `/api/prices` 5.178 (Home Assistant 2026.8.3 ca. 2.500 og 2026.7.4 ca. 1.200 pr. 27 dage), `/api/forecast` 800 (HA 2026.9.1 580, `elpriser-urltest` 140), `/api/flex/report` 123. Det ligner gamle, genererede HA-planer med en parameter, serveren nu afviser. Præcis årsag kan ikke ses (forespørgselsstreng skjult). I telemetrien (kun cache-misses) er 30 % af HA-kaldene 4xx, fordi 400 aldrig caches.
- **MCP:** `/mcp` er først deployet 3. nov.; 3 kald i dag (200), sandsynligvis egne tests. Før lanceringen ledte scannere efter MCP-filer 24. okt. (`/.well-known/mcp.json` m.fl.). npm: `elpriser-mcp` 26 downloads og `elpriser-client` 14 på 30 dage. UA `elpriser-mcp/1.0 (LM Studio MCP client)` ses 30 gange. **Der er ingen målt ekstern MCP-brug endnu, og `_usage.js` ville ikke tælle den.**

## 10. Cache, latens og fejl

- **Cache:** API-svar: 1,02 mio. hits, 644.000 dynamic (misses, tomme og ikke-cachebare). **HTML: 53 hits af ca. 107.000** (`cf-cache-status: DYNAMIC` også for sider med `s-maxage=300`). Alle HTML-sider er ca. 410 KB rå / 120 KB Brotli.
- **Latens** (mine egne målinger, 1-2 hver): HTML TTFB 140-315 ms, cachet `/api/now` 57-108 ms. RUM TTFB p75 290 ms (97 % "god"). Trægeste sider i RUM: `/dk2/cerius` 732 ms, `/dk1/nord-energi` 642 ms, `/dk2/radius` 423 ms (netselskabssider, tyndt trafik, kold rendering). Kant-TTFB og origin-tid er spærret.
- **Status, 4. okt. – 2. nov. (1,95 mio.):** 200: 93,3 %; 404: 1,92 % (37.533); 204: 1,74 % (RUM-beacon, 34.000); 301: 1,20 %; 304: 1,16 %; 400: 0,32 %; **522: 0,29 % (5.621)**; 403: 0,07 %; 500: 97; 503: 60.
- **522 er næsten udelukkende `www.elpriser.org`:** 4.730 forespørgsler på 27 dage (`/` 410, resten scannere som `/.git/config`, `/shel.php`), men også Meta-WebIndexer, Bytespider, Hunyuan, Qwen, Kimi, YouBot og AI-stikprøver. Apex-domænet har kun ca. 210 5xx (0,01 %): `/api/raw/prices` 500 (17. okt., curl, sandsynligvis egen test) og `/api/prices` 503 (upstream-timeouts).
- **404 (37.500):** ca. 98 % er scannerstøj (`.env`, `wp-*`, `*.php`, `.git`, repo-stier som `/scripts/forecast_model/...`, `/wrangler.toml`, `/DESIGN.md`, `/ElpriserAndroid/...`). Ægte og værd at rette:

| Sti | Antal (27 dage) | Bemærkning |
|---|---|---|
| `/apple-touch-icon-precomposed.png` (+ `-120x120`, `-240x240`, `*-precomposed`) | ca. 1.150 | iOS Safari/Chrome; `/apple-touch-icon.png` findes |
| `/.well-known/traffic-advice` | 309 | Chrome prefetch-proxy |
| `/.well-known/assetlinks.json` | 218 | GoogleAssociationService; Android-appen har ikke `autoVerify`, så ingen skade |
| `/app-ads.txt` | 69 | Google-adstxt-crawler; kun relevant hvis annoncer |
| `/blog/ukendt-indlaeg`, `/findes-ikke`, `/dk1/ukendt-net`, `/elpris/koebenhavn/x` | 119/87/49/53 | `elpriser-urltest` (egne 404-tests) |

- **301:** `/` 1.213 (http->https), `/dk1/`, `/blog/`, `/se1/` med skråstreg, og de sammenlagte blogindlæg (`/blog/biler-ladere-v2h-v2g` 87, `home-assistant-elpriser` 82, `shelly-elpris-automation` 79). Det er forventede redirects.
- 403 (1.439): Cloudflares managed rules blokerer scannere; ca. 224 på `/` fra Chrome-UA'er (FI, US, NL, IT).

## 11. Core Web Vitals (RUM, 30 dage, 16.800 målinger, p75)

| | LCP | INP | CLS | TTFB | God LCP |
|---|---|---|---|---|---|
| Alle | 0,48 s | 48 ms | 0 | 290 ms | 99,3 % |
| Mobil (11.400) | 0,47 s | 48 ms | 0 | 278 ms | 99 % |
| Desktop (5.100) | 0,48 s | 32 ms | 0,001 | 292 ms | 100 % |
| `/prognose` (7.300) | 0,52 s | 40 ms | 0 | 282 ms | 100 % |
| `/` (3.700) | 0,34 s | 48 ms | 0 | 205 ms | 100 % |
| `/automation` (500) | 0,31 s | 120 ms | **0,273** | 110 ms | 100 % |
| `/dk2/radius` (900) | 1,20 s | 32 ms | 0 | 423 ms | 100 % |

Enheder er omregnet fra mikrosekunder. Alle tre kernemetrikker er "gode" over hele linjen; undtagelsen er CLS på `/automation` (kodegeneratoren flytter layoutet). Intet at hente på LCP.

## 12. Rangeret forslagsliste

Ranglisten vejer sikkerhed og effekt mod indsats. "Effekt" angiver forventet størrelse; hvor jeg gætter, står det.

| # | Forslag | Forventet effekt | Indsats | Sådan måles det |
|---|---|---|---|---|
| 1 | **Ret `www.elpriser.org` (522).** Proxyet DNS-post for `www` og en Redirect Rule `www -> apex` (301, bevar sti). Cloudflare-konfiguration, ingen kode. | Fjerner ca. 4.700 fejlsvar pr. 27 dage (ca. 97 % af alle 5xx) og får crawlere (Meta, AI-bots, Bytespider) og eventuelle `www`-links til at ende på rigtig side. Backlinks mod `www` tæller ikke i dag. | 10-15 min | GraphQL: `clientRequestHTTPHost:"www.elpriser.org"` -> status 301; 5xx-andel under 0,02 % |
| 2 | **Gør søgning målbar:** ugentlig GSC-eksport (eller service-konto/API) og Bing Webmaster-eksport; bed om indeksering af de fem vigtigste Europa-sider (SE, NO, DE, NL, FI) og genindsend sitemap. Gem eksport i `docs/`. | Gør det muligt at afgøre, om 27. sep., 6.-13. okt., 1. nov. og Europa-lanceringen virker. 28. okt.-spring (x4 Google-trafik) er ellers uforklaret. | 1-2 timer (engangsgodkendelse fra ejer) | Data med højst 3 dages forsinkelse; sammenlign mod baseline 13. okt. |
| 3 | **Krydssalg på `/prognose`:** efter svarblokken en kort række "Få prognosen som sensor (Home Assistant/Shelly)", "i appen" og "din pris med netselskab". Siden har 39 % af visningerne og 87 % af Google-landingerne (ca. 1.500 Google-besøg om ugen). | Gæt: 3-5 % klik videre giver 45-75 ekstra besøg om ugen på `/automation`/`/download`; bedre fastholdelse (i dag 36 % direkte, 35 % internt). | 2-3 timer | RUM `refererPath = /prognose` mod `/download` og `/automation`; GA4 `nav_click`; andel sessioner med mere end én side |
| 4 | **Kampagneparametre på alle butikslinks:** Play `referrer=utm_source%3Delpriser.org%26utm_medium%3Dweb_footer` (og `web_download`, `web_banner` findes), App Store `?ct=web_footer`; en eksplicit GA4-hændelse `store_click` med butik og placering (`link_text` er tom for badges). | Ingen direkte effekt, men gør punkt 3 og banner/badge-skiftet evaluerbare. Android er 22 % af besøgene, iOS 33 %. | 1 time | Play Console "Acquisition by UTM", ASC App Analytics efter kampagne, GA4 `store_click` |
| 5 | **Ret telemetrien:** tæl klienter og versioner fra kanten (UA, nu hvor apps sender version) i `traffic.mjs`/`usage-report.mjs`, og behold Analytics Engine til script-tags. Tilføj `mcp` som endpoint i `_usage.js`. Ekskluder `elpriser-urltest` i rapporter. | Rigtige tal for Android/iOS/HA/Shelly og for MCP. I dag undertælles HA med faktor ca. 500. | 1-2 timer | Sum fra telemetri inden for 5 % af kant-UA-tal |
| 6 | **Begræns og vejled tunge pollere:** WAF rate-limit (fx over 30 kald/minut/IP på `/api/now` og `/api/prices`, svar 429 med `Retry-After` og link), dokumentér "priserne skifter hver hele time, poll højst hvert 60. sekund". | De to største IP-adresser er 42 % af API-kaldene; en grænse kan fjerne 35-40 % af kanttrafikken uden at ramme almindelige installationer. Beskytter mod en ny outlier som den tyske klient (17.600/dag) og gratisgrænserne (Functions 100.000/dag, Analytics Engine 100.000 skrivninger). | 1 time + overvågning | Topandel (mål under 20 % for top 2), forespørgsler/dag, antal 429 og eventuelle klager |
| 7 | **Find og ret HA-400'erne.** Hver 400 skal sige hvorfor (`error`, `param`, `hint`, link til /automation), og log parameternavnet (ikke værdien) i telemetrien. Overvej at acceptere gamle parametre. | Ca. 4.300 afviste kald pr. 27 dage fra HA 2026.7.4/2026.8.3 (`/api/prices`) og 2026.9.1 (`/api/forecast`): ødelagte automationer for nogle få brugere. | 1-2 timer | HA 4xx-rate (kant) fra 0,8 % til under 0,1 %; ny telemetriserie |
| 8 | **Ret `/automation` CLS (0,27):** reservér plads til generatorens output (min-højde/skeleton), flyt ikke indhold ved visning af koden. | Siden har 105 klik og CTR 4,6 %, og er indgangen for HA/Shelly-publikummet. Dårlig CLS er den eneste "røde" Web Vital. | 30-60 min | RUM CLS p75 under 0,1 for `/automation` |
| 9 | **Cache HTML på kanten** (Cache Rule for GET uden cookies, respekter origin-`s-maxage`, 60 s for `/`, `/dk1`, `/dk2`, 300-600 s for `/prognose` og landesider; purge ved deploy). | Kant-TTFB fra ca. 150-300 ms til under 60 ms; HTML-invokationer ned (ca. 4-6.000 pr. dag), stødpude ved spikes som 31. okt. og ved vækst; netselskabssider (TTFB p75 420-730 ms) mest. LCP er allerede god, så brugereffekten er lille. | 30 min + test af timeskift | `cf-cache-status` for HTML, RUM TTFB p75, invokationer/dag; kontrollér at prisen skifter på timen |
| 10 | **Servér touch-ikon-aliasser og `traffic-advice`:** `/apple-touch-icon-precomposed.png`, `-120x120*`, `-240x240*` som alias til `apple-touch-icon.png`; `/.well-known/traffic-advice` som tom 204/JSON. | Fjerner de eneste ægte 404'er (ca. 1.500 pr. 27 dage); sikrer korrekt ikon ved "Føj til hjemmeskærm" (iOS er 33 % af besøgene). | 15 min | 404-listen uden `apple-touch-*` |
| 11 | **Europa: prioritér og pas på indeksering.** Start med SE, NO, NL, DE, FI (størst tidlig interesse); tjek "Discovered - not indexed" efter 1-3 uger; sæt `lastmod` kun til faktisk ændrede sider (i dag 79 af 89 = 2026-11-03, hvilket svækker signalet); overvej bunden af funnelen (titel/beskrivelse pr. marked, når forespørgsler er kendt). | Undgår gentagelse af oktobers "Discovered - not indexed" på de 17 sider; fokuserer på de markeder, hvor der er trafik (SE 113, NO 93 visninger på 4 uger mod 1-3 for de øvrige 25). | 1 time + løbende | GSC Page indexing og Performance pr. land; RUM-landinger fra Google på `/xx/...` |
| 12 | **MCP: synlighed og måling.** Tilføj sitet til MCP-registre og -kataloger, forbind `server-card` fra `llms.txt`, og tæl `/mcp` anonymt (kun værktøjsnavn og klientnavn). | Ingen målt brug i dag (26 npm-downloads/måned); effekten er usikker, men uden måling kan den ikke vurderes. Lav pris. | 1-2 timer | Værktøjskald pr. dag og klient (efter punkt 5); npm-downloads |

Ikke foreslået, med begrundelse: `Disallow: /api/raw/` for Googlebot (ca. 20 % af dens hentninger, men kun ca. 15 om dagen, og AI-agenter har brug for API-stierne); WAF-regler mod scannerstier (37.000 404'er er billige og ufarlige, ca. 1.400 pr. dag); flere eksperimenter på `/elpris/<by>` (208 visninger på 4 uger giver ingen styrke); `assetlinks.json` (kun nyttig hvis Android-appen skal åbne web-links, hvilket kunne øge app-brugen, men det er en produktbeslutning).

## 13. Metode og genskabelse

Alle tal er trukket 2026-11-03 med den eksisterende analysetoken (`CLOUDFLARE_ANALYTICS_TOKEN`) og kontotokenet i `.env.deploy` (aldrig udskrevet). Genskab:

- Dagstal: `node scripts/usage-report.mjs 14` og GraphQL `httpRequests1dGroups`.
- Kant (32 dage): `httpRequestsAdaptiveGroups` pr. dag med dimensioner `userAgent verifiedBotCategory edgeResponseContentTypeName`, `clientRequestPath edgeResponseStatus cacheStatus` og `clientCountryName clientDeviceType`, filter `requestSource:"eyeball"`. Menneske-visninger: `edgeResponseContentTypeName:"html"`, `edgeResponseStatus:200`, `verifiedBotCategory:""` og `userAgentBrowser_in:[Chrome, ChromeMobile, MobileSafari, Safari, Edge, Firefox, SamsungInternet, Opera, ...]`.
- RUM: konto-`rumPageloadEventsAdaptiveGroups` og `rumWebVitalsEventsAdaptiveGroups` med `siteTag` for elpriser.org og `bot:0`.
- Funktioner: `pagesFunctionsInvocationsAdaptiveGroups`.
- Telemetri: `npm run clients -- 30`, `npm run kv:usage`, `node scripts/traffic.mjs apps 14`.
- Rå mellemresultater ligger kun i sessionens scratchpad og er ikke i repoet.

Det mangler til næste måling: Search Console-eksport (punkt 2), en kant-baseret klientrapport (punkt 5) og kampagneparametre på butikslinks (punkt 4). Med dem kan Europa-lanceringen og 28. okt.-springet måles ordentligt omkring 2026-11-17.
