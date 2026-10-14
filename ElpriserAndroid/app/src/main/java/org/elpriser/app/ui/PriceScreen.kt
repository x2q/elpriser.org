package org.elpriser.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.elpriser.app.AppViewModel
import org.elpriser.app.Tab
import org.elpriser.app.data.Clock
import org.elpriser.app.data.Day
import kotlin.math.abs

/* ── Design A: ét svar. Prisen nu, ét valg af visning og én graf. ───────────────────────── */

private val BarLow = Color(0xFF1E9E5A)
private val BarMid = Color(0xFFF0A30A)
private val BarHigh = Color(0xFFE5484D)
private val Navy = Color(0xFF14308F)
private val Ink = Color(0xFF0E1530)
private val FigureFeatures = "tnum"

/** Søjle- og pillefarver pr. niveau (0 billig, 1 middel, 2 dyr). Lyst tema følger designet, mørkt bruger appens egne toner. */
private class TierColors(val bar: Color, val bg: Color, val fg: Color)

@Composable
private fun tierColors(kind: Int): TierColors {
    val t = T
    return if (t.dark) when (kind) {
        0 -> TierColors(BarLow, t.goodSoft, t.good)
        1 -> TierColors(BarMid, t.midSoft, t.mid)
        else -> TierColors(BarHigh, t.badSoft, t.bad)
    } else when (kind) {
        0 -> TierColors(BarLow, Color(0xFFE4F6EC), Color(0xFF137A43))
        1 -> TierColors(BarMid, Color(0xFFFEF3D7), Color(0xFF9A6700))
        else -> TierColors(BarHigh, Color(0xFFFDECEC), Color(0xFFB42318))
    }
}

private fun barOf(kind: Int) = when (kind) { 0 -> BarLow; 1 -> BarMid; else -> BarHigh }

@Composable
fun PriceScreen(vm: AppViewModel, wide: Boolean) {
    val s = vm.settings
    var period by rememberSaveable { mutableIntStateOf(0) }
    val days = vm.days()
    val today = days.firstOrNull()?.takeIf { it.date == Clock.today() }

    Column(Modifier.fillMaxSize()) {
        PriceHeader(vm, wide)
        if (today == null) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
                if (vm.loading) Loading() else ErrorCard(vm.error ?: "Ingen priser for i dag endnu.", { vm.refresh(true) })
            }
            return@Column
        }

        val two = days.take(2)
        val twoVals = two.flatMap { it.price }
        val now = Clock.hour()
        val price = twoVals[now]
        val kind = verdict(price, twoVals).kind
        val verdictLabel = verdict(price, twoVals).label
        val sentence = cheaperSentence(twoVals, now)
        val cheapest = cheapestTile(twoVals, now)
        val priciest = priciestTile(twoVals, now)

        // 3–10 døgn: døgn 3 til 10 fra i dag. Mangler de, falder vi tilbage til det, der er.
        val later = days.drop(2).take(8)
        val showLater = period == 1 && later.isNotEmpty()
        val shownDays = if (showLater) later else two
        val shownVals = if (showLater) later.flatMap { it.price } else twoVals
        val shownPeriod = if (showLater) 1 else 0
        val tiers = remember(shownVals) { IntArray(shownVals.size) { verdict(shownVals[it], shownVals).kind } }
        val axis = remember(shownVals) { axisFor(shownVals) }
        val nowIndex = if (shownPeriod == 0) now else null

        val modeIdx = if (s.view >= 2) 1 else 0
        val onMode: (Int) -> Unit = { s.updateView(if (it == 0) 0 else 2) }
        val caption = priceCaption(s.mode)

        val summary = buildString {
            append(periodTitle(shownPeriod)).append(". ")
            cheapest?.let { append("${it.label}: ${fmt(it.price)} kr kl. ${pad(it.hour)}. ") }
            priciest?.let { append("${it.label}: ${fmt(it.price)} kr kl. ${pad(it.hour)}. ") }
            append("Tryk eller træk på grafen for at se prisen time for time.")
        }

        val hero: @Composable (Modifier) -> Unit = { m ->
            HeroCard(m, wide, now, price, kind, verdictLabel, sentence, caption, modeIdx, onMode)
        }
        val chart: @Composable () -> Unit = {
            PriceChartCard(
                wide = wide, period = shownPeriod, days = shownDays, vals = shownVals, tiers = tiers, axis = axis,
                nowIndex = nowIndex, summary = summary, caption = caption, modeIdx = modeIdx, onMode = onMode,
            )
        }
        val tiles: @Composable () -> Unit = { StatTiles(cheapest, priciest, wide) }

        BoxWithConstraints(Modifier.fillMaxSize()) {
            val gutter = if (wide) 24.dp else 20.dp
            val twoCol = wide && maxWidth >= 820.dp
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = gutter, end = gutter, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(if (wide) 24.dp else 20.dp),
            ) {
                vm.error?.let { ErrorCard(it, { vm.refresh(true) }) }
                if (twoCol) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        hero(Modifier.width(420.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                            PeriodPill(shownPeriod, { period = it }, wide = true)
                            chart()
                            tiles()
                        }
                    }
                } else {
                    if (wide) hero(Modifier.fillMaxWidth()) else hero(Modifier)
                    PeriodPill(shownPeriod, { period = it }, wide = wide)
                    chart()
                    tiles()
                }
            }
        }
    }
}

/* ── Hoved ───────────────────────────────────────────────────────────────────────────── */

@Composable
private fun PriceHeader(vm: AppViewModel, wide: Boolean) {
    val t = T
    val s = vm.settings
    val chipText = s.net?.let { "${it.name} · ${areaShort(it.area)}" } ?: "${s.effectiveArea} · ${areaShort(s.effectiveArea)}"
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = if (wide) 24.dp else 20.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        if (wide) {
            Column {
                Text("Pris", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.5).sp, lineHeight = 30.sp)
                Text(todayLong(), fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(t.brandSolid), contentAlignment = Alignment.Center) {
                    Icon(Ic.Bolt, Color.White, 16.dp, fill = true)
                }
                Text("elpriser", fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.2).sp)
            }
        }
        // Selve chippen er 36 dp høj; trykfladen er 44 dp.
        Box(
            Modifier.height(44.dp).clickable(role = Role.Button, onClickLabel = "Åbn netselskab og indstillinger") { vm.tab = Tab.Settings },
            contentAlignment = Alignment.Center,
        ) {
            Row(
                Modifier.height(36.dp).clip(RoundedCornerShape(18.dp)).background(t.surface)
                    .border(BorderStroke(1.dp, t.outline), RoundedCornerShape(18.dp)).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(Ic.Pin, t.brandSolid, 14.dp, stroke = 2.2f)
                Text(chipText, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/* ── Prisen nu ───────────────────────────────────────────────────────────────────────── */

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HeroCard(
    modifier: Modifier, wide: Boolean, now: Int, price: Double, kind: Int, verdictLabel: String,
    sentence: String, caption: String, modeIdx: Int, onMode: (Int) -> Unit,
) {
    val t = T
    val tier = tierColors(kind)
    val figures = TextStyle(fontFeatureSettings = FigureFeatures)
    val content: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(if (wide) 18.dp else 10.dp)) {
            Text(heroLabel(now, if (wide) todayWeekday() else null), fontSize = if (wide) 14.sp else 13.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
            Row {
                Text(
                    fmt(price), Modifier.alignByBaseline(), style = figures,
                    fontSize = if (wide) 96.sp else 76.sp, fontWeight = FontWeight.ExtraBold,
                    letterSpacing = if (wide) (-4.5).sp else (-3).sp, lineHeight = if (wide) 100.sp else 78.sp,
                )
                Text("kr/kWh", Modifier.alignByBaseline().padding(start = 8.dp), fontSize = if (wide) 22.sp else 18.sp, fontWeight = FontWeight.Bold, color = t.text2)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                Row(
                    Modifier.height(if (wide) 34.dp else 30.dp).clip(RoundedCornerShape(17.dp)).background(tier.bg).padding(horizontal = if (wide) 14.dp else 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(tier.bar))
                    Text(verdictLabel, fontSize = if (wide) 15.sp else 14.sp, fontWeight = FontWeight.ExtraBold, color = tier.fg)
                }
                if (!wide) Text(sentence, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = t.text.copy(alpha = 0.85f), style = figures)
            }
            if (wide) {
                Text(sentence, fontSize = 18.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold, color = t.text.copy(alpha = 0.85f), style = figures)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                    ModeSwitch(modeIdx, onMode, large = true)
                    Text(caption, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
                }
            }
        }
    }
    if (wide) {
        Box(
            modifier.clip(RoundedCornerShape(28.dp)).background(t.surface)
                .border(BorderStroke(1.dp, t.outline), RoundedCornerShape(28.dp)).padding(32.dp),
        ) { content() }
    } else {
        Box(modifier) { content() }
    }
}

/* ── Valg ────────────────────────────────────────────────────────────────────────────── */

/** Din pris | Spotpris. Det synlige felt er lavt; trykfladen er 44 dp. */
@Composable
private fun ModeSwitch(selected: Int, onSelect: (Int) -> Unit, large: Boolean = false) {
    val t = T
    val radius = if (large) 14.dp else 12.dp
    val visual = if (large) 44.dp else 36.dp
    Row(
        Modifier.height(44.dp).drawBehind {
            val inset = (size.height - visual.toPx()) / 2
            drawRoundRect(t.surface2, Offset(0f, inset), Size(size.width, visual.toPx()), CornerRadius(radius.toPx()))
        }.padding(horizontal = 4.dp).semantics { contentDescription = "Prisvisning" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        listOf("Din pris", "Spotpris").forEachIndexed { i, label ->
            val on = i == selected
            Box(
                Modifier.height(44.dp).selectable(on, role = Role.RadioButton, onClick = { onSelect(i) }),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier.height(visual - 8.dp).clip(RoundedCornerShape(radius - 3.dp))
                        .background(if (on) t.surface else Color.Transparent).padding(horizontal = if (large) 16.dp else 10.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(label, fontSize = if (large) 14.sp else 12.sp, fontWeight = if (on) FontWeight.ExtraBold else FontWeight.Bold, color = if (on) t.text else t.text2)
                }
            }
        }
    }
}

/** 2 døgn | 3–10 døgn. */
@Composable
private fun PeriodPill(selected: Int, onSelect: (Int) -> Unit, wide: Boolean) {
    val t = T
    val active = if (t.dark) t.brand else Navy
    val onActive = if (t.dark) t.bg else Color.White
    val shape = RoundedCornerShape(30.dp)
    Row(
        Modifier.then(if (wide) Modifier else Modifier.fillMaxWidth())
            .shadow(if (t.dark) 0.dp else 5.dp, shape, ambientColor = Ink.copy(alpha = 0.12f), spotColor = Ink.copy(alpha = 0.12f))
            .clip(shape).background(t.surface)
            .then(if (t.dark) Modifier.border(BorderStroke(1.dp, t.outline), shape) else Modifier)
            .padding(4.dp).semantics { contentDescription = "Periode" },
    ) {
        listOf("2 døgn", "3–10 døgn").forEachIndexed { i, label ->
            val on = i == selected
            Box(
                (if (wide) Modifier else Modifier.weight(1f)).height(48.dp)
                    .clip(RoundedCornerShape(26.dp)).background(if (on) active else Color.Transparent)
                    .selectable(on, role = Role.Tab, onClick = { onSelect(i) })
                    .then(if (wide) Modifier.padding(horizontal = 26.dp) else Modifier),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, color = if (on) onActive else active)
            }
        }
    }
}

/* ── Grafkort ────────────────────────────────────────────────────────────────────────── */

@Composable
private fun PriceChartCard(
    wide: Boolean, period: Int, days: List<Day>, vals: List<Double>, tiers: IntArray, axis: Axis,
    nowIndex: Int?, summary: String, caption: String, modeIdx: Int, onMode: (Int) -> Unit,
) {
    val t = T
    val radius = if (wide) 28.dp else 22.dp
    // Valget ryddes, når serien skifter (periode, visning eller nye priser).
    var sel by remember(period, vals.size, vals.firstOrNull(), vals.lastOrNull()) { mutableIntStateOf(-1) }
    val tip = if (sel in vals.indices) tooltipText(period, days, vals, sel) else null
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(radius)).background(t.surface)
            .border(BorderStroke(1.dp, t.outline), RoundedCornerShape(radius))
            .padding(start = if (wide) 28.dp else 16.dp, end = if (wide) 28.dp else 16.dp, top = if (wide) 24.dp else 16.dp, bottom = if (wide) 20.dp else 14.dp),
        verticalArrangement = Arrangement.spacedBy(if (wide) 14.dp else 6.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(periodTitle(period), fontSize = if (wide) 17.sp else 14.sp, fontWeight = FontWeight.ExtraBold)
            if (wide) Legend() else ModeSwitch(modeIdx, onMode)
        }
        if (!wide) Text(caption, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
        PriceBars(
            vals = vals, days = days, tiers = tiers, axis = axis, nowIndex = nowIndex, period = period, wide = wide,
            selected = sel, onSelect = { sel = it }, summary = summary + (tip?.let { " Valgt: $it." } ?: ""), tip = tip,
        )
    }
}

@Composable
private fun Legend() {
    val t = T
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        listOf("Billig" to BarLow, "Middel" to BarMid, "Dyr" to BarHigh).forEach { (label, c) ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(c))
                Text(label, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = t.text2)
            }
        }
    }
}

/**
 * Søjlegrafen: nulbaseret akse, én søjle pr. time, farvet efter niveau. Timer, der er gået, er dæmpede,
 * og en prik markerer nu. Tryk eller træk viser den nøjagtige pris i en mørk boble.
 */
@Composable
private fun PriceBars(
    vals: List<Double>, days: List<Day>, tiers: IntArray, axis: Axis, nowIndex: Int?, period: Int, wide: Boolean,
    selected: Int, onSelect: (Int) -> Unit, summary: String, tip: String?,
) {
    val t = T
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    val n = vals.size
    val plotH = if (wide) 240.dp else 160.dp
    val topPad = if (wide) 26.dp else 22.dp
    val labelH = if (wide) 24.dp else 22.dp
    val gutter = if (wide) 40.dp else 26.dp
    val axisSize = if (wide) 12.sp else 11.sp
    val tickStyle = TextStyle(fontFamily = Manrope, fontSize = axisSize, fontWeight = FontWeight.Bold, color = t.text2, fontFeatureSettings = FigureFeatures)
    val unitStyle = TextStyle(fontFamily = Manrope, fontSize = if (wide) 11.sp else 10.sp, fontWeight = FontWeight.Bold, color = t.text2)
    val xStyle = TextStyle(
        fontFamily = Manrope, fontSize = if (period == 1 && !wide) 10.sp else axisSize, fontWeight = FontWeight.Bold, color = t.text2,
    )
    val tipBg = if (t.dark) Color(0xFFE8EDF5) else Ink
    val tipStyle = TextStyle(
        fontFamily = Manrope, fontSize = if (wide) 13.sp else 12.sp, fontWeight = FontWeight.Bold,
        color = if (t.dark) Color(0xFF0B1220) else Color.White, fontFeatureSettings = FigureFeatures,
    )
    val firstForecast = remember(days, n) { (0 until n).firstOrNull { !days[it / 24].actual } }
    val currentSelected by rememberUpdatedState(selected)
    val gutterPx = with(density) { gutter.toPx() }

    Canvas(
        Modifier.fillMaxWidth().height(topPad + plotH + labelH)
            .semantics { contentDescription = summary }
            .pointerInput(n, gutterPx) {
                val slop = viewConfiguration.touchSlop
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    fun indexAt(x: Float) = (((x - gutterPx) / (size.width - gutterPx)) * n).toInt().coerceIn(0, n - 1)
                    val before = currentSelected
                    val startX = down.position.x
                    val first = indexAt(startX)
                    var moved = false
                    // Et tryk vælger (eller fjerner) timen, når fingeren løftes; et vandret træk følger fingeren.
                    // Lodrette træk overlades til skærmens rulning, så siden stadig kan rulles hen over grafen.
                    while (true) {
                        val ev = awaitPointerEvent()
                        val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                        if (ch.isConsumed) break
                        if (!ch.pressed) {
                            if (!moved) onSelect(if (first == before) -1 else first)
                            break
                        }
                        val dx = abs(ch.position.x - startX)
                        val dy = abs(ch.position.y - down.position.y)
                        if (!moved && dx > slop && dx > dy) moved = true
                        if (!moved && dy > slop) break
                        if (moved) { ch.consume(); onSelect(indexAt(ch.position.x)) }
                    }
                }
            },
    ) {
        val w = size.width
        val plotL = gutterPx
        val plotW = w - plotL
        val plotT = topPad.toPx()
        val plotB = plotT + plotH.toPx()
        val slot = plotW / n
        fun y(v: Double) = (plotT + (axis.max - v) / axis.span * (plotB - plotT)).toFloat()
        val y0 = y(0.0)

        // enhed + vandrette hjælpelinjer med heltals-tal
        val unit = measurer.measure("kr/kWh", unitStyle)
        drawText(unit, topLeft = Offset(0f, 0f))
        for (v in axis.ticks) {
            val yy = y(v.toDouble())
            drawLine(t.outline.copy(alpha = if (t.dark) 1f else 0.8f), Offset(plotL, yy), Offset(w, yy), strokeWidth = 1.dp.toPx())
            val tl = measurer.measure(v.toString(), tickStyle)
            drawText(tl, topLeft = Offset(plotL - 6.dp.toPx() - tl.size.width, yy - tl.size.height / 2f))
        }

        // døgnskel (3–10 døgn)
        if (period == 1) for (d in 1 until n / 24) {
            val xx = plotL + d * 24 * slot
            drawLine(t.outline.copy(alpha = 0.6f), Offset(xx, plotT), Offset(xx, plotB), strokeWidth = 1.dp.toPx())
        }
        // prognose: tynd skillelinje og etiket
        firstForecast?.let { fi ->
            val xx = plotL + fi * slot
            if (fi > 0) drawLine(t.text2.copy(alpha = 0.5f), Offset(xx, plotT), Offset(xx, plotB), strokeWidth = 1.dp.toPx())
            val lab = measurer.measure("Prognose", unitStyle)
            drawText(lab, topLeft = Offset((xx + 4.dp.toPx()).coerceAtMost(w - lab.size.width), plotT + 2.dp.toPx()))
        }

        // markeret time: svagt felt bag søjlen
        if (selected in 0 until n) {
            drawRoundRect(
                t.brandSolid.copy(alpha = 0.10f), Offset(plotL + selected * slot, plotT), Size(slot, plotB - plotT),
                CornerRadius(4.dp.toPx()),
            )
        }

        // søjler
        val gap = (if (wide) 4.dp else 2.dp).toPx().coerceAtMost(slot * 0.35f)
        val barW = (slot - gap).coerceAtLeast(1f)
        val corner = CornerRadius(minOf(2.dp.toPx(), barW / 2))
        for (i in 0 until n) {
            val top = y(vals[i])
            val hTop = minOf(top, y0); val hBottom = maxOf(top, y0)
            val h = (hBottom - hTop).coerceAtLeast(1.dp.toPx())
            val past = nowIndex != null && i < nowIndex
            var c = barOf(tiers[i])
            if (i == selected) c = lerp(c, Color.Black, 0.2f)
            else if (past) c = c.copy(alpha = 0.35f)
            drawRoundRect(c, Offset(plotL + i * slot + gap / 2, hTop), Size(barW, h), corner)
        }

        // nu-prik over timens søjle
        if (nowIndex != null && nowIndex in 0 until n) {
            val r = (if (wide) 3.dp else 2.5.dp).toPx()
            val cx = plotL + nowIndex * slot + slot / 2
            val cy = (minOf(y(vals[nowIndex]), y0) - r - 4.dp.toPx()).coerceAtLeast(plotT + r)
            drawCircle(t.text, r, Offset(cx, cy))
        }

        // aksens tekster
        val labels = if (period == 0) hourLabels(n, if (plotW / density.density >= 460f) 6 else 12) else dayLabels(days)
        for (l in labels) {
            val tl = measurer.measure(l.text, xStyle)
            val cx = plotL + l.frac * plotW
            val left = if (period == 0) (if (l.frac == 0f) plotL else cx - tl.size.width / 2f) else cx - tl.size.width / 2f
            drawText(tl, topLeft = Offset(left.coerceIn(0f, w - tl.size.width), plotB + 6.dp.toPx()))
        }

        // boblen sidst, så den ligger øverst — og aldrig uden for kortet
        if (tip != null && selected in 0 until n) {
            val tl = measurer.measure(tip, tipStyle)
            val padH = (if (wide) 11.dp else 10.dp).toPx(); val padV = (if (wide) 7.dp else 6.dp).toPx()
            val bw = tl.size.width + 2 * padH; val bh = tl.size.height + 2 * padV
            val cx = plotL + selected * slot + slot / 2
            val bx = (cx - bw / 2).coerceIn(0f, w - bw)
            val barTop = minOf(y(vals[selected]), y0)
            val by = (barTop - 12.dp.toPx() - bh).coerceAtLeast(0f)
            drawRoundRect(tipBg, Offset(bx, by), Size(bw, bh), CornerRadius(8.dp.toPx()))
            drawText(tl, topLeft = Offset(bx + padH, by + padV))
        }
    }
}

/* ── Nøgletal ────────────────────────────────────────────────────────────────────────── */

@Composable
private fun StatTiles(cheapest: Extreme?, priciest: Extreme?, wide: Boolean) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        listOfNotNull(cheapest, priciest).forEach { e -> StatCard(e, wide, Modifier.weight(1f)) }
    }
}

@Composable
private fun StatCard(e: Extreme, wide: Boolean, modifier: Modifier) {
    val t = T
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier.clip(shape).background(t.surface).border(BorderStroke(1.dp, t.outline), shape).padding(if (wide) 16.dp else 14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(e.label, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = t.text2)
        Row(verticalAlignment = Alignment.Bottom) {
            Text(fmt(e.price), fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, style = TextStyle(fontFeatureSettings = FigureFeatures))
            Text(" kr · kl. ${pad(e.hour)}", Modifier.padding(bottom = 2.dp), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = t.text2)
        }
    }
}
