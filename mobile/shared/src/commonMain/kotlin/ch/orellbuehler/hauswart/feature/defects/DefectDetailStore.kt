package ch.orellbuehler.hauswart.feature.defects

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.i18n.tr

data class DefectDetailState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val view: DefectView? = null,
    val deleting: Boolean = false,
    /** A failed delete; the defect is still shown. */
    val actionError: UiError? = null,
    /** True once the defect is gone: the screen closes. */
    val deleted: Boolean = false,
)

class DefectDetailStore(
    private val app: HauswartApp,
    private val id: String,
) : Store<DefectDetailState>(DefectDetailState()) {
    init {
        onChange(app, "defects") { if (!current.deleted) load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun delete() {
        if (current.deleting) return
        update { it.copy(deleting = true, actionError = null) }
        launch({ e -> update { it.copy(deleting = false, actionError = e) } }) {
            app.api.defects.defectsDelete(id)
            update { it.copy(deleting = false, deleted = true) }
            app.changed("defects", "tasks")
        }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun load() {
        update { it.copy(loading = it.view == null, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            app.household.get()
            val defect = app.api.defects.defectsGet(id)
            update { it.copy(loading = false, view = defectView(defect, app.household.today(), app.household.timezone)) }
        }
    }
}

/** The text of the toast after a status change. */
fun defectStatusToast(status: String): String = tr("defect_status_toast", "status" to defectStatusLabel(status))
