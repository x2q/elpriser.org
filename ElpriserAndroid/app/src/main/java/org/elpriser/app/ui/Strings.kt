package org.elpriser.app.ui

import android.content.res.Resources
import androidx.annotation.ArrayRes
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext

/*
 * Tekster uden Android-afhængighed i logikken: de rene funktioner (PriceLogic, Calc) får en [Strings] ind og beder om
 * en tekst med dens ressource-id. I appen er det [ResStrings] oven på Resources (og dermed enhedens sprog); i enhedstestene
 * en læser af res/values/strings.xml, så testene kører på JVM uden Android og stadig bruger de tekster, der leveres.
 */
interface Strings {
    fun get(@StringRes id: Int, vararg args: Any): String
    fun plural(@PluralsRes id: Int, count: Int, vararg args: Any): String
    fun array(@ArrayRes id: Int): List<String>
}

class ResStrings(private val res: Resources) : Strings {
    override fun get(id: Int, vararg args: Any): String = res.getString(id, *args)
    override fun plural(id: Int, count: Int, vararg args: Any): String = res.getQuantityString(id, count, *args)
    override fun array(id: Int): List<String> = res.getStringArray(id).toList()
}

/** Teksterne i det sprog, enheden (eller appens sprogindstilling) har valgt lige nu; skifter ved sprogskifte. */
@Composable
fun rememberStrings(): Strings {
    val ctx = LocalContext.current
    val cfg = LocalConfiguration.current
    return remember(ctx, cfg) { ResStrings(ctx.resources) }
}
