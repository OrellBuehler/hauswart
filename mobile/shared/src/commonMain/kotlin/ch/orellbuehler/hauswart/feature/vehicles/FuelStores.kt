package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.CostBook
import ch.orellbuehler.hauswart.api.generated.FuelLog
import ch.orellbuehler.hauswart.api.generated.FuelLogsCreateRequest
import ch.orellbuehler.hauswart.api.generated.FuelLogsCreateRequestSharesItem
import ch.orellbuehler.hauswart.api.generated.FuelLogsUpdateRequest
import ch.orellbuehler.hauswart.api.generated.Vehicle
import ch.orellbuehler.hauswart.api.generated.VehicleStats
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.core.formatNumber
import ch.orellbuehler.hauswart.feature.costs.MAX_COST_MINOR
import ch.orellbuehler.hauswart.feature.costs.SHARE_BPS_TOTAL
import ch.orellbuehler.hauswart.feature.costs.ShareBps
import ch.orellbuehler.hauswart.feature.costs.cleanAmount
import ch.orellbuehler.hauswart.feature.costs.cleanCurrency
import ch.orellbuehler.hauswart.feature.costs.costSplitLabel
import ch.orellbuehler.hauswart.feature.costs.defaultBook
import ch.orellbuehler.hauswart.feature.costs.equalShareInputs
import ch.orellbuehler.hauswart.feature.costs.isCurrencyCode
import ch.orellbuehler.hauswart.feature.costs.openBooks
import ch.orellbuehler.hauswart.feature.costs.parseSharePercent
import ch.orellbuehler.hauswart.feature.costs.shareToInput
import ch.orellbuehler.hauswart.feature.tasks.parseOdometer
import ch.orellbuehler.hauswart.i18n.tr

private const val FUEL_PAGE = 20L
const val FUEL_STATION_MAX = 120
const val FUEL_NOTES_MAX = 2000

/** A point of a small line drawing; both coordinates run from 0 to 1, y from the top. */
data class SparkPoint(
    val x: Double,
    val y: Double,
)

/** Normalises [values] to a line drawing; fewer than two values draw nothing. */
fun sparkPoints(values: List<Double>): List<SparkPoint> {
    if (values.size < 2) return emptyList()
    val low = values.min()
    val span = values.max() - low
    return values.mapIndexed { i, v ->
        SparkPoint(i.toDouble() / (values.size - 1), if (span == 0.0) 0.5 else 1.0 - (v - low) / span)
    }
}

/** Consumption and price of one fuel unit as the card above the log shows them. */
data class FuelPanel(
    val unit: String,
    /** "7.5 l/100 km"; null while no stretch is closed. */
    val average: String?,
    val stretches: String?,
    val consumptionSpark: List<SparkPoint>,
    val consumptionRange: String?,
    val priceTitle: String,
    /** The latest price per unit; null without a price. */
    val price: String?,
    val priceSpark: List<SparkPoint>,
    val priceRange: String?,
)

data class FuelRow(
    val id: String,
    val dateText: String,
    val partial: Boolean,
    val missedPrevious: Boolean,
    val place: String?,
    val quantityLine: String,
    val stretchLine: String?,
    val notes: String?,
    val amountText: String,
    val rateText: String?,
    val costEntryId: String?,
    val actionsLabel: String,
    val deleteText: String,
)

data class FuelLogState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val unit: String = "km",
    val panels: List<FuelPanel> = emptyList(),
    val rows: List<FuelRow> = emptyList(),
    val hasMore: Boolean = false,
    val loadingMore: Boolean = false,
    val today: String = "",
    val currency: String = "CHF",
    val readingHint: String = "",
    /** The books a fill can be booked into. */
    val books: List<VehicleChoice> = emptyList(),
    val people: List<VehicleChoice> = emptyList(),
    val saving: Boolean = false,
    val formError: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    /** True once the dialog's action went through; the screen closes it and calls [FuelLogStore.ackDone]. */
    val done: Boolean = false,
    val actionError: UiError? = null,
    val notice: String? = null,
)

/** What the fill form holds, as typed. [paidByUserId] and [bookId] are "" for none. */
data class FuelForm(
    val date: String = "",
    val odometer: String = "",
    val quantity: String = "",
    val amount: String = "",
    val unit: String = "l",
    val currency: String = "CHF",
    val fullTank: Boolean = true,
    val missedPrevious: Boolean = false,
    val station: String = "",
    val notes: String = "",
    val paidByUserId: String = "",
    val bookId: String = "",
    val splitMode: String = "ownership",
    /** The person chose the split by hand, so picking another book no longer changes it. */
    val splitTouched: Boolean = false,
    /** Percent as typed per user id for a custom split. */
    val shares: Map<String, String> = emptyMap(),
)

/** What the form shows next to its fields, worked out from the form as it stands. */
data class FuelFormView(
    val amountLabel: String,
    val quantityLabel: String,
    val odometerLabel: String,
    val showBook: Boolean,
    val showSplit: Boolean,
    val showShares: Boolean,
    val splitHint: String,
    val sharesStatus: String?,
    /** For an existing fill: the cost entry that holds the split and the receipts. */
    val costEntryHint: String?,
)

private fun fuelBookOf(
    books: List<CostBook>,
    vehicleBookId: String?,
): CostBook? = openBooks(books).firstOrNull { it.id == vehicleBookId } ?: defaultBook(books)

/** The fuel log of a vehicle: consumption and price panels, the entries, and add, edit and delete. */
class FuelLogStore(
    private val app: HauswartApp,
    private val assetId: String,
) : Store<FuelLogState>(FuelLogState()) {
    private var logs: List<FuelLog> = emptyList()
    private var cursor: String? = null
    private var books: List<CostBook> = emptyList()
    private var vehicle: Vehicle? = null

    init {
        onChange(app, "vehicles", "costs") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    private fun panelsOf(
        stats: VehicleStats,
        distanceUnit: String,
    ): List<FuelPanel> =
        VEHICLE_FUEL_UNITS.mapNotNull { unit ->
            val consumption = stats.consumption.firstOrNull { it.unit == unit }
            val prices = stats.priceTrend.filter { it.unit == unit && it.pricePerUnitMinor > 0 }
            if (consumption == null && prices.isEmpty()) return@mapNotNull null
            val stretches = consumption?.last.orEmpty()

            fun range(dates: List<String>): String? =
                if (dates.size >= 2) "${Dates.format(dates.first())} – ${Dates.format(dates.last())}" else null
            FuelPanel(
                unit = unit,
                average = consumption?.averagePer100?.let { consumptionText(it, unit, distanceUnit) },
                stretches = consumption?.averagePer100?.let { tr("fuel_stretches", "count" to consumption.stretchCount) },
                consumptionSpark = sparkPoints(stretches.map { it.consumptionPer100 }),
                consumptionRange = range(stretches.map { it.date }),
                priceTitle = tr(if (unit == "l") "fuel_price_l" else "fuel_price_kwh"),
                price = prices.lastOrNull()?.let { rateText(it.pricePerUnitMinor, stats.costs.currency, unit) },
                priceSpark = sparkPoints(prices.map { it.pricePerUnitMinor }),
                priceRange = range(prices.map { it.date }),
            )
        }

    private fun rowOf(log: FuelLog): FuelRow {
        val date = Dates.format(log.date)
        val stretch =
            if (log.consumptionPer100 != null && log.distance != null) {
                val parts =
                    mutableListOf(consumptionText(log.consumptionPer100, log.unit, log.odometerUnit))
                parts += tr("fuel_stretch", "distance" to odometerText(log.distance, log.odometerUnit))
                log.costPerDistanceMinor?.let { parts += rateText(it, log.currency, log.odometerUnit) }
                parts.joinToString(" · ")
            } else {
                null
            }
        return FuelRow(
            id = log.id,
            dateText = date,
            partial = !log.fullTank,
            missedPrevious = log.missedPrevious,
            place = listOfNotNull(log.station, log.bookName).filter { it.isNotBlank() }.joinToString(" · ").ifEmpty { null },
            quantityLine = fuelQuantityText(log.quantity, log.unit) + " · " + odometerText(log.odometer, log.odometerUnit),
            stretchLine = stretch,
            notes = log.notes?.takeIf { it.isNotBlank() },
            amountText = if (log.amountMinor == 0L) tr("fuel_free") else Money.format(log.amountMinor, log.currency),
            rateText = log.pricePerUnitMinor?.takeIf { it > 0 }?.let { rateText(it, log.currency, log.unit) },
            costEntryId = log.costEntryId,
            actionsLabel = tr("fuel_actions_aria", "date" to date),
            deleteText = tr("fuel_delete_description", "date" to date),
        )
    }

    private fun load() {
        update { it.copy(loading = it.rows.isEmpty() && it.panels.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val household = app.household.get()
            val v = app.api.vehicles.vehiclesGet(assetId)
            vehicle = v
            val stats = app.api.vehicles.vehicleStats(assetId)
            val page = app.api.vehicles.fuelLogsList(assetId, limit = FUEL_PAGE)
            books =
                fetchAll { c ->
                    val booksPage = app.api.costs.costBooksList(cursor = c, limit = 200, includeArchived = true)
                    booksPage.items to booksPage.nextCursor
                }
            logs = page.items
            cursor = page.nextCursor
            val latest = v.odometer
            update {
                it.copy(
                    loading = false,
                    unit = v.odometerUnit,
                    panels = panelsOf(stats, v.odometerUnit),
                    rows = logs.map(::rowOf),
                    hasMore = cursor != null,
                    today = app.household.today(),
                    currency = household.currency,
                    readingHint =
                        if (latest != null) {
                            tr(
                                "vehicle_odometer_latest",
                                "value" to odometerText(latest.value, latest.unit),
                                "date" to Dates.format(latest.date),
                            )
                        } else {
                            tr("vehicle_odometer_none_hint")
                        },
                    books = openBooks(books).map { b -> VehicleChoice(b.id, b.name) },
                    people = household.members.map { m -> VehicleChoice(m.id, m.name) },
                )
            }
        }
    }

    fun loadMore() {
        val next = cursor ?: return
        if (current.loadingMore) return
        update { it.copy(loadingMore = true) }
        launch({ e -> update { it.copy(loadingMore = false, actionError = e) } }) {
            val page = app.api.vehicles.fuelLogsList(assetId, cursor = next, limit = FUEL_PAGE)
            logs = logs + page.items
            cursor = page.nextCursor
            update { it.copy(loadingMore = false, rows = logs.map(::rowOf), hasMore = cursor != null) }
        }
    }

    // ---- the form

    private val members get() = app.household.members

    /** The form for a new fill: today, the vehicle's usual unit, the vehicle's book, the signed-in person as payer. */
    fun blankForm(): FuelForm {
        val book = fuelBookOf(books, vehicle?.costBookId)
        val me = app.session.user?.id
        val ids = members.map { it.id }
        return FuelForm(
            date = current.today,
            unit = if (vehicle?.fuelType == "electric") "kWh" else "l",
            currency = current.currency,
            paidByUserId = if (me != null && me in ids) me else "",
            bookId = book?.id.orEmpty(),
            splitMode = book?.defaultSplitMode ?: "ownership",
            shares = equalShareInputs(ids),
        )
    }

    /** The form of an existing fill, or null when it is not there any more. */
    fun editForm(id: String): FuelForm? {
        val log = logs.firstOrNull { it.id == id } ?: return null
        return FuelForm(
            date = log.date,
            odometer = vehicleNumberInput(log.odometer),
            quantity = vehicleNumberInput(log.quantity),
            amount = Money.toInput(log.amountMinor, log.currency),
            unit = log.unit,
            currency = log.currency,
            fullTank = log.fullTank,
            missedPrevious = log.missedPrevious,
            station = log.station.orEmpty(),
            notes = log.notes.orEmpty(),
            paidByUserId = log.paidByUserId.orEmpty(),
            bookId = log.bookId ?: fuelBookOf(books, vehicle?.costBookId)?.id.orEmpty(),
            splitMode = "ownership",
            splitTouched = true,
            shares = equalShareInputs(members.map { it.id }),
        )
    }

    fun withBook(
        form: FuelForm,
        bookId: String,
        creating: Boolean,
    ): FuelForm {
        val book = books.firstOrNull { it.id == bookId } ?: return form
        val mode = if (creating && !form.splitTouched) book.defaultSplitMode else form.splitMode
        return form.copy(bookId = book.id, splitMode = mode)
    }

    fun withSplitMode(
        form: FuelForm,
        mode: String,
    ): FuelForm = form.copy(splitMode = mode, splitTouched = true)

    fun withShare(
        form: FuelForm,
        userId: String,
        percent: String,
    ): FuelForm = form.copy(shares = form.shares + (userId to percent))

    fun equalizeShares(form: FuelForm): FuelForm = form.copy(shares = equalShareInputs(members.map { it.id }))

    fun withCurrency(
        form: FuelForm,
        text: String,
    ): FuelForm = form.copy(currency = cleanCurrency(text))

    /** The payers a form offers: the household, and for an existing fill also "nobody". */
    fun payerChoices(editing: Boolean): List<VehicleChoice> =
        (if (editing) listOf(VehicleChoice("", tr("cost_payer_none"))) else emptyList()) + current.people

    fun splitChoices(): List<VehicleChoice> = listOf("ownership", "equal", "custom", "none").map { VehicleChoice(it, costSplitLabel(it)) }

    fun unitChoices(): List<VehicleChoice> = VEHICLE_FUEL_UNITS.map { VehicleChoice(it, fuelUnitLabel(it)) }

    private fun amountOf(form: FuelForm): Long? {
        if (!isCurrencyCode(form.currency)) return null
        val minor = Money.parse(cleanAmount(form.amount), form.currency) ?: return null
        return if (minor in 0..MAX_COST_MINOR) minor else null
    }

    private fun checkShares(form: FuelForm): Pair<List<ShareBps>, String?> {
        val items = mutableListOf<ShareBps>()
        var invalid = false
        for (person in members) {
            val text = form.shares[person.id].orEmpty().trim()
            if (text.isEmpty() || text.toDoubleOrNull() == 0.0) continue
            val bps = parseSharePercent(text)
            if (bps == null) invalid = true else items += ShareBps(person.id, bps)
        }
        val total = items.sumOf { it.shareBps }
        val error =
            when {
                invalid -> tr("cost_shares_invalid")
                items.isEmpty() -> tr("cost_shares_empty")
                total != SHARE_BPS_TOTAL -> tr("cost_shares_sum", "total" to shareToInput(total))
                else -> null
            }
        return items to error
    }

    /** What the form shows around its fields; [editingId] is the fill being edited, null for a new one. */
    fun view(
        form: FuelForm,
        editingId: String?,
    ): FuelFormView {
        val log = logs.firstOrNull { it.id == editingId }
        val amount = amountOf(form)
        val choices = bookChoicesFor(log)
        val custom = form.splitMode == "custom"
        val checked = if (custom) checkShares(form) else null
        val status =
            checked?.let { (items, error) ->
                val total = items.sumOf { it.shareBps }
                when {
                    error == null -> tr("cost_shares_total_ok")
                    items.isNotEmpty() && total < SHARE_BPS_TOTAL ->
                        tr(
                            "cost_shares_missing",
                            "percent" to shareToInput(SHARE_BPS_TOTAL - total),
                        )
                    total > SHARE_BPS_TOTAL -> tr("cost_shares_over", "percent" to shareToInput(total - SHARE_BPS_TOTAL))
                    else -> error
                }
            }
        return FuelFormView(
            amountLabel = tr("fuel_amount", "currency" to form.currency),
            quantityLabel = tr("fuel_quantity", "unit" to form.unit),
            odometerLabel = tr("vehicle_odometer_value", "unit" to current.unit),
            showBook = choices.size > 1 && (log == null || log.bookId != null || (amount != null && amount > 0)),
            showSplit = editingId == null,
            showShares = editingId == null && custom,
            splitHint = tr("cost_split_${form.splitMode}_hint"),
            sharesStatus = if (editingId == null) status else null,
            costEntryHint = if (log?.costEntryId != null) tr("fuel_cost_entry_hint") else null,
        )
    }

    /** The books the book field offers: the open ones, and the one an existing fill is booked in even when it is archived. */
    fun bookChoicesFor(log: FuelLog?): List<VehicleChoice> =
        books.filter { it.archivedAt == null || it.id == log?.bookId }.map { VehicleChoice(it.id, it.name) }

    fun bookChoices(editingId: String?): List<VehicleChoice> = bookChoicesFor(logs.firstOrNull { it.id == editingId })

    // ---- saving

    fun clearForm() {
        update { it.copy(formError = null, fieldErrors = emptyMap(), done = false, saving = false) }
    }

    fun ackDone() {
        update { it.copy(done = false) }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun check(form: FuelForm): Map<String, String> {
        val errors = mutableMapOf<String, String>()
        if (form.date.isEmpty()) {
            errors["date"] = tr("m_field_required")
        } else if (!Dates.isValid(form.date)) {
            errors["date"] = tr("field_invalid_date")
        } else if (form.date > current.today) {
            errors["date"] = tr("vehicle_odometer_date_future")
        }
        val odometer = parseOdometer(form.odometer, VEHICLE_MAX_ODOMETER)
        if (!odometer.valid) {
            errors["odometer"] = tr("vehicle_odometer_invalid", "max" to formatNumber(VEHICLE_MAX_ODOMETER))
        } else if (odometer.value == null) {
            errors["odometer"] = tr("m_field_required")
        }
        val quantity = parseVehicleDecimal(form.quantity, VEHICLE_MAX_FUEL_QUANTITY)
        if (quantity.valid && quantity.value == null) {
            errors["quantity"] = tr("m_field_required")
        } else if (!quantity.valid || (quantity.value ?: 0.0) <= 0.0) {
            errors["quantity"] = tr("fuel_error_quantity", "max" to formatNumber(VEHICLE_MAX_FUEL_QUANTITY))
        }
        if (!isCurrencyCode(form.currency)) {
            errors["currency"] = tr("cost_currency_invalid")
        } else if (cleanAmount(form.amount).isEmpty()) {
            errors["amountMinor"] = tr("m_field_required")
        } else {
            val minor = Money.parse(cleanAmount(form.amount), form.currency)
            when {
                minor == null || minor < 0 -> errors["amountMinor"] = tr("cost_amount_invalid", "decimals" to Money.exponent(form.currency))
                minor > MAX_COST_MINOR ->
                    errors["amountMinor"] = tr("cost_amount_too_large", "max" to Money.format(MAX_COST_MINOR, form.currency))
            }
        }
        if (form.station.trim().length > FUEL_STATION_MAX) errors["station"] = tr("field_too_long", "max" to FUEL_STATION_MAX)
        if (form.notes.trim().length > FUEL_NOTES_MAX) errors["notes"] = tr("field_too_long", "max" to FUEL_NOTES_MAX)
        return errors
    }

    /** Records a fill ([id] null) or saves the changes of one; nothing is sent when nothing changed. */
    fun save(
        id: String?,
        form: FuelForm,
    ) {
        if (current.saving) return
        val errors = check(form).toMutableMap()
        val custom = id == null && form.splitMode == "custom"
        val shares = if (custom) checkShares(form) else null
        shares?.second?.let { errors["shares"] = it }
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, formError = UiError(tr("form_check_fields"), "invalid_request")) }
            return
        }
        val odometer = requireNotNull(parseOdometer(form.odometer, VEHICLE_MAX_ODOMETER).value)
        val quantity = requireNotNull(parseVehicleDecimal(form.quantity, VEHICLE_MAX_FUEL_QUANTITY).value)
        val amount = requireNotNull(Money.parse(cleanAmount(form.amount), form.currency))
        val station = form.station.trim().ifEmpty { null }
        val notes = form.notes.trim().ifEmpty { null }
        if (id == null) {
            send(tr("fuel_created_toast")) {
                app.api.vehicles.fuelLogsCreate(
                    assetId,
                    FuelLogsCreateRequest(
                        date = form.date,
                        odometer = odometer,
                        quantity = quantity,
                        unit = form.unit,
                        amountMinor = amount,
                        currency = form.currency,
                        fullTank = form.fullTank,
                        missedPrevious = form.missedPrevious,
                        station = station,
                        notes = notes,
                        bookId = form.bookId.ifEmpty { null },
                        paidByUserId = form.paidByUserId.ifEmpty { null },
                        splitMode = form.splitMode,
                        shares = if (custom) shares?.first?.map { FuelLogsCreateRequestSharesItem(it.userId, it.shareBps) } else null,
                    ),
                )
            }
            return
        }
        val log = logs.firstOrNull { it.id == id } ?: return
        val payer = form.paidByUserId.ifEmpty { null }
        val moves = form.bookId.isNotEmpty() && log.bookId != null && form.bookId != log.bookId
        val starts = form.bookId.isNotEmpty() && log.bookId == null && log.amountMinor == 0L && amount > 0
        val request =
            FuelLogsUpdateRequest(
                date = form.date.takeIf { it != log.date },
                odometer = odometer.takeIf { it != log.odometer },
                quantity = quantity.takeIf { it != log.quantity },
                unit = form.unit.takeIf { it != log.unit },
                amountMinor = amount.takeIf { it != log.amountMinor },
                currency = form.currency.takeIf { it != log.currency },
                fullTank = form.fullTank.takeIf { it != log.fullTank },
                missedPrevious = form.missedPrevious.takeIf { it != log.missedPrevious },
                station = if (station != log.station) Patch.of(station) else Patch.Keep,
                notes = if (notes != log.notes) Patch.of(notes) else Patch.Keep,
                bookId = form.bookId.takeIf { moves || starts },
                paidByUserId = if (payer != log.paidByUserId) Patch.of(payer) else Patch.Keep,
            )
        if (request == FuelLogsUpdateRequest()) {
            update { it.copy(done = true) }
            return
        }
        send(tr("fuel_saved_toast")) { app.api.vehicles.fuelLogsUpdate(id, request) }
    }

    private fun send(
        success: String,
        call: suspend () -> Unit,
    ) {
        update { it.copy(saving = true, formError = null, fieldErrors = emptyMap()) }
        launch({ e ->
            update {
                it.copy(
                    saving = false,
                    formError = if (e.fields.isEmpty()) e else UiError(tr("form_check_fields"), e.code),
                    fieldErrors = e.fields,
                )
            }
        }) {
            try {
                call()
            } catch (e: ApiException) {
                val refusal = odometerRefusalOf(e)?.takeIf { it.field == "odometer" } ?: throw e
                update {
                    it.copy(
                        saving = false,
                        formError = UiError(tr("form_check_fields"), e.code),
                        fieldErrors = mapOf("odometer" to odometerRefusalText(refusal, current.unit, canForce = false)),
                    )
                }
                return@launch
            }
            update { it.copy(saving = false, done = true, notice = success) }
            app.changed("vehicles", "costs", "tasks", "assets")
        }
    }

    fun delete(id: String) {
        update { it.copy(actionError = null) }
        launch({ e -> update { it.copy(actionError = e) } }) {
            app.api.vehicles.fuelLogsDelete(id)
            update { it.copy(notice = tr("fuel_deleted_toast")) }
            app.changed("vehicles", "costs", "tasks", "assets")
        }
    }
}
