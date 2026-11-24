package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.VehicleStats
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.feature.costs.costCategoryLabel
import ch.orellbuehler.hauswart.i18n.tr
import kotlin.math.roundToLong

private const val MAX_YEARS_BACK = 20
private const val MIN_YEAR = 1990
private const val MAX_YEAR = 2200

/** The years the statistics offer: this one back to the first year with data or the vehicle's first registration, at most 20 years. */
fun vehicleStatsYears(
    today: String,
    dates: List<String?>,
): List<Int> {
    val current = today.take(4).toIntOrNull() ?: return emptyList()
    val earliest = dates.mapNotNull { it?.take(4)?.toIntOrNull() }
    val start = (earliest + (current - 1)).min()
    val oldest = maxOf(start, current - MAX_YEARS_BACK, MIN_YEAR)
    return (minOf(current, MAX_YEAR) downTo oldest).toList()
}

/** The share of [part] in [total] as a whole percent. */
fun vehicleCostShare(
    total: Long,
    part: Long,
): Int = if (total > 0) ((part.toDouble() / total) * 100).roundToLong().toInt() else 0

data class StatsCategoryRow(
    val label: String,
    val amountText: String,
    /** 0 to 1, for the bar. */
    val share: Double,
    val percentText: String,
)

data class StatsMonthBar(
    val label: String,
    val valueText: String,
    /** 0 to 1 of the longest month, for the bar. */
    val fraction: Double,
)

data class StatsTaskRow(
    val id: String,
    val title: String,
    val dateText: String?,
)

data class VehicleStatsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val years: List<VehicleChoice> = emptyList(),
    val year: Int = 0,
    /** The statistics of [year] are loading. */
    val yearLoading: Boolean = false,
    val yearError: UiError? = null,
    /** Neither costs nor distance in the year. */
    val empty: Boolean = false,
    val emptyTitle: String = "",
    val totalText: String = "",
    val countText: String = "",
    val distanceText: String = "",
    val perDistanceLabel: String = "",
    val perDistanceText: String? = null,
    val categories: List<StatsCategoryRow> = emptyList(),
    val otherCurrencyText: String? = null,
    val months: List<StatsMonthBar> = emptyList(),
    /** The mounted tire set and the next tasks come from the all-time numbers. */
    val mountedTire: String? = null,
    val tasks: List<StatsTaskRow> = emptyList(),
)

/** The numbers of a vehicle per year: costs by category, distance, cost per distance, the next tasks. */
class VehicleStatsStore(
    private val app: HauswartApp,
    private val assetId: String,
) : Store<VehicleStatsState>(VehicleStatsState()) {
    init {
        onChange(app, "vehicles", "costs", "tasks") { load(current.year) }
        load(0)
    }

    fun refresh() {
        load(current.year)
    }

    fun selectYear(year: Int) {
        if (year == current.year) return
        load(year)
    }

    private fun load(wanted: Int) {
        val first = current.years.isEmpty()
        update { it.copy(loading = first, yearLoading = !first, error = null, yearError = null) }
        launch({ e ->
            update {
                it.copy(loading = false, yearLoading = false, error = if (first) e else null, yearError = if (first) null else e)
            }
        }) {
            app.household.get()
            val today = app.household.today()
            var years = current.years
            var overview: VehicleStats? = null
            if (first) {
                val vehicle = app.api.vehicles.vehiclesGet(assetId)
                val all = app.api.vehicles.vehicleStats(assetId)
                overview = all
                years =
                    vehicleStatsYears(
                        today,
                        listOf(all.from, vehicle.firstRegistration),
                    ).map { VehicleChoice(it.toString(), it.toString()) }
            }
            val year = if (wanted != 0) wanted else today.take(4).toInt()
            val stats = app.api.vehicles.vehicleStats(assetId, year = year.toLong())
            val costs = stats.costs
            val unit = stats.odometerUnit
            val maxMonth = stats.distanceByMonth.maxOfOrNull { it.distance } ?: 0.0
            val tireSet = (overview ?: stats).tireSet
            val tasks = (overview ?: stats).nextTasks
            update {
                it.copy(
                    loading = false,
                    yearLoading = false,
                    years =
                        if (years.any { c -> c.value == year.toString() }) {
                            years
                        } else {
                            listOf(VehicleChoice(year.toString(), year.toString())) +
                                years
                        },
                    year = year,
                    emptyTitle = tr("vehicle_costs_empty_title", "year" to year),
                    empty = costs.count == 0L && stats.distance == 0.0 && costs.otherCurrencyCount == 0L,
                    totalText = Money.format(costs.totalMinor, costs.currency),
                    countText = tr("vehicle_costs_count", "count" to costs.count),
                    distanceText = odometerText(stats.distance.roundToLong().toDouble(), unit),
                    perDistanceLabel = tr("vehicle_costs_per_distance", "unit" to unit),
                    perDistanceText = stats.costPerDistanceMinor?.let { c -> rateText(c, costs.currency, unit) },
                    categories =
                        costs.byCategory.map { row ->
                            val percent = vehicleCostShare(costs.totalMinor, row.totalMinor)
                            StatsCategoryRow(
                                costCategoryLabel(row.category),
                                Money.format(row.totalMinor, costs.currency),
                                maxOf(2, percent) / 100.0,
                                "$percent %",
                            )
                        },
                    otherCurrencyText =
                        if (costs.otherCurrencyCount > 0) {
                            tr("vehicle_costs_other_currency", "count" to costs.otherCurrencyCount, "currency" to costs.currency)
                        } else {
                            null
                        },
                    months =
                        if (maxMonth > 0) {
                            stats.distanceByMonth.map { m ->
                                StatsMonthBar(
                                    "${m.month.drop(5)}.${m.month.drop(2).take(2)}",
                                    odometerText(m.distance.roundToLong().toDouble(), unit),
                                    m.distance / maxMonth,
                                )
                            }
                        } else {
                            emptyList()
                        },
                    mountedTire =
                        tireSet?.let { s ->
                            tr(
                                "tire_card_mounted",
                                "name" to tireSetTitle(s.season, s.size),
                                "date" to (s.mountedOn?.let { d -> Dates.format(d) } ?: ""),
                            )
                        },
                    tasks = tasks.map { t -> StatsTaskRow(t.taskId, t.title, t.date?.let { d -> Dates.format(d) }) },
                )
            }
        }
    }
}
