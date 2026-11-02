package org.elpriser.app

import org.elpriser.app.ui.currencyText
import org.elpriser.app.ui.fmt
import org.elpriser.app.ui.tenthsText
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

/** Numbers and money follow the user's locale: decimal separator, minus sign, currency pattern. */
class FormatTest {
    private val da = Locale("da", "DK")
    private val en = Locale.ENGLISH
    private val de = Locale.GERMANY
    private val fr = Locale.FRANCE
    private val sv = Locale("sv", "SE")
    private val nb = Locale("nb", "NO")
    private val pl = Locale("pl", "PL")
    private val fi = Locale("fi", "FI")

    private fun nbsp(s: String) = s.replace(' ', ' ').replace(' ', ' ')

    @Test fun decimal_separator_by_locale() {
        assertEquals("3,90", fmt(3.9, 2, da))
        assertEquals("3.90", fmt(3.9, 2, en))
        assertEquals("3,90", fmt(3.9, 2, de))
        assertEquals("3,90", fmt(3.9, 2, fr))
        assertEquals("3,90", fmt(3.9, 2, sv))
        assertEquals("3,90", fmt(3.9, 2, pl))
        assertEquals("3,90", fmt(3.9, 2, fi))
        assertEquals("65.3", fmt(65.34, 1, en))
        assertEquals("65,3", fmt(65.34, 1, pl))
        assertEquals("12", fmt(12.4, 0, de))
    }

    @Test fun the_default_locale_is_used_when_none_is_given() {
        withLocale(en) { assertEquals("1.50", fmt(1.5)) }
        withLocale(de) { assertEquals("1,50", fmt(1.5)) }
        withLocale(DANISH) { assertEquals("1,50", fmt(1.5)) }
    }

    @Test fun minus_sign_by_locale() {
        assertEquals("-0,40", fmt(-0.4, 2, da))
        assertEquals("-0.40", fmt(-0.4, 2, en))
        assertEquals("-12,5", fmt(-12.5, 1, de))
        assertEquals("-12,5", fmt(-12.5, 1, pl))
        // Swedish, Norwegian and Finnish write the real minus sign U+2212
        assertEquals("−0,40", fmt(-0.4, 2, sv))
        assertEquals("−0,40", fmt(-0.4, 2, nb))
        assertEquals("−12,5", fmt(-12.5, 1, fi))
    }

    @Test fun a_value_that_rounds_to_zero_never_shows_a_minus() {
        for (l in listOf(da, en, de, sv, nb, pl)) {
            assertEquals("0${if (l == en) "." else ","}00", fmt(-0.001, 2, l))
            assertEquals("0${if (l == en) "." else ","}00", fmt(-0.0, 2, l))
        }
        assertEquals("0,0", fmt(-0.04, 1, de))
        assertEquals("0", fmt(-0.4, 0, de))
        assertEquals("-1", fmt(-0.6, 0, de))
    }

    @Test fun missing_values_are_an_en_dash() {
        assertEquals("–", fmt(null, 2, de))
        assertEquals("–", fmt(Double.NaN, 2, en))
    }

    @Test fun tenths_text_follows_the_locale_and_never_shows_minus_zero() {
        assertEquals("164,0", tenthsText(1640, da))
        assertEquals("164.0", tenthsText(1640, en))
        assertEquals("85,3", tenthsText(853, de))
        assertEquals("-0,3", tenthsText(-3, da))
        assertEquals("−0,3", tenthsText(-3, sv))
        assertEquals("0,0", tenthsText(0, da))
        assertEquals("-12,5", tenthsText(-125, pl))
    }

    @Test fun money_in_the_zones_currency() {
        assertEquals("€1.23", currencyText(1.2345, "EUR", en))
        assertEquals("1,23 €", nbsp(currencyText(1.2345, "EUR", de)))
        assertEquals("1,23 zł", nbsp(currencyText(1.2345, "PLN", pl)))
        assertEquals("1,23 kr", nbsp(currencyText(1.2345, "SEK", sv)))
        assertEquals("kr 1,23", nbsp(currencyText(1.2345, "NOK", nb)))
        assertEquals("NOK1.23", currencyText(1.2345, "NOK", en))
        assertEquals("1,23 kr.", nbsp(currencyText(1.2345, "DKK", da)))
    }

    @Test fun money_rounds_to_cents_and_hides_a_minus_on_zero() {
        assertEquals("€0.00", currencyText(-0.001, "EUR", en))
        assertEquals("€0.00", currencyText(0.0, "EUR", en))
        assertEquals("€12.35", currencyText(12.346, "EUR", en))
        assertEquals("-€0.50", currencyText(-0.5, "EUR", en))
    }
}
