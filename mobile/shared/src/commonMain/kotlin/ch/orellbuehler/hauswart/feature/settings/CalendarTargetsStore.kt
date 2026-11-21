package ch.orellbuehler.hauswart.feature.settings

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.CalendarSyncCounts
import ch.orellbuehler.hauswart.api.generated.CalendarTarget
import ch.orellbuehler.hauswart.api.generated.CalendarTargetsUpdateRequest
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.feature.dashboard.TONE_DUE
import ch.orellbuehler.hauswart.feature.dashboard.TONE_MUTED
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OK
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OVERDUE
import ch.orellbuehler.hauswart.feature.files.relativeInstant
import ch.orellbuehler.hauswart.i18n.tr

/** How a target is doing: `paused`, `offline`, `error`, `waiting` or `ok`. */
internal fun targetState(
    target: CalendarTarget,
    connectionUsable: Boolean,
): String =
    when {
        !target.enabled -> "paused"
        !connectionUsable -> "offline"
        target.status == "error" -> "error"
        target.status == "unknown" || target.lastCheckedAt == null -> "waiting"
        else -> "ok"
    }

/** What a run did, one phrase per count that is not zero; a sentence saying so when nothing had to be done. */
internal fun statsSummary(counts: CalendarSyncCounts): String {
    val lines =
        listOf(
            "created" to counts.created,
            "updated" to counts.updated,
            "replaced" to counts.replaced,
            "deleted" to counts.deleted,
            "adopted" to counts.adopted,
            "forgotten" to counts.forgotten,
            "skipped" to counts.skipped,
            "unconfirmed" to counts.unconfirmed,
            "failed" to counts.failed,
            "remaining" to counts.remaining,
        ).filter { it.second > 0 }.map { tr("caltargets_stats_${it.first}", "count" to it.second) }
    return if (lines.isEmpty()) tr("caltargets_stats_nothing") else lines.joinToString(", ")
}

data class CalendarTargetRow(
    val id: String,
    val name: String,
    /** Home Assistant, the calendar in it and its id. */
    val place: String,
    val level: String,
    val stateText: String,
    val stateTone: String,
    val kinds: List<String>,
    val details: List<IntegrationDetailRow>,
    /** Why the last run failed. */
    val errorText: String?,
    val lastRun: String?,
    val enabled: Boolean,
    /** The person may switch the target and sync it; household targets need an administrator. */
    val canManage: Boolean,
    val busy: Boolean,
)

data class CalendarTargetsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val rows: List<CalendarTargetRow> = emptyList(),
    /** Calendars can only be added, changed or removed in the web app. */
    val readOnlyNote: String = tr("caltargets_readonly_note"),
    val actionError: String? = null,
    /** What a "sync now" answered, to show once. */
    val notice: String? = null,
    val browserUrl: String = "",
)

/** The calendars hauswart writes appointments, due dates and deadlines into, and their health. */
class CalendarTargetsStore(
    private val app: HauswartApp,
) : Store<CalendarTargetsState>(CalendarTargetsState(browserUrl = browserUrl(app.session.serverUrl ?: "", "settings/calendar"))) {
    private var targets: List<CalendarTarget> = emptyList()
    private var usable: Map<String, Boolean> = emptyMap()
    private var busy: Set<String> = emptySet()

    init {
        load()
    }

    fun refresh() {
        load()
    }

    fun dismissMessages() {
        update { it.copy(actionError = null, notice = null) }
    }

    fun setEnabled(
        id: String,
        enabled: Boolean,
    ) {
        if (id in busy) return
        busy = busy + id
        render()
        launch({ e -> finish(id, e.message) }) {
            val saved = app.api.calendar.calendarTargetsUpdate(id, CalendarTargetsUpdateRequest(enabled = enabled))
            replace(saved)
            finish(id, null)
        }
    }

    fun syncNow(id: String) {
        if (id in busy) return
        busy = busy + id
        update { it.copy(actionError = null, notice = null) }
        render()
        launch({ e -> finish(id, e.message) }) {
            val result = app.api.calendar.calendarTargetsSync(id)
            replace(result.target)
            val notice =
                if (result.ok) {
                    tr("caltargets_sync_ok") + ": " + statsSummary(result.counts)
                } else {
                    tr("caltargets_sync_failed") + ": " + integrationErrorText(result.error?.code, HOME_ASSISTANT)
                }
            finish(id, null)
            update { it.copy(notice = notice) }
        }
    }

    private fun replace(saved: CalendarTarget) {
        targets = targets.map { if (it.id == saved.id) saved else it }
    }

    private fun finish(
        id: String,
        message: String?,
    ) {
        busy = busy - id
        render()
        if (message != null) update { it.copy(actionError = message) }
    }

    private fun load() {
        update { it.copy(loading = targets.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            targets =
                app.api.calendar
                    .calendarTargetsList()
                    .items
            usable =
                app.api.integrations
                    .integrationsList()
                    .items
                    .associate { it.kind to (it.available && it.configured && it.enabled) }
            update { it.copy(loading = false) }
            render()
        }
    }

    private fun render() {
        val zone = app.household.timezone
        val rows =
            targets.map { t ->
                val state = targetState(t, usable[t.provider] == true)
                val (stateText, tone) =
                    when (state) {
                        "paused" -> tr("caltargets_status_paused") to TONE_MUTED
                        "offline" -> tr("caltargets_status_offline") to TONE_DUE
                        "error" -> tr("caltargets_status_error") to TONE_OVERDUE
                        "waiting" -> tr("caltargets_status_waiting") to TONE_DUE
                        else -> tr("caltargets_status_ok") to TONE_OK
                    }
                val details = mutableListOf<IntegrationDetailRow>()
                details +=
                    IntegrationDetailRow(tr("caltargets_last_ok"), t.lastOkAt?.let { relativeInstant(it, zone) } ?: tr("caltargets_never"))
                details +=
                    IntegrationDetailRow(
                        tr("caltargets_last_checked"),
                        t.lastCheckedAt?.let { relativeInstant(it, zone) } ?: tr("caltargets_never"),
                    )
                details += IntegrationDetailRow(tr("caltargets_event_count"), tr("caltargets_event_count_value", "count" to t.eventCount))
                CalendarTargetRow(
                    id = t.id,
                    name = t.name,
                    place = listOfNotNull(tr("integration_ha_name"), t.remoteName, t.remoteCalendarId).joinToString(" · "),
                    level = if (t.level == "household") tr("caltargets_level_household") else tr("caltargets_level_user"),
                    stateText = stateText,
                    stateTone = tone,
                    kinds = t.config.kinds.map { tr("caltargets_kind_$it") },
                    details = details,
                    errorText = if (state == "error") integrationErrorText(t.lastError, HOME_ASSISTANT) else null,
                    lastRun = t.lastStats?.let { statsSummary(it) },
                    enabled = t.enabled,
                    canManage = t.canManage,
                    busy = t.id in busy,
                )
            }
        update { it.copy(rows = rows) }
    }
}
