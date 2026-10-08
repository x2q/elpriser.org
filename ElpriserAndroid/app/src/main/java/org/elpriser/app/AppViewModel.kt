package org.elpriser.app

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.launch
import org.elpriser.app.data.Api
import org.elpriser.app.data.Clock
import org.elpriser.app.data.Day
import org.elpriser.app.data.Forecast
import org.elpriser.app.data.Net
import org.elpriser.app.data.Nets
import org.elpriser.app.data.Position
import org.elpriser.app.data.Settings

enum class Tab { Nu, Prognose, Time, Automation, Settings }

/** Første-start- og netselskabsflowet, der ligger oven på appen. */
sealed interface Step {
    data object Welcome : Step
    data object Searching : Step
    class Found(val net: Net) : Step
    class Picker(val note: String?) : Step
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    val settings = Settings(app)

    var tab by mutableStateOf(Tab.Nu)
    /** Valgt døgn (0 = i dag) i Prognose og Time for time. */
    var selDay by mutableIntStateOf(0)
    var step by mutableStateOf<Step?>(if (settings.onboarded) null else Step.Welcome)
        private set

    var loading by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    /** Hentede serier pr. visning (mode). */
    var series by mutableStateOf<Map<String, Forecast>>(emptyMap())
        private set
    var co2 by mutableStateOf<Map<String, List<Int>>>(emptyMap())
        private set
    private var loadedAt = 0L
    private var loadedKey = ""

    /** Dage fra i dag og frem for en visning. */
    fun days(mode: String = settings.mode): List<Day> {
        val today = Clock.today()
        return series[mode]?.days?.filter { it.date >= today }.orEmpty()
    }

    fun model(): String? = series[settings.mode]?.model

    /** Henter alt, appen skal bruge: den valgte visning plus de tre, prisopbygningen regnes af. */
    fun refresh(force: Boolean = false) {
        val key = settings.mode + "|" + settings.effectiveArea + "|" + settings.netGln
        if (!force && key == loadedKey && System.currentTimeMillis() - loadedAt < 20 * 60_000L && series.isNotEmpty()) return
        loadedKey = key
        viewModelScope.launch {
            loading = true
            error = null
            val area = settings.effectiveArea
            val gln = settings.netGln
            val modes = linkedSetOf(settings.mode, "inkl_alt", "spot_inkl")
            if (gln != null) modes.add("net_inkl_alt")
            try {
                val results = modes.map { m -> async { m to Api.forecast(area, m, gln) } }.awaitAll()
                series = results.toMap()
                co2 = runCatching { Api.co2(area) }.getOrDefault(co2)
                loadedAt = System.currentTimeMillis()
            } catch (e: Exception) {
                error = if (series.isEmpty()) "Vi kunne ikke hente priserne. Tjek din forbindelse og prøv igen." else "Viser de seneste priser — kunne ikke opdatere."
                loadedKey = ""
            }
            loading = false
        }
    }

    // ── netselskab og position ─────────────────────────────────────────────

    fun openWelcome() { step = Step.Welcome }
    fun openPicker(note: String? = null) { step = Step.Picker(note) }
    fun closeStep() { step = null }

    fun skip() {
        settings.skipOnboarding()
        step = null
    }

    fun choose(net: Net, how: String) {
        settings.saveNet(net, how)
        step = null
        refresh(true)
    }

    fun forget() {
        settings.forgetNet()
        refresh(true)
    }

    /** Henter positionen én gang og finder netselskabet. Koordinaterne bruges kun til opslaget. */
    fun detect(context: Context) {
        step = Step.Searching
        viewModelScope.launch {
            val loc = Position.current(context)
            if (loc == null) {
                step = Step.Picker("Vi kunne ikke finde din position. Vælg dit netselskab på listen i stedet.")
                return@launch
            }
            try {
                val r = Api.lookup(loc.latitude, loc.longitude)
                val net = Nets.match(r.name)
                step = when {
                    net != null -> Step.Found(net)
                    r.error == "outside_denmark" -> Step.Picker("Din position ligger uden for Danmark. Vælg dit netselskab på listen.")
                    else -> Step.Picker("Vi kunne ikke finde netselskabet for din position. Vælg det på listen — det står på din elregning.")
                }
            } catch (e: Exception) {
                step = Step.Picker("Opslaget lykkedes ikke. Vælg dit netselskab på listen, eller prøv igen senere.")
            }
        }
    }

    fun positionDenied() {
        step = Step.Picker("Positionen blev ikke delt. Vælg dit netselskab på listen — så virker appen på samme måde.")
    }
}
