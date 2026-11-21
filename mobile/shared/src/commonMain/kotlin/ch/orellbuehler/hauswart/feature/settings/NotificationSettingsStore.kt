package ch.orellbuehler.hauswart.feature.settings

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.Integration
import ch.orellbuehler.hauswart.api.generated.NotificationSettings
import ch.orellbuehler.hauswart.api.generated.NotificationSettingsPutRequest
import ch.orellbuehler.hauswart.api.generated.NotificationSettingsPutRequestTargetsItem
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.uiErrorOf
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.CancellationException

/** At most this many notification targets can be saved. */
const val MAX_NOTIFY_TARGETS = 10

private const val DEFAULT_QUIET_START = "22:00"
private const val DEFAULT_QUIET_END = "07:00"
private const val PHONE_PREFIX = "mobile_app_"
private val targetPattern = Regex("^[a-z0-9_]+$")

/** One kind of notification that can reach the phone. */
data class NotifyStageRow(
    val stage: String,
    val title: String,
    val hint: String,
    val enabled: Boolean,
)

/** One notify service of the smart-home system, or one saved target that system no longer lists. */
data class NotifyTargetRow(
    val target: String,
    /** "Example Phone" for `mobile_app_example_phone`. */
    val title: String,
    /** `notify.mobile_app_example_phone`. */
    val service: String,
    val enabled: Boolean,
    /** Saved, but the connected system does not offer it any more. */
    val missing: Boolean,
    /** A companion app of a phone (its name starts with `mobile_app_`). */
    val phone: Boolean,
)

data class NotificationSettingsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val pushEnabled: Boolean = false,
    val quietOn: Boolean = false,
    val quietStart: String = DEFAULT_QUIET_START,
    val quietEnd: String = DEFAULT_QUIET_END,
    val quietHint: String = "",
    val timeOptions: List<SettingsOption> = emptyList(),
    val stages: List<NotifyStageRow> = emptyList(),
    val targets: List<NotifyTargetRow> = emptyList(),
    /** The smart-home system is connected and switched on, so it can offer services. */
    val connected: Boolean = false,
    /** Why the services could not be listed; the person can still add one by hand. */
    val servicesError: String? = null,
    /** Push is on but nothing receives it. */
    val noTarget: Boolean = false,
    /** Message under the field for a service added by hand. */
    val manualError: String? = null,
    val dirty: Boolean = false,
    val saving: Boolean = false,
    /** A failed save; the form keeps what was entered. */
    val saveError: String? = null,
    /** True after a save; the screen shows a notice and calls [NotificationSettingsStore.consumeSaved]. */
    val justSaved: Boolean = false,
)

private data class TargetDraft(
    val target: String,
    val enabled: Boolean,
    val saved: Boolean,
)

private data class Snapshot(
    val pushEnabled: Boolean,
    val quietStart: String?,
    val quietEnd: String?,
    val stages: Set<String>,
    val targets: List<Pair<String, Boolean>>,
)

/**
 * The caller's push preferences: whether notifications are pushed to the phone through the smart-home
 * system, which kinds, the quiet hours and the services that receive them. The edits live in the store
 * until [save] sends them all at once, as the endpoint replaces everything.
 */
class NotificationSettingsStore(
    private val app: HauswartApp,
) : Store<NotificationSettingsState>(NotificationSettingsState()) {
    private var pushEnabled = false
    private var quietOn = false
    private var quietStart = DEFAULT_QUIET_START
    private var quietEnd = DEFAULT_QUIET_END
    private var stages: Set<String> = emptySet()
    private var drafts: List<TargetDraft> = emptyList()
    private var services: List<String> = emptyList()
    private var baseline: Snapshot? = null
    private var timeZone = ""

    init {
        load()
    }

    fun refresh() {
        load()
    }

    fun setPushEnabled(value: Boolean) {
        pushEnabled = value
        render()
    }

    fun setQuietOn(value: Boolean) {
        quietOn = value
        render()
    }

    fun setQuietStart(value: String) {
        quietStart = value
        render()
    }

    fun setQuietEnd(value: String) {
        quietEnd = value
        render()
    }

    fun setStage(
        stage: String,
        enabled: Boolean,
    ) {
        stages = if (enabled) stages + stage else stages - stage
        render()
    }

    fun setTarget(
        target: String,
        enabled: Boolean,
    ) {
        val row = drafts.firstOrNull { it.target == target }
        drafts =
            when {
                row == null -> if (enabled) drafts + TargetDraft(target, enabled = true, saved = false) else drafts
                !enabled && !row.saved -> drafts - row
                else -> drafts.map { if (it.target == target) it.copy(enabled = enabled) else it }
            }
        render()
    }

    /** Adds a service by name (the part after `notify.`), checking it as the server does. */
    fun addManual(name: String) {
        val target = name.trim()
        if (target.isEmpty()) return
        val error =
            when {
                !targetPattern.matches(target) || target.length > 100 -> tr("notify_manual_invalid")
                drafts.any { it.target == target && it.enabled } -> tr("notify_manual_duplicate")
                drafts.size >= MAX_NOTIFY_TARGETS && drafts.none { it.target == target } ->
                    tr(
                        "notify_targets_max",
                        "max" to MAX_NOTIFY_TARGETS,
                    )
                else -> null
            }
        if (error != null) {
            update { it.copy(manualError = error) }
            return
        }
        setTarget(target, true)
    }

    fun consumeSaved() {
        update { it.copy(justSaved = false) }
    }

    fun save() {
        val current = state.value
        if (current.saving || !current.dirty) return
        val problem =
            when {
                drafts.size > MAX_NOTIFY_TARGETS -> tr("notify_targets_max", "max" to MAX_NOTIFY_TARGETS)
                quietOn && (quietStart.isBlank() || quietEnd.isBlank()) -> tr("notify_quiet_incomplete")
                else -> null
            }
        if (problem != null) {
            update { it.copy(saveError = problem) }
            return
        }
        val body =
            NotificationSettingsPutRequest(
                pushEnabled = pushEnabled,
                quietStart = if (quietOn) quietStart else null,
                quietEnd = if (quietOn) quietEnd else null,
                pushStages = NotificationSettings.PUSH_STAGES_VALUES.filter { it in stages },
                targets = drafts.map { NotificationSettingsPutRequestTargetsItem("ha_notify", it.target, it.enabled) },
            )
        update { it.copy(saving = true, saveError = null) }
        launch({ e -> update { it.copy(saving = false, saveError = e.message) } }) {
            val saved = app.api.notifications.notificationSettingsPut(body)
            adopt(saved)
            render()
            update { it.copy(saving = false, justSaved = true) }
        }
    }

    private fun load() {
        update { it.copy(loading = baseline == null, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val saved = app.api.notifications.notificationSettingsGet()
            timeZone = app.household.get().timezone
            val connection =
                app.api.integrations
                    .integrationsList()
                    .items
                    .firstOrNull { it.kind == HOME_ASSISTANT }
            val connected = connection?.usable() == true
            var servicesError: String? = null
            services = emptyList()
            if (connected) {
                try {
                    services =
                        app.api.integrations
                            .integrationsNotifyServices(HOME_ASSISTANT)
                            .items
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    servicesError = uiErrorOf(e).message
                }
            }
            adopt(saved)
            update { it.copy(connected = connected, servicesError = servicesError) }
            render()
            update { it.copy(loading = false) }
        }
    }

    private fun Integration.usable(): Boolean = available && configured && enabled

    private fun adopt(saved: NotificationSettings) {
        pushEnabled = saved.pushEnabled
        quietOn = saved.quietStart != null && saved.quietEnd != null
        quietStart = saved.quietStart ?: DEFAULT_QUIET_START
        quietEnd = saved.quietEnd ?: DEFAULT_QUIET_END
        stages = saved.pushStages.toSet()
        drafts = saved.targets.map { TargetDraft(it.target, it.enabled, saved = true) }
        baseline = snapshot()
    }

    private fun snapshot() =
        Snapshot(
            pushEnabled = pushEnabled,
            quietStart = if (quietOn) quietStart else null,
            quietEnd = if (quietOn) quietEnd else null,
            stages = stages,
            targets = drafts.map { it.target to it.enabled },
        )

    private fun render() {
        val listed = services.toSet()
        val names =
            (services + drafts.map { it.target }).distinct().sortedWith(
                compareBy({ if (it.startsWith(PHONE_PREFIX)) 0 else 1 }, { it }),
            )
        val connected = state.value.connected
        val targets =
            names.map { name ->
                NotifyTargetRow(
                    target = name,
                    title = prettyTargetName(name),
                    service = "notify.$name",
                    enabled = drafts.any { it.target == name && it.enabled },
                    missing = connected && state.value.servicesError == null && name !in listed,
                    phone = name.startsWith(PHONE_PREFIX),
                )
            }
        val stageRows =
            NotificationSettings.PUSH_STAGES_VALUES.map { stage ->
                NotifyStageRow(stage, tr("push_stage_$stage"), tr("push_stage_${stage}_hint"), stage in stages)
            }
        update {
            it.copy(
                pushEnabled = pushEnabled,
                quietOn = quietOn,
                quietStart = quietStart,
                quietEnd = quietEnd,
                quietHint = tr("notify_quiet_hint", "zone" to timeZone),
                timeOptions = timeOptions(quietStart, quietEnd),
                stages = stageRows,
                targets = targets,
                noTarget = pushEnabled && drafts.none { d -> d.enabled },
                manualError = null,
                dirty = snapshot() != baseline,
                saveError = null,
            )
        }
    }
}

/** "Example Phone" for `mobile_app_example_phone`. */
internal fun prettyTargetName(target: String): String =
    target
        .removePrefix(PHONE_PREFIX)
        .split('_')
        .filter { it.isNotEmpty() }
        .joinToString(" ") { word -> word.replaceFirstChar { it.uppercase() } }
