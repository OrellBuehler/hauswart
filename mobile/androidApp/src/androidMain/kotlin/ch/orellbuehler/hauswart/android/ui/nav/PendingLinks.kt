package ch.orellbuehler.hauswart.android.ui.nav

import ch.orellbuehler.hauswart.feature.applink.AppLink
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** A link that was handed to the app from outside (a tap on a reminder) and waits until a screen opens it. */
object PendingLinks {
    private val _link = MutableStateFlow<AppLink?>(null)
    val link: StateFlow<AppLink?> = _link

    fun offer(link: AppLink) {
        _link.value = link
    }

    fun consume() {
        _link.value = null
    }
}
