# cs (Czech) — terms to have checked by a native speaker

Register: formal "vy" (vykání), customary in Czech consumer apps.
Technical note: cs.json carries `many` (= `other`) in the plurals devices_active and hours_count, because test-i18n.mjs requires every category listed under `plural` in languages.json (which includes `many` for cs and sk) even though fillMany is set.

| Key | My choice | Alternative | Why unsure |
|---|---|---|---|
| hours in sentences (cheaper_later, tooltip, chart_summary_tile, breakdown_heading_*) | "Levněji zítra, 03:00 — …", "Dnes, 14:00 · …", "Skladba ceny pro 21:00" | "zítra v 03:00" / "ve 3:00" | The preposition "v/ve" depends on the number ("ve 2", "v 21") and the app inserts a two-digit hour, so I avoided the preposition with a comma or "pro". Reads a bit telegraphic. |
| unit_ct_kwh / unit_ct | "c€/kWh", "c€" | "centů/kWh", "€c", "c/kWh" | No settled Czech abbreviation for euro cent. |
| spot price | "Spotová cena" | "Burzovní cena", "Cena na denním trhu" | "spotová cena" is used by Czech energy sites. |
| denní trh | "denní trh" (day-ahead) | "trh na den dopředu", "denní trh OTE" | OTE calls it "denní trh". |
| grid company | "distributor" | "provozovatel distribuční soustavy" | Consumers say "distributor" (ČEZ Distribuce, EG.D); the legal term is long. |
| grid tariff, system, transmission | "distribuční sazba", "systémová sazba", "přenosová sazba" | "platba za distribuci", "cena za systémové služby" | The Czech bill lists "platba za distribuci / systémové služby"; I used "sazba" for the Danish "tarif". |
| part_duty | "Daň z elektřiny" | "Daň z elektřiny (ekologická daň)" | Czech law has "daň z elektřiny"; correct. |
| price zone | "cenová zóna" | "obchodní zóna", "nabídková zóna" | ENTSO-E term is "nabídková zóna"; "cenová zóna" is simpler for consumers. note_zone_it_n uses "obchodní zóna". |
| verdict_* | "Teď levně / průměrně / draho" | "Právě levná hodina" | Pill wording. |
| legend_* | "Levná / Průměrná / Drahá" (agree with "hodina") | "Levné" | |
| tile_cheapest/priciest | "Nejlevnější dnes" / "Nejdražší dnes" | "Nejlevněji", "Nejdráž" | Adjective implies "hodina". |
| device_* | "Elektromobil", "Ohřívač vody", "Tepelné čerpadlo" | "Bojler", "Elektroauto" | "Bojler" is the everyday word for the tank heater. |
| a11y_device_toggle | "Automatika: %1$s" | "Automatizace: %1$s" | |
| nav_smart | "Chytrá domácnost" | "Smart home" | |
| weekdays_short | "ne po út st čt pá so" | | Standard. |
| months_short | "led úno bře dub kvě čvn čvc srp zář říj lis pro" | "led. úno. …", numeric month | Czech dates are normally numeric (17. 10.); abbreviated months are less common. |
| error_load_stale | "Zobrazeny poslední ceny – aktualizace se nezdařila." | | Dash style (en dash vs em dash). |
| place_position_note / welcome | "poloha" | "lokalita", "umístění" | "poloha" is the normal phone term. |
| action_privacy | "Soukromí" | "Ochrana soukromí" | |
| store keywords | "cena elektřiny, spot, denní trh, distribuce, tarif" | "levná elektřina", "burza" | Guessed from common queries; no keyword research tool used. |
