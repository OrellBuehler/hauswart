package ch.orellbuehler.hauswart.feature.defects

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.DefectsAddEventRequest
import ch.orellbuehler.hauswart.api.generated.DefectsStatusRequest
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** What the status sheet holds: a date (reported on / fixed on) and the note, or for "fixed" the resolution. */
data class DefectStatusForm(
    val date: String = "",
    val text: String = "",
)

data class DefectStatusState(
    val loading: Boolean = true,
    val loadError: UiError? = null,
    val target: String,
    val title: String = "",
    val intro: String = "",
    val submitLabel: String = "",
    val destructive: Boolean = false,
    /** Reported and fixed ask for the date. */
    val needsDate: Boolean = false,
    val dateLabel: String = "",
    /** For "fixed" the text is the resolution, else a note. */
    val textLabel: String = "",
    val minDate: String = "",
    val maxDate: String = "",
    val initial: DefectStatusForm? = null,
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    /** True once the status changed; the sheet closes. */
    val done: Boolean = false,
    val doneMessage: String = "",
)

/** Moves a defect to [target]; the sheet reads the defect first to start with its dates and resolution. */
class DefectStatusStore(
    private val app: HauswartApp,
    private val id: String,
    target: String,
) : Store<DefectStatusState>(DefectStatusState(target = target)) {
    private val target: String = target
    private var resolution = ""

    init {
        load()
    }

    fun retry() {
        load()
    }

    fun save(form: DefectStatusForm) {
        if (current.saving) return
        val state = current
        val errors = mutableMapOf<String, String>()
        if (state.needsDate) {
            when {
                !Dates.isValid(form.date) -> errors["date"] = tr("m_field_required")
                form.date > state.maxDate -> errors["date"] = tr("defect_dialog_future")
            }
        }
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        val text = form.text.trim()
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, error = if (e.fields.isEmpty()) e else null, fieldErrors = e.fields) } }) {
            // The resolution goes first: when it fails nothing has changed yet, so trying again is safe.
            if (target == "fixed" && text != resolution.trim()) {
                patchDefectRaw(app, id, JsonObject(mapOf("resolutionMd" to JsonPrimitive(text))))
            }
            app.api.defects.defectsStatus(
                id,
                DefectsStatusRequest(
                    status = target,
                    note = text.ifEmpty { null },
                    reportedOn = if (target == "reported") form.date else null,
                    fixedOn = if (target == "fixed") form.date else null,
                ),
            )
            app.changed("defects", "tasks")
            update { it.copy(saving = false, done = true, doneMessage = defectStatusToast(target)) }
        }
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            app.household.get()
            val today = app.household.today()
            val defect = app.api.defects.defectsGet(id)
            resolution = defect.resolutionMd
            val reopening = target == "open" && (defect.status == "fixed" || defect.status == "rejected")
            val key = if (reopening) "reopen" else target
            val dialog = if (target == "open" && !reopening) "back" else key
            val needsDate = target == "reported" || target == "fixed"
            update {
                it.copy(
                    loading = false,
                    title = tr("defect_dialog_${dialog}_title"),
                    intro = tr("defect_dialog_${dialog}_description"),
                    submitLabel = defectActionLabel(target, defect.status),
                    destructive = target == "rejected",
                    needsDate = needsDate,
                    dateLabel = tr(if (target == "reported") "defect_dialog_reported_on" else "defect_dialog_fixed_on"),
                    textLabel = tr(if (target == "fixed") "defect_resolution" else "defect_dialog_note"),
                    minDate = defect.discoveredOn,
                    maxDate = today,
                    initial =
                        DefectStatusForm(
                            date =
                                if (!needsDate) {
                                    ""
                                } else if (target == "reported") {
                                    defect.reportedOn ?: today
                                } else {
                                    today
                                },
                            text = if (target == "fixed") defect.resolutionMd else "",
                        ),
                )
            }
        }
    }
}

data class DefectCorrespondenceForm(
    val body: String = "",
    val reference: String = "",
)

data class DefectCorrespondenceState(
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val done: Boolean = false,
)

/** Notes a letter sent or received on a defect. */
class DefectCorrespondenceStore(
    private val app: HauswartApp,
    private val id: String,
) : Store<DefectCorrespondenceState>(DefectCorrespondenceState()) {
    fun save(form: DefectCorrespondenceForm) {
        if (current.saving) return
        if (form.body.isBlank()) {
            update { it.copy(fieldErrors = mapOf("bodyMd" to tr("m_field_required")), error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, error = if (e.fields.isEmpty()) e else null, fieldErrors = e.fields) } }) {
            app.api.defects.defectsAddEvent(
                id,
                DefectsAddEventRequest(bodyMd = form.body.trim(), externalRef = form.reference.trim().ifEmpty { null }),
            )
            app.changed("defects")
            update { it.copy(saving = false, done = true) }
        }
    }
}
