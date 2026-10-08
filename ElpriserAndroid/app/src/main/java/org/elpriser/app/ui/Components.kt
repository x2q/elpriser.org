package org.elpriser.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.elpriser.app.Tab

@Composable
fun AppCard(modifier: Modifier = Modifier, padding: PaddingValues = PaddingValues(16.dp), content: @Composable ColumnScope.() -> Unit) {
    val t = T
    Column(
        modifier.fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(t.surface)
            .border(BorderStroke(1.dp, t.outline), RoundedCornerShape(24.dp))
            .padding(padding),
        content = content,
    )
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), modifier, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp, color = T.text2)
}

@Composable
fun Pill(text: String, bg: Color, fg: Color, modifier: Modifier = Modifier) {
    Text(text, modifier.clip(RoundedCornerShape(18.dp)).background(bg).padding(horizontal = 14.dp, vertical = 7.dp),
        fontSize = 13.5.sp, fontWeight = FontWeight.Bold, color = fg)
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, height: Dp = 52.dp) {
    val t = T
    Box(
        modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(height / 2))
            .background(if (enabled) t.brandSolid else t.surface2)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(text, fontSize = 15.5.sp, fontWeight = FontWeight.ExtraBold, color = if (enabled) Color.White else t.text2) }
}

@Composable
fun TextAction(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = T.brand) {
    Box(modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(24.dp)).clickable(role = Role.Button, onClick = onClick), contentAlignment = Alignment.Center) {
        Text(text, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, color = color)
    }
}

@Composable
fun SoftButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, bg: Color = T.surface2, fg: Color = T.text) {
    Box(modifier.height(44.dp).clip(RoundedCornerShape(22.dp)).background(bg).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center) { Text(text, fontSize = 13.5.sp, fontWeight = FontWeight.Bold, color = fg) }
}

/** Segmenteret valg (faner). */
@Composable
fun Segmented(options: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val t = T
    Row(modifier.clip(RoundedCornerShape(22.dp)).background(t.surface2).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        options.forEachIndexed { i, o ->
            val on = i == selected
            Box(
                Modifier.weight(1f).height(38.dp).clip(RoundedCornerShape(19.dp))
                    .background(if (on) t.brandSolid else Color.Transparent)
                    .semantics { role = Role.Tab; this.selected = on }
                    .clickable { onSelect(i) },
                contentAlignment = Alignment.Center,
            ) { Text(o, fontSize = 13.5.sp, fontWeight = FontWeight.Bold, color = if (on) Color.White else t.text2) }
        }
    }
}

@Composable
fun StatTile(label: String, value: String, sub: String, color: Color, modifier: Modifier = Modifier) {
    val t = T
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(t.surface2).padding(horizontal = 12.dp, vertical = 9.dp)) {
        Text(label.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp, color = t.text2)
        Row(verticalAlignment = Alignment.Bottom) {
            Text(value, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold, color = color)
            Text(" $sub", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = t.text2, modifier = Modifier.padding(bottom = 2.dp))
        }
    }
}

@Composable
fun ScreenHeader(title: String, subtitle: String, modifier: Modifier = Modifier, trailing: @Composable RowScope.() -> Unit = {}) {
    val t = T
    Row(modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.5).sp, lineHeight = 30.sp)
            Text(subtitle, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = t.text2)
        }
        trailing()
    }
}

@Composable
fun Loading(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = T.brandSolid, strokeWidth = 3.dp, modifier = Modifier.size(36.dp))
    }
}

@Composable
fun ErrorCard(text: String, onRetry: (() -> Unit)?) {
    val t = T
    AppCard {
        Text(text, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, lineHeight = 21.sp)
        if (onRetry != null) {
            Box(Modifier.padding(top = 12.dp)) { SoftButton("Prøv igen", onRetry, bg = t.brandSoft, fg = t.brand) }
        }
    }
}

@Composable
fun RadioMark(selected: Boolean) {
    val t = T
    Box(Modifier.size(24.dp).border(2.dp, if (selected) t.brandSolid else t.text2, CircleShape), contentAlignment = Alignment.Center) {
        if (selected) Box(Modifier.size(11.dp).clip(CircleShape).background(t.brandSolid))
    }
}

@Composable
fun NavItem(label: String, path: String, active: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val t = T
    Column(
        modifier.clickable(role = Role.Tab, onClick = onClick).semantics { selected = active; contentDescription = label },
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box(
            Modifier.width(64.dp).height(32.dp).clip(RoundedCornerShape(16.dp)).background(if (active) t.brandSolid else Color.Transparent),
            contentAlignment = Alignment.Center,
        ) { Icon(path, if (active) Color.White else t.text2, 22.dp, stroke = 2.2f, fill = false) }
        Text(label, fontSize = 12.sp, fontWeight = if (active) FontWeight.Bold else FontWeight.SemiBold, color = if (active) t.text else t.text2, textAlign = TextAlign.Center)
    }
}

private val navItems = listOf(
    Triple(Tab.Nu, "Nu", Ic.Bolt), Triple(Tab.Prognose, "Prognose", Ic.Trend),
    Triple(Tab.Automation, "Automation", Ic.Clock), Triple(Tab.Settings, "Mere", Ic.Menu),
)

private fun activeTab(t: Tab) = if (t == Tab.Time) Tab.Prognose else t

@Composable
fun BottomNav(tab: Tab, onTab: (Tab) -> Unit) {
    val t = T
    Row(Modifier.fillMaxWidth().background(t.nav).padding(top = 12.dp, bottom = 12.dp), horizontalArrangement = Arrangement.SpaceAround) {
        navItems.forEach { (tb, label, icon) -> NavItem(label, icon, activeTab(tab) == tb, { onTab(tb) }, Modifier.weight(1f)) }
    }
}

@Composable
fun SideRail(tab: Tab, onTab: (Tab) -> Unit) {
    val t = T
    Column(Modifier.width(96.dp).fillMaxHeight().background(t.nav).padding(top = 20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(t.brandSolid), contentAlignment = Alignment.Center) {
            Icon(Ic.Bolt, Color.White, 24.dp, fill = true)
        }
        Box(Modifier.height(10.dp))
        navItems.forEach { (tb, label, icon) -> NavItem(label, icon, activeTab(tab) == tb, { onTab(tb) }, Modifier.width(88.dp).padding(vertical = 4.dp)) }
    }
}
