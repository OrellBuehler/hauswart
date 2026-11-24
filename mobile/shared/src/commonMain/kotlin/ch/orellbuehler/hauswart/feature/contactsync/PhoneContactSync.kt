package ch.orellbuehler.hauswart.feature.contactsync

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.StoreSubscription
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.core.uiErrorOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Reported through [HauswartApp.changed] when the choice of contacts changed on this device. */
const val TOPIC_CONTACT_SYNC = "contact_sync"

/** Reported after the phone wrote a plan, or failed to. */
const val TOPIC_CONTACT_SYNC_DONE = "contact_sync_done"

/**
 * One-way sync of the chosen contacts into the phone's address book. This class fetches the contacts
 * and says what the address book has to hold ([plan]); the platform code writes it and reports back
 * with [applied] or [failed]. Signing out leaves the phone's entries alone: a session also ends by
 * itself when the device token runs out, and the person's contacts must not vanish then.
 */
class PhoneContactSync(
    private val app: HauswartApp,
) {
    private val prefs = PhoneContactPrefs(app.settings)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** Why the last sync could not reach the server; null after a good one. */
    var lastError: UiError? = null
        private set

    /**
     * The plan from the server's current contacts. Null when there is nothing to sync (signed out,
     * or nothing was ever chosen) and when the server cannot be reached: then the phone is not touched,
     * so that a failed request never deletes an entry. Never throws.
     */
    suspend fun plan(): PhoneContactPlan? {
        if (!app.session.state.value.signedIn) return null
        val chosen = prefs.chosen()
        val links = prefs.links()
        if (chosen.isEmpty() && links.isEmpty()) return null
        try {
            val contacts =
                fetchAll { cursor ->
                    val page = app.api.contacts.contactsList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            val known = contacts.map { it.id }.toSet()
            val kept = chosen.filter { it in known }.toSet()
            if (kept.size != chosen.size) prefs.saveChosen(kept)
            lastError = null
            return PhoneContactPlanner.plan(contacts, kept, links, prefs.listId())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            lastError = uiErrorOf(e)
            return null
        }
    }

    /** Plans without suspending: [onDone] gets the plan on the main thread. For Swift, which cannot call [plan]. */
    fun run(onDone: (PhoneContactPlan?) -> Unit) {
        scope.launch { onDone(plan()) }
    }

    /**
     * The phone wrote [plan]. [written] maps every contact of the plan that is in the address book now
     * to the phone's id of its entry; [listId] is the phone's id of the list, null when it has none.
     */
    fun applied(
        plan: PhoneContactPlan,
        written: Map<String, String>,
        listId: String?,
    ) {
        prefs.saveLinks(
            plan.contacts.mapNotNull { contact ->
                written[contact.contactId]?.let { PhoneContactLink(contact.contactId, it, contact.fingerprint) }
            },
        )
        prefs.saveListId(listId)
        prefs.saveWriteFailed(false)
        app.changed(TOPIC_CONTACT_SYNC_DONE)
    }

    /** The phone could not write the plan; what is stored stays, the next sync tries again. */
    fun failed() {
        prefs.saveWriteFailed(true)
        app.changed(TOPIC_CONTACT_SYNC_DONE)
    }

    /**
     * Plans again, a moment after contacts or the choice changed, and hands each plan to [onPlan]
     * until the subscription is cancelled.
     */
    fun watch(onPlan: (PhoneContactPlan) -> Unit): StoreSubscription {
        val job =
            scope.launch {
                var pending: Job? = null
                app.changes.collect { topic ->
                    if (topic == "contacts" || topic == TOPIC_CONTACT_SYNC) {
                        pending?.cancel()
                        pending =
                            launch {
                                delay(DEBOUNCE_MS)
                                plan()?.let(onPlan)
                            }
                    }
                }
            }
        return StoreSubscription(job)
    }

    private companion object {
        const val DEBOUNCE_MS = 1_000L
    }
}
