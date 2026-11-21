package ch.orellbuehler.hauswart.feature.reminders

import ch.orellbuehler.hauswart.feature.applink.AppLink
import ch.orellbuehler.hauswart.platform.KeyValueStore
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

@Serializable
private data class StoredReminder(
    val id: String,
    val fireAt: Long,
    val title: String,
    val body: String,
    val kind: String,
    val linkId: String? = null,
)

/** The device's reminder settings, the plan last made and the server notifications already shown, in plain storage. */
class ReminderPrefs(
    private val store: KeyValueStore,
) {
    private val json = Json { ignoreUnknownKeys = true }

    fun settings(): ReminderSettings {
        val time = store.load(TIME)?.takeIf { zonedMillis("2026-01-01", it, "UTC") != null } ?: DEFAULT_REMINDER_TIME
        val lead = store.load(LEAD)?.toIntOrNull()?.takeIf { it > 0 } ?: DEFAULT_APPOINTMENT_LEAD_MINUTES
        return ReminderSettings(
            enabled = store.load(ENABLED) == "1",
            timeOfDay = time,
            dueSoon = store.load(DUE_SOON) == "1",
            appointmentLeadMinutes = lead,
        )
    }

    fun save(settings: ReminderSettings) {
        store.save(ENABLED, if (settings.enabled) "1" else "0")
        store.save(TIME, settings.timeOfDay)
        store.save(DUE_SOON, if (settings.dueSoon) "1" else "0")
        store.save(LEAD, settings.appointmentLeadMinutes.toString())
    }

    fun savePlan(plan: List<PlannedReminder>) {
        val items = plan.map { StoredReminder(it.id, it.fireAt, it.title, it.body, it.link.kind, it.link.id) }
        store.save(PLAN, json.encodeToString(ListSerializer(StoredReminder.serializer()), items))
    }

    /** The plan last saved; empty when there is none or it cannot be read. */
    fun plan(): List<PlannedReminder> {
        val text = store.load(PLAN) ?: return emptyList()
        val items =
            runCatching { json.decodeFromString(ListSerializer(StoredReminder.serializer()), text) }.getOrNull() ?: return emptyList()
        return items.map { PlannedReminder(it.id, it.fireAt, it.title, it.body, AppLink(it.kind, it.linkId)) }
    }

    /** Ids of server notifications that were looked at already; null before the first sync. */
    fun seen(): Set<String>? {
        val text = store.load(SEEN) ?: return null
        return runCatching { json.decodeFromString(ListSerializer(String.serializer()), text) }.getOrNull()?.toSet()
    }

    fun saveSeen(ids: List<String>) {
        store.save(SEEN, json.encodeToString(ListSerializer(String.serializer()), ids))
    }

    /** Forgets the plan and what was shown (on sign-out); the settings stay. */
    fun forget() {
        store.delete(PLAN)
        store.delete(SEEN)
    }

    private companion object {
        const val ENABLED = "reminders_enabled"
        const val TIME = "reminders_time"
        const val DUE_SOON = "reminders_due_soon"
        const val LEAD = "reminders_lead"
        const val PLAN = "reminders_plan"
        const val SEEN = "reminders_seen"
    }
}
