package org.elpriser.app.ui

import org.elpriser.app.R
import org.elpriser.app.data.Zone
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.pow

/**
 * What a price on screen is measured in. The Danish zones keep the krone with two decimals ("3,90 kr/kWh", the unit text of the language);
 * every other zone shows its sub-unit per kWh (øre, öre, gr, ct) with one decimal, and the money amounts of the Smart-home screen are
 * written in the zone's own currency. Pure (no Android classes): the texts come in through [Strings].
 */
sealed class PriceUnit(val decimals: Int) {
    /** "kr/kWh", "øre/kWh", "ct/kWh" — the unit next to a price. */
    abstract fun perKwh(tx: Strings): String
    /** "kr", "øre", "ct" — the unit of a price that already says per kWh elsewhere (tiles). */
    abstract fun short(tx: Strings): String
    /** A saving for the Smart-home screen: the number and the unit text to show after it (null when the number already carries the currency). */
    abstract fun savingParts(tx: Strings, v: Double, locale: Locale = Locale.getDefault()): Pair<String, String?>

    /** A price as a number in this unit: "3,90" or "65,3". */
    fun price(v: Double?, locale: Locale = Locale.getDefault()): String = fmt(v, decimals, locale)
    fun withUnit(tx: Strings, v: Double, locale: Locale = Locale.getDefault()) = "${price(v, locale)} ${perKwh(tx)}"
    fun amount(tx: Strings, v: Double, locale: Locale = Locale.getDefault()) = "${price(v, locale)} ${short(tx)}"
    /** A saving as one text ("1,20 kr", "€1.20", "1,20 €"). */
    fun saving(tx: Strings, v: Double, locale: Locale = Locale.getDefault()): String {
        val (n, u) = savingParts(tx, v, locale)
        return if (u == null) n else "$n $u"
    }

    /** The Danish krone: values are kr/kWh. */
    object Kroner : PriceUnit(2) {
        override fun perKwh(tx: Strings) = tx.get(R.string.unit_price)
        override fun short(tx: Strings) = tx.get(R.string.unit_kr)
        override fun savingParts(tx: Strings, v: Double, locale: Locale) = fmt(v, 2, locale) to tx.get(R.string.unit_kr)
    }

    /** A zone outside Denmark: values are in the zone's sub-unit (1/100 of its currency) per kWh. */
    class SubUnit(val zone: Zone) : PriceUnit(1) {
        private val euroCent get() = zone.sub == "ct"
        override fun perKwh(tx: Strings) = if (euroCent) tx.get(R.string.unit_ct_kwh) else zone.perKwh
        override fun short(tx: Strings) = if (euroCent) tx.get(R.string.unit_ct) else zone.sub
        override fun savingParts(tx: Strings, v: Double, locale: Locale) = currencyText(v / 100, zone.currency, locale) to null
        override fun equals(other: Any?) = other is SubUnit && other.zone == zone
        override fun hashCode() = zone.hashCode()
    }

    companion object {
        fun of(zone: Zone): PriceUnit = if (zone.isDanish) Kroner else SubUnit(zone)
    }
}

/** A money amount in the currency, as the locale writes it ("€1.20" in English, "1,20 €" in German, "1,20 zł" in Polish); never "-0,00". */
fun currencyText(major: Double, currency: String, locale: Locale = Locale.getDefault()): String {
    val nf = NumberFormat.getCurrencyInstance(locale)
    nf.currency = Currency.getInstance(currency)
    val digits = nf.maximumFractionDigits
    val tiny = abs(major) < 0.5 * 10.0.pow(-digits)
    return nf.format(if (tiny) 0.0 else major)
}

/* ── Axis for sub-unit prices ──────────────────────────────────────────────────────────── */

private val NICE_MANTISSAS = doubleArrayOf(1.0, 2.0, 5.0)

/**
 * The vertical axis for sub-unit prices (øre, ct …), whose values run from 0 to a few hundred: "nice" steps 1, 2, 5, 10, 20, 50 …, at most five
 * intervals, the top rounded up so the highest bar (plus 12 %) never touches it, and room below zero when a price is negative. Whole numbers only.
 */
fun axisForSubUnit(vals: List<Double>): Axis {
    val finite = vals.filter { it.isFinite() }
    val top = maxOf(finite.maxOrNull() ?: 0.0, 0.0) * 1.12
    val bottom = maxOf(-(finite.minOrNull() ?: 0.0), 0.0) * 1.12
    var step = 1.0
    search@ for (exp in 0..9) for (m in NICE_MANTISSAS) {
        val s = m * 10.0.pow(exp)
        val up = maxOf(ceil(top / s - 1e-9), 1.0)
        val down = ceil(bottom / s - 1e-9)
        step = s
        if (up + down <= 5) break@search
    }
    val max = maxOf(ceil(top / step - 1e-9), 1.0) * step
    val min = -ceil(bottom / step - 1e-9) * step + 0.0
    val ticks = ArrayList<Int>()
    var v = Math.round(min / step) * step
    while (v <= max + 1e-9) { ticks.add(Math.round(v).toInt()); v += step }
    return Axis(min, max, ticks)
}

/** The axis for the prices on screen: the existing krone axis in Denmark (pinned by tests), the sub-unit axis elsewhere. */
fun axisFor(vals: List<Double>, unit: PriceUnit): Axis = if (unit is PriceUnit.SubUnit) axisForSubUnit(vals) else axisFor(vals)
