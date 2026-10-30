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
import org.elpriser.app.R
import org.elpriser.app.Tab

@Composable
fun SettingsScreen(vm: AppViewModel, wide: Boolean) {
    val t = T
    val s = vm.settings
    val ctx = LocalContext.current
    val tx = rememberStrings()
    fun open(url: String) = ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))

    val viewCard: @Composable () -> Unit = {
        val defs = listOf(
            tx.get(R.string.view_total_title) to tx.get(R.string.view_total_sub),
            tx.get(R.string.view_nonet_title) to tx.get(R.string.view_nonet_sub),
            tx.get(R.string.view_spot_incl_title) to tx.get(R.string.view_spot_incl_sub),
            tx.get(R.string.view_spot_excl_title) to tx.get(R.string.view_spot_excl_sub),
        )
        AppCard(padding = PaddingValues(start = 8.dp, end = 8.dp, top = 16.dp, bottom = 8.dp)) {
            SectionLabel(tx.get(R.string.view_label), Modifier.padding(horizontal = 8.dp))
            defs.forEachIndexed { i, (label, sub) ->
                Row(
                    Modifier.fillMaxWidth().padding(top = 2.dp).heightIn(min = 54.dp).clip(RoundedCornerShape(16.dp))
                        .clickable(role = Role.RadioButton) { s.updateView(i); vm.refresh(true) }.padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(label, fontSize = 14.5.sp, fontWeight = FontWeight.Bold)
                        Text(if (i == 0 && s.net == null) tx.get(R.string.view_needs_net, sub) else sub, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
                    }
                    RadioMark(s.view == i)
                }
            }
        }
    }

    val lookCard: @Composable () -> Unit = {
        AppCard {
            SectionLabel(tx.get(R.string.settings_look_label))
            Box(Modifier.padding(top = 10.dp)) {
                Segmented(listOf(tx.get(R.string.theme_system), tx.get(R.string.theme_light), tx.get(R.string.theme_dark)), when (s.theme) { "light" -> 1; "dark" -> 2; else -> 0 },
                    { s.updateTheme(listOf("system", "light", "dark")[it]) })
            }
        }
    }

    val aboutCard: @Composable () -> Unit = {
        AppCard {
            SectionLabel(tx.get(R.string.settings_about_label))
            Text(tx.get(R.string.about_text, BuildConfig.VERSION_NAME),
                Modifier.padding(top = 8.dp), fontSize = 12.5.sp, lineHeight = 18.sp, color = t.text2, fontWeight = FontWeight.Medium)
            Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SoftButton(tx.get(R.string.action_privacy), { open("https://elpriser.org/privatliv") }, bg = t.brandSoft, fg = t.brand)
                SoftButton(tx.get(R.string.link_site), { open("https://elpriser.org") }, bg = t.brandSoft, fg = t.brand)
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(start = 8.dp, end = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(48.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = tx.get(R.string.settings_back_label)) { vm.tab = Tab.Pris },
                contentAlignment = Alignment.Center,
            ) { Icon(Ic.Back, t.text, 24.dp, stroke = 2.2f) }
            Column(Modifier.weight(1f).padding(start = 4.dp)) {
                Text(tx.get(R.string.settings_title), fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.4).sp, lineHeight = 26.sp)
                Text(tx.get(R.string.settings_subtitle), fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
            }
        }
        if (wide) {
            Row(Modifier.fillMaxSize().padding(start = 20.dp, end = 20.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Column(Modifier.width(520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) { viewCard() }
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) { lookCard(); aboutCard() }
            }
        } else {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                viewCard(); lookCard(); aboutCard()
            }
        }
    }
}
