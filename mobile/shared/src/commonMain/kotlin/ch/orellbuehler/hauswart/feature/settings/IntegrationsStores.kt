package ch.orellbuehler.hauswart.feature.settings

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.Integration
import ch.orellbuehler.hauswart.api.generated.IntegrationTest
import ch.orellbuehler.hauswart.api.generated.IntegrationsSaveRequest
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.uiErrorOf
import ch.orellbuehler.hauswart.feature.dashboard.TONE_DUE
import ch.orellbuehler.hauswart.feature.dashboard.TONE_MUTED
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OK
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OVERDUE
import ch.orellbuehler.hauswart.feature.files.relativeInstant
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** The words and the tone of a connection's status badge. */
internal fun integrationStatus(i: Integration): Pair<String, String> =
    when {
        !i.available -> tr("integration_status_soon") to TONE_MUTED
        !i.configured -> tr("integration_status_not_connected") to TONE_MUTED
        !i.enabled -> tr("integration_status_paused") to TONE_MUTED
        i.status == "ok" -> tr("integration_status_ok") to TONE_OK
        i.status == "error" -> tr("integration_status_error") to TONE_OVERDUE
        else -> tr("integration_status_unknown") to TONE_DUE
    }

private fun nameOf(kind: String) = if (isKnownKind(kind)) tr("integration_${kindKey(kind)}_name") else kind

/** One connection in the list. */
data class IntegrationRow(
    val kind: String,
    val name: String,
    val description: String,
    val statusText: String,
    val statusTone: String,
    /** The error of a failing connection, else when it was last reachable. */
    val detail: String?,
    /** A personal connection (documents, finance) can be set up here; the household's needs an administrator. */
    val editable: Boolean,
)

data class IntegrationsListState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val rows: List<IntegrationRow> = emptyList(),
    val description: String = tr("integrations_description_readonly"),
    val browserUrl: String = "",
)

class IntegrationsListStore(
    private val app: HauswartApp,
) : Store<IntegrationsListState>(IntegrationsListState(browserUrl = browserUrl(app.session.serverUrl ?: "", "settings/integrations"))) {
    init {
        onChange(app, "integrations") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    private fun load() {
        update { it.copy(loading = it.rows.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val items =
                app.api.integrations
                    .integrationsList()
                    .items
            update { it.copy(loading = false, rows = items.filter { i -> isKnownKind(i.kind) }.map(::rowOf)) }
        }
    }

    private fun rowOf(i: Integration): IntegrationRow {
        val (text, tone) = integrationStatus(i)
        val zone = app.household.timezone
        val detail =
            when {
                i.configured && i.enabled && i.status == "error" -> integrationErrorText(i.lastError, i.kind)
                i.configured && i.lastOkAt != null -> tr("integration_last_ok") + ": " + relativeInstant(i.lastOkAt, zone)
                else -> null
            }
        return IntegrationRow(
            kind = i.kind,
            name = nameOf(i.kind),
            description = tr("integration_${kindKey(i.kind)}_description"),
            statusText = text,
            statusTone = tone,
            detail = detail,
            editable = i.level == "user" && i.available,
        )
    }
}

data class IntegrationForm(
    val baseUrl: String = "",
    /** Only typed to set or replace the stored token; it is never sent back by the server. */
    val token: String = "",
    val allowInsecureTls: Boolean = false,
    val enabled: Boolean = true,
)

/** The outcome of a test or a sync: a [title] and optional detail [lines]. */
data class IntegrationOutcome(
    val ok: Boolean,
    val title: String,
    val lines: List<String> = emptyList(),
)

data class IntegrationDetailRow(
    val label: String,
    val value: String,
)

data class IntegrationState(
    val kind: String,
    val loading: Boolean = true,
    val error: UiError? = null,
    val name: String = "",
    val description: String = "",
    val statusText: String = "",
    val statusTone: String = TONE_MUTED,
    val configured: Boolean = false,
    val enabled: Boolean = false,
    /** The person may set up, test and remove this connection. */
    val canEdit: Boolean = false,
    /** Said instead of the form when [canEdit] is false. */
    val readOnlyNote: String? = null,
    val details: List<IntegrationDetailRow> = emptyList(),
    /** The reason of a failing connection. */
    val errorText: String? = null,
    /** The values the form starts with; the screen reloads its copy when [formVersion] changes. */
    val initial: IntegrationForm = IntegrationForm(),
    val formVersion: Int = 0,
    val urlHint: String = "",
    val tokenLabel: String = "",
    val tokenHint: String = "",
    val insecureHint: String = "",
    val enabledHint: String = "",
    val saving: Boolean = false,
    val testing: Boolean = false,
    val syncing: Boolean = false,
    val disconnecting: Boolean = false,
    val fieldErrors: Map<String, String> = emptyMap(),
    /** A failed save, test, sync or disconnect. */
    val actionError: String? = null,
    val test: IntegrationOutcome? = null,
    val sync: IntegrationOutcome? = null,
    /** The finance connection can be synced right now. */
    val canSync: Boolean = false,
    val disconnectTitle: String = "",
    val disconnectText: String = "",
    /** A confirmation to show once ("Connection saved."). */
    val notice: String? = null,
    val browserUrl: String = "",
)

/** One connection (Home Assistant, the document system, the finance provider): status, and for a personal one the form, test, sync and disconnect. */
class IntegrationConnectionStore(
    private val app: HauswartApp,
    private val kind: String,
) : Store<IntegrationState>(initialState(app, kind)) {
    private var integration: Integration? = null

    init {
        load()
    }

    fun refresh() {
        load()
    }

    fun consumeNotice() {
        update { it.copy(notice = null) }
    }

    fun save(form: IntegrationForm) {
        val known = integration ?: return
        if (current.saving || current.testing) return
        val baseUrl = form.baseUrl.trim()
        val token = form.token.trim()
        val urlChanged = known.configured && baseUrl != (known.baseUrl ?: "")
        val errors = mutableMapOf<String, String>()
        if (baseUrl.isEmpty()) {
            errors["baseUrl"] = tr("m_field_required")
        } else if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(baseUrl)) {
            errors["baseUrl"] = tr("integration_ha_url_invalid")
        }
        if ((!known.configured || urlChanged) && token.isEmpty()) {
            errors["token"] = if (urlChanged) tr("integration_ha_token_required_url") else tr("m_field_required")
        }
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, actionError = null) }
            return
        }
        update { it.copy(saving = true, fieldErrors = emptyMap(), actionError = null, notice = null) }
        launch({ e -> failSave(e, baseUrl) }) {
            val saved =
                app.api.integrations.integrationsSave(
                    kind,
                    IntegrationsSaveRequest(
                        baseUrl = baseUrl,
                        token = token.ifEmpty { null },
                        allowInsecureTls = form.allowInsecureTls,
                        enabled = form.enabled,
                    ),
                )
            integration = saved
            show(saved, resetForm = true)
            update { it.copy(saving = false, notice = tr("integration_saved"), test = null) }
            announce()
            if (saved.enabled) runTest()
        }
    }

    fun test() {
        if (current.testing || current.saving) return
        update { it.copy(testing = true, actionError = null, test = null) }
        launch({ e -> update { it.copy(testing = false, actionError = e.message) } }) { runTest() }
    }

    fun disconnect() {
        if (current.disconnecting) return
        update { it.copy(disconnecting = true, actionError = null) }
        launch({ e -> update { it.copy(disconnecting = false, actionError = e.message) } }) {
            app.api.integrations.integrationsDelete(kind)
            val fresh =
                app.api.integrations
                    .integrationsList()
                    .items
                    .firstOrNull { it.kind == kind }
            integration = fresh
            if (fresh != null) show(fresh, resetForm = true)
            update { it.copy(disconnecting = false, test = null, sync = null, notice = disconnectDone()) }
            announce()
        }
    }

    /** Syncs the finance connection now. */
    fun syncNow() {
        if (current.syncing || !current.canSync) return
        update { it.copy(syncing = true, actionError = null, sync = null) }
        launch({ e -> update { it.copy(syncing = false, actionError = e.message) } }) {
            val result = app.api.finance.financeSync()
            val outcome =
                if (result.ok) {
                    val lines = syncLines(result.stats)
                    IntegrationOutcome(
                        true,
                        tr("integration_kept_sync_done"),
                        lines.ifEmpty { listOf(tr("integration_kept_sync_nothing")) },
                    )
                } else {
                    IntegrationOutcome(false, tr("integration_kept_sync_failed"), listOf(integrationErrorText(result.error?.code, KEPT)))
                }
            update { it.copy(syncing = false, sync = outcome) }
            app.changed("costs")
            reloadQuietly()
        }
    }

    private fun disconnectDone(): String =
        when (kind) {
            PAPERLESS -> tr("integration_paperless_disconnected")
            KEPT -> tr("integration_kept_disconnected")
            else -> tr("integration_disconnected")
        }

    private suspend fun runTest() {
        update { it.copy(testing = true, test = null) }
        try {
            val result = app.api.integrations.integrationsTest(kind)
            integration = result.integration
            show(result.integration, resetForm = false)
            update { it.copy(testing = false, test = outcomeOf(result)) }
            announce()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            update { it.copy(testing = false, actionError = uiErrorOf(e).message) }
        }
    }

    private suspend fun reloadQuietly() {
        val fresh =
            app.api.integrations
                .integrationsList()
                .items
                .firstOrNull { it.kind == kind } ?: return
        integration = fresh
        show(fresh, resetForm = false)
    }

    private fun outcomeOf(result: IntegrationTest): IntegrationOutcome {
        if (!result.ok) {
            return IntegrationOutcome(false, tr("integration_test_failed"), listOf(integrationErrorText(result.error?.code, kind)))
        }
        val info = result.info.orEmpty()

        fun text(key: String) = (info[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
        val lines =
            listOfNotNull(
                text("version")?.let { "${nameOf(kind)} $it" },
                text("user")?.let { tr("integration_paperless_signed_in_as", "user" to it) },
                text("defaultCurrency")?.let { tr("integration_kept_test_currency", "currency" to it) },
            )
        return IntegrationOutcome(true, tr("integration_test_ok"), lines)
    }

    private fun failSave(
        e: UiError,
        baseUrl: String,
    ) {
        val host = hostOf(baseUrl)
        val fields = mutableMapOf<String, String>()
        var message: String? = null
        when {
            e.code == "forbidden" -> fields["baseUrl"] = tr("integration_host_forbidden", "host" to host)
            e.code == "invalid_request" && "baseUrl" in e.fields -> fields["baseUrl"] = tr("integration_url_rejected")
            e.code == "invalid_request" && "token" in e.fields -> fields["token"] = tr("integration_token_rejected")
            else -> message = e.message
        }
        update { it.copy(saving = false, fieldErrors = fields, actionError = message) }
    }

    private fun announce() {
        app.changed("integrations")
        if (kind == PAPERLESS) app.changed("documents")
        if (kind == KEPT) app.changed("costs")
    }

    private fun load() {
        update { it.copy(loading = integration == null, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val found =
                app.api.integrations
                    .integrationsList()
                    .items
                    .firstOrNull { it.kind == kind }
            if (found == null) {
                update { it.copy(loading = false, error = UiError(tr("m_error_not_found"), "not_found")) }
                return@launch
            }
            integration = found
            show(found, resetForm = current.formVersion == 0)
            update { it.copy(loading = false) }
        }
    }

    private fun show(
        i: Integration,
        resetForm: Boolean,
    ) {
        val (statusText, tone) = integrationStatus(i)
        val zone = app.household.timezone
        val editable = i.level == "user" && i.available
        val details = mutableListOf<IntegrationDetailRow>()
        if (i.configured) {
            i.baseUrl?.let { details += IntegrationDetailRow(tr("integration_ha_url"), it) }
            details +=
                IntegrationDetailRow(tr("integration_last_ok"), i.lastOkAt?.let { relativeInstant(it, zone) } ?: tr("integration_never"))
            details +=
                IntegrationDetailRow(
                    tr("integration_last_checked"),
                    i.lastCheckedAt?.let { relativeInstant(it, zone) } ?: tr("integration_never"),
                )
            if (i.consecutiveFailures > 0) {
                details += IntegrationDetailRow(tr("integration_failures_label"), i.consecutiveFailures.toString())
            }
        }
        update {
            it.copy(
                statusText = statusText,
                statusTone = tone,
                configured = i.configured,
                enabled = i.enabled,
                canEdit = editable,
                readOnlyNote =
                    if (editable) {
                        null
                    } else if (i.configured) {
                        tr("integration_admin_only")
                    } else {
                        tr("integration_ha_not_connected_member")
                    },
                details = details,
                errorText = if (i.configured && i.enabled && i.status == "error") integrationErrorText(i.lastError, kind) else null,
                initial =
                    if (resetForm) {
                        IntegrationForm(i.baseUrl ?: "", "", i.allowInsecureTls, if (i.configured) i.enabled else true)
                    } else {
                        it.initial
                    },
                formVersion = if (resetForm) it.formVersion + 1 else it.formVersion,
                canSync = kind == KEPT && i.configured && i.enabled,
            )
        }
    }

    private fun hostOf(address: String): String =
        address
            .trim()
            .substringAfter("://")
            .substringBefore('/')
            .substringAfterLast('@')

    private companion object {
        fun initialState(
            app: HauswartApp,
            kind: String,
        ): IntegrationState {
            val k = kindKey(kind)
            val known = isKnownKind(kind)
            return IntegrationState(
                kind = kind,
                name = nameOf(kind),
                description = if (known) tr("integration_${k}_description") else "",
                urlHint = if (known) tr("integration_${k}_url_hint") else "",
                tokenLabel = if (known) tr(if (kind == HOME_ASSISTANT) "integration_ha_token" else "integration_${k}_token") else "",
                tokenHint = if (known) tr("integration_${k}_token_hint") else "",
                insecureHint =
                    if (known) {
                        tr(
                            if (kind ==
                                HOME_ASSISTANT
                            ) {
                                "integration_ha_insecure_hint"
                            } else {
                                "integration_${k}_insecure_hint"
                            },
                        )
                    } else {
                        ""
                    },
                enabledHint =
                    if (known) {
                        tr(
                            if (kind ==
                                HOME_ASSISTANT
                            ) {
                                "integration_ha_enabled_hint"
                            } else {
                                "integration_${k}_enabled_hint"
                            },
                        )
                    } else {
                        ""
                    },
                disconnectTitle =
                    when (kind) {
                        PAPERLESS -> tr("integration_paperless_disconnect_title")
                        KEPT -> tr("integration_kept_disconnect_title")
                        else -> tr("integration_disconnect_title")
                    },
                disconnectText =
                    when (kind) {
                        PAPERLESS -> tr("integration_paperless_disconnect_description")
                        KEPT -> tr("integration_kept_disconnect_description")
                        else -> tr("integration_disconnect_description")
                    },
                browserUrl = browserUrl(app.session.serverUrl ?: "", "settings/integrations"),
            )
        }

        val statKeys =
            listOf(
                "suggestions" to "integration_kept_stat_suggestions",
                "linkSuggestions" to "integration_kept_stat_link_suggestions",
                "autoAccepted" to "integration_kept_stat_auto_accepted",
                "assetSuggestions" to "integration_kept_stat_asset_suggestions",
                "tasksCreated" to "integration_kept_stat_tasks_created",
                "tasksUpdated" to "integration_kept_stat_tasks_updated",
                "tasksCompleted" to "integration_kept_stat_tasks_completed",
                "tasksReopened" to "integration_kept_stat_tasks_reopened",
                "tasksArchived" to "integration_kept_stat_tasks_archived",
                "skipped" to "integration_kept_stat_skipped",
                "linksWritten" to "integration_kept_stat_links_written",
                "linksRemoved" to "integration_kept_stat_links_removed",
                "linksFailed" to "integration_kept_stat_links_failed",
            )

        fun syncLines(stats: Map<String, Long>): List<String> =
            statKeys.mapNotNull { (field, key) -> stats[field]?.takeIf { it > 0 }?.let { tr(key, "count" to it) } }
    }
}
