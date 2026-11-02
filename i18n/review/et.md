# et (Estonian) — terms to have checked by a native speaker

Confidence: good overall (tier 2). Register: informal "sina" (sinu, vali, kasuta), imperative.

| Key | My choice | Alternative | Why unsure |
|---|---|---|---|
| unit_ct_kwh / unit_ct | `senti/kWh`, `senti` | `s/kWh`, `€-senti/kWh`, `ct/kWh` | Eesti Energia and Elering use "senti/kWh" or "s/kWh"; the short "s" is tighter on phones but can read as "seconds". "senti" is correct only after a number. |
| weekdays_short | P E T K N R L (single letters, CLDR) | pühap/esmasp/teisip/kolmap/neljap/reede/laup, or püh/esm/tei/kol/nel/ree/lau | Single letters are the calendar standard but read cryptically in tiles ("Odavaim K 17.") and on the 5-day axis. |
| months_short | jaan, veebr, märts, apr, mai, juuni, juuli, aug, sept, okt, nov, dets | with trailing dots | CLDR forms, no dots; dots are optional in Estonian. |
| mode_spot_price, part_spot_* | Börsihind | spot-hind, Nord Pooli hind | "börsihind" is the common consumer term; "spot" is used by traders. |
| caption_zone | "päev-ette" | "järgmise päeva" | "päev-ette turg" is the Nord Pool term; may be unfamiliar to consumers. |
| part_system | Süsteemitasu (Energinet) | Süsteemiteenuse tasu | Danish "systemtarif" has no direct Estonian counterpart. |
| part_transmission | Põhivõrgutasu (Energinet) | Ülekandetasu | "põhivõrk" is the Estonian national transmission grid; the Danish tariff is the same concept. |
| part_duty | Elektriaktsiis | Elektriaktsiis / elektrimaks | Excise term used in Estonia; Danish elafgift is in fact a levy on consumption. |
| view_total_title etc. | võrguettevõte | võrguoperaator | "võrguettevõte" is on Estonian bills; "operaator" is also used. |
| devices_active | "%1$d seade töös" | "aktiivne" | Avoids numeral-predicate agreement; "töös" reads slightly technical. |
| tile_cheapest/priciest | Odavaim / Kalleim + day word | Kõige odavam / kõige kallim | Short superlatives; the long form is more spoken. |
| day_tonight | täna õhtul | tänaõhtu | "tonight" used in "Kalleim täna õhtul". |
| breakdown_back_to_now | Tagasi praegusesse hetke | Tagasi praegusesse | Wording of the "back to now" action. |
| device_avg_save | "keskm. … sääst …" | "säästad" | Noun form chosen to avoid addressing the user on a tight two-line label. |
| about_text | Hugging Face'i | Hugging Facega | Case ending after a foreign name with an apostrophe. |
| welcome_zone_title/zone strings | hinnapiirkond | pakkumispiirkond | Elering uses "hinnapiirkond"; for IT-North I used "pakkumispiirkond" (bidding zone). |
| Hour form | kell %1$s:00 | %1$s:00 | Longer in the chart bubble. |
