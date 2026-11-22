package ch.orellbuehler.hauswart.core

import ch.orellbuehler.hauswart.HauswartApp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The logic of one screen. Both apps render [state] and call the store's plain (non-suspending)
 * functions; nothing else of a screen lives in the apps. A store is created when its screen opens
 * and closed with [close] when it goes away.
 */
abstract class Store<S : Any>(
    initial: S,
) {
    protected val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _state = MutableStateFlow(initial)
    val state: StateFlow<S> = _state.asStateFlow()

    /** The state right now. Swift reads this after [subscribe] told it that something changed. */
    val value: S get() = _state.value

    protected val current: S get() = _state.value

    /** Calls [listener] on the main thread after every change of [state], until cancelled. */
    fun subscribe(listener: () -> Unit): StoreSubscription {
        val job = scope.launch { _state.drop(1).collect { listener() } }
        return StoreSubscription(job)
    }

    protected fun update(transform: (S) -> S) {
        _state.update(transform)
    }

    /**
     * Runs [block]; a failure reaches [onError] as the text to show (see [errorText]) and never
     * escapes. Cancellation passes through.
     */
    protected fun launch(
        onError: (UiError) -> Unit,
        block: suspend CoroutineScope.() -> Unit,
    ): Job = launchIn(scope, onError, block)

    /**
     * [launch] in another scope, for work that must finish although the screen is closed meanwhile
     * (an upload): pass [HauswartApp.background]. The store is updated when the work ends, whether
     * or not anyone still looks at it.
     */
    protected fun launchIn(
        outliving: CoroutineScope,
        onError: (UiError) -> Unit,
        block: suspend CoroutineScope.() -> Unit,
    ): Job =
        outliving.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                onError(uiErrorOf(e))
            }
        }

    /** Calls [block] whenever one of [topics] is reported through [HauswartApp.changed]. */
    protected fun onChange(
        app: HauswartApp,
        vararg topics: String,
        block: () -> Unit,
    ) {
        scope.launch {
            app.changes.collect { if (it in topics) block() }
        }
    }

    open fun close() {
        scope.cancel()
    }
}

class StoreSubscription internal constructor(
    private val job: Job,
) {
    fun cancel() {
        job.cancel()
    }
}

/** Follows `nextCursor` until a list is exhausted. Household lists are small; screens show all of it. */
suspend fun <T> fetchAll(page: suspend (cursor: String?) -> Pair<List<T>, String?>): List<T> {
    val all = mutableListOf<T>()
    var cursor: String? = null
    var pages = 0
    do {
        val (items, next) = page(cursor)
        all += items
        cursor = next
        pages++
    } while (cursor != null && pages < 200)
    return all
}
