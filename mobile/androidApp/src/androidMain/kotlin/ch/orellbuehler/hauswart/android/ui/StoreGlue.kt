package ch.orellbuehler.hauswart.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.i18n.I18n

val LocalApp = staticCompositionLocalOf<HauswartApp> { error("HauswartApp is not provided") }

/**
 * The language as state the UI toolkit watches. Every text that is looked up while a screen is
 * composed ([ch.orellbuehler.hauswart.i18n.tr]) reads it, so that a change of the language draws
 * every screen that shows a text again, without rebuilding the navigation.
 */
object LocaleTracker {
    private val state = mutableStateOf("")

    /** Starts watching [app]'s language. Call once, before the first screen is composed. */
    fun install(app: HauswartApp) {
        state.value = app.locale
        I18n.onRead = { state.value }
    }

    fun set(locale: String) {
        state.value = locale
    }

    /** The language now; composing code that reads it is composed again when the language changes. */
    fun current(): String = state.value
}

/**
 * Keeps the store of one screen in a view model. The store is made again when the language changed
 * (what it computed, labels and formatted values, is in the old language), and is closed when the
 * screen is popped ([onCleared]) or the session ends ([StoreRegistry.closeAll]).
 */
class StoreHolder<T : Store<*>> : ViewModel() {
    private var held: T? = null
    private var language = ""

    fun get(
        locale: String,
        create: () -> T,
    ): T {
        held?.takeIf { language == locale }?.let { return it }
        held?.close()
        language = locale
        return create().also {
            held = it
            StoreRegistry.track(this)
        }
    }

    /** Closes the store; the next [get] makes a new one. */
    fun close() {
        held?.close()
        held = null
    }

    override fun onCleared() {
        StoreRegistry.forget(this)
        close()
    }
}

/**
 * The stores of the screens. When the person signs out the whole navigation is left, but a back
 * stack that is left is not popped: its view models stay until the activity ends. Their stores are
 * closed here so that none keeps listening or loading for the next session (and the sign-in screen
 * starts with a store of its own).
 */
object StoreRegistry {
    private val holders = mutableSetOf<StoreHolder<*>>()

    fun track(holder: StoreHolder<*>) {
        holders += holder
    }

    fun forget(holder: StoreHolder<*>) {
        holders -= holder
    }

    fun closeAll() {
        holders.toList().forEach { it.close() }
        holders.clear()
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
            factory = viewModelFactory { initializer { StoreHolder<T>() } },
        )
    return holder.get(LocaleTracker.current()) { create(app) }
}

@Composable
fun <S : Any> Store<S>.collect(): S {
    val value by state.collectAsStateWithLifecycle()
    return value
}
