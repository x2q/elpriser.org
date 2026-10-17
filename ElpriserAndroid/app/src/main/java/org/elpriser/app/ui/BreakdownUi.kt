package org.elpriser.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.CollectionInfo
import androidx.compose.ui.semantics.CollectionItemInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.collectionInfo
import androidx.compose.ui.semantics.collectionItemInfo
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * Billedtekstens opdeling: "Inkl. nettarif, afgifter og moms" er en knap, der folder pris-delene ud.
 * Farverne følger rollerne (spot, Energinet, nettarif, elafgift, moms); farven bærer aldrig betydningen alene — rækkerne har etiketter.
 */

private val LightPartColors = mapOf(
    PartRole.Spot to Color(0xFF5B8DF7), PartRole.Energinet to Color(0xFFB9CCFA), PartRole.Grid to Color(0xFF14308F),
    PartRole.Duty to Color(0xFFF0A30A), PartRole.Vat to Color(0xFFC7CCD9),
)

/** Samme roller på den mørke skala: nettarif (marine) bliver lys og Energinet dæmpet blå, så de to stadig kan skelnes mod kortet. */
private val DarkPartColors = mapOf(
    PartRole.Spot to Color(0xFF5B8DF7), PartRole.Energinet to Color(0xFF3A4F85), PartRole.Grid to Color(0xFFB9CCFA),
    PartRole.Duty to Color(0xFFFFD24A), PartRole.Vat to Color(0xFF55627C),
)

@Composable
private fun partColor(role: PartRole): Color = (if (T.dark) DarkPartColors else LightPartColors).getValue(role)

/**
 * Billedteksten under Din pris | Spotpris. Uden opdeling ([breakdown] == null) er den ren tekst uden pil;
 * ellers én knap (mindst 44 dp høj) med en pil, der drejer, og — når den er foldet ud — panelet lige under.
 */
@Composable
fun PriceCaption(
    caption: String, breakdown: Breakdown?, expanded: Boolean, onToggle: () -> Unit,
    selectedHour: Boolean, onBackToNow: () -> Unit, fontSize: TextUnit, modifier: Modifier = Modifier,
) {
    val t = T
    if (breakdown == null) {
        Text(caption, modifier, fontSize = fontSize, fontWeight = FontWeight.SemiBold, color = t.text2)
        return
    }
    Column(modifier.fillMaxWidth().animateContentSize()) {
        Row(
            Modifier.heightIn(min = 44.dp)
                .clickable(role = Role.Button, onClickLabel = if (expanded) "Fold prisopbygningen ind" else "Fold prisopbygningen ud", onClick = onToggle)
                .semantics {
                    stateDescription = if (expanded) "Udfoldet" else "Foldet sammen"
                    if (expanded) collapse { onToggle(); true } else expand { onToggle(); true }
                },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(caption, fontSize = fontSize, fontWeight = FontWeight.SemiBold, color = t.text2)
            Icon(Ic.Down, t.text2, 16.dp, stroke = 2.4f, modifier = Modifier.rotate(if (expanded) 180f else 0f))
        }
        AnimatedVisibility(expanded) {
            BreakdownPanel(breakdown, selectedHour, onBackToNow)
        }
    }
}

@Composable
private fun BreakdownPanel(b: Breakdown, selectedHour: Boolean, onBackToNow: () -> Unit) {
    val t = T
    val figures = TextStyle(fontFeatureSettings = "tnum")
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier.fillMaxWidth().padding(top = 2.dp).clip(shape).background(t.surface2).border(BorderStroke(1.dp, t.outline), shape).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(b.heading, Modifier.weight(1f).semantics { heading() }, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            if (selectedHour) {
                Box(
                    Modifier.heightIn(min = 44.dp).clickable(role = Role.Button, onClick = onBackToNow).padding(horizontal = 4.dp),
                    contentAlignment = Alignment.CenterEnd,
                ) {
                    Text("Tilbage til nu", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = t.brand)
                }
            }
        }
        // Den tynde søjle er pynt: rækkerne under bærer tallene og etiketterne.
        val weights = b.barWeights()
        Row(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).clearAndSetSemantics { }) {
            b.rows.forEachIndexed { i, r ->
                if (weights[i] > 0f) Box(Modifier.weight(weights[i]).height(8.dp).background(partColor(r.role)))
            }
        }
        Column(
            Modifier.semantics { collectionInfo = CollectionInfo(rowCount = b.rows.size + 1, columnCount = 1) },
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            b.rows.forEachIndexed { i, r ->
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 28.dp)
                        .semantics(mergeDescendants = true) { collectionItemInfo = CollectionItemInfo(i, 1, 0, 1) },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(partColor(r.role)))
                    Text(r.label, Modifier.weight(1f).padding(start = 8.dp, end = 8.dp), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Text(r.text, style = figures, color = t.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            Box(Modifier.fillMaxWidth().padding(top = 4.dp).height(1.dp).background(t.outline).clearAndSetSemantics { })
            Row(
                Modifier.fillMaxWidth().heightIn(min = 32.dp)
                    .semantics(mergeDescendants = true) { collectionItemInfo = CollectionItemInfo(b.rows.size, 1, 0, 1) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("I alt", Modifier.weight(1f), fontSize = 14.sp, fontWeight = FontWeight.ExtraBold)
                Text(b.totalText, style = figures, color = t.text, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold)
            }
        }
    }
}
