package org.elpriser.app

import org.elpriser.app.data.Api
import org.elpriser.app.data.Charges
import org.elpriser.app.data.Day
import org.elpriser.app.ui.PartRole
import org.elpriser.app.ui.barWeights
import org.elpriser.app.ui.Breakdown
import org.elpriser.app.ui.tenthsText
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Prisopbygningen under "Inkl. nettarif, afgifter og moms". Alle tal er regnet i hånden:
 * system 0,07 + transmission 0,054 + elafgift 0,008 + nettarif 0,33 + spot 0,85 = 1,312 kr ekskl. moms; × 1,25 = 1,64 kr inkl. moms.
 * Det giver (øre): spot 85,0 · system 7,0 · transmission 5,4 · nettarif 33,0 · elafgift 0,8 · moms 32,8 · i alt 164,0.
 */
class BreakdownTest {
    private val charges = Charges(sys = 0.07, trans = 0.054, afg = 0.008, vat = 0.25)

    // The Danish texts, read from res/values/strings.xml. The wrappers keep every assertion below as it was.
    private val tx = TestStrings.da
    private fun breakdownOf(
        mode: String, price: Double, hour: Int, forecastDay: Boolean, charges: Charges?, gridTariff: Double?,
        netName: String?, headingWhen: String = "",
    ): Breakdown? = org.elpriser.app.ui.breakdownOf(tx, mode, price, hour, forecastDay, charges, gridTariff, netName, headingWhen)
    private fun breakdownAt(
        mode: String, days: List<Day>, vals: List<Double>, index: Int, selected: Boolean, charges: Charges?, netName: String?,
    ): Breakdown? = org.elpriser.app.ui.breakdownAt(tx, mode, days, vals, index, selected, charges, netName)
    private fun breakdownWhen(days: List<Day>, index: Int): String = org.elpriser.app.ui.breakdownWhen(tx, days, index)

    private fun texts(b: org.elpriser.app.ui.Breakdown) = b.rows.map { it.label to it.text }

    @Test fun din_pris_med_net_deles_i_seks_raekker_der_summer_til_totalen() {
        val b = breakdownOf("net_inkl_alt", 1.64, 8, false, charges, 0.33, "Radius")!!
        assertEquals(
            listOf(
                "Spotpris (Nord Pool)" to "85,0 øre",
                "Systemtarif (Energinet)" to "7,0 øre",
                "Transmissionstarif (Energinet)" to "5,4 øre",
                "Nettarif (Radius, kl. 08)" to "33,0 øre",
                "Elafgift" to "0,8 øre",
                "Moms (25 %)" to "32,8 øre",
            ),
            texts(b),
        )
        assertEquals(1640L, b.totalTenths)
        assertEquals("1,64 kr/kWh", b.totalText)
        assertEquals("Sådan er prisen kl. 08 sammensat", b.heading)
        assertEquals(b.totalTenths, b.rows.sumOf { it.tenths })
        assertEquals(
            listOf(PartRole.Spot, PartRole.Energinet, PartRole.Energinet, PartRole.Grid, PartRole.Duty, PartRole.Vat),
            b.rows.map { it.role },
        )
    }

    @Test fun spotprisen_tager_afrundingsforskellen_saa_raekkerne_summer_praecist() {
        // 2,0634 kr: moms 41,268 øre -> 41,3; spot uafrundet 118,872 øre ville blive 118,9, men totalen er 206,3, så spot bliver 118,8.
        val b = breakdownOf("net_inkl_alt", 2.0634, 17, false, charges, 0.33, "N1")!!
        assertEquals(2063L, b.totalTenths)
        assertEquals("206,3", tenthsText(b.totalTenths))
        assertEquals("41,3 øre", b.rows.last().text)
        assertEquals("118,8 øre", b.rows.first().text)
        assertEquals(b.totalTenths, b.rows.sumOf { it.tenths })
        assertEquals("2,06 kr/kWh", b.totalText) // præcis det tal, hero og boble viser
    }

    @Test fun raekkerne_summer_altid_til_totalen_over_et_bredt_udsnit_af_priser() {
        var p = -0.4
        while (p < 6.0) {
            for (mode in listOf("net_inkl_alt", "inkl_alt", "spot_inkl")) {
                val b = breakdownOf(mode, p, 5, false, charges, 0.2917, "N1")!!
                assertEquals("$mode $p", b.totalTenths, b.rows.sumOf { it.tenths })
                assertEquals("$mode $p", Math.round(p * 1000.0), b.totalTenths)
            }
            p += 0.00731
        }
    }

    @Test fun uden_net_er_der_ingen_nettarifraekke() {
        // (0,85 + 0,07 + 0,054 + 0,008) × 1,25 = 1,2275 -> 1,23 kr; i alt 122,8 øre (afrundet fra 122,75)
        val b = breakdownOf("inkl_alt", 1.2275, 8, false, charges, null, null)!!
        assertEquals(
            listOf("Spotpris (Nord Pool)", "Systemtarif (Energinet)", "Transmissionstarif (Energinet)", "Elafgift", "Moms (25 %)"),
            b.rows.map { it.label },
        )
        assertEquals(listOf("85,0 øre", "7,0 øre", "5,4 øre", "0,8 øre", "24,6 øre"), b.rows.map { it.text })
        assertEquals(b.totalTenths, b.rows.sumOf { it.tenths })
        assertEquals("1,23 kr/kWh", b.totalText)
    }

    @Test fun spotpris_visning_har_kun_spot_og_moms() {
        // 0,85 × 1,25 = 1,0625 kr: spot 85,0 + moms 21,25 -> 21,3 (afrundet), i alt 106,3 (afrundet fra 106,25); spot tager forskellen.
        val b = breakdownOf("spot_inkl", 1.0625, 8, false, charges, null, null)!!
        assertEquals(listOf("Spotpris (Nord Pool)", "Moms (25 %)"), b.rows.map { it.label })
        assertEquals(b.totalTenths, b.rows.sumOf { it.tenths })
        assertEquals("21,3 øre", b.rows[1].text)
        assertEquals("85,0 øre", b.rows[0].text)
        assertEquals("1,06 kr/kWh", b.totalText)
    }

    @Test fun spotpris_visningens_hele_tal_gaar_op() {
        val b = breakdownOf("spot_inkl", 1.25, 0, false, charges, null, null)!!
        assertEquals(listOf("100,0 øre", "25,0 øre"), b.rows.map { it.text })
        assertEquals("1,25 kr/kWh", b.totalText)
    }

    @Test fun prognosedoegn_hedder_spotpris_prognose() {
        val b = breakdownOf("net_inkl_alt", 1.64, 13, true, charges, 0.33, "Radius")!!
        assertEquals("Spotpris (prognose)", b.rows.first().label)
        val s = breakdownOf("spot_inkl", 1.25, 13, true, charges, null, null)!!
        assertEquals("Spotpris (prognose)", s.rows.first().label)
    }

    @Test fun manglende_charges_eller_pris_giver_ingen_opdeling() {
        assertNull(breakdownOf("net_inkl_alt", 1.64, 8, false, null, 0.33, "Radius"))
        assertNull(breakdownOf("inkl_alt", Double.NaN, 8, false, charges, null, null))
        assertNull(breakdownOf("spot_inkl", Double.POSITIVE_INFINITY, 8, false, charges, null, null))
        assertNull(breakdownOf("inkl_alt", 1.64, 24, false, charges, null, null))
        // Net-visning uden nettarif for timen kan ikke deles op; ekskl. moms har ingen opdeling.
        assertNull(breakdownOf("net_inkl_alt", 1.64, 8, false, charges, null, "Radius"))
        assertNull(breakdownOf("net_inkl_alt", 1.64, 8, false, charges, Double.NaN, "Radius"))
        assertNull(breakdownOf("spot_ex", 0.85, 8, false, charges, null, null))
    }

    @Test fun nettarifraekken_klarer_et_ukendt_netselskabsnavn() {
        assertEquals("Nettarif (kl. 08)", breakdownOf("net_inkl_alt", 1.64, 8, false, charges, 0.33, null)!!.rows[3].label)
        assertEquals("Nettarif (kl. 08)", breakdownOf("net_inkl_alt", 1.64, 8, false, charges, 0.33, " ")!!.rows[3].label)
    }

    @Test fun negativ_spotpris_giver_aldrig_minus_nul_og_summen_gaar_stadig_op() {
        assertEquals("0,0", tenthsText(0))
        assertEquals("-0,3", tenthsText(-3))
        assertEquals("85,3", tenthsText(853))
        assertEquals("-12,5", tenthsText(-125))
        // 0,5 kr: moms 10,0 · system 7,0 · transmission 5,4 · nettarif 33,0 · elafgift 0,8 -> spot -6,2 øre
        val b = breakdownOf("net_inkl_alt", 0.5, 3, false, charges, 0.33, "N1")!!
        assertEquals("-6,2 øre", b.rows.first().text)
        assertEquals(b.totalTenths, b.rows.sumOf { it.tenths })
        assertTrue(b.rows.none { it.text.contains("-0,0") })
        // Prisen 0: alt er 0,0 undtagen de faste dele; ingen "-0,0".
        val z = breakdownOf("spot_inkl", 0.0, 3, false, charges, null, null)!!
        assertEquals(listOf("0,0 øre", "0,0 øre"), z.rows.map { it.text })
        assertEquals("0,00 kr/kWh", z.totalText)
    }

    @Test fun soejlens_bredder_er_forholdsmaessige_og_ignorerer_negative_dele() {
        val b = breakdownOf("net_inkl_alt", 1.64, 8, false, charges, 0.33, "N1")!!
        val w = b.barWeights()
        assertEquals(b.rows.size, w.size)
        assertEquals(1.0, w.sumOf { it.toDouble() }, 1e-5)
        assertEquals(0.5183f, w[0], 1e-3f) // 85,0 af 164,0
        val neg = breakdownOf("net_inkl_alt", 0.5, 3, false, charges, 0.33, "N1")!!
        val wn = neg.barWeights()
        assertEquals(0f, wn[0], 0f)
        assertEquals(1.0, wn.sumOf { it.toDouble() }, 1e-5)
        assertEquals(listOf(0f, 0f), barWeights(listOf(
            org.elpriser.app.ui.BreakdownRow(PartRole.Spot, "a", 0), org.elpriser.app.ui.BreakdownRow(PartRole.Vat, "b", -4),
        )))
    }

    // ── Hvilken time ────────────────────────────────────────────────────────────────────

    // 2026-10-16 er en fredag, så døgn 3 er søndag den 18.
    private fun day(date: String, actual: Boolean, price: Double, tariff: Double? = 0.33) =
        Day(date, actual, List(24) { price + it * 0.01 }, null, null, tariff?.let { t -> List(24) { t + it * 0.001 } })

    private val days = listOf(day("2026-10-16", true, 1.5), day("2026-10-17", false, 1.6), day("2026-10-18", false, 1.7))
    private val vals = days.flatMap { it.price }

    @Test fun overskriften_foelger_boblens_dagsord() {
        assertEquals("", breakdownWhen(days, 99))
        assertEquals("i dag", breakdownWhen(days, 13))
        assertEquals("i morgen", breakdownWhen(days, 24 + 13))
        assertEquals("søn 18. okt", breakdownWhen(days, 48 + 13))
    }

    @Test fun nu_er_default_og_valgt_time_faar_dagsord() {
        val now = breakdownAt("net_inkl_alt", days, vals, 8, false, charges, "Radius")!!
        assertEquals("Sådan er prisen kl. 08 sammensat", now.heading)
        assertEquals("Spotpris (Nord Pool)", now.rows[0].label) // i dag er offentliggjort
        assertEquals("Nettarif (Radius, kl. 08)", now.rows[3].label)

        val tomorrow = breakdownAt("net_inkl_alt", days, vals, 24 + 13, true, charges, "Radius")!!
        assertEquals("Sådan er prisen i morgen kl. 13 sammensat", tomorrow.heading)
        assertEquals("Spotpris (prognose)", tomorrow.rows[0].label)
        assertEquals("Nettarif (Radius, kl. 13)", tomorrow.rows[3].label)
        // nettariffen kommer fra den valgte dags egen time: 0,33 + 13 × 0,001 = 0,343 kr = 34,3 øre
        assertEquals("34,3 øre", tomorrow.rows[3].text)
        assertEquals(tomorrow.totalTenths, tomorrow.rows.sumOf { it.tenths })

        val sunday = breakdownAt("net_inkl_alt", days, vals, 48 + 13, true, charges, "Radius")!!
        assertEquals("Sådan er prisen søn 18. okt kl. 13 sammensat", sunday.heading)
        val today = breakdownAt("net_inkl_alt", days, vals, 19, true, charges, "Radius")!!
        assertEquals("Sådan er prisen i dag kl. 19 sammensat", today.heading)
    }

    @Test fun uden_noget_at_vise_er_der_ingen_opdeling() {
        assertNull(breakdownAt("net_inkl_alt", days, vals, -1, false, charges, "Radius"))
        assertNull(breakdownAt("net_inkl_alt", days, vals, vals.size, false, charges, "Radius"))
        assertNull(breakdownAt("net_inkl_alt", days, vals, 8, false, null, "Radius"))
        // et døgn uden nettarif (svaret havde ingen grid_tariff) kan ikke deles op på net-visningen, men godt uden net
        val bare = listOf(day("2026-10-16", true, 1.5, tariff = null))
        assertNull(breakdownAt("net_inkl_alt", bare, bare[0].price, 8, false, charges, "Radius"))
        assertNotNull(breakdownAt("inkl_alt", bare, bare[0].price, 8, false, charges, null))
    }

    // ── Parsing (additivt) ──────────────────────────────────────────────────────────────

    private fun response(withCharges: Boolean, tariff: Any?): JSONObject {
        val prices = JSONArray().also { a -> for (h in 0..23) a.put(JSONObject().put("hour", h).put("price", 1.0 + h / 100.0)) }
        val d = JSONObject().put("date", "2026-10-16").put("type", "actual").put("prices", prices)
        if (tariff != null) d.put("grid_tariff", tariff)
        val j = JSONObject().put("area", "DK1").put("mode", "net_inkl_alt").put("generated", "2026-10-16 10:00").put("days", JSONArray().put(d))
        if (withCharges) j.put("charges", JSONObject().put("sys", 0.07).put("trans", 0.054).put("afg", 0.008).put("vat", 0.25))
        return j
    }

    private fun tariff24() = JSONArray().also { a -> for (h in 0..23) a.put(0.3 + h / 1000.0) }

    @Test fun charges_og_grid_tariff_parses_additivt() {
        val f = Api.parseForecast(response(true, tariff24()), "DK1", "net_inkl_alt")
        val c = f.charges!!
        assertEquals(0.07, c.sys, 0.0); assertEquals(0.054, c.trans, 0.0); assertEquals(0.008, c.afg, 0.0); assertEquals(0.25, c.vat, 0.0)
        assertEquals(24, f.days[0].gridTariff!!.size)
        assertEquals(0.323, f.days[0].gridTariff!![23], 1e-9)
        // de eksisterende felter er uændrede
        assertEquals(1.0, f.days[0].price[0], 0.0)
        assertTrue(f.days[0].actual)
    }

    @Test fun aeldre_svar_uden_charges_og_grid_tariff_giver_null() {
        val f = Api.parseForecast(response(false, null), "DK1", "net_inkl_alt")
        assertNull(f.charges)
        assertNull(f.days[0].gridTariff)
        assertEquals(24, f.days[0].price.size)
    }

    @Test fun ugyldige_charges_og_tariffer_ignoreres_uden_at_kaste() {
        // grid_tariff som tekst ("hourly"), for kort liste, eller null i listen
        assertNull(Api.parseForecast(response(true, "hourly"), "DK1", "net_inkl_alt").days[0].gridTariff)
        assertNull(Api.parseForecast(response(true, JSONArray().put(0.3)), "DK1", "net_inkl_alt").days[0].gridTariff)
        val withNull = tariff24().also { it.put(5, JSONObject.NULL) }
        assertNull(Api.parseForecast(response(true, withNull), "DK1", "net_inkl_alt").days[0].gridTariff)
        // charges med et manglende tal
        val j = response(true, null)
        j.getJSONObject("charges").remove("afg")
        assertNull(Api.parseForecast(j, "DK1", "net_inkl_alt").charges)
        // ... og et svar uden net-tariff beholder stadig charges
        assertNotNull(Api.parseForecast(response(true, null), "DK1", "inkl_alt").charges)
    }
}
