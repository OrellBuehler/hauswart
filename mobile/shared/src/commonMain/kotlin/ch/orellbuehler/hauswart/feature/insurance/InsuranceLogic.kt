package ch.orellbuehler.hauswart.feature.insurance

import ch.orellbuehler.hauswart.api.generated.InsurancePoliciesCreateRequest
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.relativeDays
import ch.orellbuehler.hauswart.core.shortDate
import ch.orellbuehler.hauswart.feature.dashboard.TONE_DUE
import ch.orellbuehler.hauswart.feature.dashboard.TONE_MUTED
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OVERDUE
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.plus

val INSURANCE_TYPES: List<String> = InsurancePoliciesCreateRequest.TYPE_VALUES
val INSURANCE_PERIODS: List<String> = InsurancePoliciesCreateRequest.PREMIUM_PERIOD_VALUES
val INSURANCE_RENEWALS: List<String> = InsurancePoliciesCreateRequest.RENEWAL_VALUES

/** The longest notice period the server takes. */
const val MAX_NOTICE_MONTHS = 120

/** From this many days on a deadline is "soon": about when the reminder task starts its preparation. */
const val DEADLINE_SOON_DAYS = 30

fun insuranceTypeLabel(type: String): String = if (type in INSURANCE_TYPES) tr("insurance_type_$type") else type

fun insurancePeriodLabel(period: String): String = if (period in INSURANCE_PERIODS) tr("insurance_period_$period") else period

fun insurancePerLabel(period: String): String = if (period in INSURANCE_PERIODS) tr("insurance_per_$period") else period

fun insuranceRenewalLabel(renewal: String): String = if (renewal in INSURANCE_RENEWALS) tr("insurance_renewal_$renewal") else renewal

/** How many premium payments make a year. */
fun periodsPerYear(period: String): Int =
    when (period) {
        "monthly" -> 12
        "quarterly" -> 4
        "semiannual" -> 2
        else -> 1
    }

/** The premium of a whole year in minor units; the premium is per period, so this is exact. */
fun annualPremiumMinor(
    premiumMinor: Long,
    period: String,
): Long = premiumMinor * periodsPerYear(period)

private fun monthEnd(date: LocalDate): LocalDate =
    LocalDate(date.year, date.month, 1).plus(DatePeriod(months = 1)).plus(DatePeriod(days = -1))

/**
 * The last day a cancellation still counts: the end date minus the notice months, clamped to the end
 * of a shorter month; an end date that is the last day of its month stays at the end of the month
 * (30 June and 3 months give 31 March). Only a policy that renews by itself, with an end date and a
 * notice period, has one; otherwise null.
 */
fun cancellationDeadline(
    renewal: String,
    endDate: String?,
    noticeMonths: Int?,
): String? {
    if (renewal != "auto" || endDate == null || noticeMonths == null) return null
    val end = Dates.parse(endDate) ?: return null
    val earlier = end.plus(DatePeriod(months = -noticeMonths))
    return (if (end == monthEnd(end)) monthEnd(earlier) else earlier).toString()
}

/** A cancellation deadline as the screens say it: [text] with [tone] (`overdue`, `due` or `muted`). */
data class DeadlineHint(
    val text: String,
    val tone: String,
    val overdue: Boolean,
    /** Days until the deadline; negative once it has passed. */
    val days: Int,
)

/** How pressing [deadline] is on [today]; null for a policy without one. */
fun deadlineHint(
    deadline: String?,
    today: String,
): DeadlineHint? {
    if (deadline == null) return null
    val days = Dates.diffDays(today, deadline)
    val date = shortDate(deadline, today)
    return when {
        days < 0 ->
            DeadlineHint(
                tr("insurance_deadline_overdue") + " · " + date + " · " + relativeDays(days),
                TONE_OVERDUE,
                true,
                days,
            )
        else ->
            DeadlineHint(
                tr("insurance_deadline_cancel_by", "date" to date) + " · " + relativeDays(days),
                if (days <= DEADLINE_SOON_DAYS) TONE_DUE else TONE_MUTED,
                false,
                days,
            )
    }
}

/** The current term is over: the end date is the last day of cover. */
fun termEnded(
    endDate: String?,
    today: String,
): Boolean = endDate != null && endDate < today
