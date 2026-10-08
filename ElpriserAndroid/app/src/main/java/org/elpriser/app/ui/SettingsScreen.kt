package org.elpriser.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.elpriser.app.AppViewModel
import org.elpriser.app.BuildConfig

@Composable
fun SettingsScreen(vm: AppViewModel, wide: Boolean) {
    val t = T
    val s = vm.settings
    val ctx = LocalContext.current
    fun open(url: String) = ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))

    val netCard: @Composable () -> Unit = {
        val net = s.net
        AppCard {
            SectionLabel("Netselskab")
            Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).clip(CircleShape).background(t.brandSoft), contentAlignment = Alignment.Center) { Icon(Ic.Pin, t.brand, 24.dp) }
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(if (net != null) "${net.name} · ${net.areaLabel}" else "Intet netselskab valgt", fontSize = 17.sp, fontWeight = FontWeight.ExtraBold)
                    Text(
                        if (net != null) (if (s.netHow == "gps") "Fundet med din position · gemt på telefonen" else "Valgt af dig · gemt på telefonen") else "Priserne vises uden nettarif",
                        fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = t.text2,
                    )
                }
                SoftButton("Skift", { vm.openPicker() })
            }
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f)) { PrimaryButton(if (net != null) "Find mit netselskab igen" else "Find mit netselskab", { vm.openWelcome() }, height = 46.dp) }
                if (net != null) SoftButton("Glem", { vm.forget() }, bg = t.badSoft, fg = t.bad, modifier = Modifier.height(46.dp))
            }
            if (net == null) {
                Text("PRISOMRÅDE", Modifier.padding(top = 14.dp, bottom = 6.dp), fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp, color = t.text2)
                Segmented(listOf("DK1 Vest", "DK2 Øst"), if (s.area == "DK1") 0 else 1, { s.updateArea(if (it == 0) "DK1" else "DK2"); vm.refresh(true) })
            }
            Text("Vi spørger kun om din position, når du trykker. Vi gemmer svaret — netselskabet — og aldrig koordinaterne.",
                Modifier.padding(top = 10.dp), fontSize = 12.5.sp, lineHeight = 18.sp, color = t.text2)
        }
    }

    val viewCard: @Composable () -> Unit = {
        val defs = listOf(
            "Samlet pris med netselskab" to "Spot, nettarif, afgifter og moms",
            "Uden netselskab" to "Energinets tariffer, elafgift og moms",
            "Spotpris inkl. moms" to "Børsprisen, som den er",
            "Spotpris ekskl. moms" to "Til beregninger og fakturaer",
        )
        AppCard(padding = PaddingValues(start = 8.dp, end = 8.dp, top = 16.dp, bottom = 8.dp)) {
            SectionLabel("Prisvisning", Modifier.padding(horizontal = 8.dp))
            defs.forEachIndexed { i, (label, sub) ->
                Row(
                    Modifier.fillMaxWidth().padding(top = 2.dp).heightIn(min = 54.dp).clip(RoundedCornerShape(16.dp))
                        .clickable(role = Role.RadioButton) { s.updateView(i); vm.refresh(true) }.padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(label, fontSize = 14.5.sp, fontWeight = FontWeight.Bold)
                        Text(if (i == 0 && s.net == null) "$sub — vælg først et netselskab" else sub, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
                    }
                    RadioMark(s.view == i)
                }
            }
        }
    }

    val lookCard: @Composable () -> Unit = {
        AppCard {
            SectionLabel("Udseende")
            Box(Modifier.padding(top = 10.dp)) {
                Segmented(listOf("System", "Lys", "Mørk"), when (s.theme) { "light" -> 1; "dark" -> 2; else -> 0 },
                    { s.updateTheme(listOf("system", "light", "dark")[it]) })
            }
        }
    }

    val aboutCard: @Composable () -> Unit = {
        AppCard {
            SectionLabel("Om appen")
            Text("Priser fra Energi Data Service og ENTSO-E · prognosen kommer fra en åben model på Hugging Face · elpriser ${BuildConfig.VERSION_NAME}",
                Modifier.padding(top = 8.dp), fontSize = 12.5.sp, lineHeight = 18.sp, color = t.text2, fontWeight = FontWeight.Medium)
            Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SoftButton("Privatliv", { open("https://elpriser.org/privatliv") }, bg = t.brandSoft, fg = t.brand)
                SoftButton("elpriser.org", { open("https://elpriser.org") }, bg = t.brandSoft, fg = t.brand)
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Indstillinger", "Netselskab, prisvisning og udseende")
        if (wide) {
            Row(Modifier.fillMaxSize().padding(start = 20.dp, end = 20.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Column(Modifier.width(520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) { netCard(); aboutCard() }
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) { viewCard(); lookCard() }
            }
        } else {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                netCard(); viewCard(); lookCard(); aboutCard()
            }
        }
    }
}
