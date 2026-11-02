package org.elpriser.app

import org.junit.rules.TestWatcher
import org.junit.runner.Description
import java.util.Locale

/**
 * Pins the JVM's default locale for the length of a test and restores it afterwards. The app formats numbers with the user's locale
 * (decimal separator, minus sign), so a test's expectation is only meaningful for the locale it names; the Danish tests run as Danish.
 */
class LocaleRule(private val locale: Locale) : TestWatcher() {
    private var before: Locale? = null

    override fun starting(description: Description?) {
        before = Locale.getDefault()
        Locale.setDefault(locale)
    }

    override fun finished(description: Description?) {
        before?.let { Locale.setDefault(it) }
    }
}

/** The Danish locale the existing Danish tests run in. */
val DANISH: Locale = Locale("da", "DK")

/** Runs [block] with [locale] as the default locale. */
fun <T> withLocale(locale: Locale, block: () -> T): T {
    val before = Locale.getDefault()
    Locale.setDefault(locale)
    try { return block() } finally { Locale.setDefault(before) }
}
