package ch.orellbuehler.hauswart.feature.appointments

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiHttp
import ch.orellbuehler.hauswart.api.generated.Appointment
import ch.orellbuehler.hauswart.api.generated.AppointmentsCreateRequest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/*
 * Without an `assetId` the server gives a new appointment the device of its task; only an explicit
 * `null` says "no device". The generated request class leaves a null out, so the body of a create
 * is sent as a JSON object (as the web form does).
 */

/** [request] as a JSON object; an appointment for a task without a device carries `"assetId": null`. */
internal fun appointmentCreateBody(request: AppointmentsCreateRequest): JsonObject {
    val fields = ApiHttp.JSON.encodeToJsonElement(AppointmentsCreateRequest.serializer(), request) as JsonObject
    return if (request.taskId != null && request.assetId == null) JsonObject(fields + ("assetId" to JsonNull)) else fields
}

internal suspend fun createAppointmentRaw(
    app: HauswartApp,
    request: AppointmentsCreateRequest,
): Appointment =
    app.http.json(
        "POST",
        "/api/v1/appointments",
        emptyList(),
        JsonObject.serializer(),
        appointmentCreateBody(request),
        Appointment.serializer(),
    )
