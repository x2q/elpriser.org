package org.elpriser.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Klient til elpriser.org's åbne API. */
object Api {
    private const val BASE = "https://elpriser.org/api"
    private const val UA = "ElpriserAndroid/1.0 (+https://elpriser.org)"

    private suspend fun get(path: String, params: Map<String, String>): JSONObject = withContext(Dispatchers.IO) {
        val q = params.entries.joinToString("&") { "${it.key}=${URLEncoder.encode(it.value, "UTF-8")}" }
        val conn = URL("$BASE$path?$q").openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.setRequestProperty("User-Agent", UA)
            conn.setRequestProperty("Accept", "application/json")
            val code = conn.responseCode
            if (code !in 200..299) throw java.io.IOException("Serverfejl ($code)")
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
            out.add(Day(d.getString("date"), d.getString("type") == "actual", price, if (band) lo else null, if (band) hi else null))
        }
        val model = j.optJSONObject("model")
        return Forecast(area, mode, out, model?.optString("name"), j.optString("generated"))
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
