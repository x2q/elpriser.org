package org.elpriser.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import org.elpriser.app.ui.AutomationScreen
import org.elpriser.app.ui.BottomNav
import org.elpriser.app.ui.ElpriserTheme
import org.elpriser.app.ui.FlowHost
import org.elpriser.app.ui.NuScreen
import org.elpriser.app.ui.PrognoseScreen
import org.elpriser.app.ui.SettingsScreen
import org.elpriser.app.ui.SideRail
import org.elpriser.app.ui.T
import org.elpriser.app.ui.TimeScreen

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val sysDark = isSystemInDarkTheme()
            val dark = when (vm.settings.theme) { "dark" -> true; "light" -> false; else -> sysDark }
            // Statuslinjens og navigationsbjælkens ikoner skal følge appens tema, ikke kun systemets.
            DisposableEffect(dark) {
                enableEdgeToEdge(
                    statusBarStyle = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT) { dark },
                    navigationBarStyle = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT) { dark },
                )
                onDispose { }
            }
            ElpriserTheme(vm.settings.theme) { AppRoot(vm) }
        }
    }
}

@Composable
private fun AppRoot(vm: AppViewModel) {
    val t = T
    val wide = LocalConfiguration.current.screenWidthDp >= 600

    // Hent priser ved start, når netselskab/visning skifter, og når appen vender tilbage efter en pause.
    LaunchedEffect(vm.settings.mode, vm.settings.netGln, vm.settings.area) { vm.refresh() }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) vm.refresh() }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }
    BackHandler(enabled = vm.step == null && vm.tab != Tab.Nu) {
        vm.tab = if (vm.tab == Tab.Time) Tab.Prognose else Tab.Nu
    }

    Box(Modifier.fillMaxSize().background(t.bg)) {
        val content: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize()) {
                when (vm.tab) {
                    Tab.Nu -> NuScreen(vm, wide)
                    Tab.Prognose -> PrognoseScreen(vm, wide)
                    Tab.Time -> TimeScreen(vm, wide)
                    Tab.Automation -> AutomationScreen(vm, wide)
                    Tab.Settings -> SettingsScreen(vm, wide)
                }
            }
        }
        if (wide) {
            Row(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars)) {
                SideRail(vm.tab) { vm.tab = it }
                Box(Modifier.weight(1f)) { content() }
            }
        } else {
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f).windowInsetsPadding(WindowInsets.statusBars)) { content() }
                Box(Modifier.background(t.nav).windowInsetsPadding(WindowInsets.navigationBars)) {
                    BottomNav(vm.tab) { vm.tab = it }
                }
            }
        }
        Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars)) { FlowHost(vm) }
    }
}

