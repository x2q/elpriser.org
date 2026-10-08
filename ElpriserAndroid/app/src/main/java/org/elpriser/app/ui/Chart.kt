package org.elpriser.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.ceil

fun niceTicks(lo: Double, hi: Double): List<Double> {
    val raw = (hi - lo) / 3
    val step = listOf(0.1, 0.2, 0.25, 0.5, 1.0, 2.0, 5.0).firstOrNull { it >= raw } ?: 5.0
    val out = ArrayList<Double>()
    var v = ceil(lo / step - 1e-9) * step
    while (v <= hi + 1e-9) { out.add(v); v += step }
    return out
}

/**
 * Prisgrafen: linjen farves efter prisen (grøn nederst, rød øverst), de faktiske timer er fuldt optrukne,
 * prognosen er stiplet med P10–P90-bånd, og et punkt viser, hvor vi er nu.
 */
@Composable
fun PriceChart(
    vals: List<Double>,
    nSolid: Int,
    nowIndex: Int?,
    modifier: Modifier = Modifier,
    lo: List<Double>? = null,
    hi: List<Double>? = null,
    bandFrom: Int = 0,
    days: Int = 1,
    dayNames: List<String> = emptyList(),
    height: Dp = 170.dp,
) {
    val t = T
    val measurer = rememberTextMeasurer()
    val tickStyle = TextStyle(fontFamily = Manrope, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
    val n = vals.size
    Column(modifier.fillMaxWidth()) {
        Canvas(Modifier.fillMaxWidth().height(height)) {
            val padT = 8.dp.toPx(); val labelH = 18.dp.toPx()
            val top = padT; val bottom = size.height - labelH
            var minV = vals.min(); var maxV = vals.max()
            lo?.let { minV = minOf(minV, it.min()) }
            hi?.let { maxV = maxOf(maxV, it.max()) }
            val span = (maxV - minV).takeIf { it > 0 } ?: 1.0
            fun x(i: Int) = i.toFloat() / (n - 1) * size.width
            fun y(v: Double) = (top + (1 - (v - minV) / span) * (bottom - top)).toFloat()

            // vandrette hjælpelinjer (prisskalaens tal tegnes til sidst, oven på linjen)
            val ticks = niceTicks(minV, maxV)
            for (v in ticks) {
                val yy = y(v)
                drawLine(t.outline, Offset(0f, yy), Offset(size.width, yy), strokeWidth = 1.dp.toPx())
            }
            // døgnskel
            for (d in 1 until days) {
                val xx = x(d * 24)
                drawLine(t.outline, Offset(xx, top), Offset(xx, bottom), strokeWidth = 1.dp.toPx())
            }
            // timemærker
            for (d in 0 until days) for (h in listOf(0, 6, 12, 18)) {
                val i = d * 24 + h
                if (i >= n) continue
                val tl = measurer.measure(pad(h), tickStyle)
                val tx = (x(i) - tl.size.width / 2f).coerceIn(0f, size.width - tl.size.width)
                drawText(tl, topLeft = Offset(tx, bottom + 4.dp.toPx()))
            }
            // P10–P90-bånd
            if (lo != null && hi != null && bandFrom < n) {
                val band = Path()
                for (i in bandFrom until n) if (i == bandFrom) band.moveTo(x(i), y(hi[i])) else band.lineTo(x(i), y(hi[i]))
                for (i in n - 1 downTo bandFrom) band.lineTo(x(i), y(lo[i]))
                band.close()
                drawPath(band, t.brandSolid.copy(alpha = 0.16f))
            }
            val brush = Brush.verticalGradient(
                0f to Color(255, 59, 48), 0.15f to Color(255, 149, 0), 0.40f to Color(255, 204, 0),
                0.65f to Color(168, 216, 74), 1f to Color(52, 199, 89),
                startY = top, endY = bottom,
            )
            val ns = nSolid.coerceIn(0, n)
            if (ns > 1) {
                val p = Path()
                for (i in 0 until ns) if (i == 0) p.moveTo(x(i), y(vals[i])) else p.lineTo(x(i), y(vals[i]))
                drawPath(p, brush, style = Stroke(3.2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
            if (ns < n) {
                val p = Path()
                val from = maxOf(ns - 1, 0)
                for (i in from until n) if (i == from) p.moveTo(x(i), y(vals[i])) else p.lineTo(x(i), y(vals[i]))
                drawPath(p, brush, style = Stroke(3.2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(9.dp.toPx(), 7.dp.toPx()))))
            }
            if (nowIndex != null && nowIndex in 0 until n) {
                val xx = x(nowIndex)
                drawLine(t.text2.copy(alpha = 0.5f), Offset(xx, top), Offset(xx, bottom), strokeWidth = 1.5.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())))
                drawCircle(t.surface, 8.dp.toPx(), Offset(xx, y(vals[nowIndex])))
                drawCircle(t.brandSolid, 5.5.dp.toPx(), Offset(xx, y(vals[nowIndex])))
            }
            for (v in ticks) {
                val tl = measurer.measure(fmt(v, 2), tickStyle)
                val ty = y(v) - tl.size.height - 1.dp.toPx()
                drawRoundRect(t.surface.copy(alpha = 0.9f), Offset(0f, ty), androidx.compose.ui.geometry.Size(tl.size.width + 6.dp.toPx(), tl.size.height.toFloat()),
                    androidx.compose.ui.geometry.CornerRadius(4.dp.toPx()))
                drawText(tl, topLeft = Offset(3.dp.toPx(), ty))
            }
        }
        if (dayNames.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().padding(top = 2.dp)) {
                dayNames.forEach {
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        Text(it, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = t.text2, textAlign = TextAlign.Center)
                    }
                }
            }
        }
    }
}
