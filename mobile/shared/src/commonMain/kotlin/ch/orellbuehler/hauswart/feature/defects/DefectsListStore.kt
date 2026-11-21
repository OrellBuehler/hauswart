package ch.orellbuehler.hauswart.feature.defects

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.Defect
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.feature.files.FilePayload
import ch.orellbuehler.hauswart.i18n.tr

/** The PDF of the defect list on its way to the system viewer. A new object for every export. */
class DefectExport(
    val file: FilePayload,
)

data class DefectsListState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val query: String = "",
    /** The statuses shown; by default those that still need attention. */
    val statuses: List<String> = ACTIVE_DEFECT_STATUSES,
    val severity: String = "",
    val roomId: String = "",
    val assetId: String = "",
    val sort: String = DEFECT_SORT_DEADLINE,
    val rows: List<DefectRow> = emptyList(),
    /** How many defects exist at all. */
    val total: Int = 0,
    /** Rooms and devices that have a defect, for the filter; the first choice is "all". */
    val roomChoices: List<DefectChoice> = emptyList(),
    val assetChoices: List<DefectChoice> = emptyList(),
    val exporting: Boolean = false,
    val exported: DefectExport? = null,
    val actionError: UiError? = null,
) {
    val shown: Int get() = rows.size

    private val defaultStatuses: Boolean
        get() = statuses.size == ACTIVE_DEFECT_STATUSES.size && statuses.all { it in ACTIVE_DEFECT_STATUSES }

    /** Filters that differ from the defaults (the search text is counted apart). */
    val filterCount: Int
        get() =
            listOf(!defaultStatuses, severity.isNotEmpty(), roomId.isNotEmpty(), assetId.isNotEmpty(), sort != DEFECT_SORT_DEADLINE)
                .count { it }

    val isDefault: Boolean get() = filterCount == 0 && query.isBlank()

    /** Why the list is empty: `empty` (nothing recorded), `none_active` (all closed), `filtered`; empty text when it is not. */
    val emptyReason: String
        get() =
            when {
                rows.isNotEmpty() -> ""
                total == 0 -> "empty"
                query.isBlank() && severity.isEmpty() && roomId.isEmpty() && assetId.isEmpty() && defaultStatuses -> "none_active"
                else -> "filtered"
            }

    val countText: String get() = tr("defects_count", "count" to shown)

    /** What the PDF will contain: one status when exactly one is selected, else every status, in the selected room. */
    val pdfScope: String
        get() =
            listOfNotNull(
                if (statuses.size == 1) defectStatusLabel(statuses[0]) else tr("defects_pdf_all_statuses"),
                roomChoices.firstOrNull { it.value == roomId && roomId.isNotEmpty() }?.label,
            ).joinToString(", ")
}

class DefectsListStore(
    private val app: HauswartApp,
) : Store<DefectsListState>(DefectsListState()) {
    private var all: List<Defect> = emptyList()
    private var today = ""

    init {
        onChange(app, "defects") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun search(query: String) {
        update { it.copy(query = query) }
        show()
    }

    fun toggleStatus(status: String) {
        val now = current.statuses
        val next = if (status in now) now.filter { it != status } else now + status
        update { it.copy(statuses = if (next.isEmpty()) DEFECT_STATUSES else DEFECT_STATUSES.filter { s -> s in next }) }
        show()
    }

    fun showAllStatuses() {
        update { it.copy(statuses = DEFECT_STATUSES) }
        show()
    }

    fun setSeverity(severity: String) {
        update { it.copy(severity = severity) }
        show()
    }

    fun setRoom(roomId: String) {
        update { it.copy(roomId = roomId) }
        show()
    }

    fun setAsset(assetId: String) {
        update { it.copy(assetId = assetId) }
        show()
    }

    fun setSort(sort: String) {
        update { it.copy(sort = sort) }
        show()
    }

    fun reset() {
        update {
            it.copy(
                query = "",
                statuses = ACTIVE_DEFECT_STATUSES,
                severity = "",
                roomId = "",
                assetId = "",
                sort = DEFECT_SORT_DEADLINE,
            )
        }
        show()
    }

    fun exportPdf() {
        if (current.exporting) return
        val state = current
        update { it.copy(exporting = true, actionError = null) }
        launch({ e -> update { it.copy(exporting = false, actionError = e) } }) {
            val body =
                app.api.defects.defectsExport(
                    status = state.statuses.singleOrNull(),
                    roomId = state.roomId.ifEmpty { null },
                )
            val file = FilePayload("defects.pdf", body.contentType?.substringBefore(';')?.ifEmpty { null } ?: "application/pdf", body.bytes)
            update { it.copy(exporting = false, exported = DefectExport(file)) }
        }
    }

    fun consumeExport() {
        update { it.copy(exported = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun load() {
        update { it.copy(loading = all.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            app.household.get()
            today = app.household.today()
            all =
                fetchAll { cursor ->
                    val page = app.api.defects.defectsList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            update { it.copy(loading = false) }
            show()
        }
    }

    private fun show() {
        val state = current
        val needle = state.query.trim().lowercase()
        val matching =
            all.filter { d ->
                d.status in state.statuses &&
                    (state.severity.isEmpty() || d.severity == state.severity) &&
                    (state.roomId.isEmpty() || d.roomId == state.roomId) &&
                    (state.assetId.isEmpty() || d.assetId == state.assetId) &&
                    (
                        needle.isEmpty() ||
                            listOf(d.title, d.descriptionMd, d.locationDetail.orEmpty()).any { it.lowercase().contains(needle) }
                    )
            }
        val ordered = if (state.sort == DEFECT_SORT_NUMBER) matching.sortedByDescending { it.number } else matching
        val rooms = all.mapNotNull { d -> d.roomId?.let { id -> DefectChoice(id, d.roomName.orEmpty()) } }.distinctBy { it.value }
        val assets = all.mapNotNull { d -> d.assetId?.let { id -> DefectChoice(id, d.assetName.orEmpty()) } }.distinctBy { it.value }
        val allChoice = DefectChoice("", tr("defects_filter_all"))
        update {
            it.copy(
                rows = ordered.map { d -> defectRow(d, today) },
                total = all.size,
                roomChoices = listOf(allChoice) + rooms.sortedBy { c -> c.label.lowercase() },
                assetChoices = listOf(allChoice) + assets.sortedBy { c -> c.label.lowercase() },
            )
        }
    }
}
