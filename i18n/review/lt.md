# lt (Lithuanian) — terms to have checked by a native speaker

Confidence: good overall (tier 2). Register: formal plural "jūs" (jūsų, pasirinkite).

| Key | My choice | Alternative | Why unsure |
|---|---|---|---|
| unit_ct_kwh / unit_ct | `ct/kWh`, `ct` | `eurocentai/kWh`, `ct/kWh` | "ct/kWh" is common on Lithuanian utility sites (Ignitis, Elektrum), but "euro ct/kWh" also appears. |
| Hour form | "%1$s:00" (no "val.") | "%1$s val." / "%1$s:00 val." | Chose the compact clock form everywhere; sentences such as "Kaip susidaro 14:00 kaina" may want "val." or "valandą". |
| mode_spot_price | Biržos kaina | Nord Pool kaina, spot kaina | Lithuanian consumers know "biržos kaina" ("Nord Pool kaina" also common). |
| caption_zone | "kitos paros rinka" | "dienos prieš rinka" | Day-ahead = "kitos paros rinka" in Litgrid/Nord Pool texts. |
| part_grid / caption_net | Tinklo tarifas | Skirstymo tarifas, persiuntimo kaina | The Lithuanian bill uses "persiuntimo/skirstymo paslauga" (ESO); "tinklo tarifas" is the generic term. |
| tinklo operatorius (grid company) | tinklo operatorius | skirstomųjų tinklų operatorius (ESO) | Short form; official term is longer. |
| part_system / part_transmission | Sistemos tarifas / Perdavimo tarifas | Sistemos paslaugų tarifas | Danish tariff names have no exact Lithuanian equivalent. |
| part_duty | Elektros mokestis | Elektros akcizas | Danish "elafgift" is a consumption levy; Lithuania has an excise duty ("akcizas") on electricity. |
| verdict / legend | Pigu / Vidutiniškai / Brangu ("Dabar pigu") | Pigi / Vidutinė / Brangi | Adverb form chosen to avoid gender agreement with "kaina"/"valanda". |
| tile_cheapest/priciest | "Pigiausia / Brangiausia" + day word | | Feminine agrees with "valanda"; day_tonight "šįvakar". |
| period_two/five | "2 d." / "5 d."; titles "Kitos 2 dienos" / "Kitos 5 dienos" | "2 paros" | Compact; "paros" = 24-hour period. "Kitos 5 dienos" with a digit is common but formally "kitos 5 dienos" is nominative; "per 5 dienas" is an alternative. |
| devices_active | "…įrenginys / įrenginiai / įrenginių veikia" | "aktyvus" | Verb "veikia" avoids agreement; check the "other" form for 0, 10–20 ("įrenginių"). |
| date_day_month / date_long / day_short_date | "spal. 17 d." / "Sekmadienis, spal. 17 d." / "sk 17 d." | "17 d." / "spalio 17 d." | Reordered placeholders; abbreviated month before the day. Please verify word order and the "d." suffix. |
| weekdays_short | sk pr an tr kt pn št | | CLDR forms. |
| months_short | saus., vas., kov., bal., geg., birž., liep., rugp., rugs., spal., lapkr., gruod. | | CLDR; "birž." for June is the usual abbreviation. |
| theme_system | Sistemos | Kaip sistemoje | Meaning "follow the system". |
| buvimo vieta | buvimo vieta | vieta, padėtis, geolokacija | Used for "position/location"; "vieta" is shorter. |
| note_denied | "Buvimo vieta nebuvo pateikta." | "Prieiga prie buvimo vietos nesuteikta." | Wording of the denied-permission note. |
| export_title | Gauti planą Home Assistant | Gauti planą „Home Assistant“ | Product names left unquoted, uninflected. |
| kwh_moved | "perkelta" | "perkeltos" | Agreement with an implied "energija"; "%1$s kWh perkelta" is acceptable? |
| smart_subtitle | Naudokite pigiausias valandas šiandien | | Meaning "run devices on the cheapest hours". |
