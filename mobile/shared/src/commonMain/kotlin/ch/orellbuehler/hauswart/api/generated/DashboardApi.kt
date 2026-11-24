// Generated from docs/openapi.json by `bun run mobile:api`. Do not edit.
@file:OptIn(ExperimentalSerializationApi::class)

package ch.orellbuehler.hauswart.api.generated

import ch.orellbuehler.hauswart.api.ApiHttp
import ch.orellbuehler.hauswart.api.BinaryBody
import ch.orellbuehler.hauswart.api.Patch
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

class DashboardApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Overview for the start page
     *
     * Overdue, today, this week, later (60 days) and signal-based tasks, relevant preparations and the last completions. openDefects: defects that need attention, by deadline. expiringWarranties: warranties ending within 90 days or ended at most 30 days ago. orderNow: parts to order now (same items as GET /parts/order-now). costsYearToDate: what the year has cost so far, all books together and per book (`byBook`; household currency, entries that count as an expense; the same numbers as GET /costs/summary), without any settlement. balances: where the caller stands across all books (`myBalanceMinor`, recorded payments included; positive means the others owe the caller) and the first three of the payments that would square everybody (`suggestedPaymentCount` says how many there are), read from the same ledger as GET /costs/balances. `balances` is null when they could not be worked out right now (the failure is logged by error name and code); the rest of the dashboard is still answered. budgetAlerts: how many budgets are over their amount (`exceeded`) or from 80 % up (`warning`) this month (monthly budgets) and this year (yearly ones), as `GET /costs/budgets/status` measures them, and the three most urgent in `top` (exceeded before warning, then the higher share used; each with its book, category, period, amount, spent, `percentUsed` and `state`). Household data, the same for every member; all zeros and an empty `top` while every budget is within its amount, and null, like `balances`, when it could not be worked out right now (logged as `dashboard.budget_alerts_failed`).
     */
    suspend fun dashboard(): Dashboard =
        http.json("GET", "/api/v1/dashboard", emptyList(), Dashboard.serializer())

    /**
     * Completions per person and category
     *
     * By completion date between from and to (default: the last 90 days, at most 800 days).
     */
    suspend fun stats(
        from: String? = null,
        to: String? = null,
    ): Stats =
        http.json("GET", "/api/v1/stats", listOf("from" to from, "to" to to), Stats.serializer())
}
