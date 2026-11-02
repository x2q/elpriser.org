package org.elpriser.app.data

import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import org.elpriser.app.R

/** Navnet er et tekst-id, så det følger appens sprog; selve nøglen (`key`) er det, der gemmes. */
class Device(val key: String, @StringRes val nameRes: Int, val kw: Double, val hours: Int, val on: Boolean) {
    fun copy(hours: Int = this.hours, on: Boolean = this.on) = Device(key, nameRes, kw, hours, on)
}

/**
 * Which price zone the app shows, and in which view. Pure (no SharedPreferences), so the rules can be unit tested.
 */
object ZoneChoice {
    /**
     * The zone at start. A stored choice wins. An install from before the Europe release has none: it was Danish-only, so its stored
     * grid company (or else its stored price area) becomes dk1/dk2 and upgrading changes nothing. A fresh install gets the device's default
     * ([deviceDefault]); that is not stored until the user chooses or skips.
     * [onboarded]: the user went through the first-start list. [storedArea]/[netArea]: "DK1"/"DK2" from the old settings (null when none).
     */
    fun resolve(storedZone: String?, onboarded: Boolean, storedArea: String?, netArea: String?, deviceDefault: String): String {
        Zones.byKey(storedZone)?.let { return it.key }
        val legacy = netArea ?: storedArea
        if (onboarded || legacy != null) return if (legacy.equals("DK2", ignoreCase = true)) "dk2" else "dk1"
        return Zones.byKey(deviceDefault)?.key ?: "dk1"
    }

    /**
     * The series the app asks for. Outside Denmark there is one view, "zone" (the day-ahead spot price as published); the stored view
     * (0..3) is kept but ignored. In Denmark the view falls back to "without grid company" when there is no grid company.
     */
    fun mode(zone: Zone, view: Int, hasNet: Boolean): String = when {
        !zone.isDanish -> "zone"
        view == 0 -> if (hasNet) "net_inkl_alt" else "inkl_alt"
        view == 1 -> "inkl_alt"
        view == 2 -> "spot_inkl"
        else -> "spot_ex"
    }
}

/**
 * Brugerens indstillinger, gemt på telefonen. Netselskabet gemmes som svar (GLN) —
 * koordinater og adresse gemmes aldrig.
 */
class Settings(context: Context) {
    private val sp = context.getSharedPreferences("elpriser", Context.MODE_PRIVATE)

    var netGln by mutableStateOf(sp.getString("netGln", null))
        private set
    var netHow by mutableStateOf(sp.getString("netHow", "manual") ?: "manual")
        private set
    var onboarded by mutableStateOf(sp.getBoolean("onboarded", false))
        private set
    /**
     * The price zone's key (see [Zones]). Before the user has chosen or skipped, a fresh install shows the device's default without storing
     * it; an install from before the Europe release maps its stored grid company / price area to dk1 or dk2 (see [ZoneChoice.resolve]).
     */
    var zoneKey by mutableStateOf(
        ZoneChoice.resolve(
            sp.getString("zone", null), sp.getBoolean("onboarded", false), sp.getString("area", null),
            Nets.byGln(sp.getString("netGln", null))?.area, Zones.deviceDefault().key,
        ),
    )
        private set
    /** 0 samlet med netselskab, 1 uden netselskab, 2 spot inkl. moms, 3 spot ekskl. moms. Only the Danish zones use it; outside Denmark it is kept but ignored. */
    var view by mutableStateOf(sp.getInt("view", 0))
        private set
    /** system | light | dark */
    var theme by mutableStateOf(sp.getString("theme", "system") ?: "system")
        private set
    var devices by mutableStateOf(loadDevices())
        private set

    val zone: Zone get() = Zones.byKey(zoneKey) ?: Zones.all.first()
    /** Grid companies exist only in Denmark. */
    val net: Net? get() = if (zone.isDanish) Nets.byGln(netGln) else null
    /** "DK1" / "DK2" in Denmark; the zone key upper-cased elsewhere ("NO1", "DE"). */
    val effectiveArea: String get() = zone.code

    /** Visningen falder tilbage til "uden netselskab", når der ikke er et netselskab; uden for Danmark er der kun "zone". */
    val mode: String get() = ZoneChoice.mode(zone, view, net != null)

    fun saveNet(n: Net, how: String) {
        netGln = n.gln; netHow = how; onboarded = true
        zoneKey = n.area.lowercase()
        // "area" is also written for the sake of older app versions, which read it.
        sp.edit().putString("netGln", n.gln).putString("netHow", how).putBoolean("onboarded", true)
            .putString("zone", zoneKey).putString("area", n.area).apply()
    }

    /** The user chose a price zone (a country with one zone, a Norwegian or Swedish zone, or a Danish area without grid company). Forgets the grid company. */
    fun chooseZone(z: Zone) {
        netGln = null; onboarded = true; zoneKey = z.key
        val e = sp.edit().remove("netGln").putBoolean("onboarded", true).putString("zone", z.key)
        if (z.isDanish) e.putString("area", z.code)
        e.apply()
    }

    fun forgetNet() {
        netGln = null
        sp.edit().remove("netGln").apply()
    }

    /** Skipping keeps what is on screen (the device's default zone) and stores it. */
    fun skipOnboarding() { onboarded = true; sp.edit().putBoolean("onboarded", true).putString("zone", zoneKey).apply() }
    fun updateView(v: Int) { view = v; sp.edit().putInt("view", v).apply() }
    fun updateTheme(t: String) { theme = t; sp.edit().putString("theme", t).apply() }

    fun updateDevices(list: List<Device>) {
        devices = list
        val arr = JSONArray()
        list.forEach { arr.put(JSONObject().put("key", it.key).put("hours", it.hours).put("on", it.on)) }
        sp.edit().putString("devices", arr.toString()).apply()
    }

    private fun loadDevices(): List<Device> {
        val base = listOf(
            Device("heatpump", R.string.device_heatpump, 1.8, 10, true),
            Device("car", R.string.device_car, 7.4, 5, true),
            Device("water", R.string.device_water, 2.0, 3, false),
        )
        val raw = sp.getString("devices", null) ?: return base
        return try {
            val arr = JSONArray(raw)
            base.map { d ->
                val o = (0 until arr.length()).map { arr.getJSONObject(it) }.firstOrNull { it.getString("key") == d.key }
                if (o == null) d else d.copy(hours = o.getInt("hours").coerceIn(1, 12), on = o.getBoolean("on"))
            }
        } catch (e: Exception) { base }
    }
}
