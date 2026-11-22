package ch.orellbuehler.hauswart.feature.emergency

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.feature.docs.docSectionLabel
import ch.orellbuehler.hauswart.feature.files.FilePayload
import ch.orellbuehler.hauswart.feature.files.fileNameFor
import ch.orellbuehler.hauswart.feature.insurance.insuranceTypeLabel
import ch.orellbuehler.hauswart.i18n.tr

data class EmergencyContactRow(
    val id: String,
    val name: String,
    /** The company when it differs from the name. */
    val company: String,
    val notes: String,
    val phone: String,
    val email: String,
)

data class EmergencyInsuranceRow(
    val id: String,
    val title: String,
    /** Type, insurer and policy number. */
    val subtitle: String,
    val assistancePhone: String,
    val insurerPhone: String,
    val insurerName: String,
)

data class EmergencyHintRow(
    val id: String,
    val title: String,
    val body: String,
    /** `tip`, `rule` or `warning`. */
    val kind: String,
    val kindLabel: String,
)

data class EmergencyAssetRow(
    val id: String,
    val name: String,
    /** "Room: Cellar"; empty for none. */
    val room: String,
    val hints: List<EmergencyHintRow>,
)

data class EmergencyPageRow(
    val slug: String,
    val title: String,
    val sectionLabel: String,
)

/** The sheet as a PDF, ready for the system viewer. */
class EmergencySheet(
    val file: FilePayload,
)

data class EmergencyState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val description: String = "",
    val contacts: List<EmergencyContactRow> = emptyList(),
    val insurance: List<EmergencyInsuranceRow> = emptyList(),
    val assets: List<EmergencyAssetRow> = emptyList(),
    val pages: List<EmergencyPageRow> = emptyList(),
    /** Nothing is on the emergency page yet. */
    val empty: Boolean = false,
    val includeSecrets: Boolean = false,
    val exporting: Boolean = false,
    val exportError: UiError? = null,
    val sheet: EmergencySheet? = null,
)

/** The emergency page: emergency contacts and insurances, important devices with their pinned hints, and the emergency and rules pages. */
class EmergencyStore(
    private val app: HauswartApp,
) : Store<EmergencyState>(EmergencyState()) {
    init {
        onChange(app, "docs", "contacts", "insurance", "assets") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun setIncludeSecrets(value: Boolean) {
        update { it.copy(includeSecrets = value) }
    }

    /** Fetches the printable sheet; [EmergencyState.sheet] is set when it is there. */
    fun exportSheet() {
        if (current.exporting) return
        val secrets = current.includeSecrets
        update { it.copy(exporting = true, exportError = null) }
        launch({ e -> update { it.copy(exporting = false, exportError = e) } }) {
            val body = app.api.emergency.emergencyExport(if (secrets) "1" else null)
            val file = FilePayload(fileNameFor(tr("emergency_pdf_title"), "application/pdf"), "application/pdf", body.bytes)
            update { it.copy(exporting = false, sheet = EmergencySheet(file)) }
        }
    }

    fun clearSheet() {
        update { it.copy(sheet = null) }
    }

    fun dismissExportError() {
        update { it.copy(exportError = null) }
    }

    private fun load() {
        update { it.copy(loading = it.description.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val e = app.api.emergency.emergencyGet()
            val contacts =
                e.contacts.map {
                    EmergencyContactRow(
                        id = it.id,
                        name = it.name,
                        company = it.company?.takeIf { company -> company != it.name }.orEmpty(),
                        notes = it.notes.orEmpty(),
                        phone = it.phone.orEmpty(),
                        email = it.email.orEmpty(),
                    )
                }
            val insurance =
                e.insurance.map {
                    EmergencyInsuranceRow(
                        id = it.id,
                        title = it.title,
                        subtitle =
                            listOfNotNull(
                                insuranceTypeLabel(it.type),
                                it.insurerName,
                                it.policyNumber?.let { number -> tr("emergency_insurance_number", "number" to number) },
                            ).joinToString(" · "),
                        assistancePhone = it.assistancePhone.orEmpty(),
                        insurerPhone = it.insurerPhone.orEmpty(),
                        insurerName = it.insurerName.orEmpty(),
                    )
                }
            val assets =
                e.assets.map { asset ->
                    EmergencyAssetRow(
                        id = asset.id,
                        name = asset.name,
                        room = asset.roomName?.let { tr("emergency_room", "room" to it) }.orEmpty(),
                        hints =
                            asset.pinnedHints.map { h ->
                                EmergencyHintRow(h.id, h.title, h.bodyMd.trim(), h.kind, tr("hint_kind_${h.kind}"))
                            },
                    )
                }
            val pages = e.pages.map { EmergencyPageRow(it.slug, it.title, docSectionLabel(it.section)) }
            update {
                it.copy(
                    loading = false,
                    description = tr("emergency_description", "name" to e.household.name),
                    contacts = contacts,
                    insurance = insurance,
                    assets = assets,
                    pages = pages,
                    empty = contacts.isEmpty() && insurance.isEmpty() && assets.isEmpty() && pages.isEmpty(),
                )
            }
        }
    }
}
