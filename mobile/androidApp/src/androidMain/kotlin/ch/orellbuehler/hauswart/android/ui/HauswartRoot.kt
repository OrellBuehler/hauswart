package ch.orellbuehler.hauswart.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ListAlt
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.android.ui.connect.ConnectScreen
import ch.orellbuehler.hauswart.android.ui.contacts.contactsGraph
import ch.orellbuehler.hauswart.android.ui.dashboard.dashboardGraph
import ch.orellbuehler.hauswart.android.ui.more.moreGraph
import ch.orellbuehler.hauswart.android.ui.nav.LocalNav
import ch.orellbuehler.hauswart.android.ui.nav.PendingLinks
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.nav.featureGraphs
import ch.orellbuehler.hauswart.android.ui.nav.open
import ch.orellbuehler.hauswart.android.ui.theme.HauswartTheme
import ch.orellbuehler.hauswart.i18n.tr

private data class Tab(
    val route: String,
    val labelKey: String,
    val icon: ImageVector,
)

private val tabs =
    listOf(
        Tab(Routes.HOME, "nav_dashboard", Icons.Outlined.Home),
        Tab(Routes.TASKS, "nav_tasks", Icons.AutoMirrored.Outlined.ListAlt),
        Tab(Routes.COSTS, "nav_costs", Icons.Outlined.Payments),
        Tab(Routes.MORE, "m_nav_more", Icons.Outlined.Menu),
    )

@Composable
fun HauswartRoot(app: HauswartApp) {
    val session by app.session.state.collectAsStateWithLifecycle()
    val locale by app.localeFlow.collectAsStateWithLifecycle()
    HauswartTheme {
        CompositionLocalProvider(LocalApp provides app) {
            // Texts come from tr(), which reads the current language: a change rebuilds everything.
            key(locale, session.signedIn) {
                if (session.signedIn) MainScaffold() else ConnectScreen()
            }
        }
    }
}

@Composable
private fun MainScaffold() {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val current = entry?.destination
    val onTab = tabs.any { it.route == current?.route }
    val pending by PendingLinks.link.collectAsStateWithLifecycle()
    LaunchedEffect(pending) {
        pending?.let {
            nav.open(it)
            PendingLinks.consume()
        }
    }
    Scaffold(
        bottomBar = {
            if (onTab) {
                NavigationBar {
                    tabs.forEach { tab ->
                        NavigationBarItem(
                            selected = current?.hierarchy?.any { it.route == tab.route } == true,
                            onClick = { nav.switchTab(tab.route) },
                            icon = { Icon(tab.icon, contentDescription = null) },
                            label = { Text(tr(tab.labelKey), maxLines = 1) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
            CompositionLocalProvider(LocalNav provides nav) {
                NavHost(navController = nav, startDestination = Routes.HOME) {
                    dashboardGraph(nav)
                    contactsGraph(nav)
                    moreGraph(nav)
                    featureGraphs(nav)
                }
            }
        }
    }
}

private fun NavController.switchTab(route: String) {
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
