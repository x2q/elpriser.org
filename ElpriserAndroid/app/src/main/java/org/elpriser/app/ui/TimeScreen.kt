package org.elpriser.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.elpriser.app.AppViewModel
import org.elpriser.app.data.Clock
import org.elpriser.app.data.Day

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimeScreen(vm: AppViewModel, wide: Boolean) {
    val t = T
    val days = vm.days()
    val sel = vm.selDay.coerceIn(0, (days.size - 1).coerceAtLeast(0))
    var hour by remember { mutableStateOf<Int?>(null) }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 20.dp).height(64.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size48().clip(RoundedCornerShape(24.dp)).clickable { vm.tab = org.elpriser.app.Tab.Nu }, contentAlignment = Alignment.Center) {
                Icon(Ic.Back, t.text, 24.dp, stroke = 2.2f)
            }
            Column {
                Text("Time for time", fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.4).sp)
                Text(viewNote(vm.settings), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
            }
        }
        if (days.isEmpty()) {
            Column(Modifier.padding(16.dp)) { if (vm.loading) Loading() else ErrorCard(vm.error ?: "Ingen data endnu.", { vm.refresh(true) }) }
            return
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            days.forEachIndexed { i, d ->
                val on = i == sel
                Column(
                    Modifier.width(62.dp).clip(RoundedCornerShape(18.dp)).background(if (on) t.brandSolid else t.surface)
                        .border(1.dp, if (on) t.brandSolid else t.outline, RoundedCornerShape(18.dp))
                        .clickable { vm.selDay = i }.padding(vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(dayShort(d), fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = if (on) Color.White else t.text2)
                    Text("${d.localDate.dayOfMonth}", fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, color = if (on) Color.White else t.text)
                    Text(if (d.actual) "børs" else "prog.", fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold, color = if (on) Color.White.copy(alpha = .85f) else t.text2)
                }
            }
        }
        val d = days[sel]
        val isToday = d.date == Clock.today()
        val now = Clock.hour()
        val lo = d.price.min(); val hi = d.price.max()
        if (wide) {
            WideDay(vm, d, isToday, now, lo, hi)
            return
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 16.dp)) {
            Text("${dayLong(d)} · tryk på en time for prisopbygningen", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = t.text2, modifier = Modifier.padding(bottom = 8.dp))
            for (r in 0 until 12) {
                Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (h in listOf(r, r + 12)) {
                        val p = d.price[h]
                        val cur = isToday && h == now
                        Row(
                            Modifier.weight(1f).height(52.dp).clip(RoundedCornerShape(16.dp)).background(t.surface)
                                .border(if (cur) 2.dp else 1.dp, if (cur) t.brandSolid else t.outline, RoundedCornerShape(16.dp))
                                .clickable { hour = h },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(Modifier.width(6.dp).fillMaxHeight().background(ramp(if (hi == lo) 0.0 else (p - lo) / (hi - lo))))
                            Column(Modifier.padding(start = 10.dp)) {
                                Text(hh(h), fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
                                Text(fmt(p), fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
                            }
                        }
                    }
                }
            }
        }
        val h = hour
        if (h != null) {
            ModalBottomSheet(onDismissRequest = { hour = null }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = t.surface) {
                Breakdown(vm, d, h, sheet = true)
            }
        }
    }
}

/**
 * Tablet: dagens graf øverst, døgnet som et kompakt gitter (6 × 4, læst som et ur: 00–05 øverst),
 * og prisopbygningen for den valgte time står fast til højre i stedet for i et ark.
 */
@Composable
private fun WideDay(vm: AppViewModel, d: Day, isToday: Boolean, now: Int, lo: Double, hi: Double) {
    val t = T
    val cheapH = d.price.indexOf(lo); val dearH = d.price.indexOf(hi)
    var chosen by remember(d.date) { mutableIntStateOf(if (isToday) now else cheapH) }
    Row(Modifier.fillMaxSize().padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            AppCard {
                Text(dayLong(d), fontSize = 17.sp, fontWeight = FontWeight.ExtraBold)
                Text(if (d.actual) "Offentliggjorte børspriser" else "Modelprognose med P10–P90-bånd", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
                Box(Modifier.height(8.dp))
                PriceChart(d.price, if (d.actual) 24 else 0, if (isToday) now else null, lo = d.lo, hi = d.hi, bandFrom = 0, height = 170.dp)
            }
            Text("Tryk på en time for at se, hvad prisen består af", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
            for (r in 0 until 4) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (c in 0 until 6) {
                        val h = r * 6 + c
                        val p = d.price[h]
                        val picked = h == chosen
                        val cur = isToday && h == now
                        val tag = when (h) { cheapH -> "billigst"; dearH -> "dyrest"; else -> if (cur) "nu" else "" }
                        Column(
                            Modifier.weight(1f).clip(RoundedCornerShape(16.dp))
                                .background(if (picked) t.brandSoft else t.surface)
                                .border(if (picked) 2.dp else 1.dp, if (picked) t.brandSolid else t.outline, RoundedCornerShape(16.dp))
                                .clickable { chosen = h },
                        ) {
                            Box(Modifier.fillMaxWidth().height(6.dp).background(ramp(if (hi == lo) 0.0 else (p - lo) / (hi - lo))))
                            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                                Text(hh(h), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
                                Text(fmt(p), fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
                                Text(tag, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                                    color = when (tag) { "billigst" -> t.good; "dyrest" -> t.bad; else -> t.brand }, modifier = Modifier.height(15.dp))
                            }
                        }
                    }
                }
            }
        }
        AppCard(Modifier.width(340.dp)) { Breakdown(vm, d, chosen, sheet = false) }
    }
}

private fun Modifier.size48() = this.then(Modifier.width(48.dp).height(48.dp))

private class Part(val label: String, val value: Double, val color: Color)

@Composable
private fun Breakdown(vm: AppViewModel, d: Day, h: Int, sheet: Boolean) {
    val t = T
    val hasNet = vm.settings.net != null
    fun at(mode: String): Double? = vm.days(mode).firstOrNull { it.date == d.date }?.price?.get(h)
    val a = at("inkl_alt"); val sp = at("spot_inkl"); val n = if (hasNet) at("net_inkl_alt") else null
    val total = n ?: a
    Column(Modifier.fillMaxWidth().then(if (sheet) Modifier.navigationBarsPadding().padding(horizontal = 24.dp).padding(bottom = 24.dp) else Modifier)) {
        Text("Kl. ${hh(h)} · ${dayLong(d)}", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = t.text2)
        if (total == null || a == null || sp == null) {
            Text("Prisopbygningen er ikke hentet endnu.", Modifier.padding(vertical = 24.dp), fontSize = 15.sp)
            return@Column
        }
        Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 4.dp)) {
            Text(fmt(total), fontSize = 52.sp, fontWeight = FontWeight.Bold, letterSpacing = (-2).sp)
            Text(" kr/kWh", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = t.text2, modifier = Modifier.padding(bottom = 10.dp))
        }
        val spot = sp / 1.25
        val grid = if (n != null) (n - a) / 1.25 else 0.0
        val rest = a / 1.25 - spot
        val vat = total - total / 1.25
        val parts = buildList {
            add(Part("Spotpris", spot, t.brandSolid))
            if (n != null) add(Part("${vm.settings.net?.name}s nettarif", grid, Color(0xFFFF9500)))
            add(Part("Energinets tariffer og elafgift", rest, Color(0xFFA8D84A)))
            add(Part("Moms (25 %)", vat, t.text2))
        }
        Box(Modifier.height(14.dp))
        Row(Modifier.fillMaxWidth().height(14.dp).clip(RoundedCornerShape(7.dp))) {
            parts.forEach { p -> if (p.value > 0) Box(Modifier.weight(p.value.toFloat()).fillMaxHeight().background(p.color)) }
        }
        Box(Modifier.height(10.dp))
        parts.forEach { p ->
            Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(12.dp).height(12.dp).clip(RoundedCornerShape(4.dp)).background(p.color))
                Text(p.label, Modifier.weight(1f).padding(start = 10.dp), fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold)
                Text(fmt(p.value), fontSize = 14.5.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.End)
            }
        }
        if (!hasNet) Text("Vælg dit netselskab under Mere for at få nettariffen med.", Modifier.padding(top = 6.dp), fontSize = 12.5.sp, color = t.text2)
    }
}
