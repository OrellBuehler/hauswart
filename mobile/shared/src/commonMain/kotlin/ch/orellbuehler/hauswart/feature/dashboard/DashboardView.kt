package ch.orellbuehler.hauswart.feature.dashboard

import ch.orellbuehler.hauswart.api.generated.Dashboard
import ch.orellbuehler.hauswart.api.generated.DashboardBalances
import ch.orellbuehler.hauswart.api.generated.DashboardBudgetAlerts
import ch.orellbuehler.hauswart.api.generated.DashboardCosts
import ch.orellbuehler.hauswart.api.generated.DashboardDefect
import ch.orellbuehler.hauswart.api.generated.DashboardTask
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.dueText
import ch.orellbuehler.hauswart.core.relativeDays
import ch.orellbuehler.hauswart.core.shortDate
import ch.orellbuehler.hauswart.feature.appointments.AppointmentChip
import ch.orellbuehler.hauswart.feature.appointments.appointmentChipOf
import ch.orellbuehler.hauswart.i18n.tr
import kotlin.math.abs

const val TONE_NORMAL = "normal"
const val TONE_OVERDUE = "overdue"
const val TONE_DUE = "due"
const val TONE_OK = "ok"
const val TONE_MUTED = "muted"

const val SECTION_OVERDUE = "overdue"
const val SECTION_TODAY = "today"
const val SECTION_WEEK = "week"
const val SECTION_LATER = "later"
const val SECTION_SIGNAL = "signal"
const val SECTION_PREPARATIONS = "preparations"

const val LATER_PREVIEW = 5
private const val DEADLINE_SOON_DAYS = 30
private const val BOOKS_SHOWN = 4
private val CLOSED_DEFECTS = setOf("fixed", "rejected")

data class CountTile(
    val id: String,
    val label: String,
    val value: Long,
    val tone: String,
)

data class TaskItem(
    /** The task to open. */
    val id: String,
    val title: String,
    /** "Room · device", empty when the task belongs to neither. */
    val place: String,
    /** "in 3 days · 24 Nov", empty for a task without a date (it becomes due by a condition). */
    val whenText: String,
    val assignee: String?,
    val statusLabel: String,
    val tone: String,
    /** The earliest planned appointment of the task, null without one. */
    val appointment: AppointmentChip? = null,
    /** Completing it asks for an odometer reading first, so it cannot be done with one tap. */
    val needsReading: Boolean = false,
    /** A task can be completed, skipped and snoozed from its row; a preparation row only opens its task. */
    val actionable: Boolean = true,
)

data class TaskSection(
    val id: String,
    val title: String,
    val tone: String,
    val total: Int,
    val items: List<TaskItem>,
    /** More items than shown, offered through [DashboardStore.toggleLater]. */
    val collapsible: Boolean = false,
    val expanded: Boolean = false,
)

data class RecentItem(
    val id: String,
    val taskId: String,
    val title: String,
    val detail: String,
)

data class DefectItem(
    val id: String,
    val title: String,
    val number: Long,
    val place: String,
    val statusLabel: String,
    val severityLabel: String,
    val deadlineText: String,
    val deadlineTone: String,
)

data class DefectsCard(
    val items: List<DefectItem>,
    val total: Int,
    val moreLabel: String,
)

data class WarrantyItem(
    val id: String,
    val assetId: String,
    val title: String,
    val wording: String,
    val date: String?,
    val tone: String,
)

data class OrderItem(
    val id: String,
    val partId: String,
    val partName: String,
    val quantity: String,
    val neededBy: String,
    val taskTitle: String,
    val lateLabel: String?,
)

data class BookLine(
    val id: String,
    val name: String,
    val total: String,
)

data class CostsCard(
    val youLine: String?,
    val youTone: String,
    val balancesUnavailable: Boolean,
    val squareText: String?,
    val payments: List<String>,
    val morePayments: String?,
    val yearLabel: String,
    val yearTotal: String,
    val books: List<BookLine>,
    val moreBooks: String?,
    val budgetText: String?,
    val budgetExceeded: Boolean,
)

data class DashboardView(
    val tiles: List<CountTile>,
    val sections: List<TaskSection>,
    val recent: List<RecentItem>,
    val defects: DefectsCard?,
    val warranties: List<WarrantyItem>,
    val orderNow: List<OrderItem>,
    val costs: CostsCard?,
) {
    /** Nothing to do: no task in any section and no preparation. */
    val nothingToDo: Boolean get() = sections.isEmpty()
}

fun dashboardView(
    dashboard: Dashboard,
    laterExpanded: Boolean,
    timezone: String,
): DashboardView {
    val today = dashboard.today
    val up = dashboard.upcoming
    val later = up.later
    val sections =
        listOfNotNull(
            taskSection(SECTION_OVERDUE, tr("dashboard_overdue"), TONE_OVERDUE, up.overdue, today, timezone),
            taskSection(SECTION_TODAY, tr("dashboard_today"), TONE_NORMAL, up.today, today, timezone),
            taskSection(SECTION_WEEK, tr("dashboard_this_week"), TONE_NORMAL, up.thisWeek, today, timezone),
            taskSection(
                SECTION_LATER,
                tr("dashboard_later"),
                TONE_NORMAL,
                if (laterExpanded) later else later.take(LATER_PREVIEW),
                today,
                timezone,
                total = later.size,
                collapsible = later.size > LATER_PREVIEW,
                expanded = laterExpanded,
            ),
            taskSection(SECTION_SIGNAL, tr("dashboard_signal"), TONE_NORMAL, up.signalBased, today, timezone),
            preparationSection(dashboard),
        )
    return DashboardView(
        tiles =
            listOf(
                CountTile(
                    SECTION_OVERDUE,
                    tr("dashboard_overdue"),
                    dashboard.counts.overdue,
                    if (dashboard.counts.overdue >
                        0
                    ) {
                        TONE_OVERDUE
                    } else {
                        TONE_NORMAL
                    },
                ),
                CountTile(SECTION_TODAY, tr("dashboard_today"), dashboard.counts.today, TONE_NORMAL),
                CountTile(SECTION_WEEK, tr("dashboard_this_week"), dashboard.counts.thisWeek, TONE_NORMAL),
            ),
        sections = sections,
        recent =
            dashboard.recentCompletions.map { c ->
                val who = c.userName
                val at = Dates.dateTime(c.completedAt, timezone)
                RecentItem(c.id, c.taskId, c.taskTitle, if (who.isNullOrBlank()) at else "$who · $at")
            },
        defects = defectsCard(dashboard.openDefects, today),
        warranties =
            dashboard.expiringWarranties.map { w ->
                WarrantyItem(
                    id = w.id,
                    assetId = w.assetId,
                    title = w.title,
                    wording =
                        when {
                            w.daysLeft == 0L -> tr("warranty_today")
                            w.daysLeft < 0 -> tr("warranty_days_ago", "days" to -w.daysLeft)
                            else -> tr("warranty_days_left", "days" to w.daysLeft)
                        },
                    date = w.date?.let { Dates.format(it) },
                    tone = if (w.status == "expired") TONE_OVERDUE else TONE_DUE,
                )
            },
        orderNow =
            dashboard.orderNow.map { o ->
                OrderItem(
                    id = o.id,
                    partId = o.partId,
                    partName = o.partName,
                    quantity = tr("dashboard_order_quantity", "quantity" to o.quantity),
                    neededBy = tr("dashboard_order_needed_by", "date" to shortDate(o.neededBy, today)),
                    taskTitle = o.taskTitle,
                    lateLabel = if (o.late) tr("dashboard_order_late") else null,
                )
            },
        costs = costsCard(dashboard.costsYearToDate, dashboard.balances, dashboard.budgetAlerts),
    )
}

fun taskTone(status: String): String =
    when (status) {
        "overdue" -> TONE_OVERDUE
        "due" -> TONE_DUE
        "ok" -> TONE_OK
        else -> TONE_MUTED
    }

fun taskStatusLabel(status: String): String = if (status in DashboardTask.STATUS_VALUES) tr("status_$status") else tr("status_unknown")

private fun taskSection(
    id: String,
    title: String,
    tone: String,
    tasks: List<DashboardTask>,
    today: String,
    timeZone: String,
    total: Int = tasks.size,
    collapsible: Boolean = false,
    expanded: Boolean = false,
): TaskSection? {
    if (total == 0) return null
    return TaskSection(id, title, tone, total, tasks.map { taskItem(it, today, timeZone) }, collapsible, expanded)
}

private fun taskItem(
    task: DashboardTask,
    today: String,
    timeZone: String,
): TaskItem =
    TaskItem(
        id = task.taskId,
        title = task.title,
        place = listOfNotNull(task.roomName, task.assetName).joinToString(" · "),
        whenText = task.date?.let { dueText(it, today, task.estimated) } ?: "",
        assignee = task.assigneeName,
        statusLabel = taskStatusLabel(task.status),
        tone = taskTone(task.status),
        appointment = appointmentChipOf(task.nextAppointment, timeZone, today),
        needsReading = task.odometerAssetId != null,
    )

private fun preparationSection(dashboard: Dashboard): TaskSection? {
    val preps = dashboard.preparations
    if (preps.isEmpty()) return null
    val items =
        preps.map { p ->
            TaskItem(
                id = p.taskId,
                title = p.title,
                place = tr("dashboard_prep_for") + " " + p.taskTitle,
                whenText = p.date?.let { tr("dashboard_prep_due", "when" to dueText(it, dashboard.today)) } ?: "",
                assignee = null,
                statusLabel = "",
                tone = if (p.state == "now") TONE_DUE else TONE_MUTED,
                actionable = false,
            )
        }
    return TaskSection(SECTION_PREPARATIONS, tr("dashboard_preparations"), TONE_NORMAL, items.size, items)
}

/** The deadline of a defect: overdue once past, soon within 30 days; closed defects have no urgency. */
fun defectDeadline(
    date: String?,
    status: String,
    today: String,
): Pair<String, String> {
    if (date == null) return tr("defect_deadline_none") to TONE_MUTED
    val days = Dates.diffDays(today, date)
    val text = shortDate(date, today) + " · " + relativeDays(days)
    return when {
        status in CLOSED_DEFECTS -> text to TONE_MUTED
        days < 0 -> (tr("defect_deadline_overdue") + " · " + text) to TONE_OVERDUE
        days <= DEADLINE_SOON_DAYS -> text to TONE_DUE
        else -> text to TONE_MUTED
    }
}

private fun defectsCard(
    defects: List<DashboardDefect>,
    today: String,
): DefectsCard? {
    if (defects.isEmpty()) return null
    val shown = defects.take(LATER_PREVIEW)
    return DefectsCard(
        items =
            shown.map { d ->
                val (deadline, tone) = defectDeadline(d.date, d.status, today)
                DefectItem(
                    id = d.id,
                    title = d.title,
                    number = d.number,
                    place = listOfNotNull(d.roomName, d.assetName).joinToString(" · "),
                    statusLabel = if (d.status in DashboardDefect.STATUS_VALUES) tr("defect_status_${d.status}") else d.status,
                    severityLabel = if (d.severity in DashboardDefect.SEVERITY_VALUES) tr("defect_severity_${d.severity}") else d.severity,
                    deadlineText = deadline,
                    deadlineTone = tone,
                )
            },
        total = defects.size,
        moreLabel =
            if (defects.size > LATER_PREVIEW) tr("dashboard_all_defects", "count" to defects.size) else tr("dashboard_to_defects"),
    )
}

/** "2 budgets exceeded, 1 nearly used up"; empty while every budget is within its amount. */
fun budgetAlertText(alerts: DashboardBudgetAlerts): String =
    when {
        alerts.exceeded > 0 && alerts.warning > 0 -> tr("budget_alert_both", "exceeded" to alerts.exceeded, "warning" to alerts.warning)
        alerts.exceeded > 0 -> tr("budget_alert_exceeded", "count" to alerts.exceeded)
        alerts.warning > 0 -> tr("budget_alert_warning", "count" to alerts.warning)
        else -> ""
    }

private fun costsCard(
    costs: DashboardCosts,
    balances: DashboardBalances?,
    alerts: DashboardBudgetAlerts?,
): CostsCard? {
    val state =
        when {
            balances == null -> "unavailable"
            balances.suggestedPaymentCount > 0 -> "open"
            balances.hasActivity -> "square"
            else -> "empty"
        }
    if (costs.totalMinor == 0L && state == "empty") return null
    val you =
        balances?.takeIf { state != "empty" }?.let {
            val amount = Money.format(abs(it.myBalanceMinor), it.currency)
            when {
                it.myBalanceMinor > 0 -> tr("balances_you_get", "amount" to amount) to TONE_OK
                it.myBalanceMinor < 0 -> tr("balances_you_owe", "amount" to amount) to TONE_OVERDUE
                else -> tr("balances_you_even") to TONE_NORMAL
            }
        }
    val payments =
        if (balances != null && state == "open") {
            balances.suggestedPayments.map {
                tr(
                    "balances_owes_sentence",
                    "from" to (it.fromName ?: tr("cost_person_unknown")),
                    "to" to (it.toName ?: tr("cost_person_unknown")),
                    "amount" to Money.format(it.amountMinor, balances.currency),
                )
            }
        } else {
            emptyList()
        }
    val morePayments = balances?.let { it.suggestedPaymentCount - it.suggestedPayments.size }?.takeIf { it > 0 }
    val moreBooks = (costs.byBook.size - BOOKS_SHOWN).takeIf { it > 0 }
    val budget = alerts?.let { budgetAlertText(it) }?.takeIf { it.isNotEmpty() }
    return CostsCard(
        youLine = you?.first,
        youTone = you?.second ?: TONE_NORMAL,
        balancesUnavailable = state == "unavailable",
        squareText = if (state == "square") tr("balances_square") else null,
        payments = payments,
        morePayments = morePayments?.let { tr("dashboard_costs_more_payments", "count" to it) },
        yearLabel = tr("dashboard_costs_year", "year" to costs.year),
        yearTotal = Money.format(costs.totalMinor, costs.currency),
        books =
            if (costs.byBook.size > 1) {
                costs.byBook.take(BOOKS_SHOWN).map {
                    val name = if (it.archived) it.bookName + " (" + tr("costbook_archived_badge") + ")" else it.bookName
                    BookLine(it.bookId, name, Money.format(it.totalMinor, costs.currency))
                }
            } else {
                emptyList()
            },
        moreBooks = moreBooks?.let { tr("dashboard_costs_more_books", "count" to it) },
        budgetText = budget,
        budgetExceeded = (alerts?.exceeded ?: 0) > 0,
    )
}
