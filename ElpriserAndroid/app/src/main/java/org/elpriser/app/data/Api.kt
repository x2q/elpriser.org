package org.elpriser.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.elpriser.app.BuildConfig
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** A non-2xx answer; [code] tells a missing zone (404) from a failure. */
class HttpException(val code: Int) : java.io.IOException("HTTP $code")

/** Klient til elpriser.org's åbne API. */
object Api {
    private const val BASE = "https://elpriser.org/api"
    /** Versionen står i User-Agent, så serveren kan tælle kald pr. version (ingen id, se functions/_usage.js). */
    private val UA = "ElpriserAndroid/${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) (+https://elpriser.org)"

    private suspend fun get(path: String, params: Map<String, String>): JSONObject = withContext(Dispatchers.IO) {
        val q = params.entries.joinToString("&") { "${it.key}=${URLEncoder.encode(it.value, "UTF-8")}" }
        val conn = URL("$BASE$path?$q").openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.setRequestProperty("User-Agent", UA)
            conn.setRequestProperty("Accept", "application/json")
            val code = conn.responseCode
            if (code !in 200..299) throw HttpException(code)
            JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
        } finally {
            conn.disconnect()
        }
    }

    /** 10 døgn: faktiske børspriser, og så prognosen med P10/P90 på de døgn, der ikke er offentliggjort. */
    suspend fun forecast(area: String, mode: String, gln: String?): Forecast {
        val params = mutableMapOf("area" to area, "mode" to mode)
        if (gln != null && mode.startsWith("net_")) params["gln"] = gln
        return parseForecast(get("/forecast", params), area, mode)
    }

    /**
     * The day-ahead prices of a zone outside the Danish grid-company flow (GET /api/nordic?zone=): settled days and, in the Nordic zones and
     * NL, a model forecast after them. 404 means the zone has no data: an empty series, which the screens show as "no prices yet".
     */
    suspend fun zone(zone: Zone): Forecast {
        val j = try {
            get("/nordic", mapOf("zone" to zone.key))
        } catch (e: HttpException) {
            if (e.code == 404) return Forecast(zone.key, "zone", emptyList(), null, null)
            throw e
        }
        return parseZone(j, zone)
    }

    /**
     * What a client makes of /api/nordic (tests/golden/zones.mjs parseZone): complete days only (24 hours with a price), prices in the zone's
     * sub-unit per kWh (EUR/MWh × rate / 10; rate = zoneInfo.rate when it is above 0, else the fallback table), the band from
     * min_eur_mwh / max_eur_mwh when both are there, `actual` from the day's type. Rounded to six decimals so every platform compares exactly.
     * Adskilt fra netværket, så det kan enhedstestes.
     */
    fun parseZone(j: JSONObject, zone: Zone): Forecast {
        val info = j.optJSONObject("zoneInfo")
        val currency = info?.optString("currency", "")?.takeIf { it.isNotEmpty() } ?: zone.currency
        val given = info?.optDouble("rate", Double.NaN) ?: Double.NaN
        val rate = if (given > 0) given else (Zones.FX_FALLBACK[currency] ?: 1.0)
        fun r6(x: Double) = Math.round(x * 1e6) / 1e6
        val days = j.optJSONArray("days")
        val out = ArrayList<Day>()
        for (i in 0 until (days?.length() ?: 0)) {
            val d = days!!.getJSONObject(i)
            val arr = d.optJSONArray("prices")
            val price = MutableList(24) { Double.NaN }
            val lo = MutableList(24) { Double.NaN }
            val hi = MutableList(24) { Double.NaN }
            var band = false
            for (k in 0 until (arr?.length() ?: 0)) {
                val p = arr!!.getJSONObject(k)
                val h = p.optInt("hour", -1)
                if (h !in 0..23 || p.isNull("eur_mwh")) continue
                val eur = p.optDouble("eur_mwh", Double.NaN)
                if (eur.isNaN()) continue
                price[h] = r6(eur * rate / 10)
                if (!p.isNull("min_eur_mwh") && !p.isNull("max_eur_mwh")) {
                    lo[h] = r6(p.getDouble("min_eur_mwh") * rate / 10); hi[h] = r6(p.getDouble("max_eur_mwh") * rate / 10); band = true
                }
            }
            if (price.any { it.isNaN() }) continue
            out.add(Day(d.getString("date"), d.optString("type") == "actual", price, if (band) lo else null, if (band) hi else null))
        }
        return Forecast(zone.key, "zone", out, null, j.optString("generated").ifEmpty { null })
    }

    /** Kun hele døgn (24 timepriser) tæller; båndet P10/P90 er valgfrit. Adskilt fra netværket, så det kan enhedstestes. */
    fun parseForecast(j: JSONObject, area: String, mode: String): Forecast {
        val days = j.getJSONArray("days")
        val out = ArrayList<Day>(days.length())
        for (i in 0 until days.length()) {
            val d = days.getJSONObject(i)
            val arr = d.getJSONArray("prices")
            val price = MutableList(24) { Double.NaN }
            val lo = MutableList(24) { Double.NaN }
            val hi = MutableList(24) { Double.NaN }
            var band = false
            for (k in 0 until arr.length()) {
                val p = arr.getJSONObject(k)
                val h = p.getInt("hour")
                if (h !in 0..23 || p.isNull("price")) continue
                price[h] = p.getDouble("price")
                if (!p.isNull("min") && !p.isNull("max")) {
                    lo[h] = p.getDouble("min"); hi[h] = p.getDouble("max"); band = true
                }
            }
            if (price.any { it.isNaN() }) continue
            out.add(Day(d.getString("date"), d.getString("type") == "actual", price, if (band) lo else null, if (band) hi else null, parseGridTariff(d)))
        }
        val model = j.optJSONObject("model")
        return Forecast(area, mode, out, model?.optString("name"), j.optString("generated"), parseCharges(j))
    }

    /** `charges` øverst i svaret. Mangler feltet (ældre svar) eller er et tal ugyldigt, er der ingen opdeling at vise. */
    fun parseCharges(j: JSONObject): Charges? {
        val c = j.optJSONObject("charges") ?: return null
        val sys = c.optDouble("sys", Double.NaN)
        val trans = c.optDouble("trans", Double.NaN)
        val afg = c.optDouble("afg", Double.NaN)
        val vat = c.optDouble("vat", Double.NaN)
        if (listOf(sys, trans, afg, vat).any { it.isNaN() || it.isInfinite() } || vat < 0) return null
        return Charges(sys, trans, afg, vat)
    }

    /** `grid_tariff` pr. døgn: kun en liste med 24 tal tæller (på andre visninger er det fraværende eller en tekst). */
    private fun parseGridTariff(d: JSONObject): List<Double>? {
        val a = d.optJSONArray("grid_tariff") ?: return null
        if (a.length() != 24) return null
        val out = ArrayList<Double>(24)
        for (i in 0 until 24) {
            val v = a.optDouble(i, Double.NaN)
            if (v.isNaN() || v.isInfinite()) return null
            out.add(v)
        }
        return out
    }

    /** CO₂ i g/kWh pr. time, pr. dato. */
    suspend fun co2(area: String): Map<String, List<Int>> = parseCo2(get("/raw/co2", mapOf("area" to area)))

    /** Kun datoer med alle 24 timer. */
    fun parseCo2(j: JSONObject): Map<String, List<Int>> {
        val recs = j.getJSONArray("records")
        val byDate = LinkedHashMap<String, IntArray>()
        for (i in 0 until recs.length()) {
            val r = recs.getJSONObject(i)
            val h = r.getInt("hour")
            if (h !in 0..23) continue
            byDate.getOrPut(r.getString("date")) { IntArray(24) { -1 } }[h] = r.getInt("co2")
        }
        return byDate.filterValues { v -> v.all { it >= 0 } }.mapValues { it.value.toList() }
    }

    /** Netselskabet for en position. Positionen sendes kun hertil og gemmes hverken her eller i appen. */
    suspend fun lookup(lat: Double, lng: Double): Lookup {
        val j = get("/supplierlookup", mapOf("lat" to "%.5f".format(java.util.Locale.US, lat), "lng" to "%.5f".format(java.util.Locale.US, lng)))
        return Lookup(if (j.isNull("name")) null else j.optString("name"), if (j.isNull("error")) null else j.optString("error"))
    }
}
