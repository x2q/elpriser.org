package org.elpriser.app

import android.app.Application
import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
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

/** Pris og Smart hjem er de to faner; Indstillinger åbnes fra net-chippen og er ikke en fane. */
enum class Tab { Pris, Smart, Settings }

/** Stedslisten ("Hvor er du?"), der ligger oven på appen: ved første start og fra net-chippen. */
sealed interface Step {
    /** [note] er et tekst-id (eller null), så beskeden følger appens sprog; [searching] mens positionen slås op. */
    class Place(@StringRes val note: Int? = null, val searching: Boolean = false) : Step
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    val settings = Settings(app)

    var tab by mutableStateOf(Tab.Pris)
    var step by mutableStateOf<Step?>(if (settings.onboarded) null else Step.Place())
        private set

    var loading by mutableStateOf(false)
        private set
    /** Tekst-id for den fejl, der vises (eller null); oversættes, når den vises. */
    var error by mutableStateOf<Int?>(null)
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
                error = if (series.isEmpty()) R.string.error_load_failed else R.string.error_load_stale
                loadedKey = ""
            }
            loading = false
        }
    }

    // ── netselskab og position ─────────────────────────────────────────────

    fun openPlace(@StringRes note: Int? = null) { step = Step.Place(note) }
    fun closeStep() { if (settings.onboarded) step = null else skip() }

    fun skip() {
        settings.skipOnboarding()
        step = null
    }

    fun choose(net: Net, how: String) {
        settings.saveNet(net, how)
        step = null
        refresh(true)
    }

    /** "Uden netselskab": prisområdet alene. */
    fun chooseArea(area: String) {
        settings.forgetNet()
        settings.updateArea(area)
        step = null
        refresh(true)
    }

    fun forget() {
        settings.forgetNet()
        refresh(true)
    }

    /** Henter positionen én gang og vælger netselskabet. Koordinaterne bruges kun til opslaget. */
    fun detect(context: Context) {
        step = Step.Place(searching = true)
        viewModelScope.launch {
            val loc = Position.current(context)
            if (loc == null) {
                step = Step.Place(R.string.note_no_position)
                return@launch
            }
            try {
                val r = Api.lookup(loc.latitude, loc.longitude)
                val net = Nets.match(r.name)
                if (net != null) choose(net, "gps")
                else step = Step.Place(if (r.error == "outside_denmark") R.string.note_outside_denmark else R.string.note_no_net)
            } catch (e: Exception) {
                step = Step.Place(R.string.note_lookup_failed)
            }
        }
    }

    fun positionDenied() {
        step = Step.Place(R.string.note_denied)
    }
}
