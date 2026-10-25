package org.elpriser.app.ui

import android.Manifest
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.elpriser.app.AppViewModel
import org.elpriser.app.R
import org.elpriser.app.Step
import org.elpriser.app.data.Net
import org.elpriser.app.data.Nets
import org.elpriser.app.data.Position

/** Første start og "find / skift netselskab" — ligger oven på hele appen. */
@Composable
fun FlowHost(vm: AppViewModel) {
    val t = T
    val step = vm.step ?: return
    BackHandler {
        when (step) {
            is Step.Welcome -> if (vm.settings.onboarded) vm.closeStep() else vm.skip()
            is Step.Picker -> if (vm.settings.onboarded) vm.closeStep() else vm.openWelcome()
            is Step.Found -> vm.openPicker()
            Step.Searching -> vm.closeStep()
        }
    }
    Box(Modifier.fillMaxSize().background(t.bg)) {
        when (step) {
            is Step.Welcome -> Welcome(vm)
            Step.Searching -> Searching()
            is Step.Found -> Found(vm, step.net)
            is Step.Picker -> Picker(vm, step.note)
        }
    }
}

@Composable
private fun Narrow(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Box(Modifier.widthIn(max = 560.dp).fillMaxSize()) { content() }
    }
}

@Composable
private fun Brand() {
    val t = T
    val tx = rememberStrings()
    Row(Modifier.padding(horizontal = 20.dp).height(64.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(28.dp).clip(RoundedCornerShape(9.dp)).background(t.brandSolid), contentAlignment = Alignment.Center) { Icon(Ic.Bolt, Color.White, 16.dp, fill = true) }
        Text(tx.get(R.string.app_name), fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
private fun Welcome(vm: AppViewModel) {
    val t = T
    val tx = rememberStrings()
    val ctx = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        if (res.values.any { it }) vm.detect(ctx) else vm.positionDenied()
    }
    val ask = {
        if (Position.hasPermission(ctx)) vm.detect(ctx)
        else launcher.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION))
    }
    Narrow {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { Brand() }
                Text(tx.get(if (vm.settings.onboarded) R.string.welcome_cancel else R.string.welcome_skip), Modifier.clickable { if (vm.settings.onboarded) vm.closeStep() else vm.skip() }.padding(20.dp),
                    fontSize = 13.sp, fontWeight = FontWeight.Bold, color = t.brand)
            }
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp)) {
                Box(Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(200.dp).clip(CircleShape).background(t.brandSoft.copy(alpha = .45f)))
                    Box(Modifier.size(144.dp).clip(CircleShape).background(t.brandSoft.copy(alpha = .8f)))
                    Box(Modifier.size(88.dp).clip(CircleShape).background(t.brandSolid), contentAlignment = Alignment.Center) { Icon(Ic.Pin, Color.White, 42.dp) }
                }
                Text(tx.get(R.string.welcome_title), fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.8).sp, lineHeight = 34.sp, modifier = Modifier.padding(top = 12.dp))
                Text(tx.get(R.string.welcome_body),
                    Modifier.padding(top = 10.dp), fontSize = 15.sp, lineHeight = 22.sp, color = t.text2, fontWeight = FontWeight.Medium)
                Column(Modifier.padding(top = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    listOf(
                        tx.get(R.string.welcome_point_1),
                        tx.get(R.string.welcome_point_2),
                        tx.get(R.string.welcome_point_3),
                    ).forEach {
                        Row(verticalAlignment = Alignment.Top) {
                            Box(Modifier.size(32.dp).clip(CircleShape).background(t.surface).border(1.dp, t.outline, CircleShape), contentAlignment = Alignment.Center) { Icon(Ic.Check, t.brand, 16.dp, stroke = 2.4f) }
                            Text(it, Modifier.padding(start = 12.dp, top = 5.dp), fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
            Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                PrimaryButton(tx.get(R.string.action_find_net), ask, height = 56.dp)
                TextAction(tx.get(R.string.welcome_pick_myself), { vm.openPicker() })
            }
        }
    }
}

@Composable
private fun Searching() {
    val t = T
    val tx = rememberStrings()
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Loading()
        Text(tx.get(R.string.searching_title), fontSize = 17.sp, fontWeight = FontWeight.ExtraBold)
        Text(tx.get(R.string.searching_hint), Modifier.padding(top = 6.dp), fontSize = 13.5.sp, color = t.text2)
    }
}

@Composable
private fun Found(vm: AppViewModel, net: Net) {
    val t = T
    val tx = rememberStrings()
    Narrow {
        Column(Modifier.fillMaxSize()) {
            Brand()
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 8.dp)) {
                Box(Modifier.size(72.dp).clip(CircleShape).background(t.goodSoft), contentAlignment = Alignment.Center) { Icon(Ic.Check, t.good, 38.dp, stroke = 2.4f) }
                Text(tx.get(R.string.found_label).uppercase(), Modifier.padding(top = 20.dp), fontSize = 14.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp, color = t.text2)
                Text(net.name, fontSize = 44.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-1.4).sp, lineHeight = 48.sp)
                Text(tx.get(R.string.found_area, areaLabel(tx, net.area)), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = t.text2, modifier = Modifier.padding(top = 4.dp))
                AppCard(Modifier.padding(top = 22.dp), padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 14.dp)) {
                    SectionLabel(tx.get(R.string.found_saved_title))
                    listOf(
                        Triple(tx.get(R.string.found_saved_net, net.name, net.area), true, Ic.Check),
                        Triple(tx.get(R.string.found_saved_local), true, Ic.Check),
                        Triple(tx.get(R.string.found_saved_not), false, Ic.Close),
                    ).forEach { (text, ok, icon) ->
                        Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(28.dp).clip(CircleShape).background(if (ok) t.goodSoft else t.surface2), contentAlignment = Alignment.Center) {
                                Icon(icon, if (ok) t.good else t.text2, 15.dp, stroke = 2.4f)
                            }
                            Text(text, Modifier.padding(start = 12.dp), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, lineHeight = 19.sp)
                        }
                    }
                }
                Text(tx.get(R.string.found_wrong_hint),
                    Modifier.padding(top = 14.dp), fontSize = 12.5.sp, lineHeight = 18.sp, color = t.text2)
            }
            Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                PrimaryButton(tx.get(R.string.found_use, net.name), { vm.choose(net, "gps") }, height = 56.dp)
                TextAction(tx.get(R.string.found_not_mine), { vm.openPicker() })
            }
        }
    }
}

@Composable
private fun Picker(vm: AppViewModel, note: Int?) {
    val t = T
    val tx = rememberStrings()
    var q by remember { mutableStateOf("") }
    var sel by remember { mutableStateOf(vm.settings.net) }
    val needle = q.trim().lowercase()
    val nets = Nets.all.filter { needle.isEmpty() || it.name.lowercase().contains(needle) }
    Narrow {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.height(64.dp).padding(start = 8.dp, end = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).clip(CircleShape).clickable(role = Role.Button) {
                    if (vm.settings.onboarded) vm.closeStep() else vm.openWelcome()
                }, contentAlignment = Alignment.Center) { Icon(Ic.Back, t.text, 24.dp, stroke = 2.2f) }
                Column {
                    Text(tx.get(R.string.picker_title), fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.4).sp)
                    Text(tx.get(R.string.picker_subtitle), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
                }
            }
            Column(Modifier.padding(horizontal = 16.dp)) {
                if (note != null) {
                    Text(tx.get(note), Modifier.fillMaxWidth().padding(bottom = 10.dp).clip(RoundedCornerShape(16.dp)).background(t.midSoft).padding(horizontal = 14.dp, vertical = 10.dp),
                        fontSize = 13.sp, lineHeight = 19.sp, fontWeight = FontWeight.SemiBold)
                }
                Row(Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(26.dp)).background(t.surface2).padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Ic.Search, t.text2, 20.dp, stroke = 2.2f)
                    Box(Modifier.padding(start = 10.dp).weight(1f)) {
                        if (q.isEmpty()) Text(tx.get(R.string.picker_search_hint), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
                        BasicTextField(q, { q = it }, singleLine = true, cursorBrush = SolidColor(t.brandSolid),
                            textStyle = TextStyle(fontFamily = Manrope, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = t.text), modifier = Modifier.fillMaxWidth())
                    }
                }
                Row(
                    Modifier.fillMaxWidth().padding(top = 10.dp).height(48.dp).clip(RoundedCornerShape(24.dp)).background(t.brandSoft)
                        .clickable(role = Role.Button) { vm.openWelcome() }.padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(Ic.Pin, t.brand, 18.dp)
                    Text(tx.get(R.string.picker_locate), fontSize = 14.sp, fontWeight = FontWeight.ExtraBold, color = t.brand)
                }
            }
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp)) {
                for ((area, title) in listOf("DK1" to tx.get(R.string.picker_group_dk1), "DK2" to tx.get(R.string.picker_group_dk2))) {
                    val group = nets.filter { it.area == area }
                    if (group.isEmpty()) continue
                    SectionLabel(title, Modifier.padding(start = 8.dp, top = 14.dp, bottom = 6.dp))
                    AppCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
                        group.forEach { n ->
                            Row(Modifier.fillMaxWidth().heightIn(min = 50.dp).clip(RoundedCornerShape(14.dp)).clickable(role = Role.RadioButton) { sel = n }.padding(horizontal = 8.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                Text(n.name, Modifier.weight(1f), fontSize = 15.sp, fontWeight = FontWeight.Bold)
                                RadioMark(sel?.gln == n.gln)
                            }
                        }
                    }
                }
                if (nets.isEmpty()) Text(tx.get(R.string.picker_no_match, q), Modifier.fillMaxWidth().padding(40.dp), fontSize = 14.sp, color = t.text2)
                Box(Modifier.height(16.dp))
            }
            Box(Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 20.dp)) {
                val s = sel
                PrimaryButton(if (s != null) tx.get(R.string.picker_save, s.name) else tx.get(R.string.picker_choose), { s?.let { vm.choose(it, "manual") } }, enabled = s != null, height = 56.dp)
            }
        }
    }
}
