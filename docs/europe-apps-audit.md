# Europe audit of the Android and iOS apps

State audited: Android 1.0.3 (versionCode 4) and iOS 1.0.5 (build 7) at commit `cd1a789`, before the Europe work.
Goal: both apps usable in every EU / EEA / European country that elpriser.org has a spot price for, in the language of the user.

## 1. What the apps were

| | Android (`ElpriserAndroid/`) | iOS (`ElpriserIOS/`) |
|---|---|---|
| UI | Compose, two tabs (Pris, Smart hjem), a place sheet "Hvor er du?", Settings | SwiftUI, same screens |
| Languages | da (default), nb, sv, fi, nl in `res/values*/strings.xml`; per-app language picker (`locale_config.xml`) | none: Danish literals in the Swift sources |
| Data | `/api/forecast?area=DK1\|DK2&mode=…&gln=…`, `/api/raw/co2`, `/api/supplierlookup` | the same |
| Widgets, notifications, background work | none | none |
| Telemetry | User-Agent `ElpriserAndroid/<version> (<build>)` only | the same with `ElpriserIOS/…` |

No widget, notification, Live Activity or background fetch exists in either app, so there is nothing to localise there.

## 2. User-visible strings

* **Android**: already externalised (137 keys, of which 2 plurals and 3 arrays) and covered by `test-android-strings.mjs`, which also fails on any new hard-coded literal in the Kotlin sources. Gaps: the default resource set was Danish (a Japanese or Greek device got Danish), `fmt()` hard-wired the Danish decimal comma, and units ("kr/kWh", "kr") were embedded in 6 sentences.
* **iOS**: no localisation at all. About 130 Danish literals in `Sources/*.swift`, many built inside pure logic functions (`PrisLogic.swift`: `heroSentence`, `prisExtremes`, `breakdownOf`, `tierLabel`, `priceCaption`, `netChipLabel`, …), plus weekday and month tables in `Theme.swift`, the location permission text in `project.yml` (`NSLocationWhenInUseUsageDescription`) and accessibility labels ("Udvidet", "Skjult", "Prisvisning", "Periode" …). Unit tests (`PrisLogicTests` 21, `BreakdownTests`, `PlaceLogicTests`) pin the Danish wording.
* **Both**: the three device names in the Home Assistant / Shelly JSON export (`varmepumpe`, `elbil`, `vandvarmer`) are a data format and deliberately stay Danish so an automation does not break when the language changes.

## 3. Danish assumptions

| Area | Where | Assumption | Europe change |
|---|---|---|---|
| Price source | `Api.forecast`, `AppViewModel.refresh` | only `area` DK1/DK2; `mode` strings for Danish taxes (`net_inkl_alt`, `inkl_alt`, `spot_inkl`, `spot_ex`) | zone model: `dk1`/`dk2` keep `/api/forecast`; every other zone uses `/api/nordic?zone=<z>` (EUR/MWh, actual prices, forecast for NO/SE/FI/NL) |
| Time zone | `Clock` (`Europe/Copenhagen`) in `Models.kt` / `Models.swift` | "today" and "now" in Danish time | the zone's own wall clock (zone table carries an IANA time zone; Finland, Baltics, Greece, Romania, Bulgaria are +1 h, Portugal and Ireland −1 h) |
| Net companies | `Nets` list (31 companies), `place*` UI, GLN | Danish grid companies, GLN, Green Power Denmark names | kept, but only offered when the zone is Danish; elsewhere "no net company / tariff" |
| Location lookup | `Api.lookup` → `/api/supplierlookup` (Nominatim + Green Power Denmark) | returns `outside_denmark` abroad | kept, offered only under Denmark; the country comes from the device region or a list, not from the position |
| Currency and units | `unit_price` "kr/kWh", `value_ore`, `unit_kr` | Danish krone, øre | other zones show the zone's sub-unit per kWh (cent, øre, öre, grosz) converted at the ECB rate in `zoneInfo`; savings in the currency, formatted by the platform |
| Tax breakdown | `breakdownOf`, `BreakdownUi.kt`, `BreakdownView.swift` | Energinet tariffs, elafgift, 25 % moms | not shown outside Denmark: spot price only, said in a caption |
| Number format | `fmt()` (Kotlin), `fmt()` (Swift) | decimal comma, no grouping | the user's locale (decimal separator and minus sign) |
| Date and hour | arrays `weekdays_*`, `months_short`, `date_*` strings, `kl.` | Danish names, "17. okt", "kl. 19" | per-language arrays and templates; hour as a number plus a localised word or `:00` |
| Plurals | `devices_active`, `hours_count` | one/other | CLDR categories per language (pl, cs, sk, lt, lv, ro, sl, hr, sr need more) |
| Chart axis | `axisFor` / `priceAxis`: whole kroner | prices around 0–5 kr | unit-aware axis (0–40 ct) |
| Default language | `values/` Danish; iOS development region da | unknown device language gets Danish | English fallback on both platforms; Danish is `values-da` / `da` |
| Country selection | none (the "Andre lande" row opened elpriser.org/norden) | Denmark is the only country | country list (30 countries, 38 zones), default from the device region and language |
| Store text | `ElpriserAndroid/store/listing-*.md`, `ElpriserIOS/store/listing-da.md` | "kun Danmark", "kroner" | per-language listing in `docs/store/` |
| Privacy text | `privatliv.html`, ASC/Play declarations | Danish only; location "indsamlet+delt til OSM" for the net lookup | unchanged data flows (see `docs/store/europe-release-checklist.md`), but the policy is Danish only: owner decision |
| Telemetry | User-Agent version count | already pan-European | unchanged; the zone is not sent beyond the API query |
| Accessibility | `supportsRtl=false` | LTR only | correct for all target languages (none is RTL) |
| Test data | `Locale("da","DK")` in `TestStrings.kt`; `Clock.calendar.locale = da_DK` | Danish formatting in tests and calendar | tests set the locale explicitly |

## 4. What stays Danish on purpose

* Danish grid-company names, GLN numbers and the matching strings (proper nouns, pinned by `tests/golden`).
* "Energinet", "Nord Pool", "Energi Data Service", "ENTSO-E", "Hugging Face", "Home Assistant", "Shelly", "elpriser.org".
* The privacy policy page (Danish).

## 5. Data sources, attribution

Prices outside Denmark: Energy-Charts.info (Bundesnetzagentur | SMARD.de, **CC BY 4.0**, changed: hourly means) for AT BE CH CZ DE FR HU IT-North PL SI, ENTSO-E Transparency Platform for the rest. The about card shows the attribution whenever the selected zone is not Danish (`about_sources_eu`).

## 6. Result of the Europe work (this branch)

* One text catalogue (`i18n/`) generates the Android resources and the iOS String Catalog; 26 languages (da en de fr nl it pl sv nb fi cs hu sl es pt sk el ro bg hr sr et lv lt mk sq, Serbian also in Latin; nn/no fall back to nb). Tier 1 (the first ten) is enforced complete by `test-i18n.mjs`; the other 16 are complete too but unreviewed by native speakers (`i18n/review/`); mk and sq are low confidence.
* English is the fallback language on both platforms (Android `values/`, iOS development language).
* 38 price zones in 30 countries in both apps from one contract (`tests/golden/zones.mjs`, checked against the API, the web and both apps' tables). Zone prices come from `/api/nordic`; Denmark keeps `/api/forecast` and the net-company flow, unchanged.
* Tests: Android 109 JVM tests, iOS 153 XCTest cases, root gate green. Not covered: a real device or emulator run of the location lookup, VoiceOver/TalkBack output in the new languages, tablets/landscape outside what was looked at.
* Store: `docs/store/` has the listing of every language and `europe-release-checklist.md` with the countries and the manual steps. Nothing was uploaded or submitted.
