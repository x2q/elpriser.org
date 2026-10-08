package org.elpriser.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import org.elpriser.app.R
import java.util.Locale

@Immutable
class Tokens(
    val dark: Boolean,
    val bg: Color, val surface: Color, val surface2: Color, val outline: Color,
    val text: Color, val text2: Color,
    val brand: Color, val brandSoft: Color, val brandSolid: Color,
    val good: Color, val goodSoft: Color, val mid: Color, val midSoft: Color, val bad: Color, val badSoft: Color,
    val co2: Color, val co2Soft: Color, val nav: Color, val scrim: Color,
)

private fun c(hex: Long) = Color(0xFF000000 or hex)

val LightTokens = Tokens(
    false, c(0xf4f7fc), c(0xffffff), c(0xeaf0fa), c(0xdbe3f0), c(0x0e1421), c(0x4d596b),
    c(0x1747d6), c(0xe2eaff), c(0x1b57f5),
    c(0x157a3c), c(0xddf4e4), c(0x8a5a00), c(0xfff1d1), c(0xb4231b), c(0xfde3e0),
    c(0x0b756a), c(0xd9f2ee), c(0xe9eef8), Color(0x730e1421),
)

val DarkTokens = Tokens(
    true, c(0x0b1220), c(0x131b29), c(0x1b2535), c(0x26324a), c(0xe8edf5), c(0xa9b5c9),
    c(0x7ea2ff), c(0x1c2b55), c(0x5b8bff),
    c(0x4cd964), c(0x133222), c(0xffd24a), c(0x3a3112), c(0xff7a70), c(0x3d1d1b),
    c(0x2fd4bf), c(0x10332f), c(0x161f30), Color(0x8C000000),
)

val LocalTokens = staticCompositionLocalOf { LightTokens }
val T: Tokens @Composable get() = LocalTokens.current

@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
private fun manrope(w: Int) = Font(R.font.manrope, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
val Manrope = FontFamily(manrope(400), manrope(500), manrope(600), manrope(700), manrope(800))

@Composable
fun ElpriserTheme(mode: String, content: @Composable () -> Unit) {
    val dark = when (mode) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    val t = if (dark) DarkTokens else LightTokens
    val scheme = if (dark) darkColorScheme(primary = t.brandSolid, background = t.bg, surface = t.surface, onSurface = t.text, onBackground = t.text)
    else lightColorScheme(primary = t.brandSolid, background = t.bg, surface = t.surface, onSurface = t.text, onBackground = t.text)
    val base = TextStyle(fontFamily = Manrope, color = t.text)
    CompositionLocalProvider(LocalTokens provides t) {
        MaterialTheme(
            colorScheme = scheme,
            typography = Typography(bodyLarge = base, bodyMedium = base, bodySmall = base, labelLarge = base, titleMedium = base),
            content = content,
        )
    }
}

/* Samme farveskala som elpriser.org: grøn (billig) → lime → gul → orange → rød (dyr). */
private val RampStops = listOf(
    0.0f to Color(52, 199, 89), 0.35f to Color(168, 216, 74), 0.6f to Color(255, 204, 0),
    0.85f to Color(255, 149, 0), 1.0f to Color(255, 59, 48),
)

fun ramp(t0: Double): Color {
    val t = t0.coerceIn(0.0, 1.0).toFloat()
    for (i in 1 until RampStops.size) {
        val (p1, c1) = RampStops[i]
        if (t <= p1) {
            val (p0, c0) = RampStops[i - 1]
            return lerp(c0, c1, (t - p0) / (p1 - p0))
        }
    }
    return RampStops.last().second
}

fun tOf(v: Double, vals: List<Double>): Double {
    val lo = vals.min(); val hi = vals.max()
    return if (hi == lo) 0.0 else (v - lo) / (hi - lo)
}

/** Dansk talformat: komma som decimaltegn og aldrig "-0,00". */
fun fmt(v: Double?, d: Int = 2): String {
    if (v == null || v.isNaN()) return "–"
    var s = String.format(Locale.US, "%.${d}f", v)
    if (Regex("^-0\\.?0*$").matches(s)) s = s.substring(1)
    return s.replace('.', ',')
}

fun pad(h: Int) = h.toString().padStart(2, '0')
fun hh(h: Int) = "${pad(h)}–${pad((h + 1) % 24)}"
