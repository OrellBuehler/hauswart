package ch.orellbuehler.hauswart.feature.parts

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.PartsCreateRequest
import ch.orellbuehler.hauswart.api.generated.PartsUpdateRequest
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.i18n.tr

private val WHOLE = Regex("^\\d{1,9}$")

/** A whole number from a field, null when the text is none. */
internal fun parseCount(text: String): Long? = text.trim().takeIf { WHOLE.matches(it) }?.toLongOrNull()

/** Every field of the part form as typed; [stockCount] only counts for a new part. */
data class PartForm(
    val name: String = "",
    val partNumber: String = "",
    val supplier: String = "",
    val shopUrl: String = "",
    val price: String = "",
    val stockCount: String = "0",
    val minStock: String = "0",
    val reorderQty: String = "1",
    val leadTimeDays: String = "14",
    val notes: String = "",
)

data class PartEditState(
    val isNew: Boolean,
    val loading: Boolean = true,
    val loadError: UiError? = null,
    val initial: PartForm? = null,
    val currency: String = "",
    val saving: Boolean = false,
    val error: UiError? = null,
    /** Messages per field of the request (`name`, `unitPriceMinor`, `minStock`, ...). */
    val fieldErrors: Map<String, String> = emptyMap(),
    val savedId: String? = null,
)

/** Creates a part ([id] null) or edits one. */
class PartEditStore(
    private val app: HauswartApp,
    private val id: String?,
) : Store<PartEditState>(PartEditState(isNew = id == null)) {
    init {
        load()
    }

    fun retry() {
        load()
    }

    fun save(form: PartForm) {
        if (current.saving) return
        val currency = current.currency
        val errors = mutableMapOf<String, String>()
        if (form.name.isBlank()) errors["name"] = tr("m_field_required")
        val price = if (form.price.isBlank()) null else Money.parse(form.price, currency)
        if (form.price.isNotBlank() && price == null) errors["unitPriceMinor"] = tr("field_number")
        val stock = parseCount(form.stockCount)
        if (id == null && (stock == null || stock > MAX_PART_STOCK)) errors["stockCount"] = tr("field_number")
        val min = parseCount(form.minStock)
        if (min == null || min > MAX_PART_STOCK) errors["minStock"] = tr("field_number")
        val reorder = parseCount(form.reorderQty)
        if (reorder == null || reorder < 1 || reorder > MAX_PART_STOCK) errors["reorderQty"] = tr("field_min", "min" to 1)
        val lead = parseCount(form.leadTimeDays)
        if (lead == null || lead > 3650) errors["leadTimeDays"] = tr("field_number")
        if (errors.isNotEmpty() || min == null || reorder == null || lead == null) {
            update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, error = if (e.fields.isEmpty()) e else null, fieldErrors = e.fields) } }) {
            val saved =
                if (id == null) {
                    app.api.parts.partsCreate(
                        PartsCreateRequest(
                            name = form.name.trim(),
                            partNumber = form.partNumber.trim().ifEmpty { null },
                            supplier = form.supplier.trim().ifEmpty { null },
                            shopUrl = form.shopUrl.trim().ifEmpty { null },
                            unitPriceMinor = price,
                            currency = currency,
                            stockCount = stock,
                            minStock = min,
                            reorderQty = reorder,
                            leadTimeDays = lead,
                            notes = form.notes.trim().ifEmpty { null },
                        ),
                    )
                } else {
                    app.api.parts.partsUpdate(
                        id,
                        PartsUpdateRequest(
                            name = form.name.trim(),
                            partNumber = Patch.of(form.partNumber.trim().ifEmpty { null }),
                            supplier = Patch.of(form.supplier.trim().ifEmpty { null }),
                            shopUrl = form.shopUrl.trim(),
                            unitPriceMinor = Patch.of(price),
                            minStock = min,
                            reorderQty = reorder,
                            leadTimeDays = lead,
                            notes = Patch.of(form.notes.trim().ifEmpty { null }),
                        ),
                    )
                }
            app.changed("parts")
            update { it.copy(saving = false, savedId = saved.id) }
        }
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            if (id == null) {
                app.household.get()
                update { it.copy(loading = false, currency = app.household.currency, initial = PartForm()) }
            } else {
                val p = app.api.parts.partsGet(id)
                val form =
                    PartForm(
                        name = p.name,
                        partNumber = p.partNumber.orEmpty(),
                        supplier = p.supplier.orEmpty(),
                        shopUrl = p.shopUrl.orEmpty(),
                        price = p.unitPriceMinor?.let { Money.toInput(it, p.currency) }.orEmpty(),
                        stockCount = "0",
                        minStock = p.minStock.toString(),
                        reorderQty = p.reorderQty.toString(),
                        leadTimeDays = p.leadTimeDays.toString(),
                        notes = p.notes.orEmpty(),
                    )
                update { it.copy(loading = false, currency = p.currency, initial = form) }
            }
        }
    }
}
