package org.elpriser.app

import org.elpriser.app.ui.Strings
import org.w3c.dom.Element
import java.io.File
import java.util.Locale
import javax.xml.parsers.DocumentBuilderFactory

/**
 * The app's own texts for the JVM tests, read from the strings.xml the app ships — so there is exactly one Danish wording.
 * The logic functions ask for texts by resource id; the ids are mapped to names through the generated R class.
 * Placeholders are formatted with String.format in the file's locale, as Resources.getString does on a device.
 * Android's resource escapes (\n, \', \", \\, \@, \?, \uXXXX) are undone; whitespace handling is the plain trim only,
 * which is all these files use (test-android-strings.mjs forbids the rest).
 */
class XmlStrings(file: File, private val locale: Locale) : Strings {
    private val strings = HashMap<String, String>()
    private val plurals = HashMap<String, Map<String, String>>()
    private val arrays = HashMap<String, List<String>>()
    private val names = HashMap<Int, String>()

    init {
        require(file.exists()) { "strings file not found: ${file.absolutePath} (tests run with app/ as working directory)" }
        for (cls in listOf(R.string::class.java, R.plurals::class.java, R.array::class.java)) {
            for (f in cls.fields) {
                val id = f.getInt(null)
                require(id != 0 && !names.containsKey(id)) { "R.${cls.simpleName}.${f.name} has no unique id ($id); cannot map ids to names" }
                names[id] = f.name
            }
        }
        val root = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file).documentElement
        val nodes = root.childNodes
        for (i in 0 until nodes.length) {
            val n = nodes.item(i) as? Element ?: continue
            val name = n.getAttribute("name")
            when (n.tagName) {
                "string" -> strings[name] = unescape(n.textContent)
                "plurals" -> plurals[name] = items(n).associate { it.getAttribute("quantity") to unescape(it.textContent) }
                "string-array" -> arrays[name] = items(n).map { unescape(it.textContent) }
            }
        }
    }

    private fun items(parent: Element): List<Element> {
        val out = ArrayList<Element>()
        val kids = parent.getElementsByTagName("item")
        for (i in 0 until kids.length) out.add(kids.item(i) as Element)
        return out
    }

    private fun unescape(raw: String): String {
        val t = raw.trim()
        val sb = StringBuilder()
        var i = 0
        while (i < t.length) {
            val c = t[i]
            if (c == '\\' && i + 1 < t.length) {
                when (val n = t[i + 1]) {
                    'n' -> sb.append('\n')
                    't' -> sb.append('\t')
                    'u' -> { sb.append(t.substring(i + 2, i + 6).toInt(16).toChar()); i += 4 }
                    else -> sb.append(n)
                }
                i += 2
            } else {
                sb.append(c)
                i++
            }
        }
        return sb.toString()
    }

    private fun nameOf(id: Int) = names[id] ?: error("unknown resource id $id")

    override fun get(id: Int, vararg args: Any): String {
        val name = nameOf(id)
        val template = strings[name] ?: error("no string '$name' in the strings file")
        return String.format(locale, template, *args)
    }

    override fun plural(id: Int, count: Int, vararg args: Any): String {
        val name = nameOf(id)
        val forms = plurals[name] ?: error("no plurals '$name' in the strings file")
        val template = (if (count == 1) forms["one"] else forms["other"]) ?: error("plurals '$name' lacks the form for $count")
        return String.format(locale, template, *args)
    }

    override fun array(id: Int): List<String> = arrays[nameOf(id)] ?: error("no string-array '${nameOf(id)}' in the strings file")
}

object TestStrings {
    /** Danish: the default values/strings.xml. Gradle runs unit tests with the module directory (app/) as working directory. */
    val da: Strings by lazy { XmlStrings(File("src/main/res/values/strings.xml"), Locale("da", "DK")) }
}
