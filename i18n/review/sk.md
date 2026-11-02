# sk (Slovak) — terms to have checked by a native speaker

Register: formal "vy" (vykanie), customary in Slovak consumer apps.
Technical note: sk.json carries `many` (= `other`) in the plurals devices_active and hours_count, because test-i18n.mjs requires every category listed under `plural` in languages.json (which includes `many` for cs and sk) even though fillMany is set.

| Key | My choice | Alternative | Why unsure |
|---|---|---|---|
| unit_ct_kwh / unit_ct | "c€/kWh", "c€" | "centov/kWh", "c/kWh" | No settled Slovak abbreviation for euro cent (Slovakia uses the euro, so retail sites usually write "€/kWh"). |
| spot price | "Spotová cena" | "Burzová cena", "Cena na dennom trhu" | |
| denný trh | "denný trh" (day-ahead) | "trh na deň dopredu", "krátkodobý denný trh (OKTE)" | OKTE calls it "krátkodobý trh s elektrinou"; "denný trh" is shorter. |
| grid company | "distribútor" | "distribučná spoločnosť", "prevádzkovateľ distribučnej sústavy" | Consumers: "distribútor" (ZSDIS, SSD, VSD). |
| grid tariff | "distribučná tarifa" | "tarifa za distribúciu elektriny" | The official name is "tarifa za distribúciu"; the shorter form fits the UI. |
| part_system / part_transmission | "Systémová tarifa", "Prenosová tarifa" | "Tarifa za prevádzkovanie systému", "Tarifa za prenos" | Slovak bills show "tarifa za prevádzkovanie systému" (TPS) and "tarifa za systémové služby" (TSS). |
| part_duty | "Daň z elektriny" | | Slovak "daň z elektriny" is correct; it is a different tax from the Danish elafgift. |
| price zone | "cenová zóna" | "obchodná zóna", "ponuková zóna" | |
| nav_smart | "Smart domácnosť" | "Inteligentná domácnosť", "Smart home" | The full phrase is long for a tab label. |
| hours | "o 14:00" | "o 14. hodine" | "o" works for any number. |
| verdict_* | "Teraz lacno / priemerne / draho" | | |
| legend_* | "Lacná / Priemerná / Drahá" | "Lacné" | Agrees with "hodina". |
| tile_cheapest/priciest | "Najlacnejšie dnes" / "Najdrahšie dnes" | "Najlacnejšia hodina" | Adverb form; unsure it reads naturally as a tile label. |
| country | "krajina" | "štát" | "krajina" is the everyday word. |
| device_water | "Ohrievač vody" | "Bojler" | "bojler" is colloquial. |
| device_* | "Elektromobil", "Tepelné čerpadlo" | "Elektrické auto" | |
| a11y_device_toggle | "Automatika: %1$s" | "Automatizácia: %1$s" | |
| months_short | "jan feb mar apr máj jún júl aug sep okt nov dec" | with dots | Slovak abbreviations normally carry a dot ("jan."); omitted for compactness, as in the Danish source. |
| action_privacy | "Súkromie" | "Ochrana súkromia" | |
| error_load_stale, note_* | en dash "–" | em dash "—" | I used an en dash in sentences (Slovak typography) but kept "—" in cheaper_later / view_needs_net to match the source. Consistency is arguable. |
| store keywords | "cena elektriny, spot, denný trh, distribúcia, tarifa" | | Guessed from common queries; no keyword research tool used. |
