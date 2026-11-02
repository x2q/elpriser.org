package org.elpriser.app.ui

import android.Manifest
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.elpriser.app.AppViewModel
import org.elpriser.app.R
import org.elpriser.app.Step
import org.elpriser.app.Tab
import org.elpriser.app.data.Net
import org.elpriser.app.data.Nets
import org.elpriser.app.data.Position
import org.elpriser.app.data.Zones
import java.text.Normalizer
import java.util.Locale

/** Stedslisten "Hvor er du?" — ligger oven på hele appen: ved første start og fra net-chippen. */
@Composable
fun FlowHost(vm: AppViewModel) {
    val step = vm.step ?: return
    Box(Modifier.fillMaxSize().background(T.bg)) {
        when (step) { is Step.Place -> Place(vm, step) }
    }
}

/**
 * Text as a search compares it: lower case, accents removed, and the letters that do not decompose folded to their plain form
 * ("Österreich" -> "osterreich", "Tromsø" -> "tromso", "Łódź" -> "lodz"), so "osterreich" and "Österreich" find each other.
 */
internal fun fold(s: String): String {
    val plain = Normalizer.normalize(s.trim().lowercase(Locale.ROOT), Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")
    val out = StringBuilder()
    for (c in plain) out.append(UNDECOMPOSED[c.code] ?: c.toString())
    return out.toString()
}

/** Letters Unicode does not split into a base letter and an accent, by code point: o-slash, ae, l-stroke, d-stroke, sharp s, dotless i. */
private val UNDECOMPOSED = mapOf(0xF8 to "o", 0xE6 to "ae", 0x142 to "l", 0x111 to "d", 0xDF to "ss", 0x131 to "i")

/** Søgningen: netselskaber, hvis navn indeholder søgeordet (uden hensyn til store/små bogstaver og accenter). */
internal fun matchNets(q: String): List<Net> {
    val needle = fold(q)
    return if (needle.isEmpty()) emptyList() else Nets.all.filter { fold(it.name).contains(needle) }
}

/** The countries whose name in the user's language contains the search text, in the language's order. */
internal fun matchCountries(q: String, locale: Locale = Locale.getDefault()): List<String> {
    val needle = fold(q)
    return if (needle.isEmpty()) emptyList() else Zones.countriesSorted(locale).filter { fold(Zones.countryName(it, locale)).contains(needle) }
}

/** The screens of the place sheet, stacked: back pops one. */
private sealed interface Page {
    /** Danish context: the position, Denmark and a link to all countries; elsewhere: the user's country and the list of countries. */
    data object Root : Page
    data object Countries : Page
    /** The zones of a country with several (Norway, Sweden; Denmark's two areas lead on to the grid companies). */
    data class ZoneList(val country: String) : Page
    /** Outside the Danish context: Denmark with the position lookup (it finds Danish grid companies only) and the two areas. */
    data object Denmark : Page
    /** One Danish price area: "without grid company" and its grid companies. */
    data class Area(val area: String) : Page
}

@Composable
private fun Place(vm: AppViewModel, step: Step.Place) {
    val t = T
    val tx = rememberStrings()
    val ctx = LocalContext.current
    val cfg = LocalConfiguration.current
    val locale = remember(cfg) { Locale.getDefault() }
    val s = vm.settings
    var stack by remember { mutableStateOf<List<Page>>(listOf(Page.Root)) }
    var q by remember { mutableStateOf("") }
    val page = stack.last()
    val push = { p: Page -> stack = stack + p }
    // The Danish context (the screen as before: grid companies first) is where the current zone is Danish. On a fresh install that is the
    // device's default zone, so a Danish phone gets the Danish welcome and a German one the country list.
    val danishCtx = s.zone.isDanish
    val countries = remember(locale) { Zones.countriesSorted(locale) }
    val foundCountries = matchCountries(q, locale)
    val foundNets = matchNets(q)
    val searching = q.isNotBlank()

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        if (res.values.any { it }) vm.detect(ctx) else vm.positionDenied()
    }
    val ask = {
        if (Position.hasPermission(ctx)) vm.detect(ctx)
        else launcher.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION))
    }
    BackHandler { if (stack.size > 1) stack = stack.dropLast(1) else vm.closeStep() }

    val detail = { a: String ->
        val n = s.net
        when {
            n != null && n.area == a -> n.name
            n == null && s.zoneKey == a.lowercase() -> tx.get(R.string.view_nonet_title)
            else -> null
        }
    }
    val areaName = { a: String -> tx.get(if (a == "DK1") R.string.place_west else R.string.place_east) }
    val titleOf = { p: Page ->
        when (p) {
            Page.Root -> tx.get(R.string.place_title)
            Page.Countries -> tx.get(R.string.place_countries)
            is Page.ZoneList -> tx.get(R.string.place_zone_title)
            Page.Denmark -> Zones.countryName("DK", locale)
            is Page.Area -> areaName(p.area)
        }
    }
    // What a country row says on the right when it is the current one: the zone (NO1 · Oslo) or the grid company.
    val countryDetail = { cc: String ->
        val cur = s.zone
        when {
            cur.country != cc -> null
            cc == "DK" -> s.net?.name ?: areaLabel(tx, cur.code)
            Zones.zonesOf(cc).size > 1 -> Zones.chipText(cur, locale)
            else -> null
        }
    }
    val pickCountry = { cc: String ->
        val zs = Zones.zonesOf(cc)
        when {
            cc == "DK" && !danishCtx -> push(Page.Denmark)
            zs.size == 1 -> vm.chooseZone(zs[0])
            else -> push(Page.ZoneList(cc))
        }
    }

    @Composable
    fun CountryRow(cc: String, sep: Boolean) {
        PlaceRow(
            Zones.countryName(cc, locale), detail = countryDetail(cc), check = s.zone.country == cc,
            chevron = Zones.zonesOf(cc).size > 1, sep = sep,
        ) { pickCountry(cc) }
    }

    @Composable
    fun CountryGroup(list: List<String>) {
        Group { list.forEachIndexed { i, cc -> CountryRow(cc, i > 0) } }
    }

    @Composable
    fun Note() {
        if (step.note != null) {
            Text(tx.get(step.note), Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(t.midSoft).padding(horizontal = 14.dp, vertical = 10.dp),
                fontSize = 13.sp, lineHeight = 19.sp, fontWeight = FontWeight.SemiBold)
        }
    }

    // The position lookup finds Danish grid companies only, so it exists only on the Danish screens.
    @Composable
    fun PositionBlock() {
        Group {
            if (step.searching) {
                Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(color = t.brandSolid, strokeWidth = 2.5.dp, modifier = Modifier.size(20.dp))
                    Text(tx.get(R.string.searching_title), fontSize = 16.sp, fontWeight = FontWeight.Bold)
                }
            } else PlaceRow(tx.get(R.string.place_use_position), icon = Ic.Locate, tint = t.brand, bold = true, onClick = ask)
        }
        Foot(tx.get(if (step.searching) R.string.searching_hint else R.string.place_position_note))
        if (s.net != null && !step.searching) TextAction(tx.get(R.string.place_forget), { vm.forget() }, Modifier.padding(horizontal = 0.dp))
    }

    @Composable
    fun DanishAreas() {
        Group {
            PlaceRow(tx.get(R.string.place_west), detail = detail("DK1"), chevron = true) { push(Page.Area("DK1")) }
            PlaceRow(tx.get(R.string.place_east), detail = detail("DK2"), chevron = true, sep = true) { push(Page.Area("DK2")) }
        }
    }

    @Composable
    fun SettingsRow() {
        Box(Modifier.height(10.dp))
        Group { PlaceRow(tx.get(R.string.place_settings), icon = Ic.Sliders, chevron = true) { vm.closeStep(); vm.tab = Tab.Settings } }
    }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 560.dp).fillMaxSize()) {
            Box(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp)) {
                if (stack.size > 1) {
                    Row(
                        Modifier.align(Alignment.CenterStart).widthIn(max = 150.dp).height(48.dp).clip(RoundedCornerShape(24.dp))
                            .clickable(role = Role.Button) { stack = stack.dropLast(1) }.padding(horizontal = 8.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Icon(Ic.Back, t.brand, 22.dp, stroke = 2.4f)
                        Text(titleOf(stack[stack.size - 2]), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = t.brand, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                Text(
                    titleOf(page), Modifier.align(Alignment.Center).padding(horizontal = if (stack.size > 1) 100.dp else 72.dp),
                    fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Box(
                    Modifier.align(Alignment.CenterEnd).height(48.dp).clip(RoundedCornerShape(24.dp)).clickable(role = Role.Button) { vm.closeStep() }.padding(horizontal = 14.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(tx.get(if (s.onboarded) R.string.place_close else R.string.welcome_skip), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = t.brand, maxLines = 1) }
            }
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                when (page) {
                    is Page.Area -> {
                        val a = page.area
                        Group {
                            PlaceRow(tx.get(R.string.view_nonet_title), check = s.net == null && s.zoneKey == a.lowercase()) { vm.chooseArea(a) }
                            Nets.all.filter { it.area == a }.forEach { n -> PlaceRow(n.name, check = s.net?.gln == n.gln, sep = true) { vm.choose(n, "manual") } }
                        }
                        Foot(tx.get(R.string.place_net_note))
                    }
                    is Page.ZoneList -> {
                        Group {
                            Zones.zonesOf(page.country).forEachIndexed { i, z ->
                                if (z.isDanish) {
                                    PlaceRow(areaLabel(tx, z.code), detail = detail(z.code), chevron = true, sep = i > 0) { push(Page.Area(z.code)) }
                                } else {
                                    PlaceRow(Zones.chipText(z, locale), check = s.zoneKey == z.key, sep = i > 0) { vm.chooseZone(z) }
                                }
                            }
                        }
                        Foot(tx.get(R.string.place_zone_note))
                    }
                    Page.Countries -> {
                        CountryGroup(countries)
                    }
                    Page.Denmark -> {
                        Note()
                        PositionBlock()
                        Box(Modifier.height(4.dp))
                        DanishAreas()
                        Foot(tx.get(R.string.place_net_note))
                    }
                    Page.Root -> {
                        if (!s.onboarded) {
                            Column(Modifier.padding(horizontal = 4.dp, vertical = 6.dp)) {
                                Text(tx.get(if (danishCtx) R.string.welcome_title else R.string.welcome_zone_title), fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.6).sp, lineHeight = 30.sp)
                                Text(tx.get(if (danishCtx) R.string.welcome_body else R.string.welcome_zone_body), Modifier.padding(top = 6.dp), fontSize = 14.sp, lineHeight = 20.sp, color = t.text2, fontWeight = FontWeight.Medium)
                            }
                        }
                        if (danishCtx) Note()
                        Row(Modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(22.dp)).background(t.surface2).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Ic.Search, t.text2, 18.dp, stroke = 2.2f)
                            Box(Modifier.padding(start = 10.dp).weight(1f)) {
                                if (q.isEmpty()) Text(tx.get(R.string.place_search_hint), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = t.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                BasicTextField(q, { q = it }, singleLine = true, cursorBrush = SolidColor(t.brandSolid),
                                    textStyle = TextStyle(fontFamily = Manrope, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = t.text), modifier = Modifier.fillMaxWidth())
                            }
                        }
                        if (searching) {
                            if (foundCountries.isEmpty() && foundNets.isEmpty()) Foot(tx.get(R.string.place_no_match, q.trim()))
                            else {
                                if (foundCountries.isNotEmpty()) CountryGroup(foundCountries)
                                if (foundNets.isNotEmpty()) Group {
                                    foundNets.forEachIndexed { i, n -> PlaceRow(n.name, detail = areaLabel(tx, n.area), check = s.net?.gln == n.gln, sep = i > 0) { vm.choose(n, "manual") } }
                                }
                            }
                        } else if (danishCtx) {
                            PositionBlock()
                            Head(tx.get(R.string.place_group_dk))
                            DanishAreas()
                            Head(tx.get(R.string.place_others))
                            Group { PlaceRow(tx.get(R.string.place_all_countries), chevron = true) { push(Page.Countries) } }
                            SettingsRow()
                        } else {
                            Zones.deviceCountry(locale)?.let { cc ->
                                Head(tx.get(R.string.place_your_country))
                                CountryGroup(listOf(cc))
                            }
                            Head(tx.get(R.string.place_countries))
                            CountryGroup(countries)
                            SettingsRow()
                        }
                    }
                }
                Box(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun Head(text: String) {
    SectionLabel(text, Modifier.padding(start = 16.dp, top = 14.dp, bottom = 2.dp))
}

@Composable
private fun Foot(text: String) {
    Text(text, Modifier.padding(horizontal = 16.dp, vertical = 2.dp), fontSize = 12.5.sp, lineHeight = 18.sp, color = T.text2)
}

/** Én afrundet gruppe af rækker med tynde skillelinjer, som Apples grupperede lister. */
@Composable
private fun Group(content: @Composable () -> Unit) {
    val t = T
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(t.surface).border(BorderStroke(1.dp, t.outline), RoundedCornerShape(20.dp)),
    ) { content() }
}

@Composable
private fun PlaceRow(
    label: String, detail: String? = null, icon: String? = null, tint: Color = T.text, bold: Boolean = false,
    check: Boolean = false, chevron: Boolean = false, sep: Boolean = false, onClick: () -> Unit,
) {
    val t = T
    if (sep) Box(Modifier.padding(start = 16.dp).fillMaxWidth().height(1.dp).background(t.outline))
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (icon != null) Icon(icon, tint, 20.dp, stroke = 2.2f)
        Text(label, Modifier.weight(1f), fontSize = 16.sp, fontWeight = if (bold || check) FontWeight.ExtraBold else FontWeight.SemiBold, color = tint)
        if (detail != null) Text(detail, Modifier.widthIn(max = 160.dp), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = t.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (check) Icon(Ic.Check, t.brandSolid, 20.dp, stroke = 2.6f)
        if (chevron) Icon(Ic.Next, t.text2, 16.dp, stroke = 2.4f)
    }
}
