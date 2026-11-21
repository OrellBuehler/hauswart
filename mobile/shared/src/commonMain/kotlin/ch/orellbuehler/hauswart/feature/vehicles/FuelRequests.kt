package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiHttp
import ch.orellbuehler.hauswart.api.generated.FuelLog
import ch.orellbuehler.hauswart.api.generated.FuelLogsCreateRequest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/*
 * Without a `paidByUserId` the server books a new fill as paid by the caller; only an explicit
 * `null` says "nobody". The generated request class leaves a null out, so the body of a create is
 * sent as a JSON object with the payer written out (as the web form does).
 */

/** [request] as a JSON object; a missing payer is sent as `"paidByUserId": null`. */
internal fun fuelCreateBody(request: FuelLogsCreateRequest): JsonObject {
    val fields = ApiHttp.JSON.encodeToJsonElement(FuelLogsCreateRequest.serializer(), request) as JsonObject
    return if (request.paidByUserId == null) JsonObject(fields + ("paidByUserId" to JsonNull)) else fields
}

internal suspend fun createFuelLogRaw(
    app: HauswartApp,
    assetId: String,
    request: FuelLogsCreateRequest,
): FuelLog =
    app.http.json(
        "POST",
        "/api/v1/assets/${ApiHttp.segment(assetId)}/fuel-logs",
        emptyList(),
        JsonObject.serializer(),
        fuelCreateBody(request),
        FuelLog.serializer(),
    )
