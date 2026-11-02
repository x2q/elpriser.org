# fr — review notes

Terms and strings a native speaker (France/Belgium/Switzerland) should confirm. Address: "vous" where the reader is addressed. French typography (no-break space before : ; ! ? and inside « ») uses U+00A0 characters in the UI strings.

| Key | Choice | Alternative | Why unsure |
|---|---|---|---|
| unit_ct_kwh, unit_ct | "c€/kWh", "c€" | "cts/kWh", "ct/kWh" | "c€/kWh" is common on French retail sites; Belgium and Switzerland often write "cts/kWh" or "ct./kWh" |
| part_system | "Tarif système (Energinet)" | "Tarif des services système" | Danish systemtarif has no exact French counterpart |
| part_transmission | "Tarif de transport (Energinet)" | "Tarif de transmission" | "Transport" is the French grid term (RTE), but Danish "transmission" may be better understood literally |
| part_grid, caption_net, view_total_sub | "Tarif réseau" | "TURPE", "Acheminement", "Frais d'acheminement" | Shortest understandable form; the bill item is "acheminement", the regulated tariff is TURPE |
| part_duty, view_nonet_sub | "Accise sur l'électricité" | "Taxes (accise)" | Current French term since 2022; Belgium says "cotisation sur l'énergie", Switzerland has other levies |
| gestionnaire de réseau (many keys) | "gestionnaire de réseau" | "gestionnaire de réseau de distribution", "distributeur" | France: Enedis/ELD; users may say "distributeur" |
| place_zone_title, welcome_zone_body | "Zone de prix" | "Zone de dépôt des offres" | The official term is stiff; consumer-friendly choice |
| caption_zone | "Prix de bourse (day-ahead)" | "marché J-1" | "day-ahead" is usual in the trade, "J-1" in French sources |
| hero_label | "Prix de l'électricité maintenant · 14 h" | "en ce moment" | Long for a label; consider "Prix actuel" |
| hero_label_weekday | "… maintenant · mercredi 14 h" | "mercredi à 14 h" | Reads slightly clipped |
| hour format "%1$s h" | "09 h" | "9 h" | The app passes two digits, so "09 h" with a leading zero looks odd in French; "9 h" would be natural |
| verdict_cheap/mid/high | "Pas cher / Moyen / Cher maintenant" | "Bas / Moyen / Élevé" | "Pas cher" is colloquial; "bas/élevé" refers to price rather than to the hour |
| tile_cheapest / tile_priciest | "Moins cher aujourd'hui", "Plus cher ce soir" | "Le moins cher…" | Without the article it reads like a label; fine for tiles |
| mode_net_price | "Votre prix" | "Prix TTC" | Mirrors the Danish; "TTC" is more common but the price is not the full consumer price in every context |
| period_title_* | "Les 2 prochains jours" | "2 prochains jours" | Article added so that a11y_period_hint stays grammatical |
| date_long | "Dimanche 17 oct." | "dimanche 17 oct." | The app passes the weekday capitalised per the note; French normally lower-cases weekdays |
| months_short, weekdays_short | "janv.", "févr.", "dim." with dots | no dots | CLDR style |
| device_water | "Chauffe-eau" | "Ballon d'eau chaude" | Standard term |
| device_car | "Voiture électrique" | "VE" | Short enough |
| smart_subtitle | "Programmez sur les heures les moins chères du jour" | "Fonctionne aux heures creuses" | "Heures creuses" is a French tariff term and would be misleading |
| a11y_device_toggle | "Automatisation : %1$s" | "%1$s automatique" | The Danish word order is reversed |
| searching_title | "Recherche de … gestionnaire de réseau…" | with space before … | French typography: no space before the ellipsis (differs from Danish source) |
| place_west/east | "Danemark occidental/oriental" | "de l'Ouest/de l'Est" | Common in French sources |
| kwh_moved | "%1$s kWh décalés" | "déplacés" | "décaler" is used for load shifting |
| value_ore | "øre" | "øre danois" | Unit kept |
