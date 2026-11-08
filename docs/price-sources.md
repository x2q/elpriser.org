# Price sources: one order per zone, the first complete day wins

Written 2026-11-08 on branch `price-sources`. Nothing here is rolled out: the branch adds files, it changes no existing job. The rollout is at the end.

## What it does

`scripts/eu_prices/build_prices.py` (the network and the KV), `price_sources.py` (the rules, pure) and `omie_parse.py` (OMIE's file) give each of 25 EU zones an **ordered list of sources** and publish, **per delivery day**, the first source that has the day **complete**. Yesterday may come from ENTSO-E and tomorrow from Energy-Charts; a source that lags, is down or has a hole never makes a zone's day disappear.

| Rule | How |
|---|---|
| Complete day | every 15-minute cell of the zone's local day that the market has published by now has a price from that source: 24 hours (23 / 25 on the DST days). "Published by now" = the end of tomorrow's CET market day, so Portugal's tomorrow (Lisbon is an hour behind CET) is complete with 23 hours, exactly as before. |
| Never a partial day | a day with a missing or null cell is skipped for that source and the next source is tried. A day no source has complete is not published. `--allow-partial` (off) restores the old jobs' rule (publish the best day with at least 12 priced hours). |
| Outage never deletes a day | a day the site already has, complete, stays until a source delivers it again (stored days keep their 15-minute rows too). |
| Source recorded | each day in `eu-prices-<zone>` carries `source`: `entsoe`, `energy-charts` or `omie`. The Worker passes it through untouched (`test-api.mjs`); the JSON shape is otherwise the one it read before (`zone`, `generated`, `trainedThrough`, `unit`, `days[{date,type,source,prices}]`). `eu-slots-<zone>` is unchanged in shape and comes from the same source as its day. |
| Disagreements | where two sources both have a cell, a difference over 0.01 EUR/MWh is logged as `DIFF <date> hHH <max diff> (a vs b)`. Never fatal, never changes what is published. A normal run asks the later sources only for days that are missing; `--crosscheck` asks them for everything. |
| Rate limits | Energy-Charts (2 requests a minute per IP) is asked only for days an earlier source did not deliver, and for "only tomorrow is missing" not before 13:45 CET (the auction result is not out earlier). ENTSO-E 2 s apart, OMIE 1 s apart, one request per OMIE market day per run for Spain and Portugal together. |
| Failure isolation | one source failing is logged as `<source> FAILED (<type>: <message>)` (never the URL: it carries the token) and the zone is served by the next one; one zone failing never stops the others; the job exits 0 (2 = missing configuration). |

## The order per zone

| Zone | Sources, in order | Before: first run that had tomorrow (log, UTC, 2026-11-03..07) | After |
|---|---|---|---|
| de at be cz pl si | ENTSO-E, Energy-Charts | 14:00 (Energy-Charts job, cron 11:30 / 14:00) | first poll after ENTSO-E publishes (see "Gain") |
| fr hu | ENTSO-E, Energy-Charts | 14:00, on 1 of 5 days 16:00 (Energy-Charts late) | same |
| it-n | ENTSO-E, Energy-Charts | 16:00 on every day (Energy-Charts late; the ENTSO-E timing is not logged) | first poll after the earlier of the two |
| ch | Energy-Charts, ENTSO-E | 11:30 (Switzerland clears at ~11:00 CET, before the coupled auction) | unchanged order: no log shows ENTSO-E earlier for CH |
| es pt | ENTSO-E, OMIE | 14:15 (ENTSO-E job, cron 11:45 / 14:15) | first poll after the earlier of ENTSO-E and OMIE |
| sk gr ro bg hr ee lv lt al xk | ENTSO-E | 14:15 (gr hr ro sk: 16:15 on 1-2 of 5 days) | first poll after ENTSO-E publishes |
| rs me mk | ENTSO-E | 11:45 (their own earlier auctions) | first poll after ENTSO-E publishes |
| gb, ie | unchanged (Elexon, SEMOpx) | | |
| nl, dk1 dk2 no1-no5 se1-se4 fi | unchanged (build_entsoe_prices.py: `nl` overlay, Nordic 15-minute slots; hourly prices come from the Nordic forecast job) | | |

Why this order. Energy-Charts' day-ahead prices are the same auction results and Energy-Charts has been the slower source: on Sunday 2026-11-08 it had Monday's prices for DE, AT and IT-North not yet at 11:30 UTC, while ENTSO-E had DE, AT, FR, BE, NL, PL, CZ, HU, SI, CH, ES and PT at 13:29 UTC and Energy-Charts had DE and AT at 13:31 UTC. So ENTSO-E goes first, Energy-Charts is the fallback (and the cross-check). Both OMIE and ENTSO-E carry Spain and Portugal: OMIE is the market operator itself, so it is the fallback and the cross-check there. **If the measurement below shows OMIE earlier than ENTSO-E, swap the two in `CHAINS`** (the test pins the table, so also change `ZONES.es.src`/`pt.src` in `functions/[[path]].js` and run `node scripts/sync-pris-block.mjs`).

## Gain: when tomorrow's price appears

What is **measured**: with the old cron times the site first had tomorrow at the first run after publication, 14:00 UTC for the Energy-Charts zones and 14:15 UTC for the ENTSO-E ones (table above). The auction result itself is out at **12:01 UTC (13:01 CET) on 2026-11-08** for DE-LU, AT, FR, BE, NL and PL and at 12:03 UTC for the Nordic and Baltic zones (Nord Pool's `updatedAt`, read by hand, a handful of requests, 2026-11-08). ENTSO-E had every one of those zones at 13:29 UTC, i.e. within 88 minutes of the result, and the site got it at 14:00-14:15.

What is **not measured yet**: the minute ENTSO-E (and OMIE, Energy-Charts) first carry the day. ENTSO-E's A44 answer has no publication time, so it can only be read by polling. `scripts/eu_prices/measure_first_seen.py` does that: it asks ENTSO-E (15 zones), OMIE (es, pt) and Energy-Charts (de, it-n, ch) every 5 minutes from 10:30 to 15:30 UTC and writes the first time each source had tomorrow complete. It was started on the Spark in the staging directory on 2026-11-08 and runs until 2026-11-10 00:00 UTC (`~/elpriser-eu-sources/first_seen.jsonl`; read it with `python3 measure_first_seen.py --report first_seen.jsonl`; stop it with `pkill -f measure_first_seen`). A pair that was already there when the poller started is marked `<=` (an upper bound).

So the **gain** is: old first-seen (14:00 / 14:15 UTC, 16:00 for it-n, fr, hu on late days) minus the first poll after the source publishes. With ENTSO-E at 12:05-12:40 UTC (to be confirmed by the poller) and a poll every 10 minutes it is **about 1.5 to 2 hours** for every zone above, and about 3.5 hours for it-n on its late days. The cadence is the lever: the old jobs ran at 11:30 and 14:00 UTC, nothing between.

What the visitor sees is later than the KV write by the Worker's caches, which this branch does not change: `kvJson(..., { ttl: 900 })` caches a KV value 15 minutes at the edge and `/api/nordic` answers `max-age=1800, s-maxage=1800`, so a price written at 12:10 UTC can take up to 15 + 30 minutes to reach a browser (the rendered country pages have their own cache key, `zone-ssr-v*`, whose lifetime I did not measure). The gain in the KV is therefore larger than the gain on a page; shortening those TTLs on the days before ~13:30 CET is the next lever and is not part of this change.

## Evaluation of the sources (2026-11-08)

### ENTSO-E Transparency Platform (primary for all 25 zones)
* URL `https://web-api.tp.entsoe.eu/api?documentType=A44&in_Domain=<EIC>&out_Domain=<EIC>&periodStart=..&periodEnd=..`, XML, security token (the Spark's, in `~/.config/elpriser.env`, never printed).
* EIC codes, all answered with day-ahead A01 prices in EUR/MWh: DE-LU `10Y1001A1001A82H`, AT `10YAT-APG------L`, FR `10YFR-RTE------C`, BE `10YBE----------2`, NL `10YNL----------L`, PL `10YPL-AREA-----S`, CZ `10YCZ-CEPS-----N`, HU `10YHU-MAVIR----U`, SI `10YSI-ELES-----O`, CH `10YCH-SWISSGRIDZ`, IT-North `10Y1001A1001A73I`, ES `10YES-REE------0`, PT `10YPT-REN------W` (plus the 15 already in `build_entsoe_prices.py`).
* Resolution: PT15M for every one of these zones (checked 2026-11-08); the existing parser (`entsoe_parse.py`) expands A03 blocks and reads PT15M / PT30M / PT60M, and Spain's A07 intraday series is ignored.
* Update time: tomorrow's day appears in the hour after the result (12:01 UTC); exact minute: see the poller. IT-North did not have 2026-11-09 yet at 13:31 UTC (its auction results come later).
* Terms: the Transparency Platform's re-use terms for A44 were **not** settled when `entsoe_parse.py` was written and I could not verify them either (the knowledge-base page "List of data available for free re-use" answers HTTP 400 to a plain request, and ENTSO-E's public pages do not state a licence). The site credits "ENTSO-E Transparency Platform" and says the hourly means are its own change. **Needs the owner**: a yes or no from ENTSO-E (transparency@entsoe.eu) on re-use of A44 on a public site.
* Reliability: one real hole seen: on 2026-11-08 the Latvian response lacked the whole market day 2026-11-07 (see "Partial days").

### OMIE (Spain, Portugal: fallback and cross-check)
* URL `https://www.omie.es/en/file-download?parents=marginalpdbc&filename=marginalpdbc_YYYYMMDD.1` (the site answers 302 to the unbracketed `parents=`, then 200 `application/octet-stream`; 404 while not published). No key, no cookie needed. Plain text: `year;month;day;period;price PT;price ES;`, EUR/MWh, 96 quarter-hour periods (92 / 100 on the DST days, 24 hourly rows before October 2025; verified on real files, fixtures `omie_marginalpdbc_*.txt`).
* Update time: `2026-11-09` was there at 13:34 UTC on 2026-11-08; the minute is in the poller's result.
* Cross-check against ENTSO-E on 2026-11-08: 288 of 288 cells for ES and 288 of 288 for PT equal (max difference 0.0).
* Terms (https://www.omie.es/en/legal-warning, read in full): the public information "can be used freely, provided that its original content is fully respected"; "if used in its original format, you must cite the source"; information is for informative purposes. The site cites OMIE (`prisCredit`) and says its hourly means are its own change. Hourly means are a change of the "original content": the same position as for the other sources, flagged for the owner, not a blocker for a fallback.
* Reliability: unverified over time (one day's observation); the file has a version suffix `.1`, a re-issued file (`.2`) is not read.

### Nord Pool (not used)
* Technically open: `https://dataportal-api.nordpoolgroup.com/api/DayAheadPrices?date=YYYY-MM-DD&market=DayAhead&deliveryArea=<AREA>&currency=EUR` answers JSON with no credentials (GER = DE-LU, AT, FR, BE, NL, PL, EE, LV, LT, FI, SE1-4, NO1-5, DK1-2, BG; 204 for the other zones: HU, CZ, SK, SI, HR, GR, RO, ES, PT, IT, CH, DE-LU by that name). 15-minute prices, and `updatedAt` gives the publication time (12:01:00 UTC for GER/AT/FR/BE/NL/PL on 2026-11-08).
* Terms: Nord Pool's website terms (https://nordpoolgroup.com/en/About-us/terms-and-conditions-for-useofwebsite/) allow download "for use in connection with trading" and for the firm's own analysis, forbid to "republish, retransmit, redistribute", and say "Nord Pool does not permit automatic extraction of data". Its market-data pages (https://www.nordpoolgroup.com/en/services/power-market-data-services/day-ahead-market-data/) sell redistribution licences from about EUR 3,500 to 5,500 a year plus API subscriptions. **Not a source**: a public site that republishes the prices is redistribution and a job that polls it is automatic extraction. I made about 30 single requests by hand to measure the publication time and the area list; nothing polls it. **Owner**: only a Nord Pool data licence (redistribution) would open it; the measured gain would be at most the ~35 minutes between the auction (12:01 UTC) and ENTSO-E, so it is not worth the fee on this evidence.

### Energy-Charts (fallback; first source for CH)
* `https://api.energy-charts.info/price?bzn=<zone>&start=&end=`, JSON, no key, 2 requests a minute per IP, CC BY 4.0 "from Bundesnetzagentur | SMARD.de" for the 10 zones of `build_eu_prices.py` (its other zones are internal-use-only and are not used). Unchanged otherwise.

### EPEX
Not used, not read, not named in code (owner's rule; `test-eu-prices.mjs` fails if a source file mentions it).

## Attribution

Changed in this branch (every source in a zone's list is credited, because a day can come from any of them and says which in `source`):
* `functions/[[path]].js` (the Pris block, copied to `index.html` by `scripts/sync-pris-block.mjs`): `ZONES[z].src` is now a `+`-joined list in the job's order (`entsoe+ec`, `ec+entsoe` for CH, `entsoe+omie`); `prisCredit()` writes each source's credit (ENTSO-E Transparency Platform; Bundesnetzagentur | SMARD.de (Energy-Charts.info), CC BY 4.0; OMIE) joined by `, ` in the footer and the text block of the 14 country pages; the 14 page descriptions name the sources; the llms.txt "Kilde" sentence lists ENTSO-E for all zones, Energy-Charts / OMIE as second source, SEMOpx and Elexon as before.
* `functions/api/[[catchall]].js`: the OpenAPI text of `/api/nordic` (sources in order, `days[].source`, OMIE) and of `/api/slots`, and the comment on the zone lists.
* Tests pinned: `test-static.js`, `test-forecast-chart.mjs`, `test-zone-pages.mjs`, `test-eu-prices.mjs` (the Python table against the Worker's lists and credits, EPEX / Nord Pool absent), `test-api.mjs` (`source` reaches the answer), `test-e2e.js`, `test-urls.js` (browser and live suites: syntax checked, not run).

**Not changed, to do at the next release / publication** (listed, as asked):
* App strings `about_sources_eu` in `i18n/strings/*.json` (26 languages) and the Android `values*/strings.xml` / iOS equivalents: "ENTSO-E Transparency Platform and Energy-Charts.info (...)" does not name OMIE.
* `docs/store/*.md`, `ElpriserAndroid/store/*` listings and `functions/_download_i18n.js` notes: "ENTSO-E, Energi Data Service" is still true; no OMIE.
* `scripts/forecast_model/hf/DATA_LICENCES.md` line 14 (Energy-Charts / SMARD: "Only the elpriser.org price pages (DE, FR, PL, IT-N, AT, BE, CH, CZ, HU, SI)") and the HF model cards written from it (`scripts/forecast_model/hf/`, `card_tables.py`): the price pages' source is now ENTSO-E first; add an OMIE row (ES, PT price pages; not a training input) and say that ENTSO-E and Energy-Charts both feed these pages. That directory belongs to the forecast agent and was not touched.
* (done) `docs/add-a-country.md` now describes `src` as a source list.
* `privacy.html`, `privatliv.html` already name ENTSO-E generally ("and other public sources"); no change needed.

## Staging results (the Spark, `~/elpriser-eu-sources`, nothing written to KV)

`build_prices.py --compare` reads the live KV (GET only) and prints how the would-be payload differs. Run 2026-11-08 13:46 UTC, 24 zones (all but it-n, which waited for the Energy-Charts rate window; the live KV then still had the Energy-Charts job's 11:30 UTC state):

* **Identical** to the live KV for every overlapping day of every zone, where the same source delivers (de, at, fr, be, pl, cz, hu, si, es, sk, gr, ro, bg, hr, rs, ee, lt, me, mk, al, xk: yesterday and today; ch from Energy-Charts: all three days).
* **New days the site did not have yet** (the gain, live): 2026-11-09 for de, at, fr, be, pl, cz, hu, si, es, pt, sk, gr, ro, bg, hr, ee, lt, al, xk, lv, from ENTSO-E at 13:46 UTC; the site got de at 14:00 UTC (Energy-Charts job) and the ENTSO-E zones at 14:15.
* **pt, today**: hour 23 (stored: null) is now priced, because the 2026-11-09 market day is out and its first hour is Lisbon's hour 23 of the 8th. An improvement, not a difference of the source.
* **lv**: ENTSO-E's response lacks the whole market day 2026-11-07 (and with it the first hour of the 8th). The live KV today has a partial 8th (23 hours) from the old job; with the strict rule the 7th and the 8th are **not published**, only the 9th. This is the one place where "never a partial day" removes something the site shows today. A single-source zone has nothing to fall back on. **Decision for the owner**: run with `--allow-partial` (the old behaviour for such a day), or accept a gap until ENTSO-E repairs it.
* **OMIE vs ENTSO-E** (es, pt, `--crosscheck`): no DIFF line; 288 / 288 cells equal for each.
* **Energy-Charts vs ENTSO-E** (`--compare --crosscheck`, 14:05-14:11 UTC, the 10 Energy-Charts zones de at fr be pl cz hu si it-n ch): **no DIFF line**: every 15-minute cell both sources had was equal to the cent (0.01 EUR/MWh tolerance), for yesterday, today and (de, at, fr, be, pl, cz, hu, si, ch) tomorrow. Against the live KV (written by the 14:00 Energy-Charts job a few minutes earlier) all three days of all ten zones were `identical`, except it-n: tomorrow `NEW (entsoe)`, ENTSO-E had IT-North's 2026-11-09 at 14:10 UTC, Energy-Charts did not at 14:02 (no order of publication can be read from two points in time).

## Partial days: what the rule did and does not

The old jobs published a day with at least 12 priced hours. The new rule publishes a day only when every published cell is priced. Cases seen on 2026-11-08: Latvia (above); Portugal's 23-hour tomorrow stays (the 24th cell is not published yet by construction). Nothing in the Worker needs a complete day; the page and the apps already show a missing hour as empty, so `--allow-partial` is safe if the owner prefers it.

## Rollout (owner or lead, after review; nothing below has been done)

Everything is additive: the old scripts are not edited. Order matters: Worker first, job second.

1. **Deploy the Worker** from the merged branch (`npm run deploy`: the gate runs first). The credit lines then name ENTSO-E first on 14 pages; harmless before the job changes. `source` on days is optional for every consumer.
2. **Back up** on the Spark:
   ```
   ssh cc@spark-9e9f.tail27c98.ts.net
   cd ~ && crontab -l > crontab.bak-$(date +%Y%m%d)
   cp -a elpriser-eu elpriser-eu/bak-$(date +%Y%m%d)-sources     # the old dir already holds bak-* copies; this one keeps the current scripts
   ```
3. **Copy the new files** (new names only, nothing existing is overwritten) from the merged repo, `scripts/eu_prices/`: `price_sources.py omie_parse.py build_prices.py measure_first_seen.py` into `~/elpriser-eu/`. Run the tests there: `python3 test_price_sources.py` needs `test_price_sources.py` and `fixtures/` copied too (optional).
4. **Dry run against the live KV** (reads KV, writes nothing; takes ~1 minute without Energy-Charts, ~7 with `--crosscheck`):
   ```
   cd ~/elpriser-eu && set -a && . ~/.config/elpriser.env && set +a
   python3 build_prices.py --compare
   python3 build_prices.py --compare --crosscheck --zones de,fr,at      # after 14:25 UTC, not while the Energy-Charts cron runs
   ```
   Expect `identical` for every day the same source delivers, `NEW (entsoe)` for days the site lacks, and no `DIFF` lines (or look at each one).
5. **Enable.** In `crontab -e`:
   * comment out the six `build_eu_prices.py` lines (`30 11`, `0 14`, `0 16,18,22`);
   * change the four `build_entsoe_prices.py` all-zone lines (`45 11`, `15 14`, `15 16,18,22`) to the zones this job keeps (it must NOT write the 15 EU zones too, or two jobs overwrite each other's `eu-prices-<zone>`):
     `... python3 build_entsoe_prices.py --zones nl,dk1,dk2,no1,no2,no3,no4,no5,se1,se2,se3,se4,fi >> entsoe_prices.log 2>&1`
     (the `5,35 12-16 * * *  ... --zones nl` line stays as it is);
   * add:
     ```
     # elpriser.org: day-ahead prices for 25 zones, first complete source per day (build_prices.py, docs/price-sources.md)
     */10 10-15 * * *  cd ~/elpriser-eu && python3 build_prices.py >> prices.log 2>&1
     0 16,18,22 * * *  cd ~/elpriser-eu && python3 build_prices.py >> prices.log 2>&1
     20 16 * * *       cd ~/elpriser-eu && python3 build_prices.py --crosscheck >> prices.log 2>&1
     ```
     The `*/10 10-15` window polls ENTSO-E (and OMIE) every ten minutes through the publication hour in both summer and winter time; Energy-Charts is asked only as a fallback after 13:45 CET. The 16:20 run is the daily cross-check against the second source (about 7 minutes; Energy-Charts' rate limit is why it is a separate, single run). The 16:00 and 16:20 runs must not overlap: the 16:00 run takes about a minute.
6. **Verify** the same day: `tail -n 40 ~/elpriser-eu/prices.log` (zones `OK`, `source` per day, `DIFF` lines); `curl -s 'https://elpriser.org/api/nordic?zone=de' | python3 -c "import json,sys; print([(d['date'], d.get('source')) for d in json.load(sys.stdin)['days']])"`; open `/de/strompreis` and check the footer credit names ENTSO-E and Bundesnetzagentur | SMARD.de; the next afternoon read `first_seen.jsonl` for the measured gain.
7. **Rollback**: `crontab ~/crontab.bak-<date>` (the old lines are back byte for byte); the next old run rewrites `eu-prices-<zone>` without `source`, which every consumer accepts. Nothing in KV needs deleting; the Worker change can stay (it credits sources that are still in use). To pause only the new job: comment its three lines and uncomment the old ones.

## Not verified

* The minute each source first carries tomorrow (poller running, result in `first_seen.jsonl`), hence the size of the gain in hours is an expectation, not a measurement.
* ENTSO-E's re-use terms for A44 (above), OMIE's behaviour over weeks, whether OMIE ever re-issues a file as `.2`.
* The Saturday case in `docs/forecast-runbook.md` (ENTSO-E holding "today + 2" for DE and AT): on Sunday 2026-11-08 ENTSO-E had no today + 2 for DE, AT, FR, NL or ES. The layer asks for yesterday to tomorrow only, as before, so that case does not change here; the forecast job handles it.
* `test-e2e.js` and `test-urls.js` (browser, live) were edited for the new credit format and syntax-checked, not run.
