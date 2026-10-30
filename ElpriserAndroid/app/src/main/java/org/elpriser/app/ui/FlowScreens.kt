package org.elpriser.app.ui

import android.Manifest
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
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
import org.elpriser.app.Tab
import org.elpriser.app.data.Net
import org.elpriser.app.data.Nets
import org.elpriser.app.data.Position

/** Stedslisten "Hvor er du?" — ligger oven på hele appen: ved første start og fra net-chippen. */
@Composable
fun FlowHost(vm: AppViewModel) {
    val step = vm.step ?: return
    Box(Modifier.fillMaxSize().background(T.bg)) {
        when (step) { is Step.Place -> Place(vm, step) }
    }
}

/** Søgningen på tværs af begge områder: netselskaber, hvis navn indeholder søgeordet. */
internal fun matchNets(q: String): List<Net> {
    val needle = q.trim().lowercase()
    return if (needle.isEmpty()) emptyList() else Nets.all.filter { it.name.lowercase().contains(needle) }
}

@Composable
private fun Place(vm: AppViewModel, step: Step.Place) {
    val t = T
    val tx = rememberStrings()
    val ctx = LocalContext.current
    val s = vm.settings
    var area by remember { mutableStateOf<String?>(null) }
    var q by remember { mutableStateOf("") }
    val found = matchNets(q)
    val searching = q.isNotBlank()

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        if (res.values.any { it }) vm.detect(ctx) else vm.positionDenied()
    }
    val ask = {
        if (Position.hasPermission(ctx)) vm.detect(ctx)
        else launcher.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION))
    }
    BackHandler { if (area != null) area = null else vm.closeStep() }

    val detail = { a: String ->
        val n = s.net
        when {
            n != null && n.area == a -> n.name
            n == null && s.area == a -> tx.get(R.string.view_nonet_title)
            else -> null
        }
    }
    val areaName = { a: String -> tx.get(if (a == "DK1") R.string.place_west else R.string.place_east) }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 560.dp).fillMaxSize()) {
            Box(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp)) {
                val a = area
                if (a != null) {
                    Row(
                        Modifier.align(Alignment.CenterStart).height(48.dp).clip(RoundedCornerShape(24.dp)).clickable(role = Role.Button) { area = null }.padding(horizontal = 8.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Icon(Ic.Back, t.brand, 22.dp, stroke = 2.4f)
                        Text(tx.get(R.string.place_title), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = t.brand)
                    }
                }
                Text(
                    if (a != null) areaName(a) else tx.get(R.string.place_title), Modifier.align(Alignment.Center),
                    fontSize = 17.sp, fontWeight = FontWeight.ExtraBold,
                )
                Box(
                    Modifier.align(Alignment.CenterEnd).height(48.dp).clip(RoundedCornerShape(24.dp)).clickable(role = Role.Button) { vm.closeStep() }.padding(horizontal = 14.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(tx.get(if (s.onboarded) R.string.place_close else R.string.welcome_skip), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = t.brand) }
            }
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val a = area
                if (a != null) {
                    Group {
                        PlaceRow(tx.get(R.string.view_nonet_title), check = s.net == null && s.area == a) { vm.chooseArea(a) }
                        Nets.all.filter { it.area == a }.forEach { n -> PlaceRow(n.name, check = s.net?.gln == n.gln, sep = true) { vm.choose(n, "manual") } }
                    }
                    Foot(tx.get(R.string.place_net_note))
                } else {
                    if (!s.onboarded) {
                        Column(Modifier.padding(horizontal = 4.dp, vertical = 6.dp)) {
                            Text(tx.get(R.string.welcome_title), fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.6).sp, lineHeight = 30.sp)
                            Text(tx.get(R.string.welcome_body), Modifier.padding(top = 6.dp), fontSize = 14.sp, lineHeight = 20.sp, color = t.text2, fontWeight = FontWeight.Medium)
                        }
                    }
                    if (step.note != null) {
                        Text(tx.get(step.note), Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(t.midSoft).padding(horizontal = 14.dp, vertical = 10.dp),
                            fontSize = 13.sp, lineHeight = 19.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Row(Modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(22.dp)).background(t.surface2).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Ic.Search, t.text2, 18.dp, stroke = 2.2f)
                        Box(Modifier.padding(start = 10.dp).weight(1f)) {
                            if (q.isEmpty()) Text(tx.get(R.string.picker_search_hint), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
                            BasicTextField(q, { q = it }, singleLine = true, cursorBrush = SolidColor(t.brandSolid),
                                textStyle = TextStyle(fontFamily = Manrope, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = t.text), modifier = Modifier.fillMaxWidth())
                        }
                    }
                    if (searching) {
                        if (found.isEmpty()) Foot(tx.get(R.string.picker_no_match, q.trim()))
                        else Group { found.forEachIndexed { i, n -> PlaceRow(n.name, detail = areaLabel(tx, n.area), check = s.net?.gln == n.gln, sep = i > 0) { vm.choose(n, "manual") } } }
                    } else {
                        Group {
                            if (step.searching) {
                                Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    CircularProgressIndicator(color = t.brandSolid, strokeWidth = 2.5.dp, modifier = Modifier.size(20.dp))
                                    Text(tx.get(R.string.searching_title), fontSize = 16.sp, fontWeight = FontWeight.Bold)
                                }
                            } else PlaceRow(tx.get(R.string.place_use_position), icon = Ic.Locate, tint = t.brand, bold = true, onClick = ask)
                        }
                        Foot(tx.get(if (step.searching) R.string.searching_hint else R.string.place_position_note))
                        if (s.net != null && !step.searching) TextAction(tx.get(R.string.place_forget), { vm.forget() }, Modifier.padding(horizontal = 0.dp))
                        Head(tx.get(R.string.place_group_dk))
                        Group {
                            PlaceRow(tx.get(R.string.place_west), detail = detail("DK1"), chevron = true) { area = "DK1" }
                            PlaceRow(tx.get(R.string.place_east), detail = detail("DK2"), chevron = true, sep = true) { area = "DK2" }
                        }
                        Head(tx.get(R.string.place_others))
                        Group { PlaceRow(tx.get(R.string.place_nordics), chevron = true) { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://elpriser.org/norden"))) } }
                        Box(Modifier.height(10.dp))
                        Group { PlaceRow(tx.get(R.string.place_settings), icon = Ic.Sliders, chevron = true) { vm.closeStep(); vm.tab = Tab.Settings } }
                    }
                }
                Box(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun Head(text: String) {
    SectionLabel(text, Modifier.padding(start = 16.dp, top = 14.dp, bottom = 2.dp))
}

@Composable
private fun Foot(text: String) {
    Text(text, Modifier.padding(horizontal = 16.dp, vertical = 2.dp), fontSize = 12.5.sp, lineHeight = 18.sp, color = T.text2)
}

/** Én afrundet gruppe af rækker med tynde skillelinjer, som Apples grupperede lister. */
@Composable
private fun Group(content: @Composable () -> Unit) {
    val t = T
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(t.surface).border(BorderStroke(1.dp, t.outline), RoundedCornerShape(20.dp)),
    ) { content() }
}

@Composable
private fun PlaceRow(
    label: String, detail: String? = null, icon: String? = null, tint: Color = T.text, bold: Boolean = false,
    check: Boolean = false, chevron: Boolean = false, sep: Boolean = false, onClick: () -> Unit,
) {
    val t = T
    if (sep) Box(Modifier.padding(start = 16.dp).fillMaxWidth().height(1.dp).background(t.outline))
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (icon != null) Icon(icon, tint, 20.dp, stroke = 2.2f)
        Text(label, Modifier.weight(1f), fontSize = 16.sp, fontWeight = if (bold || check) FontWeight.ExtraBold else FontWeight.SemiBold, color = tint)
        if (detail != null) Text(detail, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
        if (check) Icon(Ic.Check, t.brandSolid, 20.dp, stroke = 2.6f)
        if (chevron) Icon(Ic.Next, t.text2, 16.dp, stroke = 2.4f)
    }
}
