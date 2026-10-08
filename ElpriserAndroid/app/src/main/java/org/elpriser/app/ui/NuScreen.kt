package org.elpriser.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.elpriser.app.AppViewModel
import org.elpriser.app.Tab
import org.elpriser.app.data.Clock
import org.elpriser.app.data.Day
import org.elpriser.app.data.Settings

/** Aktuel visning som tekst: hvad prisen indeholder. */
fun viewNote(s: Settings): String = when (s.mode) {
    "net_inkl_alt" -> "inkl. ${s.net?.name}-nettarif, afgifter og moms"
    "inkl_alt" -> "inkl. tariffer, afgifter og moms · uden netselskab"
    "spot_inkl" -> "spotpris inkl. moms"
    else -> "spotpris ekskl. moms"
}

fun areaName(area: String) = if (area == "DK1") "Vestdanmark" else "Østdanmark"

/** Sammensat serie for flere døgn: priser, P10/P90 (faktiske døgn bruger prisen selv) og antal faktiske punkter. */
class Series(val vals: List<Double>, val lo: List<Double>, val hi: List<Double>, val nSolid: Int, val bandFrom: Int)

fun combine(days: List<Day>): Series {
    val vals = days.flatMap { it.price }
    val lo = days.flatMap { it.lo ?: it.price }
    val hi = days.flatMap { it.hi ?: it.price }
    val firstFc = days.indexOfFirst { !it.actual }
    val n = if (firstFc < 0) vals.size else firstFc * 24
    return Series(vals, lo, hi, n, n)
}

@Composable
fun NuScreen(vm: AppViewModel, wide: Boolean) {
    val t = T
    val s = vm.settings
    val days = vm.days()
    val today = days.firstOrNull()?.takeIf { it.date == Clock.today() }
    val netLabel = s.net?.let { "${it.areaLabel} · ${it.name}" } ?: "${s.effectiveArea} · vælg netselskab"

    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Nu", todayLong()) {
            Row(
                Modifier.height(44.dp).clip(RoundedCornerShape(22.dp)).background(t.surface2)
                    .clickable(role = Role.Button) { vm.openPicker() }.padding(start = 16.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(netLabel, fontSize = 13.5.sp, fontWeight = FontWeight.Bold)
                Icon(Ic.Down, t.text, 18.dp, stroke = 2.2f)
            }
        }
        if (today == null) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
                if (vm.loading) Loading() else ErrorCard(vm.error ?: "Ingen priser for i dag endnu.", { vm.refresh(true) })
            }
            return
        }
        if (wide) {
            Row(Modifier.fillMaxSize().padding(start = 20.dp, end = 20.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    NuMain(vm, today, days)
                }
                Column(Modifier.width(360.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    WeekList(vm, days)
                }
            }
        } else {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                NuMain(vm, today, days)
            }
        }
    }
}

@Composable
private fun NuMain(vm: AppViewModel, today: Day, days: List<Day>) {
    val t = T
    val s = vm.settings
    val now = Clock.hour()
    val vals = today.price
    val price = vals[now]
    val v = verdict(price, vals)
    val (vbg, vfg) = when (v.kind) { 0 -> t.goodSoft to t.good; 1 -> t.midSoft to t.mid; else -> t.badSoft to t.bad }
    val co2 = vm.co2[today.date]
    val cheap = cheapestWindow(vals, 3)
    val peak = cheapestWindow(vals, 3, highest = true)
    val save = Math.round((1 - cheap.avg / peak.avg) * 100).toInt()
    var range by remember { mutableIntStateOf(0) }

    vm.error?.let { ErrorCard(it, { vm.refresh(true) }) }

    AppCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 18.dp)) {
        Text("${areaName(s.effectiveArea)} · ${s.effectiveArea}${s.net?.let { " · ${it.name}" } ?: ""} · LIGE NU KL. ${pad(now)}".uppercase(),
            fontSize = 11.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp, color = t.text2)
        Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 4.dp)) {
            Text(fmt(price), fontSize = 72.sp, fontWeight = FontWeight.Bold, letterSpacing = (-3).sp, lineHeight = 76.sp)
            Text(" kr/kWh", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = t.text2, modifier = Modifier.padding(bottom = 12.dp))
        }
        Text(viewNote(s), fontSize = 13.sp, color = t.text2, fontWeight = FontWeight.Medium)
        Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill(v.label, vbg, vfg)
            if (co2 != null) Pill("${co2[now]} g CO₂/kWh", t.co2Soft, t.co2)
        }
    }

    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(t.brandSolid).padding(horizontal = 18.dp, vertical = 14.dp)) {
        val inCheap = now >= cheap.s && now < cheap.e
        Text(
            (if (inCheap) "Strømmen er billig nu. " else "") +
                "De tre billigste timer i dag er kl. ${cheap.label} — ${fmt(cheap.avg)} kr/kWh i snit, $save % under spidsen kl. ${peak.label}.",
            fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, lineHeight = 21.sp, color = Color.White,
        )
    }

    AppCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Prisen time for time", fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
            Segmented(listOf("I dag", "3 døgn"), range, { range = it }, Modifier.width(190.dp))
        }
        Box(Modifier.height(10.dp))
        if (range == 0) {
            PriceChart(vals, if (today.actual) 24 else 0, now, lo = today.lo, hi = today.hi, bandFrom = 0)
        } else {
            val three = days.take(3)
            val c = combine(three)
            PriceChart(c.vals, c.nSolid, now, lo = c.lo, hi = c.hi, bandFrom = c.bandFrom, days = three.size, dayNames = three.map { dayLabel(it) })
        }
        Box(Modifier.padding(top = 8.dp)) { SoftButton("Se time for time", { vm.tab = Tab.Time }, bg = t.brandSoft, fg = t.brand) }
    }

    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val lo = vals.min(); val hi = vals.max()
        StatTile("Billigst", fmt(lo), "kl. ${pad(vals.indexOf(lo))}", t.good, Modifier.weight(1f))
        StatTile("Dyrest", fmt(hi), "kl. ${pad(vals.indexOf(hi))}", t.bad, Modifier.weight(1f))
        if (co2 != null) {
            val g = co2.min()
            StatTile("Grønnest", "$g", "g kl. ${pad(co2.indexOf(g))}", t.co2, Modifier.weight(1f))
        }
    }
}

@Composable
fun WeekList(vm: AppViewModel, days: List<Day>) {
    val t = T
    AppCard {
        SectionLabel("Næste 7 døgn")
        val shown = days.take(7)
        val lo = shown.minOf { it.price.min() }; val hi = shown.maxOf { it.price.max() }
        shown.forEach { d ->
            Row(Modifier.fillMaxWidth().clickable { vm.tab = Tab.Prognose }.padding(vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.width(92.dp)) {
                    Text(dayLabel(d), fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    Text(if (d.actual) "Børspris" else "Prognose", fontSize = 11.5.sp, color = t.text2, fontWeight = FontWeight.SemiBold)
                }
                RangeBar(d.price.min(), d.price.max(), lo, hi, Modifier.weight(1f))
                Text(fmt(d.price.average()), Modifier.width(52.dp), fontSize = 14.sp, fontWeight = FontWeight.ExtraBold,
                    textAlign = androidx.compose.ui.text.style.TextAlign.End)
            }
        }
    }
}
