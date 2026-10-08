package org.elpriser.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Streg-ikoner (24×24), samme former som i designet. */
object Ic {
    const val Bolt = "M13 2L4 14h7l-1 8 9-12h-7z"
    const val Trend = "M3 17l6-6 4 4 8-8M15 7h6v6"
    const val Clock = "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M12 7v5l3 2"
    const val Menu = "M4 7h16M4 12h16M4 17h16"
    const val Pin = "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0zM9 10a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"
    const val Locate = "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0M12 2v2M12 20v2M2 12h2M20 12h2"
    const val Bell = "M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0"
    const val Check = "M5 12l5 5 9-10"
    const val Close = "M6 6l12 12M18 6L6 18"
    const val Back = "M19 12H5M12 19l-7-7 7-7"
    const val Search = "M4 11a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M20 20l-4-4"
    const val Down = "M6 9l6 6 6-6"
    const val Heat = "M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"
    const val Car = "M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"
    const val Drop = "M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"
    const val Grid = "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"
}

@Composable
fun Icon(path: String, tint: Color, size: Dp = 22.dp, stroke: Float = 2f, fill: Boolean = false, modifier: Modifier = Modifier) {
    val p = remember(path) { PathParser().parsePathString(path).toPath() }
    Canvas(modifier.size(size)) {
        scale(this.size.width / 24f, pivot = Offset.Zero) {
            if (fill) drawPath(p, tint, style = Fill)
            else drawPath(p, tint, style = Stroke(width = stroke, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}
