package ch.orellbuehler.hauswart.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.Store

val LocalApp = staticCompositionLocalOf<HauswartApp> { error("HauswartApp is not provided") }

class StoreHolder<T : Store<*>>(
    val store: T,
) : ViewModel() {
    override fun onCleared() {
        store.close()
    }
}

/**
 * The store of a screen. It lives as long as the screen is on the back stack (it is kept in the
 * navigation entry's view model store) and is closed when the screen is popped. [key] tells apart
 * two stores of the same class on one screen.
 */
@Composable
inline fun <reified T : Store<*>> rememberStore(
    key: String = "",
    crossinline create: (HauswartApp) -> T,
): T {
    val app = LocalApp.current
    val holder: StoreHolder<T> =
        viewModel(
            key = T::class.java.name + key,
            factory = viewModelFactory { initializer { StoreHolder(create(app)) } },
        )
    return holder.store
}

@Composable
fun <S : Any> Store<S>.collect(): S {
    val value by state.collectAsStateWithLifecycle()
    return value
}
