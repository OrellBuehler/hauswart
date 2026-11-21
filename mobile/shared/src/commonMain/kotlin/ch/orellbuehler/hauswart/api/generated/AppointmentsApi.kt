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

class AppointmentsApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * List appointments
     *
     * Appointments of the household (service visits, inspections, deliveries), soonest first. `from` and `to` are days in the household time zone, both included: an appointment is listed when it overlaps one of them (a timed one counts on every day it touches). Filter by asset, task, contact and status; without a status every status is listed. Dates are YYYY-MM-DD, instants UTC ISO strings. All-day appointments carry startDate/endDate (the last day included) and no instants, timed ones the reverse.
     *
     * @param status planned | done | cancelled
     */
    suspend fun appointmentsList(
        cursor: String? = null,
        limit: Long? = null,
        from: String? = null,
        to: String? = null,
        assetId: String? = null,
        taskId: String? = null,
        contactId: String? = null,
        status: String? = null,
    ): AppointmentsListResponse =
        http.json("GET", "/api/v1/appointments", listOf("cursor" to cursor, "limit" to limit, "from" to from, "to" to to, "assetId" to assetId, "taskId" to taskId, "contactId" to contactId, "status" to status), AppointmentsListResponse.serializer())

    /**
     * Create an appointment
     *
     * A timed appointment needs startsAt (endsAt defaults to an hour later); an all-day one needs allDay true and startDate (endDate defaults to the same day, the last day included). The fields of the other kind are refused, the end must come after the start and an appointment lasts at most 14 days (a timed one may run an hour over, which is what 14 calendar days have more when the clocks go back). It can belong to a task (taskId, optionally the occurrenceKey it is for; without one the occurrence the task shows now is recorded, none for a task that shows none), a device and a contact; the asset defaults to the task's asset. It starts as planned. 400 field errors name the offending field (`taskId`, `assetId`, `contactId` when they do not exist).
     */
    suspend fun appointmentsCreate(
        body: AppointmentsCreateRequest,
    ): Appointment =
        http.json("POST", "/api/v1/appointments", emptyList(), AppointmentsCreateRequest.serializer(), body, Appointment.serializer())

    /**
     * Get an appointment
     */
    suspend fun appointmentsGet(
        id: String,
    ): Appointment =
        http.json("GET", "/api/v1/appointments/${ApiHttp.segment(id)}", emptyList(), Appointment.serializer())

    /**
     * Change an appointment
     *
     * Changes only the fields given. allDay switches between timed and all-day (then the new kind's start is required); otherwise the fields must fit the appointment as it is and the whole must stay valid, so moving only the start of a timed appointment to after its end is a 400 on endsAt. Changing the task records the occurrence the new task shows now as the occurrenceKey, unless one is sent; sending occurrenceKey null for the same task removes it. Cancel an appointment by setting status to cancelled, reopen it with planned. Setting status to done records the status only; POST /appointments/{id}/complete also completes the task. A request that changes nothing leaves updatedAt alone.
     */
    suspend fun appointmentsUpdate(
        id: String,
        body: AppointmentsUpdateRequest,
    ): Appointment =
        http.json("PATCH", "/api/v1/appointments/${ApiHttp.segment(id)}", emptyList(), AppointmentsUpdateRequest.serializer(), body, Appointment.serializer())

    /**
     * Delete an appointment
     *
     * Comments and attachments go with it. Cancel it instead to keep it.
     */
    suspend fun appointmentsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/appointments/${ApiHttp.segment(id)}", emptyList())

    /**
     * Mark an appointment done
     *
     * Sets the status to done and, when the appointment belongs to a task, completes the occurrence the appointment is for (its occurrenceKey, recorded when it got the task) as the caller, with the idempotency key `appointment:<id>`: repeating the request completes nothing twice and answers with the first completion and replayed true. Always answers 200; send `{}` when there is no note or date to give. Browser sessions are attributed as manual, API tokens by their kind. The task is left alone (completion null) when it is archived or when that occurrence has been settled meanwhile (the task shows another occurrence, or reports this one as completed, skipped or acknowledged), so the work is never counted twice and no cycle is skipped. An appointment without an occurrenceKey (its task showed none, or it was removed) completes the occurrence the task shows only if that is dated and fell due on or before the last day of the appointment. A cancelled appointment is a 409. Undoing the task's completion later (DELETE /completions/{id}) does not reopen the appointment, and reopening the appointment does not undo the completion.
     */
    suspend fun appointmentsComplete(
        id: String,
        body: AppointmentsCompleteRequest,
    ): AppointmentsCompleteResponse =
        http.json("POST", "/api/v1/appointments/${ApiHttp.segment(id)}/complete", emptyList(), AppointmentsCompleteRequest.serializer(), body, AppointmentsCompleteResponse.serializer())
}

@Serializable
data class AppointmentsListResponse(
    val items: List<Appointment>,
    val nextCursor: String?,
)

@Serializable
data class AppointmentsCreateRequest(
    val title: String,
    val notes: String? = null,
    val location: String? = null,
    val allDay: Boolean? = null,
    /** date-time */
    val startsAt: String? = null,
    /** date-time */
    val endsAt: String? = null,
    /** date */
    val startDate: String? = null,
    /** date */
    val endDate: String? = null,
    val taskId: String? = null,
    val assetId: String? = null,
    val contactId: String? = null,
    val occurrenceKey: String? = null,
)

@Serializable
data class AppointmentsUpdateRequest(
    val title: String? = null,
    val notes: Patch<String> = Patch.Keep,
    val location: Patch<String> = Patch.Keep,
    val allDay: Boolean? = null,
    /** date-time */
    val startsAt: String? = null,
    /** date-time */
    val endsAt: String? = null,
    /** date */
    val startDate: String? = null,
    /** date */
    val endDate: String? = null,
    val taskId: Patch<String> = Patch.Keep,
    val assetId: Patch<String> = Patch.Keep,
    val contactId: Patch<String> = Patch.Keep,
    val occurrenceKey: Patch<String> = Patch.Keep,
    /** planned | done | cancelled */
    val status: String? = null,
) {
    companion object {
        val STATUS_VALUES: List<String> = listOf("planned", "done", "cancelled")
    }
}

@Serializable
data class AppointmentsCompleteRequest(
    val note: String? = null,
    /** date-time */
    val completedAt: String? = null,
)

@Serializable
data class AppointmentsCompleteResponse(
    val appointment: Appointment,
    val completion: Completion?,
    val task: Task?,
    val replayed: Boolean,
)
