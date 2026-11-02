# Europe release: countries, declarations and manual steps

Nothing here has been done in App Store Connect or Google Play Console. This document is the plan and the list of manual steps for the owner.
Version of this release: Android 1.1.0 (versionCode 5), iOS 1.1.0 (build 8). Listing texts: `docs/store/<lang>.md` (26 languages, limits checked by `npm run test:store`).
Translation caveats for native speakers: `i18n/review/<lang>.md`. mk and sq are low confidence; do not ship them without a native read.

## 1. Where the app should be available

The app has a spot price for the countries below (one or more of the 38 zones). Enabling a country without a zone would show the Germany fallback, which is wrong there, so those are left out.

| Group | Countries (ISO) | Zone in the app |
|---|---|---|
| EU, with a zone | AT BE BG HR CZ DK EE FI FR DE GR HU IE IT LV LT NL PL PT RO SK SI ES SE | own zone (IT: IT-North only; DK: DK1/DK2 with grid companies; SE: SE1–SE4) |
| EU, shares a zone | LU | DE-LU (Germany and Luxembourg) |
| EU, no zone | CY MT | none. Do not enable until a zone exists (the app would show Germany) |
| EEA | NO | NO1–NO5 |
| EEA, no zone | IS LI | none (LI is not priced as CH: do not enable) |
| Other Europe | CH | CH |
| Western Balkans | RS ME MK AL | own zone |
| Western Balkans, no zone | BA XK | none: do not enable |
| UK | GB | none: the API has no GB prices, do not enable |

So enable these 31 countries in both stores (the 27 EU members minus CY and MT = 25, plus NO, CH, RS, ME, MK, AL): `AL AT BE BG CH CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV ME MK NL NO PL PT RO RS SE SI SK`. Denmark stays enabled.

Language notes:
* Apple's App Store Connect metadata languages do not include bg, et, lv, lt, sl, sr, mk, sq (to be confirmed in App Store Connect). The listings for these have `n/a` in the ios.* fields; the storefronts of BG, EE, LV, LT, SI, RS, MK, AL then show the primary-language (English) listing. The in-app translations for these languages are in the build, but iOS only offers a language the system supports, so users of those languages see them only where iOS lists the app language (to be tested on a device).
* Google Play supports all 26 languages as listing languages.
* The Germany fallback (`FALLBACK_ZONE`) applies to devices with no supported region or language, e.g. English in the UK or US. Owner decision (see section 5).

## 2. Declarations that must be consistent with the app

| Topic | What the app does | Where to declare |
|---|---|---|
| Location | "Use my position" (Denmark only) reads coarse/fine location once on a tap; the coordinates go to elpriser.org, which looks up the grid company via OpenStreetMap Nominatim; nothing stored in the app except the grid company's GLN. Unchanged by this release. | Play Data safety: location, collected, shared (OSM), optional, not stored; ASC App Privacy: Coarse/Precise Location, not linked to the user, not used for tracking, purpose App Functionality |
| Device region and language | read on the device to choose the default zone; never sent | nothing to declare |
| Zone / country | sent as `zone=<key>` in the price request (not personal data) | nothing to declare |
| Usage telemetry | the User-Agent carries app name and version (`ElpriserAndroid/1.1.0 (5)`); the server counts requests per version, no id, no IP stored (see `functions/_usage.js`, `privatliv.html`). Already shipped in the previous builds. | Play Data safety: "App info and performance / Diagnostics" is arguably covered by anonymous counts; keep consistent with how 1.0.x was declared. ASC: "Usage Data / Product Interaction" only if you count it as collected data; counts without an identifier are normally declared as not linked and not tracking |
| Ads, accounts | none | unchanged |
| Encryption | HTTPS only | iOS `ITSAppUsesNonExemptEncryption` false (already in the build) |
| DSA (EU Digital Services Act) | trader status | Apple: already approved for the Danish listing (trader information shows in every EU storefront, nothing new to enable). Google Play: the developer profile must have the trader/contact details verified (Play Console > Settings > Developer account > Contact details); needed for EU distribution |
| Privacy policy | https://elpriser.org/privatliv exists in Danish only | both stores require a URL; consider an English version (owner decision). The apps' about card links to it |
| Attribution | CC BY 4.0 (Energy-Charts / Bundesnetzagentur | SMARD.de) and ENTSO-E named in the about card and in every listing | done in the build and the texts |

## 3. App Store Connect, manual steps (owner)

1. New version 1.1.0 for the iOS app (id 6820474476). Build 8 must be archived and uploaded with the release Xcode (27.1) and the API key recipe from the memory notes; nothing has been uploaded.
2. Pricing and Availability: keep Free; Availability > add the countries of section 1 that are not yet enabled (Denmark only today).
3. App Information > Localizable Information: add the languages da, en-GB (or en-US), de-DE, fr-FR, nl-NL, it, pl, sv, no, fi, cs, hu, es-ES, pt-PT, sk, el, ro, hr (the 18 Apple supports). For each paste from `docs/store/<lang>.md`: ios.name, ios.subtitle, ios.promo, ios.keywords, ios.description, ios.whatsnew. Choose the primary language (English recommended, owner decision) so the storefronts without a metadata language show English.
4. Screenshots: the existing ones are Danish (`ElpriserIOS/store/screenshots`). Apple lets a locale reuse another locale's screenshots; at least add English ones. Owner decision.
5. App Privacy: re-check the answers against section 2 (unchanged data flows).
6. Age rating, Content Rights, Export Compliance: unchanged.
7. EU Digital Services Act: nothing new while the trader declaration stays approved; re-confirm in App Information > EU Digital Services Act.
8. Attach build 8, "Add for Review", automatic release as before. Wait for approval before telling anyone it is live.

## 4. Google Play Console, manual steps (owner)

1. Production > Create new release: upload the 1.1.0 (5) `.aab` (build with `JAVA_HOME=… ./gradlew :app:bundleRelease`; the upload key is the existing one; nothing has been built or uploaded).
2. Release notes: for each language add the `play.whatsnew` text from `docs/store/<lang>.md` inside `<xx-XX>` tags (da-DK, en-GB, de-DE, fr-FR, nl-NL, it-IT, pl-PL, sv-SE, no-NO, fi-FI, cs-CZ, hu-HU, sl, es-ES, pt-PT, sk, el-GR, ro, bg, hr, sr, et, lv, lt, mk-MK, sq), each on its own lines, 500 characters at most.
3. Grow > Store presence > Main store listing > Manage translations: add the 25 languages; paste title, short and full description from the listings (switch off Google's automatic translation for these). Decide the default language (today da-DK; English recommended for a European listing, owner decision).
4. Release > Reach and devices > Countries/regions > Production: add the countries of section 1.
5. Policy > App content > Data safety: re-check (section 2); Target audience and content: unchanged; Ads: none.
6. Settings > Developer account > Contact details: confirm the DSA trader details are verified.
7. Send for review and roll out in stages (owner's choice), as with 1.0.x.

## 5. Decisions the owner must make

* Fallback zone for devices without a supported region/language (UK, US, other): Germany (`FALLBACK_ZONE` in `tests/golden/zones.mjs` and the two apps) or a country chooser every time.
* Whether Italy should offer more than IT-North (the API only serves IT-North; the app says so).
* CY and MT (EU members without a price zone): leave out or add zones later.
* Store default languages (English vs Danish) and the primary App Store language.
* Whether to write an English privacy policy.
* Native-speaker review before release for every language (`i18n/review/`), at least for the languages of the biggest markets (de fr it pl es) and certainly for mk and sq.
* iOS languages bg, et, lv, lt, sl, sr, mk, sq: no Apple metadata language; the iOS storefronts show the primary-language listing.
