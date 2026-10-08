package org.elpriser.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.elpriser.app.AppViewModel
import org.elpriser.app.data.Clock
import org.elpriser.app.data.Device

private class Plan(val d: Device, val hours: Set<Int>, val avg: Double, val kwh: Double, val save: Double)

private fun iconFor(key: String) = when (key) { "heatpump" -> Ic.Heat; "car" -> Ic.Car; else -> Ic.Drop }

@Composable
fun AutomationScreen(vm: AppViewModel, wide: Boolean) {
    val t = T
    val s = vm.settings
    val today = vm.days().firstOrNull { it.date == Clock.today() }
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Automation", "Kør efter de billigste timer i dag")
        if (today == null) {
            Column(Modifier.padding(16.dp)) { if (vm.loading) Loading() else ErrorCard(vm.error ?: "Ingen priser for i dag endnu.", { vm.refresh(true) }) }
            return
        }
        val prices = today.price
        val dayAvg = prices.average()
        val order = prices.mapIndexed { h, p -> h to p }.sortedBy { it.second }
        val plans = s.devices.map { d ->
            val chosen = order.take(d.hours)
            val kwh = d.hours * d.kw
            val cost = chosen.sumOf { it.second * d.kw }
            Plan(d, chosen.map { it.first }.toSet(), chosen.map { it.second }.average(), kwh, dayAvg * kwh - cost)
        }
        val active = plans.filter { it.d.on }
        val saveTotal = active.sumOf { it.save }
        val kwhTotal = active.sumOf { it.kwh }

        val summary: @Composable () -> Unit = {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(t.brandSolid).padding(horizontal = 20.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("BESPARELSE I DAG", fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, color = Color.White.copy(alpha = .85f))
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(fmt(saveTotal), fontSize = 36.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1).sp, color = Color.White)
                        Text(" kr", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White, modifier = Modifier.padding(bottom = 6.dp))
                    }
                }
                Text("${active.size} ${if (active.size == 1) "enhed aktiv" else "enheder aktive"}\n${fmt(kwhTotal, 1)} kWh flyttet",
                    fontSize = 13.sp, lineHeight = 19.sp, fontWeight = FontWeight.SemiBold, color = Color.White, textAlign = TextAlign.End)
            }
        }
        val devices: @Composable () -> Unit = {
            plans.forEach { p ->
                DeviceCard(p.d, p.hours, prices, p.avg, p.save, wide) { nd -> s.updateDevices(s.devices.map { if (it.key == nd.key) nd else it }) }
            }
        }
        val export: @Composable () -> Unit = { ExportCard(vm, plans.filter { it.d.on }.map { it.d to it.hours }, today.date) }

        if (wide) {
            Row(Modifier.fillMaxSize().padding(start = 20.dp, end = 20.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) { summary(); devices() }
                Column(Modifier.width(400.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    PlanCard(prices, plans.map { it.d to it.hours })
                    export()
                }
            }
        } else {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                summary(); devices(); export()
            }
        }
    }
}

@Composable
private fun DeviceCard(d: Device, hours: Set<Int>, prices: List<Double>, avg: Double, save: Double, wide: Boolean, onChange: (Device) -> Unit) {
    val t = T
    AppCard(Modifier.alpha(if (d.on) 1f else 0.72f), padding = androidx.compose.foundation.layout.PaddingValues(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).clip(CircleShape).background(t.brandSoft), contentAlignment = Alignment.Center) { Icon(iconFor(d.key), t.brand, 22.dp) }
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(d.name, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
                Text("${fmt(d.kw, 1)} kW · billigste timer", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
            }
            Switch(
                checked = d.on, onCheckedChange = { onChange(d.copy(on = it)) },
                colors = SwitchDefaults.colors(checkedTrackColor = t.brandSolid, checkedThumbColor = Color.White, uncheckedTrackColor = t.surface2, uncheckedThumbColor = t.text2, uncheckedBorderColor = t.text2),
            )
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.clip(RoundedCornerShape(22.dp)).background(t.surface2).padding(2.dp), verticalAlignment = Alignment.CenterVertically) {
                Stepper("−", "En time mindre") { onChange(d.copy(hours = (d.hours - 1).coerceAtLeast(1))) }
                Text("${d.hours} ${if (d.hours == 1) "time" else "timer"}", Modifier.width(78.dp), fontSize = 14.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
                Stepper("+", "En time mere") { onChange(d.copy(hours = (d.hours + 1).coerceAtMost(12))) }
            }
            Box(Modifier.weight(1f))
            Text("gns. ${fmt(avg)} kr/kWh\nspar ${fmt(save)} kr", fontSize = 12.5.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold, color = t.text2, textAlign = TextAlign.End)
        }
        Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            prices.indices.forEach { h ->
                Box(Modifier.weight(1f).height(if (wide) 24.dp else 20.dp).clip(RoundedCornerShape(5.dp)).background(
                    if (h in hours) (if (d.on) t.brandSolid else t.text2.copy(alpha = .5f)) else t.surface2))
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 3.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            listOf("00", "06", "12", "18", "24").forEach { Text(it, fontSize = 10.5.sp, color = t.text2) }
        }
    }
}

@Composable
private fun Stepper(label: String, desc: String, onClick: () -> Unit) {
    Box(Modifier.size(40.dp).clip(CircleShape).clickable(onClickLabel = desc, onClick = onClick), contentAlignment = Alignment.Center) {
        Text(label, fontSize = 22.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun PlanCard(prices: List<Double>, rows: List<Pair<Device, Set<Int>>>) {
    val t = T
    AppCard {
        SectionLabel("Dagens plan")
        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Pris", Modifier.width(96.dp), fontSize = 12.5.sp, fontWeight = FontWeight.Bold, color = t.text2)
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                val now = Clock.hour()
                prices.forEachIndexed { h, p ->
                    Box(Modifier.weight(1f).height(22.dp).clip(RoundedCornerShape(3.dp)).background(ramp(tOf(p, prices))))
                }
            }
        }
        rows.forEach { (d, hrs) ->
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(d.name, Modifier.width(96.dp), fontSize = 12.5.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                    prices.indices.forEach { h -> Box(Modifier.weight(1f).height(22.dp).clip(RoundedCornerShape(3.dp)).background(if (d.on && h in hrs) t.brandSolid else t.surface2)) }
                }
            }
        }
    }
}

@Composable
private fun ExportCard(vm: AppViewModel, plans: List<Pair<Device, Set<Int>>>, date: String) {
    val t = T
    val ctx = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    val s = vm.settings
    val json = buildString {
        append("{\n  \"area\": \"${s.effectiveArea}\", \"mode\": \"${s.mode}\", \"date\": \"$date\",\n  \"devices\": [\n")
        plans.forEachIndexed { i, (d, hrs) ->
            append("    { \"name\": \"${d.name.lowercase()}\",\n      \"hours\": [${hrs.sorted().joinToString(", ")}] }${if (i < plans.size - 1) "," else ""}\n")
        }
        append("  ]\n}")
    }
    AppCard(padding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Hent planen til Home Assistant", fontSize = 14.5.sp, fontWeight = FontWeight.ExtraBold)
                Text("eller Shelly — JSON med de valgte timer", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
            }
            SoftButton(if (copied) "Kopieret" else "Kopiér", {
                (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Elpriser-plan", json))
                copied = true
            }, bg = t.brandSoft, fg = t.brand)
        }
        Text(json, Modifier.fillMaxWidth().padding(top = 10.dp).clip(RoundedCornerShape(14.dp)).background(t.surface2).padding(12.dp),
            fontFamily = FontFamily.Monospace, fontSize = 11.sp, lineHeight = 16.sp)
    }
}
