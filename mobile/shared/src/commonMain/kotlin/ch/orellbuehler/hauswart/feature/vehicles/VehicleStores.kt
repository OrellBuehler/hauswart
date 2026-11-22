package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.CostBook
import ch.orellbuehler.hauswart.api.generated.Vehicle
import ch.orellbuehler.hauswart.api.generated.VehiclesPutRequest
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.feature.costs.defaultBook
import ch.orellbuehler.hauswart.feature.costs.openBooks
import ch.orellbuehler.hauswart.i18n.tr

private suspend fun loadBooks(app: HauswartApp): List<CostBook> =
    fetchAll { cursor ->
        val page = app.api.costs.costBooksList(cursor = cursor, limit = 200, includeArchived = true)
        page.items to page.nextCursor
    }

/** The facts of a vehicle's details as a list of label and value; empty ones are left out. */
internal fun vehicleFacts(
    vehicle: Vehicle,
    books: List<CostBook>,
): List<VehicleFact> {
    val book = books.firstOrNull { it.id == vehicle.costBookId }
    val bookName =
        book?.let { if (it.archivedAt != null) tr("cost_book_archived_option", "name" to it.name) else it.name }
    return listOfNotNull(
        vehicle.vin?.let { VehicleFact(tr("vehicle_vin"), it) },
        vehicle.registrationNumber?.let { VehicleFact(tr("vehicle_registration_number"), it) },
        vehicle.firstRegistration?.let { VehicleFact(tr("vehicle_first_registration"), Dates.format(it)) },
        vehicle.fuelType?.let { VehicleFact(tr("vehicle_fuel"), vehicleFuelLabel(it)) },
        vehicle.tireSizeSummer?.let { VehicleFact(tr("vehicle_tire_summer"), it) },
        vehicle.tireSizeWinter?.let { VehicleFact(tr("vehicle_tire_winter"), it) },
        vehicle.location?.let { VehicleFact(tr("vehicle_location"), it) },
        bookName?.let { VehicleFact(tr("vehicle_cost_book"), it) },
    ).filter { it.value.isNotBlank() }
}

data class VehicleSectionState(
    val loading: Boolean = true,
    val error: UiError? = null,
    /** The asset is no vehicle (the server answers 404): the section shows nothing. */
    val notVehicle: Boolean = false,
    val plate: String? = null,
    val unit: String = "km",
    /** "45'200 km"; null before the first reading. */
    val odometer: String? = null,
    /** "Stand vom 21.11.2026". */
    val odometerDate: String? = null,
    val facts: List<VehicleFact> = emptyList(),
    val notes: String? = null,
    val firstRegistration: String? = null,
)

/** The summary card of a vehicle on its asset screen. */
class VehicleSectionStore(
    private val app: HauswartApp,
    private val assetId: String,
) : Store<VehicleSectionState>(VehicleSectionState()) {
    init {
        onChange(app, "vehicles", "costs") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    private fun load() {
        update { it.copy(loading = it.plate == null && it.odometer == null && it.facts.isEmpty(), error = null) }
        launch({ e ->
            if (e.isNotFound) {
                update { it.copy(loading = false, notVehicle = true) }
            } else {
                update { it.copy(loading = false, error = e) }
            }
        }) {
            val vehicle = app.api.vehicles.vehiclesGet(assetId)
            val books = if (vehicle.costBookId != null) loadBooks(app) else emptyList()
            val latest = vehicle.odometer
            update {
                it.copy(
                    loading = false,
                    notVehicle = false,
                    plate = vehicle.plate?.takeIf { p -> p.isNotBlank() },
                    unit = vehicle.odometerUnit,
                    odometer = latest?.let { l -> odometerText(l.value, l.unit) },
                    odometerDate = latest?.let { l -> tr("vehicle_odometer_as_of", "date" to Dates.format(l.date)) },
                    facts = vehicleFacts(vehicle, books),
                    notes = vehicle.notes?.takeIf { n -> n.isNotBlank() },
                    firstRegistration = vehicle.firstRegistration,
                )
            }
        }
    }
}

/** What the details form holds, as typed. [fuelType] and [costBookId] are "" for none. */
data class VehicleForm(
    val plate: String = "",
    val vin: String = "",
    val registrationNumber: String = "",
    val firstRegistration: String = "",
    val fuelType: String = "",
    val tireSizeSummer: String = "",
    val tireSizeWinter: String = "",
    val location: String = "",
    val odometerUnit: String = "km",
    val notes: String = "",
    val costBookId: String = "",
)

data class VehicleEditState(
    val loading: Boolean = true,
    val loadError: UiError? = null,
    val initial: VehicleForm? = null,
    val fuelTypes: List<VehicleChoice> = emptyList(),
    val units: List<VehicleChoice> = emptyList(),
    val books: List<VehicleChoice> = emptyList(),
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    /** True once saved; the screen closes. */
    val saved: Boolean = false,
)

private val LIMITS =
    mapOf(
        "plate" to 32,
        "vin" to 32,
        "registrationNumber" to 32,
        "tireSizeSummer" to 64,
        "tireSizeWinter" to 64,
        "location" to 200,
        "notes" to 20_000,
    )

/** Edits the details of a vehicle (plate, VIN, registration data, tire sizes, unit, cost book). */
class VehicleEditStore(
    private val app: HauswartApp,
    private val assetId: String,
) : Store<VehicleEditState>(VehicleEditState()) {
    init {
        load()
    }

    fun retry() {
        load()
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val vehicle = app.api.vehicles.vehiclesGet(assetId)
            val books = loadBooks(app)
            val defaultName = defaultBook(books)?.name
            val choices =
                listOf(
                    VehicleChoice(
                        "",
                        if (defaultName !=
                            null
                        ) {
                            tr("vehicle_cost_book_default", "name" to defaultName)
                        } else {
                            tr("vehicle_cost_book_default_plain")
                        },
                    ),
                ) +
                    books
                        .filter { it.archivedAt == null || it.id == vehicle.costBookId }
                        .map {
                            VehicleChoice(
                                it.id,
                                if (it.archivedAt !=
                                    null
                                ) {
                                    tr("cost_book_archived_option", "name" to it.name)
                                } else {
                                    it.name
                                },
                            )
                        }
            update {
                it.copy(
                    loading = false,
                    initial =
                        VehicleForm(
                            plate = vehicle.plate.orEmpty(),
                            vin = vehicle.vin.orEmpty(),
                            registrationNumber = vehicle.registrationNumber.orEmpty(),
                            firstRegistration = vehicle.firstRegistration.orEmpty(),
                            fuelType = vehicle.fuelType.orEmpty(),
                            tireSizeSummer = vehicle.tireSizeSummer.orEmpty(),
                            tireSizeWinter = vehicle.tireSizeWinter.orEmpty(),
                            location = vehicle.location.orEmpty(),
                            odometerUnit = vehicle.odometerUnit,
                            notes = vehicle.notes.orEmpty(),
                            costBookId = vehicle.costBookId.orEmpty(),
                        ),
                    fuelTypes =
                        listOf(VehicleChoice("", tr("vehicle_fuel_none"))) +
                            VEHICLE_FUEL_TYPES.map { t -> VehicleChoice(t, vehicleFuelLabel(t)) },
                    units = VEHICLE_ODOMETER_UNITS.map { u -> VehicleChoice(u, vehicleUnitLabel(u)) },
                    books =
                        choices.filter { c ->
                            c.value.isEmpty() ||
                                openBooks(books).any { b -> b.id == c.value } ||
                                c.value == vehicle.costBookId
                        },
                )
            }
        }
    }

    fun save(form: VehicleForm) {
        if (current.saving) return
        val errors = mutableMapOf<String, String>()
        if (form.firstRegistration.isNotEmpty() &&
            !Dates.isValid(form.firstRegistration)
        ) {
            errors["firstRegistration"] = tr("field_invalid_date")
        }
        val texts =
            mapOf(
                "plate" to form.plate,
                "vin" to form.vin,
                "registrationNumber" to form.registrationNumber,
                "tireSizeSummer" to form.tireSizeSummer,
                "tireSizeWinter" to form.tireSizeWinter,
                "location" to form.location,
                "notes" to form.notes,
            )
        texts.forEach { (field, text) ->
            val max = LIMITS.getValue(field)
            if (text.trim().length > max) errors[field] = tr("field_too_long", "max" to max)
        }
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, error = UiError(tr("form_check_fields"), "invalid_request")) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e ->
            val bookClosed = e.fields["costBookId"] != null
            val fields = if (bookClosed) e.fields + ("costBookId" to tr("vehicle_cost_book_closed")) else e.fields
            update {
                it.copy(
                    saving = false,
                    error = if (fields.isEmpty()) e else UiError(tr("form_check_fields"), e.code),
                    fieldErrors = fields,
                )
            }
        }) {
            fun text(value: String): Patch<String> = Patch.of(value.trim().ifEmpty { null })
            app.api.vehicles.vehiclesPut(
                assetId,
                VehiclesPutRequest(
                    plate = text(form.plate),
                    vin = text(form.vin),
                    registrationNumber = text(form.registrationNumber),
                    firstRegistration = Patch.of(form.firstRegistration.ifEmpty { null }),
                    fuelType = Patch.of(form.fuelType.ifEmpty { null }),
                    tireSizeSummer = text(form.tireSizeSummer),
                    tireSizeWinter = text(form.tireSizeWinter),
                    location = text(form.location),
                    odometerUnit = form.odometerUnit,
                    notes = text(form.notes),
                    costBookId = Patch.of(form.costBookId.ifEmpty { null }),
                ),
            )
            update { it.copy(saving = false, saved = true) }
            app.changed("vehicles", "assets")
        }
    }
}
