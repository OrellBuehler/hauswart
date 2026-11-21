// Generated from docs/openapi.json by `bun run mobile:api`. Do not edit.
@file:OptIn(ExperimentalSerializationApi::class)

package ch.orellbuehler.hauswart.api.generated

import ch.orellbuehler.hauswart.api.Patch
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

@Serializable
data class ErrorEnvelopeError(
    /** unauthenticated | forbidden | invalid_request | not_found | conflict | rate_limited | csrf_failed | gone | upstream_error | setup_required | setup_complete | invalid_credentials | internal */
    val code: String,
    val message: String,
    val details: JsonElement? = null,
) {
    companion object {
        val CODE_VALUES: List<String> = listOf("unauthenticated", "forbidden", "invalid_request", "not_found", "conflict", "rate_limited", "csrf_failed", "gone", "upstream_error", "setup_required", "setup_complete", "invalid_credentials", "internal")
    }
}

@Serializable
data class ErrorEnvelope(
    val error: ErrorEnvelopeError,
)

@Serializable
data class User(
    val id: String,
    val username: String,
    val displayName: String?,
    /** admin | member */
    val role: String,
    /** de | en */
    val locale: String,
) {
    companion object {
        val ROLE_VALUES: List<String> = listOf("admin", "member")
        val LOCALE_VALUES: List<String> = listOf("de", "en")
    }
}

@Serializable
data class ApiToken(
    val id: String,
    /** mobile | integration | ha | mcp */
    val kind: String,
    val name: String,
    val prefix: String,
    /** read | write | docs:write | costs:write | ha:action | admin */
    val scopes: List<String>,
    /** date-time */
    val lastUsedAt: String?,
    /** date-time */
    val expiresAt: String?,
    /** date-time */
    val createdAt: String,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("mobile", "integration", "ha", "mcp")
        val SCOPES_VALUES: List<String> = listOf("read", "write", "docs:write", "costs:write", "ha:action", "admin")
    }
}

@Serializable
data class CreatedApiToken(
    val id: String,
    /** mobile | integration | ha | mcp */
    val kind: String,
    val name: String,
    val prefix: String,
    /** read | write | docs:write | costs:write | ha:action | admin */
    val scopes: List<String>,
    /** date-time */
    val lastUsedAt: String?,
    /** date-time */
    val expiresAt: String?,
    /** date-time */
    val createdAt: String,
    val token: String,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("mobile", "integration", "ha", "mcp")
        val SCOPES_VALUES: List<String> = listOf("read", "write", "docs:write", "costs:write", "ha:action", "admin")
    }
}

@Serializable
data class AdminUser(
    val id: String,
    val username: String,
    val displayName: String?,
    /** admin | member */
    val role: String,
    /** de | en */
    val locale: String,
    val ownershipBps: Long,
    /** date-time */
    val createdAt: String,
) {
    companion object {
        val ROLE_VALUES: List<String> = listOf("admin", "member")
        val LOCALE_VALUES: List<String> = listOf("de", "en")
    }
}

@Serializable
data class Room(
    val id: String,
    val name: String,
    val slug: String,
    val haAreaId: String?,
    val icon: String?,
    val sortOrder: Long,
    val notes: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
)

@Serializable
data class RoomAreaImportItemsItem(
    val areaId: String,
    /** created | linked | unchanged | not_found */
    val outcome: String,
    val room: Room?,
) {
    companion object {
        val OUTCOME_VALUES: List<String> = listOf("created", "linked", "unchanged", "not_found")
    }
}

@Serializable
data class RoomAreaImport(
    val items: List<RoomAreaImportItemsItem>,
)

@Serializable
data class Asset(
    val id: String,
    /** device | plant | fixture | vehicle | other */
    val kind: String,
    val name: String,
    val slug: String,
    val qrSlug: String,
    val roomId: String?,
    val roomName: String?,
    val category: String?,
    val manufacturer: String?,
    val model: String?,
    val serialNumber: String?,
    /** date */
    val purchaseDate: String?,
    /** date */
    val installedDate: String?,
    /** date */
    val warrantyUntil: String?,
    /** date */
    val warrantyExtendedUntil: String?,
    /** manual | document */
    val warrantySource: String,
    val showOnEmergency: Boolean,
    val notes: String?,
    val species: String?,
    val light: String?,
    val waterNotes: String?,
    val photoAttachmentId: String?,
    val photoUrl: String?,
    val externalSource: String?,
    val externalRef: String?,
    /** date-time */
    val archivedAt: String?,
    val commentCount: Long,
    val vehicle: VehicleSummary? = null,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("device", "plant", "fixture", "vehicle", "other")
        val WARRANTY_SOURCE_VALUES: List<String> = listOf("manual", "document")
    }
}

@Serializable
data class VehicleSummary(
    val plate: String?,
    val odometer: OdometerSummary?,
)

@Serializable
data class OdometerSummary(
    val value: Double,
    /** date */
    val date: String,
    /** km | mi */
    val unit: String,
) {
    companion object {
        val UNIT_VALUES: List<String> = listOf("km", "mi")
    }
}

@Serializable
data class Task(
    val id: String,
    val title: String,
    val descriptionMd: String,
    /** cleaning | maintenance | filter | plant | waste | inspection | payment | order | warranty | defect | other */
    val category: String,
    /** low | normal | high */
    val priority: String,
    val effortMinutes: Long?,
    val assetId: String?,
    val assetName: String?,
    val roomId: String?,
    val roomName: String?,
    val trigger: Trigger,
    /** none | fixed | rotate */
    val assignMode: String,
    val assigneeUserId: String?,
    val rotationOrder: List<String>,
    /** alternate | fair */
    val rotationStrategy: String,
    /** assignee | all */
    val notifyMode: String,
    val graceDays: Long,
    val dueSoonDays: Long?,
    /** date */
    val snoozedUntil: String?,
    /** date-time */
    val archivedAt: String?,
    /** manual | seed | kept | paperless | ha | mcp | system */
    val source: String,
    val externalSource: String?,
    val externalRef: String?,
    val externalUrl: String?,
    val createdBy: String?,
    val commentCount: Long,
    val openNoteCount: Long,
    val nextAppointment: NextAppointment?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
    val state: TaskState?,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("cleaning", "maintenance", "filter", "plant", "waste", "inspection", "payment", "order", "warranty", "defect", "other")
        val PRIORITY_VALUES: List<String> = listOf("low", "normal", "high")
        val ASSIGN_MODE_VALUES: List<String> = listOf("none", "fixed", "rotate")
        val ROTATION_STRATEGY_VALUES: List<String> = listOf("alternate", "fair")
        val NOTIFY_MODE_VALUES: List<String> = listOf("assignee", "all")
        val SOURCE_VALUES: List<String> = listOf("manual", "seed", "kept", "paperless", "ha", "mcp", "system")
    }
}

@Serializable
data class TriggerIntervalSeasonsItem(
    val fromMonth: Long,
    val toMonth: Long,
    val every: Long,
    /** day | week | month | year */
    val unit: String,
) {
    companion object {
        val UNIT_VALUES: List<String> = listOf("day", "week", "month", "year")
    }
}

@Serializable
sealed class TriggerIntervalAutoCompleteItem {
    @Serializable
    @SerialName("counter_reset")
    data class CounterReset(
        val entityId: String,
        val minDrop: Double,
    ) : TriggerIntervalAutoCompleteItem()

    @Serializable
    @SerialName("state_change")
    data class StateChange(
        val entityId: String,
        val to: String,
        val from: String? = null,
    ) : TriggerIntervalAutoCompleteItem()

    @Serializable
    data object Unknown : TriggerIntervalAutoCompleteItem()
}

@Serializable
data class TriggerCounterDeltaOrEvery(
    val every: Long,
    /** day | week | month | year */
    val unit: String,
) {
    companion object {
        val UNIT_VALUES: List<String> = listOf("day", "week", "month", "year")
    }
}

@Serializable
data class TriggerCounterDeltaAutoCompleteOnReset(
    val minDrop: Double,
)

@Serializable
data class TriggerStateConditionEstimateFrom(
    val entityId: String,
    val target: Double,
    /** down | up */
    val direction: String,
) {
    companion object {
        val DIRECTION_VALUES: List<String> = listOf("down", "up")
    }
}

@Serializable
sealed class Trigger {
    @Serializable
    @SerialName("interval")
    data class Interval(
        @EncodeDefault val v: Long = 1,
        val every: Long,
        /** day | week | month | year */
        val unit: String,
        /** completion | schedule */
        val anchor: String,
        val startDate: String,
        val seasons: List<TriggerIntervalSeasonsItem>? = null,
        val autoComplete: List<TriggerIntervalAutoCompleteItem>? = null,
    ) : Trigger() {
        companion object {
            val UNIT_VALUES: List<String> = listOf("day", "week", "month", "year")
            val ANCHOR_VALUES: List<String> = listOf("completion", "schedule")
        }
    }

    @Serializable
    @SerialName("calendar")
    data class Calendar(
        @EncodeDefault val v: Long = 1,
        /** weekly | monthly | yearly */
        val freq: String,
        val interval: Long,
        val byWeekday: List<Long>? = null,
        val byMonthDay: Long? = null,
        val nth: Long? = null,
        val byMonth: List<Long>? = null,
        val startDate: String,
        val earlyDays: Long? = null,
        val autoComplete: List<TriggerIntervalAutoCompleteItem>? = null,
    ) : Trigger() {
        companion object {
            val FREQ_VALUES: List<String> = listOf("weekly", "monthly", "yearly")
        }
    }

    @Serializable
    @SerialName("min_per_period")
    data class MinPerPeriod(
        @EncodeDefault val v: Long = 1,
        /** week | month | quarter | year */
        val period: String,
        val count: Long,
        val remindFromFraction: Double? = null,
        val startDate: String? = null,
        val autoComplete: List<TriggerIntervalAutoCompleteItem>? = null,
    ) : Trigger() {
        companion object {
            val PERIOD_VALUES: List<String> = listOf("week", "month", "quarter", "year")
        }
    }

    @Serializable
    @SerialName("counter_delta")
    data class CounterDelta(
        @EncodeDefault val v: Long = 1,
        val entityId: String,
        val threshold: Double,
        val unit: String? = null,
        val orEvery: TriggerCounterDeltaOrEvery? = null,
        val autoCompleteOnReset: TriggerCounterDeltaAutoCompleteOnReset? = null,
        val autoComplete: List<TriggerIntervalAutoCompleteItem>? = null,
    ) : Trigger()

    @Serializable
    @SerialName("state_condition")
    data class StateCondition(
        @EncodeDefault val v: Long = 1,
        val entityId: String,
        /** eq | ne | gt | gte | lt | lte */
        val op: String,
        val value: JsonElement,
        val forMinutes: Long? = null,
        val autoComplete: List<TriggerIntervalAutoCompleteItem>? = null,
        val estimateFrom: TriggerStateConditionEstimateFrom? = null,
    ) : Trigger() {
        companion object {
            val OP_VALUES: List<String> = listOf("eq", "ne", "gt", "gte", "lt", "lte")
        }
    }

    @Serializable
    @SerialName("ha_calendar")
    data class HaCalendar(
        @EncodeDefault val v: Long = 1,
        val entityId: String,
        val summaryMatch: String? = null,
        val offsetDays: Long,
        val time: String? = null,
        val autoComplete: List<TriggerIntervalAutoCompleteItem>? = null,
    ) : Trigger()

    @Serializable
    @SerialName("one_off")
    data class OneOff(
        @EncodeDefault val v: Long = 1,
        val date: String,
    ) : Trigger()

    @Serializable
    @SerialName("kept_bill")
    data class KeptBill(
        @EncodeDefault val v: Long = 1,
        val billId: String,
        val dueDate: String,
        /** open | paid | cancelled | overdue */
        val status: String,
    ) : Trigger() {
        companion object {
            val STATUS_VALUES: List<String> = listOf("open", "paid", "cancelled", "overdue")
        }
    }

    @Serializable
    @SerialName("warranty")
    data class Warranty(
        @EncodeDefault val v: Long = 1,
        val until: String,
        val extendedUntil: String? = null,
        val leadDays: Long? = null,
    ) : Trigger()

    @Serializable
    data object Unknown : Trigger()
}

@Serializable
data class NextAppointment(
    val id: String,
    val allDay: Boolean,
    /** date-time */
    val startsAt: String?,
    /** date */
    val startDate: String?,
)

@Serializable
data class TaskStateProgress(
    val current: Double,
    val target: Double,
    val unit: String? = null,
)

@Serializable
data class TaskStateEstimate(
    /** date */
    val date: String,
    /** low | medium */
    val confidence: String,
) {
    companion object {
        val CONFIDENCE_VALUES: List<String> = listOf("low", "medium")
    }
}

@Serializable
data class TaskState(
    /** ok | open | due | overdue | snoozed | unknown */
    val status: String,
    /** date */
    val dueDate: String?,
    /** exact | deadline | estimated | condition | none */
    val dueKind: String,
    val occurrenceKey: String,
    /** date */
    val windowStart: String?,
    val progress: TaskStateProgress?,
    val estimate: TaskStateEstimate?,
    val missedCount: Long,
    /** never_completed | completed | skipped | snoozed | seasonal_boundary | missed_occurrences | period_satisfied | missed_previous_period | signal_missing | signal_stale | signal_unavailable | baseline_missing | counter_reset | condition_pending | condition_active | acknowledged | estimate_from_history | no_upcoming_events | no_occurrences | bill_cancelled | bill_overdue | warranty_expired | expired_archive */
    val reasons: List<String>,
    val currentAssigneeUserId: String?,
    /** date-time */
    val evaluatedAt: String,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("ok", "open", "due", "overdue", "snoozed", "unknown")
        val DUE_KIND_VALUES: List<String> = listOf("exact", "deadline", "estimated", "condition", "none")
        val REASONS_VALUES: List<String> = listOf("never_completed", "completed", "skipped", "snoozed", "seasonal_boundary", "missed_occurrences", "period_satisfied", "missed_previous_period", "signal_missing", "signal_stale", "signal_unavailable", "baseline_missing", "counter_reset", "condition_pending", "condition_active", "acknowledged", "estimate_from_history", "no_upcoming_events", "no_occurrences", "bill_cancelled", "bill_overdue", "warranty_expired", "expired_archive")
    }
}

@Serializable
data class DueResultEstimate(
    /** date */
    val date: String,
    /** low | medium */
    val confidence: String,
) {
    companion object {
        val CONFIDENCE_VALUES: List<String> = listOf("low", "medium")
    }
}

@Serializable
data class DueResult(
    /** ok | open | due | overdue | snoozed | unknown */
    val status: String,
    /** date */
    val dueDate: String?,
    /** exact | deadline | estimated | condition | none */
    val dueKind: String,
    /** date */
    val windowStart: String? = null,
    val occurrenceKey: String,
    val progress: TaskStateProgress? = null,
    val estimate: DueResultEstimate? = null,
    val missedCount: Long? = null,
    /** never_completed | completed | skipped | snoozed | seasonal_boundary | missed_occurrences | period_satisfied | missed_previous_period | signal_missing | signal_stale | signal_unavailable | baseline_missing | counter_reset | condition_pending | condition_active | acknowledged | estimate_from_history | no_upcoming_events | no_occurrences | bill_cancelled | bill_overdue | warranty_expired | expired_archive */
    val reasons: List<String>,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("ok", "open", "due", "overdue", "snoozed", "unknown")
        val DUE_KIND_VALUES: List<String> = listOf("exact", "deadline", "estimated", "condition", "none")
        val REASONS_VALUES: List<String> = listOf("never_completed", "completed", "skipped", "snoozed", "seasonal_boundary", "missed_occurrences", "period_satisfied", "missed_previous_period", "signal_missing", "signal_stale", "signal_unavailable", "baseline_missing", "counter_reset", "condition_pending", "condition_active", "acknowledged", "estimate_from_history", "no_upcoming_events", "no_occurrences", "bill_cancelled", "bill_overdue", "warranty_expired", "expired_archive")
    }
}

@Serializable
data class TaskDetail(
    val id: String,
    val title: String,
    val descriptionMd: String,
    /** cleaning | maintenance | filter | plant | waste | inspection | payment | order | warranty | defect | other */
    val category: String,
    /** low | normal | high */
    val priority: String,
    val effortMinutes: Long?,
    val assetId: String?,
    val assetName: String?,
    val roomId: String?,
    val roomName: String?,
    val trigger: Trigger,
    /** none | fixed | rotate */
    val assignMode: String,
    val assigneeUserId: String?,
    val rotationOrder: List<String>,
    /** alternate | fair */
    val rotationStrategy: String,
    /** assignee | all */
    val notifyMode: String,
    val graceDays: Long,
    val dueSoonDays: Long?,
    /** date */
    val snoozedUntil: String?,
    /** date-time */
    val archivedAt: String?,
    /** manual | seed | kept | paperless | ha | mcp | system */
    val source: String,
    val externalSource: String?,
    val externalRef: String?,
    val externalUrl: String?,
    val createdBy: String?,
    val commentCount: Long,
    val openNoteCount: Long,
    val nextAppointment: NextAppointment?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
    val state: TaskState?,
    val preparations: List<Preparation>,
    val recentCompletions: List<Completion>,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("cleaning", "maintenance", "filter", "plant", "waste", "inspection", "payment", "order", "warranty", "defect", "other")
        val PRIORITY_VALUES: List<String> = listOf("low", "normal", "high")
        val ASSIGN_MODE_VALUES: List<String> = listOf("none", "fixed", "rotate")
        val ROTATION_STRATEGY_VALUES: List<String> = listOf("alternate", "fair")
        val NOTIFY_MODE_VALUES: List<String> = listOf("assignee", "all")
        val SOURCE_VALUES: List<String> = listOf("manual", "seed", "kept", "paperless", "ha", "mcp", "system")
    }
}

@Serializable
data class PreparationLeadValue(
    val entityId: String,
    /** eq | ne | gt | gte | lt | lte */
    val op: String,
    val value: JsonElement,
) {
    companion object {
        val OP_VALUES: List<String> = listOf("eq", "ne", "gt", "gte", "lt", "lte")
    }
}

@Serializable
data class Preparation(
    val id: String,
    val taskId: String,
    val title: String,
    /** generic | order_part */
    val kind: String,
    val leadDays: Long?,
    val leadValue: PreparationLeadValue?,
    val partId: String?,
    val qty: Long,
    val sortOrder: Long,
    /** not_yet | now | done | in_stock_skip */
    val state: String,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("generic", "order_part")
        val STATE_VALUES: List<String> = listOf("not_yet", "now", "done", "in_stock_skip")
    }
}

@Serializable
data class Completion(
    val id: String,
    val taskId: String,
    val taskTitle: String,
    /** done | skipped */
    val kind: String,
    /** manual | qr | api | mcp | ha | notification | kept | system */
    val source: String,
    /** date-time */
    val completedAt: String,
    /** date */
    val completedDate: String,
    val userId: String?,
    val userName: String?,
    val counterValue: Double?,
    val occurrenceKey: String?,
    /** date */
    val dueDateAtCompletion: String?,
    val note: String?,
    /** date-time */
    val revokedAt: String?,
    /** date-time */
    val createdAt: String,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("done", "skipped")
        val SOURCE_VALUES: List<String> = listOf("manual", "qr", "api", "mcp", "ha", "notification", "kept", "system")
    }
}

@Serializable
data class ServiceLogEntry(
    val id: String,
    val assetId: String,
    val assetName: String,
    /** date */
    val date: String,
    /** maintenance | repair | installation | inspection | replacement | other */
    val kind: String,
    val title: String,
    val descriptionMd: String,
    val contactId: String?,
    val contactName: String?,
    val completionId: String?,
    val costMinor: Long?,
    val currency: String?,
    val costEntryId: String?,
    val costs: CostsOf,
    val odometer: Double?,
    val performedBy: String?,
    val createdBy: String?,
    val commentCount: Long,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("maintenance", "repair", "installation", "inspection", "replacement", "other")
    }
}

@Serializable
data class CostsOf(
    val totalMinor: Long,
    val count: Long,
)

@Serializable
data class DashboardCounts(
    val overdue: Long,
    val today: Long,
    val thisWeek: Long,
    val preparations: Long,
)

@Serializable
data class DashboardUpcoming(
    val overdue: List<DashboardTask>,
    val today: List<DashboardTask>,
    val thisWeek: List<DashboardTask>,
    val later: List<DashboardTask>,
    val signalBased: List<DashboardTask>,
)

@Serializable
data class Dashboard(
    /** date */
    val today: String,
    /** date-time */
    val generatedAt: String,
    val counts: DashboardCounts,
    val upcoming: DashboardUpcoming,
    val preparations: List<DashboardPreparation>,
    val recentCompletions: List<Completion>,
    val openDefects: List<DashboardDefect>,
    val expiringWarranties: List<DashboardWarranty>,
    val orderNow: List<OrderNowItem>,
    val costsYearToDate: DashboardCosts,
    val balances: DashboardBalances?,
    val budgetAlerts: DashboardBudgetAlerts?,
    val pendingFinanceSuggestions: Long,
    val reviewNeededCount: Long,
    val pendingReceiptCount: Long,
)

@Serializable
data class DashboardTaskEstimate(
    /** date */
    val date: String,
    /** low | medium */
    val confidence: String,
) {
    companion object {
        val CONFIDENCE_VALUES: List<String> = listOf("low", "medium")
    }
}

@Serializable
data class DashboardTask(
    val taskId: String,
    val title: String,
    /** cleaning | maintenance | filter | plant | waste | inspection | payment | order | warranty | defect | other */
    val category: String,
    /** low | normal | high */
    val priority: String,
    val assetId: String?,
    val assetName: String?,
    val roomId: String?,
    val roomName: String?,
    val assigneeUserId: String?,
    val assigneeName: String?,
    /** ok | open | due | overdue | snoozed | unknown */
    val status: String,
    /** exact | deadline | estimated | condition | none */
    val dueKind: String,
    /** date */
    val date: String?,
    val estimated: Boolean,
    val estimate: DashboardTaskEstimate?,
    val progress: TaskStateProgress?,
    val openNoteCount: Long,
    val odometerAssetId: String?,
    val nextAppointment: NextAppointment?,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("cleaning", "maintenance", "filter", "plant", "waste", "inspection", "payment", "order", "warranty", "defect", "other")
        val PRIORITY_VALUES: List<String> = listOf("low", "normal", "high")
        val STATUS_VALUES: List<String> = listOf("ok", "open", "due", "overdue", "snoozed", "unknown")
        val DUE_KIND_VALUES: List<String> = listOf("exact", "deadline", "estimated", "condition", "none")
    }
}

@Serializable
data class DashboardPreparation(
    val taskId: String,
    val taskTitle: String,
    val prepId: String,
    val title: String,
    /** not_yet | now | done | in_stock_skip */
    val state: String,
    /** date */
    val date: String?,
) {
    companion object {
        val STATE_VALUES: List<String> = listOf("not_yet", "now", "done", "in_stock_skip")
    }
}

@Serializable
data class DashboardDefect(
    val id: String,
    val title: String,
    /** date */
    val date: String?,
    val number: Long,
    /** open | reported | in_progress | fixed | rejected */
    val status: String,
    /** low | medium | high */
    val severity: String,
    val roomName: String?,
    val assetName: String?,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("open", "reported", "in_progress", "fixed", "rejected")
        val SEVERITY_VALUES: List<String> = listOf("low", "medium", "high")
    }
}

@Serializable
data class DashboardWarranty(
    val id: String,
    val title: String,
    /** date */
    val date: String?,
    val assetId: String,
    /** valid | expiring | expired */
    val status: String,
    val daysLeft: Long,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("valid", "expiring", "expired")
    }
}

@Serializable
data class OrderNowItem(
    val id: String,
    val title: String,
    /** date */
    val date: String,
    val taskId: String,
    val taskTitle: String,
    val partId: String,
    val partName: String,
    val quantity: Long,
    /** date */
    val neededBy: String,
    /** date */
    val orderBy: String,
    val late: Boolean,
    val stockCount: Long,
    val supplier: String?,
    val shopUrl: String?,
    val unitPriceMinor: Long?,
    val currency: String,
)

@Serializable
data class DashboardCostsByCategoryItem(
    /** repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other */
    val category: String,
    val totalMinor: Long,
    val count: Long,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("repair", "utilities", "renewal_fund", "purchase", "mortgage_interest", "mortgage_principal", "insurance", "renovation", "maintenance", "fuel", "taxes_fees", "groceries", "household", "dining", "leisure", "travel", "health", "gifts", "transport", "subscriptions", "other")
    }
}

@Serializable
data class DashboardCostsByBookItem(
    val bookId: String,
    val bookName: String,
    val taxRelevant: Boolean,
    val archived: Boolean,
    val totalMinor: Long,
    val count: Long,
)

@Serializable
data class DashboardCosts(
    val year: Long,
    val currency: String,
    val totalMinor: Long,
    val byCategory: List<DashboardCostsByCategoryItem>,
    val byBook: List<DashboardCostsByBookItem>,
)

@Serializable
data class DashboardBalancesSuggestedPaymentsItem(
    val fromUserId: String,
    val fromName: String?,
    val toUserId: String,
    val toName: String?,
    val amountMinor: Long,
)

@Serializable
data class DashboardBalances(
    val currency: String,
    val myBalanceMinor: Long,
    val hasActivity: Boolean,
    val suggestedPayments: List<DashboardBalancesSuggestedPaymentsItem>,
    val suggestedPaymentCount: Long,
)

@Serializable
data class DashboardBudgetAlerts(
    val exceeded: Long,
    val warning: Long,
    val top: List<DashboardBudgetAlert>,
)

@Serializable
data class DashboardBudgetAlert(
    val budgetId: String,
    val bookId: String?,
    val bookName: String?,
    /** repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other */
    val category: String?,
    /** month | year */
    val period: String,
    val amountMinor: Long,
    val spentMinor: Long,
    val currency: String,
    val percentUsed: Long,
    /** warning | exceeded */
    val state: String,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("repair", "utilities", "renewal_fund", "purchase", "mortgage_interest", "mortgage_principal", "insurance", "renovation", "maintenance", "fuel", "taxes_fees", "groceries", "household", "dining", "leisure", "travel", "health", "gifts", "transport", "subscriptions", "other")
        val PERIOD_VALUES: List<String> = listOf("month", "year")
        val STATE_VALUES: List<String> = listOf("warning", "exceeded")
    }
}

@Serializable
data class Stats(
    /** date */
    val from: String,
    /** date */
    val to: String,
    val total: GroupStats,
    val byUser: Map<String, GroupStats>,
    val byCategory: Map<String, GroupStats>,
)

@Serializable
data class GroupStats(
    val done: Long,
    val skipped: Long,
    val onTime: Long,
    val measurable: Long,
    val onTimeShare: Double?,
)

@Serializable
data class Notification(
    val id: String,
    /** prep | due_soon | due | overdue | digest | info | comment | hint */
    val kind: String,
    val taskId: String?,
    /** notification_prep | notification_due_soon | notification_due | notification_due_soon_notes | notification_due_notes | notification_overdue | notification_digest | notification_info | notification_comment | notification_hint */
    val titleKey: String,
    val params: NotificationParams,
    val url: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val readAt: String?,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("prep", "due_soon", "due", "overdue", "digest", "info", "comment", "hint")
        val TITLE_KEY_VALUES: List<String> = listOf("notification_prep", "notification_due_soon", "notification_due", "notification_due_soon_notes", "notification_due_notes", "notification_overdue", "notification_digest", "notification_info", "notification_comment", "notification_hint")
    }
}

typealias NotificationParams = Map<String, JsonElement>

@Serializable
data class Household(
    val name: String,
    val timezone: String,
    val currency: String,
    /** date */
    val handoverDate: String?,
    val settings: HouseholdSettings,
    /** date-time */
    val updatedAt: String,
)

@Serializable
data class HouseholdSettings(
    val dueSoonDays: Long,
    val digestTime: String,
    val defectDeadlineMonths: Long,
    val integrationHostAllowlist: List<String>? = null,
)

@Serializable
data class DirectoryUser(
    val id: String,
    val displayName: String,
    val ownershipBps: Long,
)

@Serializable
data class Contact(
    val id: String,
    /** installer | property_mgmt | manufacturer_support | emergency | utility | insurance | neighbor | seller | other */
    val kind: String,
    val name: String,
    val company: String?,
    val phone: String?,
    val email: String?,
    val url: String?,
    val address: String?,
    val notes: String?,
    val emergency: Boolean,
    val guestVisible: Boolean,
    val sortOrder: Long,
    val externalSource: String?,
    val externalRef: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("installer", "property_mgmt", "manufacturer_support", "emergency", "utility", "insurance", "neighbor", "seller", "other")
    }
}

@Serializable
data class ContactDetailAssetsItem(
    val linkId: String,
    val assetId: String,
    val assetName: String,
    /** support | installer | seller | service | other */
    val role: String,
) {
    companion object {
        val ROLE_VALUES: List<String> = listOf("support", "installer", "seller", "service", "other")
    }
}

@Serializable
data class ContactDetail(
    val id: String,
    /** installer | property_mgmt | manufacturer_support | emergency | utility | insurance | neighbor | seller | other */
    val kind: String,
    val name: String,
    val company: String?,
    val phone: String?,
    val email: String?,
    val url: String?,
    val address: String?,
    val notes: String?,
    val emergency: Boolean,
    val guestVisible: Boolean,
    val sortOrder: Long,
    val externalSource: String?,
    val externalRef: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
    val assets: List<ContactDetailAssetsItem>,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("installer", "property_mgmt", "manufacturer_support", "emergency", "utility", "insurance", "neighbor", "seller", "other")
    }
}

@Serializable
data class AssetContact(
    val id: String,
    val assetId: String,
    val contactId: String,
    /** support | installer | seller | service | other */
    val role: String,
    val contact: Contact,
) {
    companion object {
        val ROLE_VALUES: List<String> = listOf("support", "installer", "seller", "service", "other")
    }
}

@Serializable
data class Part(
    val id: String,
    val name: String,
    val partNumber: String?,
    val supplier: String?,
    val shopUrl: String?,
    val unitPriceMinor: Long?,
    val currency: String,
    val stockCount: Long,
    val minStock: Long,
    val reorderQty: Long,
    val leadTimeDays: Long,
    /** date-time */
    val orderedAt: String?,
    val orderedQty: Long,
    val lowStock: Boolean,
    val notes: String?,
    /** date-time */
    val archivedAt: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
)

@Serializable
data class PartDetailAssetsItem(
    val id: String,
    val name: String,
)

@Serializable
data class PartDetailTasksItem(
    val id: String,
    val title: String,
    val qty: Long,
)

@Serializable
data class PartDetail(
    val id: String,
    val name: String,
    val partNumber: String?,
    val supplier: String?,
    val shopUrl: String?,
    val unitPriceMinor: Long?,
    val currency: String,
    val stockCount: Long,
    val minStock: Long,
    val reorderQty: Long,
    val leadTimeDays: Long,
    /** date-time */
    val orderedAt: String?,
    val orderedQty: Long,
    val lowStock: Boolean,
    val notes: String?,
    /** date-time */
    val archivedAt: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
    val assets: List<PartDetailAssetsItem>,
    val tasks: List<PartDetailTasksItem>,
    val recentMovements: List<PartMovement>,
)

@Serializable
data class PartMovement(
    val id: String,
    val partId: String,
    val delta: Long,
    /** used | bought | correction */
    val reason: String,
    val userId: String?,
    val userName: String?,
    val completionId: String?,
    val note: String?,
    /** date-time */
    val at: String,
) {
    companion object {
        val REASON_VALUES: List<String> = listOf("used", "bought", "correction")
    }
}

@Serializable
data class AssetPart(
    val assetId: String,
    val partId: String,
    val part: Part,
)

@Serializable
data class TaskPart(
    val taskId: String,
    val partId: String,
    val qty: Long,
    val part: Part,
)

@Serializable
data class Vehicle(
    val assetId: String,
    val plate: String?,
    val vin: String?,
    val registrationNumber: String?,
    /** date */
    val firstRegistration: String?,
    /** petrol | diesel | electric | hybrid | plugin_hybrid | other */
    val fuelType: String?,
    val tireSizeSummer: String?,
    val tireSizeWinter: String?,
    val location: String?,
    /** km | mi */
    val odometerUnit: String,
    val notes: String?,
    val costBookId: String?,
    val odometer: OdometerSummary?,
    /** date-time */
    val updatedAt: String?,
) {
    companion object {
        val FUEL_TYPE_VALUES: List<String> = listOf("petrol", "diesel", "electric", "hybrid", "plugin_hybrid", "other")
        val ODOMETER_UNIT_VALUES: List<String> = listOf("km", "mi")
    }
}

@Serializable
data class VehicleStatsDistanceByMonthItem(
    val month: String,
    val distance: Double,
)

@Serializable
data class VehicleStatsCosts(
    val currency: String,
    val totalMinor: Long,
    val count: Long,
    val otherCurrencyCount: Long,
    val byCategory: List<DashboardCostsByCategoryItem>,
)

@Serializable
data class VehicleStatsConsumptionItemLastItem(
    val fillId: String,
    /** date */
    val date: String,
    val distance: Double,
    val quantity: Double,
    val consumptionPer100: Double,
)

@Serializable
data class VehicleStatsConsumptionItem(
    /** l | kWh */
    val unit: String,
    val averagePer100: Double?,
    val stretchCount: Long,
    val last: List<VehicleStatsConsumptionItemLastItem>,
) {
    companion object {
        val UNIT_VALUES: List<String> = listOf("l", "kWh")
    }
}

@Serializable
data class VehicleStatsPriceTrendItem(
    val fillId: String,
    /** date */
    val date: String,
    /** l | kWh */
    val unit: String,
    val pricePerUnitMinor: Double,
) {
    companion object {
        val UNIT_VALUES: List<String> = listOf("l", "kWh")
    }
}

@Serializable
data class VehicleStats(
    val assetId: String,
    val year: Long?,
    /** date */
    val from: String?,
    /** date */
    val to: String?,
    /** km | mi */
    val odometerUnit: String,
    val distance: Double,
    val distanceByMonth: List<VehicleStatsDistanceByMonthItem>,
    val costs: VehicleStatsCosts,
    val costPerDistanceMinor: Double?,
    val consumption: List<VehicleStatsConsumptionItem>,
    val priceTrend: List<VehicleStatsPriceTrendItem>,
    val tireSet: TireSet?,
    val nextTasks: List<DashboardTask>,
) {
    companion object {
        val ODOMETER_UNIT_VALUES: List<String> = listOf("km", "mi")
    }
}

@Serializable
data class TireSet(
    val id: String,
    val assetId: String,
    /** summer | winter | all_season */
    val season: String,
    val brand: String?,
    val model: String?,
    val size: String?,
    val dot: String?,
    val treadDepthMm: Double?,
    /** date */
    val treadMeasuredOn: String?,
    val treadWarning: Boolean,
    val ageYears: Double?,
    val storageLocation: String?,
    val storageContactId: String?,
    val storageContactName: String?,
    val mounted: Boolean,
    /** date */
    val mountedOn: String?,
    /** date */
    val purchasedOn: String?,
    /** date-time */
    val retiredAt: String?,
    val notes: String?,
    val distance: Double?,
    /** km | mi */
    val odometerUnit: String,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val SEASON_VALUES: List<String> = listOf("summer", "winter", "all_season")
        val ODOMETER_UNIT_VALUES: List<String> = listOf("km", "mi")
    }
}

@Serializable
data class FuelLog(
    val id: String,
    val assetId: String,
    /** date */
    val date: String,
    val odometer: Double,
    /** km | mi */
    val odometerUnit: String,
    val quantity: Double,
    /** l | kWh */
    val unit: String,
    val amountMinor: Long,
    val currency: String,
    val fullTank: Boolean,
    val missedPrevious: Boolean,
    val station: String?,
    val notes: String?,
    val costEntryId: String?,
    val bookId: String?,
    val bookName: String?,
    val paidByUserId: String?,
    val pricePerUnitMinor: Double?,
    val distance: Double?,
    val consumptionPer100: Double?,
    val costPerDistanceMinor: Double?,
    val createdBy: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val ODOMETER_UNIT_VALUES: List<String> = listOf("km", "mi")
        val UNIT_VALUES: List<String> = listOf("l", "kWh")
    }
}

@Serializable
data class TireSetDetail(
    val id: String,
    val assetId: String,
    /** summer | winter | all_season */
    val season: String,
    val brand: String?,
    val model: String?,
    val size: String?,
    val dot: String?,
    val treadDepthMm: Double?,
    /** date */
    val treadMeasuredOn: String?,
    val treadWarning: Boolean,
    val ageYears: Double?,
    val storageLocation: String?,
    val storageContactId: String?,
    val storageContactName: String?,
    val mounted: Boolean,
    /** date */
    val mountedOn: String?,
    /** date */
    val purchasedOn: String?,
    /** date-time */
    val retiredAt: String?,
    val notes: String?,
    val distance: Double?,
    /** km | mi */
    val odometerUnit: String,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
    val events: List<TireSetEvent>,
) {
    companion object {
        val SEASON_VALUES: List<String> = listOf("summer", "winter", "all_season")
        val ODOMETER_UNIT_VALUES: List<String> = listOf("km", "mi")
    }
}

@Serializable
data class TireSetEvent(
    val id: String,
    /** mounted | unmounted | tread_measured */
    val kind: String,
    /** date */
    val date: String,
    val odometer: Double?,
    val treadDepthMm: Double?,
    /** date-time */
    val createdAt: String,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("mounted", "unmounted", "tread_measured")
    }
}

@Serializable
data class OdometerReading(
    val id: String,
    val assetId: String,
    /** date */
    val date: String,
    val value: Double,
    /** manual | completion | service_log | fuel_log | tire_change */
    val source: String,
    val sourceId: String?,
    val note: String?,
    val createdBy: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val SOURCE_VALUES: List<String> = listOf("manual", "completion", "service_log", "fuel_log", "tire_change")
    }
}

@Serializable
data class CostEntry(
    val id: String,
    val bookId: String,
    val bookName: String,
    val bookTaxRelevant: Boolean,
    /** date */
    val date: String,
    val title: String,
    val amountMinor: Long,
    val currency: String,
    /** repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other */
    val category: String,
    val assetId: String?,
    val assetName: String?,
    val roomId: String?,
    val roomName: String?,
    val defectId: String?,
    val defectNumber: Long?,
    val defectTitle: String?,
    val serviceLogId: String?,
    val serviceLogTitle: String?,
    val payee: String?,
    val notes: String?,
    val paidByUserId: String?,
    val paidByName: String?,
    /** ownership | equal | custom | none */
    val splitMode: String,
    val shares: List<CostShare>,
    val tags: List<CostTagRef>,
    val countsAsExpense: Boolean,
    /** unknown | maintenance | investment | no */
    val deductible: String,
    /** manual | finance_transaction | finance_bill | recurring */
    val source: String,
    val providerUrl: String?,
    val fuelLogId: String?,
    val reviewNeeded: Boolean,
    /** date-time */
    val reviewedAt: String?,
    val reviewedByUserId: String?,
    val receiptTaskId: String?,
    val financeLinked: Boolean,
    val recurrenceId: String?,
    val commentCount: Long,
    val createdBy: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("repair", "utilities", "renewal_fund", "purchase", "mortgage_interest", "mortgage_principal", "insurance", "renovation", "maintenance", "fuel", "taxes_fees", "groceries", "household", "dining", "leisure", "travel", "health", "gifts", "transport", "subscriptions", "other")
        val SPLIT_MODE_VALUES: List<String> = listOf("ownership", "equal", "custom", "none")
        val DEDUCTIBLE_VALUES: List<String> = listOf("unknown", "maintenance", "investment", "no")
        val SOURCE_VALUES: List<String> = listOf("manual", "finance_transaction", "finance_bill", "recurring")
    }
}

@Serializable
data class CostShare(
    val userId: String,
    val userName: String?,
    val shareBps: Long,
    val amountMinor: Long,
)

@Serializable
data class CostTagRef(
    val id: String,
    val name: String,
    /** gray | red | orange | amber | green | teal | blue | violet | pink */
    val color: String,
) {
    companion object {
        val COLOR_VALUES: List<String> = listOf("gray", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink")
    }
}

@Serializable
data class CostsSummaryByMonthItem(
    val month: String,
    val totalMinor: Long,
    val count: Long,
)

@Serializable
data class CostsSummaryByAssetItem(
    val assetId: String,
    val assetName: String,
    val totalMinor: Long,
    val count: Long,
)

@Serializable
data class CostsSummaryByDeductibleItem(
    /** unknown | maintenance | investment | no */
    val deductible: String,
    val totalMinor: Long,
    val count: Long,
) {
    companion object {
        val DEDUCTIBLE_VALUES: List<String> = listOf("unknown", "maintenance", "investment", "no")
    }
}

@Serializable
data class CostsSummaryPeopleItem(
    val userId: String,
    val userName: String?,
    val paidMinor: Long,
    val shareMinor: Long,
    val balanceMinor: Long,
)

@Serializable
data class CostsSummary(
    val year: Long,
    val currency: String,
    val otherCurrencyCount: Long,
    val expenseTotalMinor: Long,
    val equityTotalMinor: Long,
    val byCategory: List<DashboardCostsByCategoryItem>,
    val byMonth: List<CostsSummaryByMonthItem>,
    val byAsset: List<CostsSummaryByAssetItem>,
    val byDeductible: List<CostsSummaryByDeductibleItem>,
    val people: List<CostsSummaryPeopleItem>,
    val settlement: List<DashboardBalancesSuggestedPaymentsItem>,
    val unassignedPayerCount: Long,
    val reviewNeededCount: Long,
)

@Serializable
data class RecentCategoriesItemsItem(
    val bookId: String,
    /** repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other */
    val category: String,
    val count: Long,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("repair", "utilities", "renewal_fund", "purchase", "mortgage_interest", "mortgage_principal", "insurance", "renovation", "maintenance", "fuel", "taxes_fees", "groceries", "household", "dining", "leisure", "travel", "health", "gifts", "transport", "subscriptions", "other")
    }
}

@Serializable
data class RecentCategories(
    val entriesPerBook: Long,
    val items: List<RecentCategoriesItemsItem>,
)

@Serializable
data class MoveCostsToBookResultYears(
    val from: Long,
    val to: Long,
)

@Serializable
data class MoveCostsToBookResult(
    val bookId: String,
    val moved: Long,
    val unchanged: Long,
    val deductibleReset: Long,
    val dryRun: Boolean,
    val years: MoveCostsToBookResultYears?,
)

@Serializable
data class CostBalancesBook(
    val id: String,
    val name: String,
)

@Serializable
data class CostBalancesPeopleItem(
    val userId: String,
    val userName: String?,
    val paidMinor: Long,
    val shareMinor: Long,
    val sentMinor: Long,
    val receivedMinor: Long,
    val balanceMinor: Long,
)

@Serializable
data class CostBalancesCrossBookSettlements(
    val count: Long,
    val totalMinor: Long,
)

@Serializable
data class CostBalances(
    val book: CostBalancesBook?,
    val currency: String,
    val otherCurrencyCount: Long,
    val unassignedPayerCount: Long,
    val people: List<CostBalancesPeopleItem>,
    val crossBookSettlements: CostBalancesCrossBookSettlements?,
    val suggestedPayments: List<DashboardBalancesSuggestedPaymentsItem>,
)

@Serializable
data class CostBook(
    val id: String,
    val name: String,
    val slug: String,
    val icon: String?,
    /** ownership | equal | none */
    val defaultSplitMode: String,
    val taxRelevant: Boolean,
    /** date-time */
    val archivedAt: String?,
    val sortOrder: Long,
    val isDefault: Boolean,
    val entryCount: Long,
    val settlementCount: Long,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val DEFAULT_SPLIT_MODE_VALUES: List<String> = listOf("ownership", "equal", "none")
    }
}

@Serializable
data class CostTag(
    val id: String,
    val name: String,
    /** gray | red | orange | amber | green | teal | blue | violet | pink */
    val color: String,
    val entryCount: Long,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val COLOR_VALUES: List<String> = listOf("gray", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink")
    }
}

@Serializable
data class CostBudget(
    val id: String,
    val bookId: String?,
    val bookName: String?,
    /** repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other */
    val category: String?,
    /** month | year */
    val period: String,
    val amountMinor: Long,
    val currency: String,
    val active: Boolean,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("repair", "utilities", "renewal_fund", "purchase", "mortgage_interest", "mortgage_principal", "insurance", "renovation", "maintenance", "fuel", "taxes_fees", "groceries", "household", "dining", "leisure", "travel", "health", "gifts", "transport", "subscriptions", "other")
        val PERIOD_VALUES: List<String> = listOf("month", "year")
    }
}

@Serializable
data class CostBudgetStatus(
    val year: Long,
    val month: Long,
    val currency: String,
    val warningPercent: Long,
    val items: List<CostBudgetStatusItem>,
)

@Serializable
data class CostBudgetStatusItem(
    val budget: CostBudget,
    /** date */
    val periodFrom: String,
    /** date */
    val periodTo: String,
    val spentMinor: Long,
    val entryCount: Long,
    val remainingMinor: Long,
    val percentUsed: Long,
    /** ok | warning | exceeded */
    val state: String,
) {
    companion object {
        val STATE_VALUES: List<String> = listOf("ok", "warning", "exceeded")
    }
}

@Serializable
data class CostRecurrenceSharesItem(
    val userId: String,
    val shareBps: Long,
)

@Serializable
data class CostRecurrence(
    val id: String,
    val bookId: String,
    val bookName: String,
    val title: String,
    val amountMinor: Long,
    val currency: String,
    /** repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other */
    val category: String,
    val assetId: String?,
    val assetName: String?,
    val roomId: String?,
    val roomName: String?,
    val payee: String?,
    val notes: String?,
    val paidByUserId: String?,
    val paidByName: String?,
    /** ownership | equal | custom | none */
    val splitMode: String,
    val shares: List<CostRecurrenceSharesItem>?,
    val participantIds: List<String>?,
    val tags: List<CostTagRef>,
    val countsAsExpense: Boolean,
    /** unknown | maintenance | investment | no */
    val deductible: String,
    /** monthly | quarterly | yearly */
    val frequency: String,
    val interval: Long,
    val dayOfMonth: Long,
    /** date */
    val startDate: String,
    /** date */
    val endDate: String?,
    /** date */
    val nextDate: String?,
    /** date */
    val lastOccurrenceDate: String?,
    val active: Boolean,
    /** book_archived | failed */
    val lastError: String?,
    val createdBy: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val CATEGORY_VALUES: List<String> = listOf("repair", "utilities", "renewal_fund", "purchase", "mortgage_interest", "mortgage_principal", "insurance", "renovation", "maintenance", "fuel", "taxes_fees", "groceries", "household", "dining", "leisure", "travel", "health", "gifts", "transport", "subscriptions", "other")
        val SPLIT_MODE_VALUES: List<String> = listOf("ownership", "equal", "custom", "none")
        val DEDUCTIBLE_VALUES: List<String> = listOf("unknown", "maintenance", "investment", "no")
        val FREQUENCY_VALUES: List<String> = listOf("monthly", "quarterly", "yearly")
        val LAST_ERROR_VALUES: List<String> = listOf("book_archived", "failed")
    }
}

@Serializable
data class CostRecurrenceRun(
    val recurrence: CostRecurrence,
    val entry: CostEntry?,
)

@Serializable
data class Settlement(
    val id: String,
    val bookId: String?,
    val bookName: String?,
    val fromUserId: String,
    val fromName: String?,
    val toUserId: String,
    val toName: String?,
    val amountMinor: Long,
    val currency: String,
    /** date */
    val date: String,
    val note: String?,
    val createdBy: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
)

@Serializable
data class FinanceSuggestionCostPayload(
    /** finance_transaction | finance_bill */
    val source: String,
    /** date */
    val date: String,
    val amountMinor: Long,
    val currency: String,
    val title: String,
    val payee: String?,
    /** repair | utilities | renewal_fund | purchase | mortgage_interest | mortgage_principal | insurance | renovation | maintenance | fuel | taxes_fees | groceries | household | dining | leisure | travel | health | gifts | transport | subscriptions | other */
    val category: String,
    val url: String?,
    val assetId: String?,
    val bookId: String?,
) {
    companion object {
        val SOURCE_VALUES: List<String> = listOf("finance_transaction", "finance_bill")
        val CATEGORY_VALUES: List<String> = listOf("repair", "utilities", "renewal_fund", "purchase", "mortgage_interest", "mortgage_principal", "insurance", "renovation", "maintenance", "fuel", "taxes_fees", "groceries", "household", "dining", "leisure", "travel", "health", "gifts", "transport", "subscriptions", "other")
    }
}

@Serializable
data class FinanceSuggestionAssetPayload(
    val name: String,
    /** date */
    val purchaseDate: String,
    val priceMinor: Long,
    val currency: String,
    val url: String?,
)

@Serializable
data class FinanceSuggestionBillTaskPayload(
    val title: String,
    /** date */
    val dueDate: String,
    val amountMinor: Long?,
    val currency: String,
    val url: String?,
)

@Serializable
data class FinanceSuggestionLinkPayload(
    val entryId: String,
    val entry: FinanceLinkedEntry?,
    val transaction: FinanceSuggestionCostPayload,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed class FinanceSuggestion {
    @Serializable
    @SerialName("cost")
    data class Cost(
        val id: String,
        /** pending | accepted | dismissed */
        val status: String,
        val acceptedEntityId: String?,
        /** date-time */
        val createdAt: String,
        /** date-time */
        val updatedAt: String,
        val payload: FinanceSuggestionCostPayload,
    ) : FinanceSuggestion() {
        companion object {
            val STATUS_VALUES: List<String> = listOf("pending", "accepted", "dismissed")
        }
    }

    @Serializable
    @SerialName("asset")
    data class Asset(
        val id: String,
        /** pending | accepted | dismissed */
        val status: String,
        val acceptedEntityId: String?,
        /** date-time */
        val createdAt: String,
        /** date-time */
        val updatedAt: String,
        val payload: FinanceSuggestionAssetPayload,
    ) : FinanceSuggestion() {
        companion object {
            val STATUS_VALUES: List<String> = listOf("pending", "accepted", "dismissed")
        }
    }

    @Serializable
    @SerialName("bill_task")
    data class BillTask(
        val id: String,
        /** pending | accepted | dismissed */
        val status: String,
        val acceptedEntityId: String?,
        /** date-time */
        val createdAt: String,
        /** date-time */
        val updatedAt: String,
        val payload: FinanceSuggestionBillTaskPayload,
    ) : FinanceSuggestion() {
        companion object {
            val STATUS_VALUES: List<String> = listOf("pending", "accepted", "dismissed")
        }
    }

    @Serializable
    @SerialName("link")
    data class Link(
        val id: String,
        /** pending | accepted | dismissed */
        val status: String,
        val acceptedEntityId: String?,
        /** date-time */
        val createdAt: String,
        /** date-time */
        val updatedAt: String,
        val payload: FinanceSuggestionLinkPayload,
    ) : FinanceSuggestion() {
        companion object {
            val STATUS_VALUES: List<String> = listOf("pending", "accepted", "dismissed")
        }
    }

    @Serializable
    data object Unknown : FinanceSuggestion()
}

@Serializable
data class FinanceLinkedEntry(
    val id: String,
    val title: String,
    /** date */
    val date: String,
    val amountMinor: Long,
    val currency: String,
    val payee: String?,
    val bookId: String,
    val bookName: String,
)

@Serializable
data class FinanceSuggestionAcceptedEntity(
    /** cost | asset | task */
    val type: String,
    val id: String,
) {
    companion object {
        val TYPE_VALUES: List<String> = listOf("cost", "asset", "task")
    }
}

@Serializable
data class FinanceSuggestionAccepted(
    val suggestion: FinanceSuggestion,
    val entity: FinanceSuggestionAcceptedEntity,
)

@Serializable
data class FinanceSyncError(
    val code: String,
    val message: String,
)

@Serializable
data class FinanceSync(
    val ok: Boolean,
    val error: FinanceSyncError?,
    val stats: Map<String, Long>,
)

@Serializable
data class Defect(
    val id: String,
    val number: Long,
    val title: String,
    val descriptionMd: String,
    /** open | reported | in_progress | fixed | rejected */
    val status: String,
    /** low | medium | high */
    val severity: String,
    val roomId: String?,
    val roomName: String?,
    val assetId: String?,
    val assetName: String?,
    val locationDetail: String?,
    /** date */
    val discoveredOn: String,
    /** date */
    val reportedOn: String?,
    val responsibleContactId: String?,
    val responsibleContactName: String?,
    /** date */
    val deadlineDate: String?,
    /** manual | handover */
    val deadlineSource: String,
    /** date */
    val fixedOn: String?,
    val resolutionMd: String,
    val costEntryId: String?,
    val costs: CostsOf,
    val reminderTaskId: String?,
    val commentCount: Long,
    val createdBy: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("open", "reported", "in_progress", "fixed", "rejected")
        val SEVERITY_VALUES: List<String> = listOf("low", "medium", "high")
        val DEADLINE_SOURCE_VALUES: List<String> = listOf("manual", "handover")
    }
}

@Serializable
data class DefectDetail(
    val id: String,
    val number: Long,
    val title: String,
    val descriptionMd: String,
    /** open | reported | in_progress | fixed | rejected */
    val status: String,
    /** low | medium | high */
    val severity: String,
    val roomId: String?,
    val roomName: String?,
    val assetId: String?,
    val assetName: String?,
    val locationDetail: String?,
    /** date */
    val discoveredOn: String,
    /** date */
    val reportedOn: String?,
    val responsibleContactId: String?,
    val responsibleContactName: String?,
    /** date */
    val deadlineDate: String?,
    /** manual | handover */
    val deadlineSource: String,
    /** date */
    val fixedOn: String?,
    val resolutionMd: String,
    val costEntryId: String?,
    val costs: CostsOf,
    val reminderTaskId: String?,
    val commentCount: Long,
    val createdBy: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
    val events: List<DefectEvent>,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("open", "reported", "in_progress", "fixed", "rejected")
        val SEVERITY_VALUES: List<String> = listOf("low", "medium", "high")
        val DEADLINE_SOURCE_VALUES: List<String> = listOf("manual", "handover")
    }
}

@Serializable
data class DefectEvent(
    val id: String,
    val defectId: String,
    /** date-time */
    val at: String,
    val userId: String?,
    val userName: String?,
    /** created | status | comment | correspondence */
    val type: String,
    /** open | reported | in_progress | fixed | rejected */
    val fromStatus: String?,
    /** open | reported | in_progress | fixed | rejected */
    val toStatus: String?,
    val bodyMd: String,
    val externalRef: String?,
) {
    companion object {
        val TYPE_VALUES: List<String> = listOf("created", "status", "comment", "correspondence")
        val FROM_STATUS_VALUES: List<String> = listOf("open", "reported", "in_progress", "fixed", "rejected")
        val TO_STATUS_VALUES: List<String> = listOf("open", "reported", "in_progress", "fixed", "rejected")
    }
}

@Serializable
@JsonClassDiscriminator("kind")
sealed class DefectTimelineItem {
    @Serializable
    @SerialName("event")
    data class Event(
        val id: String,
        /** date-time */
        val at: String,
        val userId: String?,
        val userName: String?,
        /** created | status | comment | correspondence */
        val type: String,
        /** open | reported | in_progress | fixed | rejected */
        val fromStatus: String?,
        /** open | reported | in_progress | fixed | rejected */
        val toStatus: String?,
        val bodyMd: String,
        val externalRef: String?,
    ) : DefectTimelineItem() {
        companion object {
            val TYPE_VALUES: List<String> = listOf("created", "status", "comment", "correspondence")
            val FROM_STATUS_VALUES: List<String> = listOf("open", "reported", "in_progress", "fixed", "rejected")
            val TO_STATUS_VALUES: List<String> = listOf("open", "reported", "in_progress", "fixed", "rejected")
        }
    }

    @Serializable
    @SerialName("comment")
    data class Comment(
        val id: String,
        /** date-time */
        val at: String,
        val userId: String?,
        val userName: String?,
        val bodyMd: String,
        /** date-time */
        val editedAt: String?,
        val deleted: Boolean,
    ) : DefectTimelineItem()

    @Serializable
    data object Unknown : DefectTimelineItem()
}

@Serializable
data class InsurancePolicy(
    val id: String,
    val title: String,
    /** motor_liability | motor_partial_casco | motor_full_casco | household | personal_liability | building | legal | travel | health | life | other */
    val type: String,
    val insurerContactId: String?,
    val insurerName: String?,
    val policyNumber: String?,
    val premiumMinor: Long,
    val currency: String,
    /** monthly | quarterly | semiannual | annual */
    val premiumPeriod: String,
    val annualPremiumMinor: Long,
    val deductibleMinor: Long?,
    /** date */
    val startDate: String,
    /** date */
    val endDate: String?,
    /** auto | fixed */
    val renewal: String,
    val cancellationNoticeMonths: Long?,
    /** date */
    val cancellationDeadline: String?,
    val assistancePhone: String?,
    val showOnEmergency: Boolean,
    val notes: String?,
    val assets: List<InsurancePolicyAsset>,
    val reminderTaskId: String?,
    val commentCount: Long,
    /** date-time */
    val archivedAt: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val TYPE_VALUES: List<String> = listOf("motor_liability", "motor_partial_casco", "motor_full_casco", "household", "personal_liability", "building", "legal", "travel", "health", "life", "other")
        val PREMIUM_PERIOD_VALUES: List<String> = listOf("monthly", "quarterly", "semiannual", "annual")
        val RENEWAL_VALUES: List<String> = listOf("auto", "fixed")
    }
}

@Serializable
data class InsurancePolicyAsset(
    val id: String,
    val name: String,
    /** device | plant | fixture | vehicle | other */
    val kind: String,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("device", "plant", "fixture", "vehicle", "other")
    }
}

@Serializable
data class AssetNote(
    val id: String,
    val assetId: String,
    val assetName: String,
    val body: String,
    /** open | resolved */
    val status: String,
    /** date-time */
    val resolvedAt: String?,
    val resolvedBy: String?,
    val resolvedByName: String?,
    val serviceLogId: String?,
    val defectId: String?,
    val createdBy: String?,
    val createdByName: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("open", "resolved")
    }
}

@Serializable
data class Appointment(
    val id: String,
    val title: String,
    val notes: String?,
    val location: String?,
    val allDay: Boolean,
    /** date-time */
    val startsAt: String?,
    /** date-time */
    val endsAt: String?,
    /** date */
    val startDate: String?,
    /** date */
    val endDate: String?,
    val taskId: String?,
    val taskTitle: String?,
    val occurrenceKey: String?,
    val assetId: String?,
    val assetName: String?,
    val contactId: String?,
    val contactName: String?,
    /** planned | done | cancelled */
    val status: String,
    val commentCount: Long,
    val createdByUserId: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("planned", "done", "cancelled")
    }
}

@Serializable
data class Warranty(
    val assetId: String,
    val assetName: String,
    val roomName: String?,
    val manufacturer: String?,
    val model: String?,
    /** date */
    val purchaseDate: String?,
    /** date */
    val warrantyUntil: String?,
    /** date */
    val warrantyExtendedUntil: String?,
    /** date */
    val effectiveUntil: String,
    /** valid | expiring | expired */
    val status: String,
    val daysLeft: Long,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("valid", "expiring", "expired")
    }
}

@Serializable
data class CommentAuthor(
    val id: String,
    val displayName: String,
)

@Serializable
data class Comment(
    val id: String,
    /** task | defect | asset | room | part | contact | service_log | asset_hint | doc_page | cost | insurance_policy | appointment */
    val entityType: String,
    val entityId: String,
    val author: CommentAuthor?,
    val bodyMd: String,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val editedAt: String?,
    val deleted: Boolean,
    val canEdit: Boolean,
    val canDelete: Boolean,
) {
    companion object {
        val ENTITY_TYPE_VALUES: List<String> = listOf("task", "defect", "asset", "room", "part", "contact", "service_log", "asset_hint", "doc_page", "cost", "insurance_policy", "appointment")
    }
}

@Serializable
data class Hint(
    val id: String,
    val assetId: String,
    val assetName: String,
    val title: String,
    val bodyMd: String,
    /** tip | rule | warning */
    val kind: String,
    val pinned: Boolean,
    val sortOrder: Long,
    val guestVisible: Boolean,
    val taskId: String?,
    val taskTitle: String?,
    val reaction: SignalReaction?,
    val commentCount: Long,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("tip", "rule", "warning")
    }
}

@Serializable
data class SignalReaction(
    @EncodeDefault val type: String = "signal_change",
    val entityId: String,
    val toState: String,
    val fromState: String? = null,
    val delayMinutes: Long? = null,
    val notify: JsonElement,
)

@Serializable
data class DocPageSummary(
    val id: String,
    val slug: String,
    val title: String,
    /** general | device | room | emergency | rules | howto */
    val section: String,
    val assetId: String?,
    val roomId: String?,
    val sortOrder: Long,
    val guestVisible: Boolean,
    val pinned: Boolean,
    val rev: Long,
    val excerpt: String,
    val commentCount: Long,
    val updatedBy: String?,
    val updatedByName: String?,
    /** date-time */
    val archivedAt: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val SECTION_VALUES: List<String> = listOf("general", "device", "room", "emergency", "rules", "howto")
    }
}

@Serializable
data class DocPage(
    val id: String,
    val slug: String,
    val title: String,
    /** general | device | room | emergency | rules | howto */
    val section: String,
    val assetId: String?,
    val roomId: String?,
    val sortOrder: Long,
    val guestVisible: Boolean,
    val pinned: Boolean,
    val rev: Long,
    val excerpt: String,
    val commentCount: Long,
    val updatedBy: String?,
    val updatedByName: String?,
    /** date-time */
    val archivedAt: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
    val bodyMd: String,
    val renderedHtml: String,
    val headings: List<Heading>,
    val backlinks: List<PageBacklink>,
) {
    companion object {
        val SECTION_VALUES: List<String> = listOf("general", "device", "room", "emergency", "rules", "howto")
    }
}

@Serializable
data class Heading(
    val level: Long,
    val text: String,
    val id: String,
)

@Serializable
data class PageBacklink(
    val id: String,
    val slug: String,
    val title: String,
)

@Serializable
data class PageRevisionSummary(
    val rev: Long,
    val title: String,
    val size: Long,
    val userId: String?,
    val userName: String?,
    /** date-time */
    val createdAt: String,
)

@Serializable
data class PageRevision(
    val rev: Long,
    val title: String,
    val size: Long,
    val userId: String?,
    val userName: String?,
    /** date-time */
    val createdAt: String,
    val bodyMd: String,
)

@Serializable
data class SearchHit(
    /** page | asset | room | task | defect | contact | part | asset_hint | insurance_policy | appointment | document */
    val type: String,
    val id: String,
    val title: String,
    val snippet: String,
    val url: String,
) {
    companion object {
        val TYPE_VALUES: List<String> = listOf("page", "asset", "room", "task", "defect", "contact", "part", "asset_hint", "insurance_policy", "appointment", "document")
    }
}

@Serializable
data class Attachment(
    val id: String,
    /** asset | room | page | task | defect | service_log | part | asset_hint | contact | cost | insurance_policy | asset_note | tire_set | appointment | ai_task */
    val ownerType: String,
    val ownerId: String,
    val filename: String,
    val mime: String,
    val size: Long,
    val width: Long?,
    val height: Long?,
    val caption: String?,
    val guestVisible: Boolean,
    val url: String,
    val thumbUrl: String?,
    val uploadedBy: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val OWNER_TYPE_VALUES: List<String> = listOf("asset", "room", "page", "task", "defect", "service_log", "part", "asset_hint", "contact", "cost", "insurance_policy", "asset_note", "tire_set", "appointment", "ai_task")
    }
}

@Serializable
data class NotificationSettings(
    val pushEnabled: Boolean,
    val quietStart: String?,
    val quietEnd: String?,
    /** prep | due_soon | due | overdue | digest | hint | comment */
    val pushStages: List<String>,
    val targets: List<NotificationTarget>,
) {
    companion object {
        val PUSH_STAGES_VALUES: List<String> = listOf("prep", "due_soon", "due", "overdue", "digest", "hint", "comment")
    }
}

@Serializable
data class NotificationTarget(
    val id: String,
    /** ha_notify */
    val channel: String,
    val target: String,
    val enabled: Boolean,
)

@Serializable
data class Integration(
    /** homeassistant | paperless | kept */
    val kind: String,
    /** household | user */
    val level: String,
    val available: Boolean,
    val capabilities: List<String>,
    val configured: Boolean,
    val enabled: Boolean,
    val baseUrl: String?,
    val allowInsecureTls: Boolean,
    val config: JsonObject,
    /** ok | error | unknown */
    val status: String,
    val lastError: String?,
    /** date-time */
    val lastOkAt: String?,
    /** date-time */
    val lastCheckedAt: String?,
    val consecutiveFailures: Long,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("homeassistant", "paperless", "kept")
        val LEVEL_VALUES: List<String> = listOf("household", "user")
        val STATUS_VALUES: List<String> = listOf("ok", "error", "unknown")
    }
}

@Serializable
data class IntegrationTestError(
    val code: String,
    val message: String,
)

@Serializable
data class IntegrationTest(
    val ok: Boolean,
    val error: IntegrationTestError?,
    val info: Map<String, JsonElement?>?,
    val integration: Integration,
)

@Serializable
data class ExternalEntity(
    val id: String,
    val domain: String,
    val name: String,
    val state: String,
    val unit: String?,
    val area: String?,
)

@Serializable
data class ExternalCalendar(
    val id: String,
    val name: String,
    val capabilities: CalendarCapabilities?,
)

@Serializable
data class CalendarCapabilities(
    val create: Boolean,
    val update: Boolean,
    val delete: Boolean,
    val alarms: Boolean,
)

@Serializable
data class ExternalDevice(
    val id: String,
    val name: String,
    val manufacturer: String?,
    val model: String?,
    val area: String?,
    val areaId: String?,
)

@Serializable
data class ExternalArea(
    val id: String,
    val name: String,
    val floor: String?,
    val roomId: String?,
)

@Serializable
data class ExternalTag(
    val id: Long,
    val name: String,
    val color: String?,
    val documentCount: Long?,
)

@Serializable
data class ExternalCorrespondent(
    val id: Long,
    val name: String,
    val documentCount: Long?,
)

@Serializable
data class ExternalCustomField(
    val id: Long,
    val name: String,
    val dataType: String,
)

@Serializable
data class ExternalGroup(
    val id: Long,
    val name: String,
)

@Serializable
data class ExternalStoragePath(
    val id: Long,
    val name: String,
    val path: String?,
)

@Serializable
data class ExternalDocument(
    /** paperless */
    val provider: String,
    val externalId: Long,
    val title: String,
    /** date */
    val createdDate: String?,
    val correspondentId: Long?,
    val correspondentName: String?,
    val tagIds: List<Long>,
    val tagNames: List<String>,
    val mimeType: String?,
    val pageCount: Long?,
    val noteCount: Long,
    /** date */
    val warrantyUntil: String?,
    /** date */
    val warrantyExtendedUntil: String?,
    val linkedTo: List<DocumentLinkSummary>,
    val thumbUrl: String,
    val previewUrl: String,
    val downloadUrl: String,
)

@Serializable
data class DocumentLinkSummary(
    val linkId: String,
    /** asset | room | page | task | defect | service_log | part | contact | cost | insurance_policy */
    val ownerType: String,
    val ownerId: String,
    val ownerTitle: String?,
    val ownerUrl: String?,
    /** manual | receipt | warranty | datasheet | correspondence | invoice | policy | registration | other */
    val role: String,
) {
    companion object {
        val OWNER_TYPE_VALUES: List<String> = listOf("asset", "room", "page", "task", "defect", "service_log", "part", "contact", "cost", "insurance_policy")
        val ROLE_VALUES: List<String> = listOf("manual", "receipt", "warranty", "datasheet", "correspondence", "invoice", "policy", "registration", "other")
    }
}

@Serializable
data class AssetSuggestion(
    @EncodeDefault val kind: String = "asset",
    /** paperless */
    val provider: String,
    val externalId: Long,
    val title: String,
    /** date */
    val createdDate: String?,
    val correspondentName: String?,
    /** date */
    val warrantyUntil: String?,
    /** date */
    val warrantyExtendedUntil: String?,
)

@Serializable
data class ContactSuggestion(
    @EncodeDefault val kind: String = "contact",
    /** paperless */
    val provider: String,
    val correspondentId: Long,
    val name: String,
    val documentCount: Long,
    val externalSource: String,
    val externalRef: String,
)

@Serializable
data class DocumentUpload(
    val id: String,
    /** paperless */
    val provider: String,
    /** queued | uploading | processing | done | failed */
    val status: String,
    val attachmentId: String,
    /** asset | room | page | task | defect | service_log | part | contact | cost | insurance_policy */
    val ownerType: String,
    val ownerId: String,
    /** manual | receipt | warranty | datasheet | correspondence | invoice | policy | registration | other */
    val role: String,
    val title: String,
    val externalId: Long?,
    val linkId: String?,
    val duplicate: Boolean,
    val errorCode: String?,
    val warning: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("queued", "uploading", "processing", "done", "failed")
        val OWNER_TYPE_VALUES: List<String> = listOf("asset", "room", "page", "task", "defect", "service_log", "part", "contact", "cost", "insurance_policy")
        val ROLE_VALUES: List<String> = listOf("manual", "receipt", "warranty", "datasheet", "correspondence", "invoice", "policy", "registration", "other")
    }
}

@Serializable
data class ExternalDocumentDetail(
    /** paperless */
    val provider: String,
    val externalId: Long,
    val title: String,
    /** date */
    val createdDate: String?,
    val correspondentId: Long?,
    val correspondentName: String?,
    val tagIds: List<Long>,
    val tagNames: List<String>,
    val mimeType: String?,
    val pageCount: Long?,
    val noteCount: Long,
    /** date */
    val warrantyUntil: String?,
    /** date */
    val warrantyExtendedUntil: String?,
    val linkedTo: List<DocumentLinkSummary>,
    val thumbUrl: String,
    val previewUrl: String,
    val downloadUrl: String,
    val webUrl: String?,
    val links: List<DocumentLink>,
)

@Serializable
data class DocumentLinkDocument(
    val title: String,
    /** date */
    val createdDate: String?,
    val correspondentName: String?,
    val mimeType: String?,
    val pageCount: Long?,
    val tagNames: List<String>,
)

@Serializable
data class DocumentLink(
    val id: String,
    /** paperless */
    val provider: String,
    val externalId: Long,
    /** asset | room | page | task | defect | service_log | part | contact | cost | insurance_policy */
    val ownerType: String,
    val ownerId: String,
    val ownerTitle: String?,
    val ownerUrl: String?,
    /** manual | receipt | warranty | datasheet | correspondence | invoice | policy | registration | other */
    val role: String,
    val label: String?,
    val available: Boolean,
    val document: DocumentLinkDocument?,
    val thumbUrl: String?,
    val previewUrl: String?,
    val downloadUrl: String?,
    val createdBy: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val OWNER_TYPE_VALUES: List<String> = listOf("asset", "room", "page", "task", "defect", "service_log", "part", "contact", "cost", "insurance_policy")
        val ROLE_VALUES: List<String> = listOf("manual", "receipt", "warranty", "datasheet", "correspondence", "invoice", "policy", "registration", "other")
    }
}

@Serializable
data class FinanceCategory(
    val id: String,
    val name: String,
    val parentId: String?,
    /** expense | income */
    val kind: String,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("expense", "income")
    }
}

@Serializable
data class FinanceAccount(
    val id: String,
    val name: String,
    val currency: String,
    val type: String,
    val archived: Boolean,
)

@Serializable
data class NotificationActionResult(
    val taskId: String,
    val completionId: String,
    val replayed: Boolean,
)

@Serializable
data class CalendarFeed(
    val id: String,
    val name: String,
    /** mine | all */
    val scope: String,
    val includeEstimated: Boolean,
    val includePreparations: Boolean,
    val includeDefects: Boolean,
    val includeWarranties: Boolean,
    val alarmTime: String?,
    val alarmDaysBefore: Long,
    /** de | en */
    val locale: String,
    val url: String?,
    /** date-time */
    val lastFetchedAt: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val SCOPE_VALUES: List<String> = listOf("mine", "all")
        val LOCALE_VALUES: List<String> = listOf("de", "en")
    }
}

@Serializable
data class CalendarTarget(
    val id: String,
    /** homeassistant */
    val provider: String,
    /** household | user */
    val level: String,
    val ownerId: String?,
    val remoteCalendarId: String,
    val remoteName: String?,
    val name: String,
    val enabled: Boolean,
    val config: CalendarTargetConfig,
    val capabilities: CalendarCapabilities?,
    /** ok | error | unknown */
    val status: String,
    val lastError: String?,
    /** date-time */
    val lastOkAt: String?,
    /** date-time */
    val lastCheckedAt: String?,
    /** date-time */
    val nextAttemptAt: String?,
    val consecutiveFailures: Long,
    val lastStats: CalendarSyncCounts?,
    val eventCount: Long,
    val canManage: Boolean,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val LEVEL_VALUES: List<String> = listOf("household", "user")
        val STATUS_VALUES: List<String> = listOf("ok", "error", "unknown")
    }
}

@Serializable
data class CalendarTargetConfig(
    /** appointments | task_due | preparations | defect_deadlines | insurance_deadlines | warranty_ends */
    val kinds: List<String>,
    /** push */
    val direction: String,
    /** mine | all */
    val scope: String,
    /** all_day | timed */
    val timedMode: String,
    val dueTime: String,
    val dueDurationMinutes: Long,
    val alarmMinutes: Long?,
    val titlePrefix: String,
    /** recreate | forget */
    val onRemoteDelete: String,
    /** hauswart_wins */
    val conflictPolicy: String,
    /** de | en */
    val locale: String,
) {
    companion object {
        val KINDS_VALUES: List<String> = listOf("appointments", "task_due", "preparations", "defect_deadlines", "insurance_deadlines", "warranty_ends")
        val SCOPE_VALUES: List<String> = listOf("mine", "all")
        val TIMED_MODE_VALUES: List<String> = listOf("all_day", "timed")
        val ON_REMOTE_DELETE_VALUES: List<String> = listOf("recreate", "forget")
        val LOCALE_VALUES: List<String> = listOf("de", "en")
    }
}

@Serializable
data class CalendarSyncCounts(
    val created: Long,
    val updated: Long,
    val replaced: Long,
    val deleted: Long,
    val adopted: Long,
    val forgotten: Long,
    val skipped: Long,
    val failed: Long,
    val unconfirmed: Long,
    val remaining: Long,
)

@Serializable
data class CalendarSyncError(
    val code: String,
    val message: String,
)

@Serializable
data class CalendarSync(
    val ok: Boolean,
    val error: CalendarSyncError?,
    val counts: CalendarSyncCounts,
    val target: CalendarTarget,
)

@Serializable
data class EmergencyHousehold(
    val name: String,
)

@Serializable
data class Emergency(
    val household: EmergencyHousehold,
    val pages: List<EmergencyPage>,
    val contacts: List<Contact>,
    val assets: List<EmergencyAsset>,
    val insurance: List<EmergencyInsurance>,
)

@Serializable
data class EmergencyPage(
    val id: String,
    val slug: String,
    val title: String,
    /** general | device | room | emergency | rules | howto */
    val section: String,
    val renderedHtml: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val SECTION_VALUES: List<String> = listOf("general", "device", "room", "emergency", "rules", "howto")
    }
}

@Serializable
data class EmergencyAsset(
    val id: String,
    val name: String,
    val roomName: String?,
    val pinnedHints: List<EmergencyHint>,
)

@Serializable
data class EmergencyHint(
    val id: String,
    val title: String,
    val bodyMd: String,
    /** tip | rule | warning */
    val kind: String,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("tip", "rule", "warning")
    }
}

@Serializable
data class EmergencyInsurance(
    val id: String,
    val title: String,
    /** motor_liability | motor_partial_casco | motor_full_casco | household | personal_liability | building | legal | travel | health | life | other */
    val type: String,
    val insurerName: String?,
    val insurerPhone: String?,
    val policyNumber: String?,
    val assistancePhone: String?,
) {
    companion object {
        val TYPE_VALUES: List<String> = listOf("motor_liability", "motor_partial_casco", "motor_full_casco", "household", "personal_liability", "building", "legal", "travel", "health", "life", "other")
    }
}

@Serializable
data class GuestLink(
    val id: String,
    val label: String,
    /** active | scheduled | expired | revoked */
    val status: String,
    val createdBy: String?,
    val createdByName: String?,
    /** date-time */
    val startsAt: String?,
    /** date-time */
    val expiresAt: String,
    /** date-time */
    val revokedAt: String?,
    val hasPin: Boolean,
    val pinLocked: Boolean,
    val includeSecrets: Boolean,
    /** emergency | rules | contacts | devices | howto */
    val sections: List<String>,
    val pageIds: List<String>,
    /** de | en */
    val locale: String,
    /** date-time */
    val lastViewedAt: String?,
    val viewCount: Long,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("active", "scheduled", "expired", "revoked")
        val SECTIONS_VALUES: List<String> = listOf("emergency", "rules", "contacts", "devices", "howto")
        val LOCALE_VALUES: List<String> = listOf("de", "en")
    }
}

@Serializable
data class CreatedGuestLink(
    val id: String,
    val label: String,
    /** active | scheduled | expired | revoked */
    val status: String,
    val createdBy: String?,
    val createdByName: String?,
    /** date-time */
    val startsAt: String?,
    /** date-time */
    val expiresAt: String,
    /** date-time */
    val revokedAt: String?,
    val hasPin: Boolean,
    val pinLocked: Boolean,
    val includeSecrets: Boolean,
    /** emergency | rules | contacts | devices | howto */
    val sections: List<String>,
    val pageIds: List<String>,
    /** de | en */
    val locale: String,
    /** date-time */
    val lastViewedAt: String?,
    val viewCount: Long,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
    val url: String,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("active", "scheduled", "expired", "revoked")
        val SECTIONS_VALUES: List<String> = listOf("emergency", "rules", "contacts", "devices", "howto")
        val LOCALE_VALUES: List<String> = listOf("de", "en")
    }
}

@Serializable
data class AiTask(
    val id: String,
    /** receipt | fuel_receipt | service_invoice | insurance_policy */
    val kind: String,
    /** pending | done | dismissed */
    val status: String,
    val note: String?,
    val createdByUserId: String?,
    val createdByName: String?,
    val attachment: Attachment?,
    val bookId: String?,
    val bookName: String?,
    val assetId: String?,
    val assetName: String?,
    val claim: AiTaskClaim?,
    val bookedSoFar: List<AiTaskCost>,
    val result: AiTaskResult?,
    val dismissReason: String?,
    /** date-time */
    val completedAt: String?,
    /** session | mobile | integration | ha | mcp */
    val completedVia: String?,
    val completedByUserId: String?,
    val completedByName: String?,
    /** date-time */
    val createdAt: String,
    /** date-time */
    val updatedAt: String,
) {
    companion object {
        val KIND_VALUES: List<String> = listOf("receipt", "fuel_receipt", "service_invoice", "insurance_policy")
        val STATUS_VALUES: List<String> = listOf("pending", "done", "dismissed")
        val COMPLETED_VIA_VALUES: List<String> = listOf("session", "mobile", "integration", "ha", "mcp")
    }
}

@Serializable
data class AiTaskClaim(
    val byUserId: String,
    val byName: String?,
    /** date-time */
    val at: String,
    /** date-time */
    val expiresAt: String,
)

@Serializable
data class AiTaskCost(
    val id: String,
    /** date */
    val date: String,
    val title: String,
    val amountMinor: Long,
    val currency: String,
    val reviewNeeded: Boolean,
    val fuelLogId: String?,
)

@Serializable
data class AiTaskResult(
    val createdCostIds: List<String>,
    val createdFuelLogIds: List<String>,
    val note: String?,
    val costs: List<AiTaskCost>,
)

@Serializable
data class AiTaskCount(
    val count: Long,
)
