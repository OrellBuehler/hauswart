package ch.orellbuehler.hauswart.feature.root

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.Store
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

data class RootState(
    val signedIn: Boolean,
    val locale: String,
    val userName: String,
)

/** What the outermost view needs: signed in or not, and the language (a change rebuilds the UI). */
class RootStore(
    private val app: HauswartApp,
) : Store<RootState>(stateOf(app)) {
    init {
        scope.launch {
            combine(app.session.state, app.localeFlow) { _, _ -> stateOf(app) }.collect { next -> update { next } }
        }
    }

    private companion object {
        fun stateOf(app: HauswartApp): RootState {
            val user = app.session.user
            return RootState(
                signedIn = app.session.state.value.signedIn,
                locale = app.locale,
                userName = user?.displayName ?: user?.username ?: "",
            )
        }
    }
}
