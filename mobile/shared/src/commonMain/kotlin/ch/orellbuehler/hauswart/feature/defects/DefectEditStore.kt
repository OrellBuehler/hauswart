package ch.orellbuehler.hauswart.feature.defects

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.Asset
import ch.orellbuehler.hauswart.api.generated.DefectDetail
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.plus
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Every field of the defect form as typed; dates are `YYYY-MM-DD` or empty, ids are empty for none. */
data class DefectForm(
    val title: String = "",
    val description: String = "",
    val severity: String = "medium",
    val roomId: String = "",
    val assetId: String = "",
    val locationDetail: String = "",
    val discoveredOn: String = "",
    val contactId: String = "",
    /** `auto` (from the handover date), `manual` or `none`. */
    val deadlineMode: String = DEADLINE_MODE_NONE,
    val deadlineDate: String = "",
)

data class DefectEditState(
    val isNew: Boolean,
    val loading: Boolean = true,
    val loadError: UiError? = null,
    val initial: DefectForm? = null,
    /** The number of the defect being edited; 0 for a new one. */
    val number: Long = 0,
    val today: String = "",
    val rooms: List<DefectChoice> = emptyList(),
    val assets: List<DefectChoice> = emptyList(),
    val contacts: List<DefectChoice> = emptyList(),
    val severities: List<DefectChoice> = emptyList(),
    val deadlineModes: List<DefectChoice> = emptyList(),
    /** There is no contact to choose from. */
    val noContacts: Boolean = false,
    val saving: Boolean = false,
    val error: UiError? = null,
    /** Messages per field of the request (`title`, `discoveredOn`, `deadlineDate`, ...). */
    val fieldErrors: Map<String, String> = emptyMap(),
    val savedId: String? = null,
)

/** Records a defect ([id] null) or edits one; [assetId] and [roomId] preset a new one. */
class DefectEditStore(
    private val app: HauswartApp,
    private val id: String?,
    private val assetId: String?,
    private val roomId: String?,
) : Store<DefectEditState>(DefectEditState(isNew = id == null)) {
    private var handoverDate: String? = null
    private var deadlineMonths = 0
    private var assetRooms: Map<String, String> = emptyMap()

    init {
        load()
    }

    fun retry() {
        load()
    }

    /** The form after the device was chosen: an empty room becomes the room of the device. */
    fun withAsset(
        form: DefectForm,
        assetId: String,
    ): DefectForm {
        val room = assetRooms[assetId]
        return if (assetId.isNotEmpty() && form.roomId.isEmpty() && room != null) {
            form.copy(assetId = assetId, roomId = room)
        } else {
            form.copy(assetId = assetId)
        }
    }

    /** The lines under the deadline choice. */
    fun deadlineHints(form: DefectForm): List<String> {
        val handover = handoverDate
        val lines = mutableListOf<String>()
        when (form.deadlineMode) {
            DEADLINE_MODE_AUTO ->
                if (handover != null) {
                    lines +=
                        tr(
                            "defect_deadline_auto_hint",
                            "date" to Dates.format(autoDeadline(handover, deadlineMonths)),
                            "handover" to Dates.format(handover),
                            "months" to deadlineMonths,
                        )
                }
            DEADLINE_MODE_NONE -> lines += tr("defect_deadline_none_hint")
        }
        lines +=
            if (handover ==
                null
            ) {
                tr("defect_deadline_no_handover")
            } else if (form.deadlineMode !=
                DEADLINE_MODE_NONE
            ) {
                tr("defect_deadline_reminder_hint")
            } else {
                ""
            }
        return lines.filter { it.isNotEmpty() }
    }

    fun save(form: DefectForm) {
        if (current.saving) return
        val errors = validate(form)
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, error = if (e.fields.isEmpty()) e else null, fieldErrors = e.fields) } }) {
            val body = requestBody(form)
            val saved = if (id == null) createDefectRaw(app, body) else patchDefectRaw(app, id, body)
            app.changed("defects", "tasks")
            update { it.copy(saving = false, savedId = saved.id) }
        }
    }

    private fun validate(form: DefectForm): Map<String, String> {
        val errors = mutableMapOf<String, String>()
        if (form.title.isBlank()) errors["title"] = tr("m_field_required")
        when {
            !Dates.isValid(form.discoveredOn) -> errors["discoveredOn"] = tr("m_field_required")
            form.discoveredOn > current.today -> errors["discoveredOn"] = tr("defect_dialog_future")
        }
        if (form.deadlineMode == DEADLINE_MODE_MANUAL && !Dates.isValid(form.deadlineDate)) errors["deadlineDate"] = tr("m_field_required")
        return errors
    }

    private fun requestBody(form: DefectForm): JsonObject {
        val fields =
            mutableMapOf(
                "title" to JsonPrimitive(form.title.trim()),
                "descriptionMd" to JsonPrimitive(form.description),
                "severity" to JsonPrimitive(form.severity),
                "roomId" to nullable(form.roomId),
                "assetId" to nullable(form.assetId),
                "locationDetail" to nullable(form.locationDetail.trim()),
                "discoveredOn" to JsonPrimitive(form.discoveredOn),
                "responsibleContactId" to nullable(form.contactId),
            )
        when (form.deadlineMode) {
            DEADLINE_MODE_AUTO -> if (id != null) fields["deadlineSource"] = JsonPrimitive("handover")
            DEADLINE_MODE_MANUAL -> fields["deadlineDate"] = JsonPrimitive(form.deadlineDate)
            else -> fields["deadlineDate"] = JsonNull
        }
        return JsonObject(fields)
    }

    private fun nullable(value: String) = if (value.isEmpty()) JsonNull else JsonPrimitive(value)

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val data =
                coroutineScope {
                    val r =
                        async {
                            fetchAll { c ->
                                app.api.rooms
                                    .roomsList(cursor = c, limit = 200)
                                    .let { p -> p.items to p.nextCursor }
                            }
                        }
                    val a =
                        async {
                            fetchAll { c ->
                                app.api.assets
                                    .assetsList(cursor = c, limit = 200)
                                    .let { p -> p.items to p.nextCursor }
                            }
                        }
                    val k =
                        async {
                            fetchAll { c ->
                                app.api.contacts.contactsList(cursor = c, limit = 200).let { p ->
                                    p.items to
                                        p.nextCursor
                                }
                            }
                        }
                    val h = async { app.api.household.householdGet() }
                    val d = id?.let { wanted -> async { app.api.defects.defectsGet(wanted) } }
                    Loaded(r.await(), a.await(), k.await(), h.await(), d?.await())
                }
            app.household.get()
            val today = app.household.today()
            handoverDate = data.household.handoverDate
            deadlineMonths =
                data.household.settings.defectDeadlineMonths
                    .toInt()
            val defect = data.defect
            val keep = defect?.assetId
            val assets: List<Asset> = data.assets.filter { it.archivedAt == null || it.id == keep }
            assetRooms = assets.mapNotNull { a -> a.roomId?.let { a.id to it } }.toMap()
            val none = { key: String -> DefectChoice("", tr(key)) }
            val modes =
                listOfNotNull(
                    if (handoverDate != null) DefectChoice(DEADLINE_MODE_AUTO, tr("defect_deadline_auto")) else null,
                    DefectChoice(DEADLINE_MODE_MANUAL, tr("defect_deadline_manual")),
                    DefectChoice(DEADLINE_MODE_NONE, tr("defect_deadline_none_option")),
                )
            update {
                it.copy(
                    loading = false,
                    initial = initialForm(defect, today),
                    number = defect?.number ?: 0,
                    today = today,
                    rooms =
                        listOf(none("defect_no_room")) +
                            data.rooms.sortedWith(compareBy({ r -> r.sortOrder }, { r -> r.name.lowercase() })).map { r ->
                                DefectChoice(r.id, r.name)
                            },
                    assets =
                        listOf(none("defect_no_asset")) +
                            assets.map { a -> DefectChoice(a.id, if (a.roomName != null) "${a.name} (${a.roomName})" else a.name) },
                    contacts =
                        listOf(none("defect_no_contact")) +
                            data.contacts.map { c ->
                                DefectChoice(c.id, if (!c.company.isNullOrBlank()) "${c.name} (${c.company})" else c.name)
                            },
                    severities = defectSeverityChoices(),
                    deadlineModes = modes,
                    noContacts = data.contacts.isEmpty(),
                )
            }
        }
    }

    private fun initialForm(
        defect: DefectDetail?,
        today: String,
    ): DefectForm {
        val handover = handoverDate
        if (defect == null) {
            return DefectForm(
                discoveredOn = today,
                assetId = assetId.orEmpty(),
                roomId = roomId.orEmpty(),
                deadlineMode = if (handover != null) DEADLINE_MODE_AUTO else DEADLINE_MODE_NONE,
            )
        }
        val mode =
            when {
                defect.deadlineSource == "handover" && handover != null -> DEADLINE_MODE_AUTO
                defect.deadlineDate != null -> DEADLINE_MODE_MANUAL
                else -> DEADLINE_MODE_NONE
            }
        return DefectForm(
            title = defect.title,
            description = defect.descriptionMd,
            severity = defect.severity,
            roomId = defect.roomId.orEmpty(),
            assetId = defect.assetId.orEmpty(),
            locationDetail = defect.locationDetail.orEmpty(),
            discoveredOn = defect.discoveredOn,
            contactId = defect.responsibleContactId.orEmpty(),
            deadlineMode = mode,
            deadlineDate = defect.deadlineDate.orEmpty(),
        )
    }

    private class Loaded(
        val rooms: List<ch.orellbuehler.hauswart.api.generated.Room>,
        val assets: List<Asset>,
        val contacts: List<ch.orellbuehler.hauswart.api.generated.Contact>,
        val household: ch.orellbuehler.hauswart.api.generated.Household,
        val defect: DefectDetail?,
    )
}

/** The deadline the household's handover date gives: that date plus [months] months. */
fun autoDeadline(
    handover: String,
    months: Int,
): String = Dates.parse(handover)?.plus(DatePeriod(months = months))?.toString() ?: handover
