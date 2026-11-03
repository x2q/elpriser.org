# Adding a country price page (and, if needed, a new language)

A country page (`/cz/ceny-elektriny`, `/ie/electricity-price`, …) is the canonical Pris screen drawn from
`/api/nordic?zone=<z>` in the page's own language: actual day-ahead prices, today and tomorrow, one period. When the zone's answer
also carries forecast days (elpriser.org's own model: `scripts/forecast_model/eu`, 25 of the EU zones), the SAME page draws the forecast
screen (`PRIS_EUF`: 2/5/7 days, the P10–P90 band, the accuracy line and the honest note) — **decided from the data at render time**
(`prisZoneCfg`), never from the zone's name, so a new country needs nothing for it: it shows the forecast as soon as the API serves one and
stays on settled prices while it does not. Everything lives in the **Pris block** — the text between `// ═══ Pris-skærmen (Design A: ét svar) ═══`
and `// ═══ /Pris-skærmen ═══` in `functions/[[path]].js`. **Edit it there**; `index.html` carries a byte-identical copy
that `node scripts/sync-pris-block.mjs` writes for you (the gate fails when they differ).

## What is where

| What | Where in the Pris block | One entry per |
|---|---|---|
| The words of the screen (weekdays, "now", "cheapest hour", …) | `PRIS_I18N[lang]` | **language** |
| The words of the chrome (footer, place dialog, country names) | `CHROME_I18N[lang]` | **language** |
| Everything about one page: path, zones, title, description, h1, note about the data, Wikidata item, locale | `PRIS_COUNTRIES['xx/slug']` | **page** |
| Name, currency, unit, source, clock of a price zone | `ZONES[key]` | **zone** |

Austria and Switzerland read the German tables and Belgium the Dutch and the French one, each saying its own country in its
`PRIS_COUNTRIES` entry (`tx`). **No language table may name a country** — that is why `h1`, `zonesH` and `note` are not in
`PRIS_I18N`.

Everything else follows from the page's entry and needs no edit: the SEO entry (title, description), the sitemap and its
priority, `data-page`, `og:locale`, the llms.txt bullet, the client router, the dev server's routes, `spatialCoverage`
(Wikidata item, `qid`) and the country links in the footer and place dialog of every page. The Danish pages' footer chips and
place dialog are plain HTML in `index.html`; **derive them, never hand-edit**: `node scripts/sync-danish-chrome.mjs`
(it also rewrites the Danish chrome fixture; the gate runs it with `--check`).

## A. A new page in a language that already has a table (de, nl, fr, en, cs, …)

1. Check that `/api/nordic?zone=<z>` serves the zone (`EU_ZONES_ENERGY_CHARTS` or `EU_ZONES_ENTSOE` in `functions/api/[[catchall]].js`)
   and note the timezone of the zone's days (`scripts/eu_prices/build_*_prices.py`).
2. Add the zone to `ZONES` (template below). `src` is `'ec'` (Energy-Charts: Bundesnetzagentur | SMARD.de, CC BY 4.0) or `'entsoe'`
   (ENTSO-E Transparency Platform), `'semopx'` (SEMOpx day-ahead results: Ireland) or `'elexon'` (Elexon BMRS Market Index Price, within-day: Great Britain)
   — the same job that writes the zone; a test checks it. `shift` is the hours from Copenhagen to the zone's own
   clock (Dublin and London −1, Athens +1, Lisbon −1; CET zones none) — the feed's days are the zone's local days.
   **Great Britain is the one page that is not a day-ahead price and not in euro**: `cur:'GBP',rate:1,sub:'p'` (the feed is already in pounds, `zoneInfo.rate` is 1), `last:1`
   (the current hour is never priced yet, so the hero shows the latest priced hour with its own time), and its `tx` overrides `now`, `fc`, `actual`, `cap`, `verdict` and says in `note` that
   the price is the within-day Market Index Price, not the day-ahead auction, with no tomorrow. Its credit is Elexon's licence sentence (`prisCredit('elexon')`).
3. Add the page to `PRIS_COUNTRIES` (template below), **appended at the end**. Look up the Wikidata item and check its English label
   (`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q…&props=labels&languages=en&format=json`, with a `User-Agent`).
   Title ≤ 62 and description 80–155 characters (a test checks), the description names the source.
4. `node scripts/sync-pris-block.mjs && node scripts/sync-danish-chrome.mjs`
5. Country names: the footer of other languages shows a country's own name until their `cn` has it (`prisCn`). Adding `cc:'…'` to every
   language's `cn` is optional and last: when several agents work in parallel, leave it for one consolidation pass.
6. Tests: **the four per-country test files read the table** (`PRIS_COUNTRIES`, `ZONES`, `PRIS_PICK`, `CHROME_I18N`, `PRIS_I18N`) and cover a new page without an edit:
   `test-static.js`, `test-forecast-chart.mjs`, the generic loop at the end of the actual-price section of `test-zone-pages.mjs` (and its sitemap, llms.txt and
   spatialCoverage blocks, which iterate the table; the clock of a zone comes from `ZONES[z].shift`), `test-urls.js` (live; pages, zones, language, unit, source) and
   `test-e2e.js` (Playwright, CI only: routes, stub zones, footer and place-dialog lists, the chrome of every page, the generic loop over the EUP rows, the clock test).
   **Pin the strings by hand** the way the existing pages are pinned (a second pair of eyes on the translation) — these are the only per-country edits:
   one row in `ACT` (+ `PRISNOTE`/`PRISCAP`/`CHANGED` rows per *language*, `PAGENOTE` for a page that names its own country in a shared language) in `test-zone-pages.mjs`,
   one row in `QID` there, one row per language in `WORDS` of `test-forecast-chart.mjs` (fc, cap, note, nodot), one row per language in `CHROME_WORDS` and one row in `EUP`
   in `test-e2e.js` (an `EUP` page without a row is still checked from its own entry). Names of the new country in the footer lists follow the language's `cn`
   (the e2e derives them with `prisCn`).
7. Bump the SSR cache keys when the shared markup changed (`ZONE_SSR_VERSION`, `CITY_SSR_VERSION`, `PROGNOSE_SSR_VERSION`,
   `homepage-ssr-vNN` in `functions/[[path]].js`; `test-static.js` pins them).
8. `npm run test:gate` and `TZ=UTC npx -y node@22 test-static.js` (CI runs UTC and Node 22).

```js
// ZONES — one line
  xx:{name:'XX',city:'<the country in the page language>',lang:'<language code>',cur:'EUR',rate:1,sub:'<ct|c€|cent|…>',src:'ec' /* or 'entsoe', 'semopx', 'elexon' */,shift:0 /* only if not CET */},

// PRIS_COUNTRIES — one entry, appended
  'xx/<slug>':{lang:'<language code>',cc:'xx',zones:['xx'],def:'xx',act:1,
    name:'<the country, in the page language>',da:'<the country in Danish>',loc:'<ll_CC>',qid:'Q…',
    title:'TODO <=62 characters',
    desc:'TODO 80-155 characters, ends with: Source: Bundesnetzagentur | SMARD.de   (or ENTSO-E)',
    tx:{h1:'TODO <Electricity price in X: today and tomorrow>',
      zonesH:'TODO <heading of the text block>',
      note:'TODO <hourly means of the 15-minute prices, calculated by elpriser.org (changed from the original data). Anything about THIS zone (e.g. prices in euro cent, not in <currency>). Source:>'}},
// optional in tx: cap (the caption under the price: say "in euro cent" where people expect another currency), chg (the footer's change note)
// optional beside tx: sub / city (a second page of the same zone in another language, as Belgium in French), pick (the dialog's label)
```

## B. A new language

Add **two entries** (they can be copied from `en` or `cs` and translated key by key; a test fails on a missing or empty key, a wrong shape,
a Danish word, a missing placeholder in the accuracy line or a word about gas, carbon or fuel). Then do A for the first page.

```js
// PRIS_I18N — the words of the screen
  xx:{wd:[7 weekdays, Sunday first],ws:[7 short],mon:[12 short months],dot:'.' /* the mark after a day number: "2. lis"; '' if none */, /* optional: mf:1 when the language writes the month first, "nov. 3." (Hungarian), month names with their own dot */
    hs:':00' /* optional: suffix after the hour — " Uhr", " h", ":00" */, hh:1 /* optional: the suffix after EACH hour of a range ("13:00–14:00") */,
    dec:'.' /* optional: only if the decimal mark is not a comma */,
    now:'…',hourly:'…',at:'' /* the word before the hour: "um", "at"; '' if the language has none */,today:'…',tomorrow:'…',evening:'… (tonight)',
    verdict:['cheap right now','average right now','expensive right now'],tier:['Cheap','Average','Expensive'],
    cheaper:'Cheaper' /* "Cheaper tomorrow 13:00 — 8,1 ct" */,cheapest24:'…',lo:'cheapest hour',hi:'most expensive hour',
    next:'…',p2:'2 days',p5:'5 days',p7:'7 days' /* the period buttons of a page with a forecast */,period:'…',fc:'<the language\'s word for forecast>',actual:'<day-ahead price>',
    byDay:'…',day:'…',range:'…',type:'…',none:'The prices could not be loaded right now.',
    cap:'<wholesale day-ahead price excluding VAT, taxes and network charges>',avg:'<avg.>',
    act1:'Today',act2:'Today and tomorrow',cheapRest:'Cheapest hour of the rest of the day',
    // the forecast texts (a page whose zone has a forecast): fcn the honest note, fcb the name of the P10–P90 band, fcl 'low confidence', and the accuracy line,
    // filled with MEASURED numbers from the answer's `accuracy`: {h} horizon (D+h), {mae} / {base} errors in EUR/MWh, {g} / {r} per cent (a loss has a minus), {c} the share of hours inside the band
    fcn:'<elpriser.org\'s own statistical model, not an official forecast; best at picking the cheapest hours, much less sure of the price level (no better than a simple method since September 2026); settled prices always replace it>',
    fcb:'<P10–P90 range>',fcl:'<Low confidence>',
    fca:'<Back-test, D+{h}: mean error {mae} EUR/MWh, {g} % lower than a simple method ({r} % since 1 Sept 2026).>',
    fcae:'<the same for the zones that quote EUR (EE, LV, LT): Back-test, D+{h}: mean error {mae} EUR/MWh (a simple method: {base} EUR/MWh).>',
    fcr:'<It ranks the cheapest hours {r} % better than a simple method.>',fcc:'<In the back-test {c} % of the hours fell inside the range.>',
    // the ESTIMATE of hours that have no price yet (Great Britain, Portugal, Ireland: functions/_estimate.js): est the label (legend, divider, tooltip), estn the honest note,
    // esta / esth the accuracy lines (rest of the day / the one missing hour), filled with measured numbers; {u} is the unit of the answer's accuracy ("GBP/MWh")
    est:'<Estimate>',estn:'<Hours marked Estimate are not published prices. They are elpriser.org\'s own statistical estimate ... replaced by the settled price as soon as it is published.>',
    esta:'<Back-test, rest of the day: mean error {mae} {u}, {g} % lower than a simple method ({r} % since 1 Sept 2026).>',
    esth:'<Back-test, the missing hour: mean error {mae} {u} (the last settled hour alone: {base} {u}).>'},

// CHROME_I18N — the words of the footer and the place dialog
  xx:{home:'elpriser.org <home page>',land:'Countries',place:'Where are you?',area:'Price zone',oth:'Other countries',back:'Back',find:'Search',none:'No results',close:'Close',
    cn:{dk:'…',no:'…',sv:'…',fi:'…',nl:'…',de:'…',fr:'…',pl:'…',it:'…',at:'…',ch:'…',be:'…',ie:'…',cz:'…' /* every country that has a page; one missing falls back to its own name */},
    privacy:'Privacy (in Danish)' /* the policy at /privatliv is Danish */,src:'Source:',and:'and',open:'Open datasets on',
    chg:'Changed: hourly means calculated by elpriser.org'},
```

Typography that is easy to get wrong: French wants a no-break space before `:` and `?` (` `); the hour is written the way the language writes a clock
time (a language whose preposition changes with the number — Czech v/ve — is better off without one: `at:''`); weekday and month names are
**lower case** unless the language capitalises them; `ws`/`mon` abbreviations are what a calendar in that language uses. `fc` is the language's word for
"forecast" and differs from `actual`. The forecast texts are the same in every language, short, and say the numbers are measured: never write "80 %" as a promise of
the band (its measured coverage is a number of the answer), and never mention gas, carbon or other fuel inputs (their licences are unconfirmed; they are model inputs only).
Nothing may say a currency other than the unit (prices are euro cent, with a note where the country uses another currency).

A new language also needs, in `test-forecast-chart.mjs`, ONE row in `WORDS` (`fc`: its word for "forecast", which `fc` of its table must contain; `cap`: the words the caption must carry,
`note`: the words of the change note; `nodot: 1` when its day mark is `''`, Romanian, Bulgarian, Greek, Lithuanian, Albanian: the check allows exactly one empty `dot` there; the
suite fails with the language's name when the row is missing), one row each in `PRISNOTE`, `PRISCAP` and `CHANGED` of `test-zone-pages.mjs`, and one row in `CHROME_WORDS` of
`test-e2e.js`. A zone on another clock than Copenhagen's needs only its `shift` in `ZONES`: the tests (`zoneToday`/`zoneHour` in `test-zone-pages.mjs`, `shiftOf` in `test-e2e.js`)
read it from there. The Pris font (`manrope.woff2`) has
Basic Latin and Latin-1 only: Latin Extended (Czech, Polish, Romanian), Cyrillic and Greek fall back to the system font, which is how the pages look today.

## B2. A zone with an estimate for hours that have no price yet (gb, pt, ie)

`ESTIMATE_ZONES` in `functions/_estimate.js` is the one list (the Spark job lists the same three in `scripts/forecast_model/gb/run_estimate.py`; `test-eu-forecast.mjs` pins that they agree).
A zone on it may have KV `eu-estimate-<zone>`; `/api/nordic` then adds a top-level `estimate` (the settled `days` are never changed) and the page draws those hours hatched,
labelled `est`, with the note `estn` and the measured accuracy (`estimate.accuracy`). A new zone needs the job that writes the key (docs/forecast-runbook.md, "The estimate job"), its backtest and nothing else here.

## C. Do not

- Do not translate a source or licence (`Bundesnetzagentur | SMARD.de`, `ENTSO-E Transparency Platform`, `CC BY 4.0`) and do not drop the change note: the licence
  requires saying that the hourly means are our change.
- Do not convert to a national currency, add a net company or a tariff: those are Danish-market features. Do not hand-write a forecast claim into a country's
  title, description or `tx`: they are static and must stay true for a zone that has no forecast; the screen and the text block add the forecast note themselves
  (`fcn`) when the answer has forecast days.
- Do not leave a `TODO` in the block (a test fails).
- Do not hand-edit the Danish footer chips, the Danish place dialog or the copy of the block in `index.html`.
- Merge conflicts in `PRIS_COUNTRIES`/`ZONES`/the language tables are append-only: keep both sides. For the two derived places, take either side and rerun the two scripts.

## D. The next markets (all EUR/MWh from `/api/nordic`; unit: the language's usual abbreviation for euro cent; days are the zone's local days)

| Zone | Country | Language | Source | Clock | Wikidata | Suggested path |
|---|---|---|---|---|---|---|
| `cz` | Czechia | cs | ec | CET | Q213 | `/cz/ceny-elektriny` — **done** |
| `hu` | Hungary | hu | ec | CET | Q28 | `/hu/aramar` |
| `si` | Slovenia | sl | ec | CET | Q215 | `/si/cena-elektrike` |
| `es` | Spain | es | entsoe | CET | Q29 | `/es/precio-luz` |
| `pt` | Portugal | pt | entsoe | −1 (23-hour days possible) | Q45 | `/pt/preco-eletricidade` |
| `sk` | Slovakia | sk | entsoe | CET | Q214 | `/sk/cena-elektriny` |
| `gr` | Greece | el | entsoe | +1 | Q41 | `/gr/timi-revmatos` — **done** |
| `ro` | Romania | ro | entsoe | +1 | Q218 | `/ro/pretul-energiei` — **done** |
| `bg` | Bulgaria | bg | entsoe | +1 | Q219 | `/bg/tsena-na-toka` — **done** |
| `hr` | Croatia | hr | entsoe | CET | Q224 | `/hr/cijena-struje` |
| `rs` | Serbia | sr (Latin or Cyrillic: decide first) | entsoe | CET | Q403 | `/rs/cena-struje` |
| `ee` `lv` `lt` | Estonia, Latvia, Lithuania | et, lv, lt | entsoe | +1 | Q191, Q211, Q37 | `/ee/elektri-hind`, `/lv/elektribas-cena`, `/lt/elektros-kaina` |
| `me` | Montenegro | sr-ME or sr | entsoe | CET | Q236 | `/me/cijena-struje` |
| `mk` | North Macedonia | mk | entsoe | CET | Q221 | `/mk/cena-na-struja` — **done** |
| `al` | Albania | sq | entsoe | CET | Q222 | `/al/cmimi-i-energjise` — **done** |
| `xk` | Kosovo | sq | entsoe (hourly, EIC 10Y1001C--00100H) | CET | Q1246 | `/xk/cmimi-i-rrymes` — **done** |
| `gb` | United Kingdom (Great Britain only) | en | elexon (within-day index, GBP, no tomorrow) | −1 (London) | Q145 | `/gb/electricity-price` — **done** |
| `it-cn` … | Italy's other zones | it | — | CET | Q38 | not served by `/api/nordic` yet (Energy-Charts allows internal use only for them): needs a data layer first |

Wikidata items verified against their English labels on 2026-11-02 (Czechia's English label there is still "Czech Republic"). The ENTSO-E re-use terms are
accepted by the owner; the page names the platform and says the hourly means are our change. Ireland's `ie` is the all-island SEM (Ireland **and** Northern
Ireland), read from the SEMOpx day-ahead results since 2026-11-02 (`build_semopx_prices.py`; it was ENTSO-E): see `_zone-location.js`, which also keeps `gb` out of Northern Ireland. Portugal (`pt`) runs on the same clock as Ireland and can have a day of 23 priced hours: an hour without a price is drawn as an empty bar
(`test-zone-pages.mjs` covers it for Ireland).
