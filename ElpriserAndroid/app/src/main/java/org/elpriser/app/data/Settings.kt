package org.elpriser.app.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject

class Device(val key: String, val name: String, val kw: Double, val hours: Int, val on: Boolean) {
    fun copy(hours: Int = this.hours, on: Boolean = this.on) = Device(key, name, kw, hours, on)
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
    var area by mutableStateOf(sp.getString("area", "DK1") ?: "DK1")
        private set
    var onboarded by mutableStateOf(sp.getBoolean("onboarded", false))
        private set
    /** 0 samlet med netselskab, 1 uden netselskab, 2 spot inkl. moms, 3 spot ekskl. moms */
    var view by mutableStateOf(sp.getInt("view", 0))
        private set
    /** system | light | dark */
    var theme by mutableStateOf(sp.getString("theme", "system") ?: "system")
        private set
    var devices by mutableStateOf(loadDevices())
        private set

    val net: Net? get() = Nets.byGln(netGln)
    val effectiveArea: String get() = net?.area ?: area

    /** Visningen falder tilbage til "uden netselskab", når der ikke er et netselskab. */
    val mode: String
        get() = when (view) {
            0 -> if (net != null) "net_inkl_alt" else "inkl_alt"
            1 -> "inkl_alt"
            2 -> "spot_inkl"
            else -> "spot_ex"
        }

    fun saveNet(n: Net, how: String) {
        netGln = n.gln; netHow = how; onboarded = true
        sp.edit().putString("netGln", n.gln).putString("netHow", how).putBoolean("onboarded", true).apply()
    }

    fun forgetNet() {
        netGln = null
        sp.edit().remove("netGln").apply()
    }

    fun skipOnboarding() { onboarded = true; sp.edit().putBoolean("onboarded", true).apply() }
    fun updateArea(a: String) { area = a; sp.edit().putString("area", a).apply() }
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
            Device("heatpump", "Varmepumpe", 1.8, 10, true),
            Device("car", "Elbil", 7.4, 5, true),
            Device("water", "Vandvarmer", 2.0, 3, false),
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
