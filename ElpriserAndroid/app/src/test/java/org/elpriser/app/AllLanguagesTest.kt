package org.elpriser.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Every text of every shipped language (the default English values/ and each values-xx/, read from the files the app ships) must format with
 * sample arguments: no exception from a malformed template, no placeholder left over, no stray percent sign. test-android-strings.mjs checks
 * the placeholders against the default file; this one runs the real java.util.Formatter in the language's own locale, as a device does.
 */
class AllLanguagesTest {
    private val placeholder = Regex("%(\\d+)\\$([sd])")

    /** Sample arguments for a template: an integer for %n$d, a word for %n$s, as many as the highest index. */
    private fun sampleArgs(template: String): Array<Any> {
        val found = placeholder.findAll(template).map { it.groupValues[1].toInt() to it.groupValues[2] }.toList()
        val n = found.maxOfOrNull { it.first } ?: 0
        return Array(n) { i -> if (found.any { it.first == i + 1 && it.second == "d" }) 3 as Any else "Sample" }
    }

    private fun check(what: String, template: String, locale: java.util.Locale) {
        val args = sampleArgs(template)
        // every '%' belongs to a positional placeholder or is a doubled literal percent sign
        val bare = template.replace("%%", "").replace(placeholder, "")
        assertFalse("$what: stray '%' in '$template'", bare.contains('%'))
        val out = try { String.format(locale, template, *args) } catch (e: Exception) { throw AssertionError("$what: '$template' does not format: $e") }
        val percents = Regex("%%").findAll(template).count()
        assertEquals("$what: percent signs in '$out'", percents, out.count { it == '%' })
        assertFalse("$what: unresolved placeholder in '$out'", Regex("%\\d|\\{\\d*\\}|\\$\\d").containsMatchIn(out))
        assertTrue("$what: empty text", out.isNotBlank())
    }

    @Test fun every_text_of_every_language_formats() {
        val folders = TestStrings.folders()
        assertTrue("expected the default and 25 translations, found $folders", folders.size >= 26)
        for (folder in folders) {
            val x = TestStrings.forFolder(folder)
            val locale = x.locale
            assertTrue("$folder: no strings", x.stringTemplates.size > 100)
            for ((name, t) in x.stringTemplates) if (name !in x.untranslatable) check("$folder string $name", t, locale)
            for ((name, forms) in x.pluralTemplates) {
                assertTrue("$folder plurals $name: no 'other' form", "other" in forms)
                for ((q, t) in forms) check("$folder plurals $name[$q]", t, locale)
            }
            for ((name, items) in x.arrayItems) {
                assertTrue("$folder array $name: empty", items.isNotEmpty())
                for ((i, t) in items.withIndex()) assertTrue("$folder array $name[$i] is blank", t.isNotBlank())
            }
            assertEquals("$folder weekdays_long", 7, x.arrayItems["weekdays_long"]?.size)
            assertEquals("$folder weekdays_short", 7, x.arrayItems["weekdays_short"]?.size)
            assertEquals("$folder months_short", 12, x.arrayItems["months_short"]?.size)
        }
    }

    @Test fun the_logic_texts_resolve_through_the_helper_in_every_language() {
        // the helper the logic tests use (ids -> names -> templates) works for every file, for the plural helper in the one/other forms too
        for (folder in TestStrings.folders()) {
            val x = TestStrings.forFolder(folder)
            assertTrue(folder, x.get(R.string.unit_ct_kwh).isNotBlank())
            assertTrue(folder, x.get(R.string.unit_price).isNotBlank())
            assertTrue(folder, x.get(R.string.tooltip, "A", "12", "B").contains("12"))
            assertTrue(folder, x.get(R.string.place_no_match, "xyz").contains("xyz"))
            assertTrue(folder, x.plural(R.plurals.hours_count, 1, 1).contains("1"))
            assertTrue(folder, x.plural(R.plurals.hours_count, 5, 5).contains("5"))
            assertEquals(7, x.array(R.array.weekdays_long).size)
        }
    }
}
