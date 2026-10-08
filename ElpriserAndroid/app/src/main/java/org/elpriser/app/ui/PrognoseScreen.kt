package org.elpriser.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.elpriser.app.AppViewModel
import org.elpriser.app.Tab
import org.elpriser.app.data.Day

@Composable
fun RangeBar(min: Double, max: Double, lo: Double, hi: Double, modifier: Modifier = Modifier) {
    val t = T
    val span = (hi - lo).takeIf { it > 0 } ?: 1.0
    Canvas(modifier.padding(horizontal = 6.dp).height(10.dp)) {
        val r = CornerRadius(5.dp.toPx())
        drawRoundRect(t.surface2, size = size, cornerRadius = r)
        val a = ((min - lo) / span).toFloat(); val b = ((max - lo) / span).toFloat()
        val x0 = a * size.width; val w = ((b - a) * size.width).coerceAtLeast(10.dp.toPx())
        drawRoundRect(Brush.horizontalGradient(listOf(ramp(a.toDouble()), ramp(b.toDouble())), startX = x0, endX = x0 + w),
            topLeft = Offset(x0.coerceAtMost(size.width - w), 0f), size = Size(w, size.height), cornerRadius = r)
    }
}

@Composable
fun PrognoseScreen(vm: AppViewModel, wide: Boolean) {
    val t = T
    val s = vm.settings
    var basis by remember { mutableIntStateOf(0) }
    val mode = if (basis == 0) s.mode else "spot_inkl"
    val days = vm.days(mode)
    val sel = vm.selDay.coerceIn(0, (days.size - 1).coerceAtLeast(0))
    val ownLabel = if (s.mode == "net_inkl_alt") "Din pris" else "Valgt visning"

    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Prognose", "10 døgn frem · børspris og modelprognose")
        if (days.isEmpty()) {
            Column(Modifier.padding(16.dp)) { if (vm.loading) Loading() else ErrorCard(vm.error ?: "Ingen data endnu.", { vm.refresh(true) }) }
            return
        }
        val list: @Composable () -> Unit = {
            if (s.mode != "spot_inkl") Segmented(listOf(ownLabel, "Spot inkl. moms"), basis, { basis = it }, Modifier.fillMaxWidth())
            AppCard(padding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)) {
                val lo = days.minOf { it.price.min() }; val hi = days.maxOf { it.price.max() }
                days.forEachIndexed { i, d ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                            .background(if (i == sel) t.brandSoft else androidx.compose.ui.graphics.Color.Transparent)
                            .clickable { vm.selDay = i }.padding(horizontal = 10.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.width(if (wide) 128.dp else 100.dp)) {
                            Text(dayLabel(d), fontSize = 14.sp, fontWeight = FontWeight.Bold)
                            Text("${dayMonth(d)} · ${if (d.actual) "børspris" else "prognose"}", fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
                        }
                        RangeBar(d.price.min(), d.price.max(), lo, hi, Modifier.weight(1f))
                        Text(fmt(d.price.average()), Modifier.width(54.dp), fontSize = 14.5.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.End)
                    }
                }
            }
        }
        val detail: @Composable () -> Unit = { DayDetail(vm, days[sel]) }
        if (wide) {
            Row(Modifier.fillMaxSize().padding(start = 20.dp, end = 20.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) { list() }
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) { detail() }
            }
        } else {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                list(); detail()
            }
        }
    }
}

@Composable
private fun DayDetail(vm: AppViewModel, d: Day) {
    val t = T
    AppCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(dayLong(d), fontSize = 17.sp, fontWeight = FontWeight.ExtraBold)
                Text(if (d.actual) "Offentliggjorte børspriser" else "Modelprognose med P10–P90-bånd", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
            }
        }
        Box(Modifier.height(10.dp))
        PriceChart(d.price, if (d.actual) 24 else 0, null, lo = d.lo, hi = d.hi, bandFrom = 0)
        Box(Modifier.height(10.dp))
        val cheap = cheapestWindow(d.price, 3); val peak = cheapestWindow(d.price, 3, true)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatTile("Billigste 3 t", fmt(cheap.avg), "kl. ${cheap.label}", t.good, Modifier.weight(1f))
            StatTile("Dyreste 3 t", fmt(peak.avg), "kl. ${peak.label}", t.bad, Modifier.weight(1f))
        }
        if (d.lo != null && d.hi != null) {
            Text(
                "Usikkerhed: gennemsnittet ligger mellem ${fmt(d.lo.average())} og ${fmt(d.hi.average())} kr/kWh (P10–P90). Jo længere frem, jo bredere bånd.",
                fontSize = 12.5.sp, lineHeight = 18.sp, color = t.text2, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 10.dp),
            )
        }
        Box(Modifier.padding(top = 10.dp)) { SoftButton("Se time for time", { vm.tab = Tab.Time }, bg = t.brandSoft, fg = t.brand) }
    }
    vm.model()?.let {
        Text("Prognosen kommer fra en åben model (${it}) og opdateres hver dag. Se modellen og data på huggingface.co/Elpriser.",
            fontSize = 11.5.sp, lineHeight = 17.sp, color = t.text2, modifier = Modifier.padding(horizontal = 8.dp))
    }
}
