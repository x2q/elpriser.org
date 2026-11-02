# ro (Romanian) – terms to have a native speaker check

Address: informal singular imperative ("Alege", "locația ta"), matching the Danish source. Alternative: formal "Alegeți / dumneavoastră", which some Romanian consumer apps use.

| Key(s) | Choice | Alternative | Why unsure |
|---|---|---|---|
| unit_ct_kwh, unit_ct | "eurocenți/kWh", "eurocenți" | "c€/kWh", "ct/kWh" ("bani/kWh" would be wrong) | The spelled-out word is clearest for lay users but long for chart tiles; no settled retail abbreviation for the euro cent in Romania. Check that it fits next to the big price. |
| hero_label, hero_label_weekday | "Prețul energiei acum" | "Prețul curentului acum" (colloquial), "Prețul electricității acum" | "curent" is what people say but is ambiguous in writing; "energie" is neutral. |
| mode_spot_price, part_spot_*, caption_* | "Preț spot" | "Preț PZU", "Preț pe piața angro" | The Romanian market says PZU (Piața pentru Ziua Următoare); "spot" is understood but less local. caption_zone spells out "piața pentru ziua următoare". |
| part_grid, caption_net, view_total_sub, place_net_note | "tarif de distribuție" | "tarif de rețea" | Distribution tariff is the correct bill term for the Danish net-company charge; caption_zone uses the generic "tarife de rețea". |
| place_*, view_*, welcome_*, open_settings_label | "operator de distribuție" (grid company) | "operator de rețea", "OD" | The official term is "operator de distribuție (OD)", but it is long on small screens. |
| part_system, part_transmission | "Tarif de sistem", "Tarif de transport" | "Tarif pentru serviciul de sistem", "Tarif de transport al energiei" | Mapped to Romanian bill vocabulary; Danish tariff semantics differ slightly. |
| part_duty | "Accize energie electrică" | "Taxa pe electricitate", "Accize la energia electrică" | Excise is the Romanian legal term; Danish elafgift is a consumption tax. |
| device_water | "Boiler" | "Încălzitor de apă" | Boiler is the everyday term for a hot-water tank in Romania. |
| device_car | "Mașină electrică" | "Autoturism electric" | Colloquial vs formal. |
| kwh_moved | "%1$s kWh mutați" | "%1$s kWh deplasați", "Mutat: %1$s kWh" | Gender agreement with kWh is awkward (masculine plural). |
| devices_active, hours_count "other" | "%1$d de dispozitive active", "%1$d de ore" | - | Romanian needs "de" for numbers of 20 and over (also 100, 120 ...). The generic "other" form is therefore right for those but check that it reads well. |
| weekdays_short, months_short | dum., lun., mar., mie., joi, vin., sâm. / ian., ..., sept. | no dots ("Dum", "Lun") | Dots follow CLDR; "mar." can be marți (weekday) or martie (month) but never occupies the same position. |
| theme_light, theme_dark | "Luminos" / "Întunecat" | "Deschis" / "Închis", "Luminoasă" / "Întunecată" | Android Romanian uses "Temă luminoasă/întunecată"; gender depends on what the heading implies. |
| action_privacy | "Confidențialitate" | "Politica de confidențialitate" | The button opens the Danish-language policy page. |
| device_avg_save | "medie ... / economie ..." | "în medie", "economisești" | Two-line label, kept short. |
| tile_cheapest, tile_priciest | "Cel mai ieftin azi" | "Cea mai ieftină oră azi" | Dropped "oră" to save space; reads slightly elliptical. |
| Store keywords | curent, electricitate, tarif dinamic, PZU ... | - | Chosen from my knowledge of Romanian energy-market vocabulary, not validated against App Store search volumes. |
