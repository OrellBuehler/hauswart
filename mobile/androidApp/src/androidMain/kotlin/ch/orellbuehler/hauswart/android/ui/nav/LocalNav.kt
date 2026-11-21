package ch.orellbuehler.hauswart.android.ui.nav

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.navigation.NavController

/**
 * The navigation controller of the main scaffold, for composables that sit inside a screen's content and must open other
 * screens without being handed a controller (the extension points of the asset and room screens).
 */
val LocalNav = staticCompositionLocalOf<NavController> { error("NavController is not provided") }
