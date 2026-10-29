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
import androidx.compose.runtime.mutableStateOf
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
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.elpriser.app.AppViewModel
import org.elpriser.app.R
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
    val tx = rememberStrings()
    // Det gemte heltal (også en ældre værdi fra før 5 døgn) tvinges til en gyldig periode.
    var storedPeriod by rememberSaveable { mutableIntStateOf(PERIOD_TWO) }
    val period = coercePeriod(storedPeriod)
    val days = vm.days()
    val today = days.firstOrNull()?.takeIf { it.date == Clock.today() }

    Column(Modifier.fillMaxSize()) {
        PriceHeader(vm, wide)
        if (today == null) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
                if (vm.loading) Loading() else ErrorCard(tx.get(vm.error ?: R.string.error_no_prices_today), { vm.refresh(true) })
            }
            return@Column
        }

        val two = visibleDays(days, PERIOD_TWO)
        val twoVals = two.flatMap { it.price }
        val now = Clock.hour()
        val price = twoVals[now]
        val kind = verdict(price, twoVals).kind
        val verdictLabel = verdict(price, twoVals).label(tx)
        val sentence = cheaperSentence(tx, twoVals, now)

        // 5 døgn: i dag fra kl. 00 + de næste fire døgn (120 timer). Mangler døgn, vises dem, der er.
        val shownPeriod = effectivePeriod(days.size, period)
        val shownDays = visibleDays(days, period)
        val shownVals = if (shownPeriod == PERIOD_FIVE) shownDays.flatMap { it.price } else twoVals
        // Grafen starter seks timer før nu og løber 2 eller 5 døgn frem (vinduet kan nå ind i døgn 3 / 6); nøgletallene bliver ved døgnene.
        val cw = chartWindow(days.size, shownPeriod, now)
        val chartDays = windowDays(days, cw)
        val chartVals = chartDays.flatMap { it.price }
        val winVals = chartVals.subList(cw.st, cw.end)
        // Nøgletal: dyreste/billigste time fra nu og til slutningen af det viste vindue.
        val cheapest = cheapestTile(tx, shownVals, now, shownDays)
        val priciest = priciestTile(tx, shownVals, now, shownDays)
        val tiers = remember(chartVals, cw.st, cw.n) { tiersFor(chartVals, winVals) }
        val axis = remember(chartVals, cw.st, cw.n) { axisFor(winVals) }
        val nowIndex = now

        val modeIdx = if (s.view >= 2) 1 else 0
        val onMode: (Int) -> Unit = { s.updateView(if (it == 0) 0 else 2) }
        val caption = priceCaption(tx, s.mode)

        // Det valgte søjleindeks deles af grafen og prisopbygningen (ryddes, når serien skifter: periode, visning eller nye priser).
        var sel by remember(shownPeriod, chartVals.size, chartVals.firstOrNull(), chartVals.lastOrNull(), cw.st) { mutableIntStateOf(-1) }
        var breakdownOpen by rememberSaveable { mutableStateOf(false) }
        val picked = sel in cw.st until cw.end
        val breakdown = breakdownAt(
            tx, s.mode, chartDays, chartVals, if (picked) sel else now, picked, vm.series[s.mode]?.charges, s.net?.name,
        )
        val captionSlot: @Composable (Modifier, TextUnit) -> Unit = { m, size ->
            PriceCaption(caption, breakdown, breakdownOpen, { breakdownOpen = !breakdownOpen }, picked, { sel = -1 }, size, m)
        }

        val summary = buildString {
            append(periodTitle(tx, shownPeriod)).append(". ")
            cheapest?.let { append(tx.get(R.string.chart_summary_tile, it.label, fmt(it.price), pad(it.hour))).append(' ') }
            priciest?.let { append(tx.get(R.string.chart_summary_tile, it.label, fmt(it.price), pad(it.hour))).append(' ') }
            append(tx.get(R.string.chart_hint))
        }

        val hero: @Composable (Modifier) -> Unit = { m ->
            HeroCard(m, wide, now, price, kind, verdictLabel, sentence, captionSlot, modeIdx, onMode)
        }
        val chart: @Composable () -> Unit = {
            PriceChartCard(
                wide = wide, period = shownPeriod, days = chartDays, vals = chartVals, window = cw, tiers = tiers, axis = axis,
                nowIndex = nowIndex, summary = summary, captionSlot = captionSlot, modeIdx = modeIdx, onMode = onMode,
                sel = sel, onSel = { sel = it },
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
                vm.error?.let { ErrorCard(tx.get(it), { vm.refresh(true) }) }
                if (twoCol) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        hero(Modifier.width(420.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                            PeriodPill(shownPeriod, { storedPeriod = it }, wide = true)
                            chart()
                            tiles()
                        }
                    }
                } else {
                    if (wide) hero(Modifier.fillMaxWidth()) else hero(Modifier)
                    PeriodPill(shownPeriod, { storedPeriod = it }, wide = wide)
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
    val tx = rememberStrings()
    val chipText = s.net?.let { "${it.name} · ${areaShort(tx, it.area)}" } ?: "${s.effectiveArea} · ${areaShort(tx, s.effectiveArea)}"
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = if (wide) 24.dp else 20.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        if (wide) {
            Column {
                Text(tx.get(R.string.nav_price), fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.5).sp, lineHeight = 30.sp)
                Text(todayLong(tx), fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(t.brandSolid), contentAlignment = Alignment.Center) {
                    Icon(Ic.Bolt, Color.White, 16.dp, fill = true)
                }
                Text(tx.get(R.string.app_name), fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.2).sp)
            }
        }
        // Selve chippen er 36 dp høj; trykfladen er 44 dp.
        Box(
            Modifier.height(44.dp).clickable(role = Role.Button, onClickLabel = tx.get(R.string.open_settings_label)) { vm.tab = Tab.Settings },
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
    sentence: String, captionSlot: @Composable (Modifier, TextUnit) -> Unit, modeIdx: Int, onMode: (Int) -> Unit,
) {
    val t = T
    val tx = rememberStrings()
    val tier = tierColors(kind)
    val figures = TextStyle(fontFeatureSettings = FigureFeatures)
    val content: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(if (wide) 18.dp else 10.dp)) {
            Text(heroLabel(tx, now, if (wide) todayWeekday(tx) else null), fontSize = if (wide) 14.sp else 13.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
            Row {
                Text(
                    fmt(price), Modifier.alignByBaseline(), style = figures, color = t.text,
                    fontSize = if (wide) 96.sp else 76.sp, fontWeight = FontWeight.ExtraBold,
                    letterSpacing = if (wide) (-4.5).sp else (-3).sp, lineHeight = if (wide) 100.sp else 78.sp,
                )
                Text(tx.get(R.string.unit_price), Modifier.alignByBaseline().padding(start = 8.dp), fontSize = if (wide) 22.sp else 18.sp, fontWeight = FontWeight.Bold, color = t.text2)
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
                Column(verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.padding(top = 4.dp)) {
                    ModeSwitch(modeIdx, onMode, large = true)
                    captionSlot(Modifier, 12.sp)
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
    val tx = rememberStrings()
    val radius = if (large) 14.dp else 12.dp
    val visual = if (large) 44.dp else 36.dp
    Row(
        Modifier.height(44.dp).drawBehind {
            val inset = (size.height - visual.toPx()) / 2
            drawRoundRect(t.surface2, Offset(0f, inset), Size(size.width, visual.toPx()), CornerRadius(radius.toPx()))
        }.padding(horizontal = 4.dp).semantics { contentDescription = tx.get(R.string.view_label) },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        listOf(tx.get(R.string.mode_net_price), tx.get(R.string.mode_spot_price)).forEachIndexed { i, label ->
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

/** 2 døgn | 5 døgn. */
@Composable
private fun PeriodPill(selected: Int, onSelect: (Int) -> Unit, wide: Boolean) {
    val t = T
    val tx = rememberStrings()
    val active = if (t.dark) t.brand else Navy
    val onActive = if (t.dark) t.bg else Color.White
    val shape = RoundedCornerShape(30.dp)
    Row(
        Modifier.then(if (wide) Modifier else Modifier.fillMaxWidth())
            .shadow(if (t.dark) 0.dp else 5.dp, shape, ambientColor = Ink.copy(alpha = 0.12f), spotColor = Ink.copy(alpha = 0.12f))
            .clip(shape).background(t.surface)
            .then(if (t.dark) Modifier.border(BorderStroke(1.dp, t.outline), shape) else Modifier)
            .padding(4.dp).semantics { contentDescription = tx.get(R.string.period_label) },
    ) {
        periodLabels(tx).forEachIndexed { i, label ->
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
    wide: Boolean, period: Int, days: List<Day>, vals: List<Double>, window: ChartWindow, tiers: IntArray, axis: Axis,
    nowIndex: Int?, summary: String, captionSlot: @Composable (Modifier, TextUnit) -> Unit, modeIdx: Int, onMode: (Int) -> Unit,
    sel: Int, onSel: (Int) -> Unit,
) {
    val t = T
    val tx = rememberStrings()
    val radius = if (wide) 28.dp else 22.dp
    val tip = if (sel in window.st until window.end) tooltipText(tx, days, vals, sel) else null
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(radius)).background(t.surface)
            .border(BorderStroke(1.dp, t.outline), RoundedCornerShape(radius))
            .padding(start = if (wide) 28.dp else 16.dp, end = if (wide) 28.dp else 16.dp, top = if (wide) 24.dp else 16.dp, bottom = if (wide) 20.dp else 14.dp),
        verticalArrangement = Arrangement.spacedBy(if (wide) 14.dp else 6.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(periodTitle(tx, period), Modifier.weight(1f, fill = false).padding(end = 8.dp), fontSize = if (wide) 17.sp else 14.sp, fontWeight = FontWeight.ExtraBold)
            if (wide) Legend() else ModeSwitch(modeIdx, onMode)
        }
        if (!wide) captionSlot(Modifier, 11.5.sp)
        PriceBars(
            vals = vals, days = days, window = window, tiers = tiers, axis = axis, nowIndex = nowIndex, period = period, wide = wide,
            selected = sel, onSelect = onSel, summary = summary + (tip?.let { " " + tx.get(R.string.chart_selected, it) } ?: ""), tip = tip,
        )
    }
}

@Composable
private fun Legend() {
    val t = T
    val tx = rememberStrings()
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        listOf(tx.get(R.string.legend_cheap) to BarLow, tx.get(R.string.legend_mid) to BarMid, tx.get(R.string.legend_high) to BarHigh).forEach { (label, c) ->
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
    vals: List<Double>, days: List<Day>, window: ChartWindow, tiers: IntArray, axis: Axis, nowIndex: Int?, period: Int, wide: Boolean,
    selected: Int, onSelect: (Int) -> Unit, summary: String, tip: String?,
) {
    val t = T
    val tx = rememberStrings()
    val unitText = tx.get(R.string.unit_price)
    val forecastText = tx.get(R.string.forecast_label)
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    val st = window.st
    val n = window.n
    val plotH = if (wide) 240.dp else 160.dp
    val topPad = if (wide) 26.dp else 22.dp
    val labelH = if (wide) 24.dp else 22.dp
    val gutter = if (wide) 40.dp else 26.dp
    val axisSize = if (wide) 12.sp else 11.sp
    val tickStyle = TextStyle(fontFamily = Manrope, fontSize = axisSize, fontWeight = FontWeight.Bold, color = t.text2, fontFeatureSettings = FigureFeatures)
    val unitStyle = TextStyle(fontFamily = Manrope, fontSize = if (wide) 11.sp else 10.sp, fontWeight = FontWeight.Bold, color = t.text2)
    val xStyle = TextStyle(
        fontFamily = Manrope, fontSize = axisSize, fontWeight = FontWeight.Bold, color = t.text2,
    )
    val tipBg = if (t.dark) Color(0xFFE8EDF5) else Ink
    val tipStyle = TextStyle(
        fontFamily = Manrope, fontSize = if (wide) 13.sp else 12.sp, fontWeight = FontWeight.Bold,
        color = if (t.dark) Color(0xFF0B1220) else Color.White, fontFeatureSettings = FigureFeatures,
    )
    val firstForecast = remember(days) { forecastStart(days) }
    val currentSelected by rememberUpdatedState(selected)
    val gutterPx = with(density) { gutter.toPx() }

    Canvas(
        Modifier.fillMaxWidth().height(topPad + plotH + labelH)
            .semantics { contentDescription = summary }
            .pointerInput(st, n, gutterPx) {
                val slop = viewConfiguration.touchSlop
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    fun indexAt(x: Float) = st + (((x - gutterPx) / (size.width - gutterPx)) * n).toInt().coerceIn(0, n - 1)
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
        val unit = measurer.measure(unitText, unitStyle)
        drawText(unit, topLeft = Offset(0f, 0f))
        for (v in axis.ticks) {
            val yy = y(v.toDouble())
            drawLine(t.outline.copy(alpha = if (t.dark) 1f else 0.8f), Offset(plotL, yy), Offset(w, yy), strokeWidth = 1.dp.toPx())
            val tl = measurer.measure(v.toString(), tickStyle)
            drawText(tl, topLeft = Offset(plotL - 6.dp.toPx() - tl.size.width, yy - tl.size.height / 2f))
        }

        // døgnskel ved hver midnat (5 døgn)
        if (period == PERIOD_FIVE) for (m in midnights(window)) {
            val xx = plotL + (m - st) * slot
            drawLine(t.outline.copy(alpha = 0.6f), Offset(xx, plotT), Offset(xx, plotB), strokeWidth = 1.dp.toPx())
        }
        // prognose: tynd skillelinje og etiket
        firstForecast?.takeIf { it < window.end }?.let { f0 ->
            val fi = maxOf(f0 - st, 0)
            val xx = plotL + fi * slot
            if (fi > 0) drawLine(t.text2.copy(alpha = 0.5f), Offset(xx, plotT), Offset(xx, plotB), strokeWidth = 1.dp.toPx())
            val lab = measurer.measure(forecastText, unitStyle)
            drawText(lab, topLeft = Offset((xx + 4.dp.toPx()).coerceAtMost(w - lab.size.width), plotT + 2.dp.toPx()))
        }

        // markeret time: svagt felt bag søjlen
        if (selected in st until window.end) {
            drawRoundRect(
                t.brandSolid.copy(alpha = 0.10f), Offset(plotL + (selected - st) * slot, plotT), Size(slot, plotB - plotT),
                CornerRadius(4.dp.toPx()),
            )
        }

        // søjler
        // 5 døgn: omkring 120 tynde søjler med et hårfint mellemrum; 2 døgn: lidt luft mellem omkring 50 søjler.
        val gap = (if (period == PERIOD_FIVE) (if (wide) 2.dp else 1.dp) else if (wide) 4.dp else 2.dp).toPx().coerceAtMost(slot * 0.35f)
        val barW = (slot - gap).coerceAtLeast(1f)
        val corner = CornerRadius(minOf(2.dp.toPx(), barW / 2))
        for (i in st until window.end) {
            val top = y(vals[i])
            val hTop = minOf(top, y0); val hBottom = maxOf(top, y0)
            val h = (hBottom - hTop).coerceAtLeast(1.dp.toPx())
            val past = nowIndex != null && i < nowIndex
            var c = barOf(tiers[i])
            if (i == selected) c = lerp(c, Color.Black, 0.2f)
            else if (past) c = c.copy(alpha = 0.35f)
            drawRoundRect(c, Offset(plotL + (i - st) * slot + gap / 2, hTop), Size(barW, h), corner)
        }

        // nu-prik over timens søjle
        if (nowIndex != null && nowIndex in st until window.end) {
            val r = (if (wide) 3.dp else 2.5.dp).toPx()
            val cx = plotL + (nowIndex - st) * slot + slot / 2
            val cy = (minOf(y(vals[nowIndex]), y0) - r - 4.dp.toPx()).coerceAtLeast(plotT + r)
            drawCircle(t.text, r, Offset(cx, cy))
        }

        // aksens tekster
        val labels = if (period == PERIOD_TWO) hourLabels(tx, days, window, if (plotW / density.density >= 460f) 6 else 12) else dayLabels(tx, days, window)
        for (l in labels) {
            val tl = measurer.measure(l.text, xStyle)
            val cx = plotL + l.frac * plotW
            val left = if (period == PERIOD_TWO) (if (l.frac == 0f) plotL else cx - tl.size.width / 2f) else cx - tl.size.width / 2f
            drawText(tl, topLeft = Offset(left.coerceIn(0f, w - tl.size.width), plotB + 6.dp.toPx()))
        }

        // boblen sidst, så den ligger øverst — og aldrig uden for kortet
        if (tip != null && selected in st until window.end) {
            val tl = measurer.measure(tip, tipStyle)
            val padH = (if (wide) 11.dp else 10.dp).toPx(); val padV = (if (wide) 7.dp else 6.dp).toPx()
            val bw = tl.size.width + 2 * padH; val bh = tl.size.height + 2 * padV
            val cx = plotL + (selected - st) * slot + slot / 2
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
    val tx = rememberStrings()
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier.clip(shape).background(t.surface).border(BorderStroke(1.dp, t.outline), shape).padding(if (wide) 16.dp else 14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(e.label, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = t.text2)
        Row(verticalAlignment = Alignment.Bottom) {
            Text(fmt(e.price), color = t.text, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, style = TextStyle(fontFeatureSettings = FigureFeatures))
            Text(tx.get(R.string.stat_price_hour, pad(e.hour)), Modifier.padding(start = 4.dp, bottom = 2.dp), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = t.text2)
        }
    }
}
