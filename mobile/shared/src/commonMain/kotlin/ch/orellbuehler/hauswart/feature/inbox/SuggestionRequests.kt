package ch.orellbuehler.hauswart.feature.inbox

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiHttp
import ch.orellbuehler.hauswart.api.generated.FinanceSuggestionAccepted
import ch.orellbuehler.hauswart.api.generated.FinanceSuggestionsAcceptRequest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/*
 * On accept, the server reads a missing `assetId` as "the device of the suggestion" and a missing
 * `paidByUserId` as "the caller", and a `null` as "none". The generated request class leaves a null
 * out, so "no device" and "nobody paid" are sent as a JSON object with an explicit null.
 */

/** [request] as a JSON object, with the fields named in [nulls] sent as an explicit `null`. */
internal fun acceptBody(
    request: FinanceSuggestionsAcceptRequest,
    nulls: Set<String> = emptySet(),
): JsonObject {
    val fields = ApiHttp.JSON.encodeToJsonElement(FinanceSuggestionsAcceptRequest.serializer(), request) as JsonObject
    return JsonObject(fields + nulls.associateWith { JsonNull })
}

internal suspend fun acceptSuggestionRaw(
    app: HauswartApp,
    id: String,
    body: JsonObject,
): FinanceSuggestionAccepted =
    app.http.json(
        "POST",
        "/api/v1/finance/suggestions/${ApiHttp.segment(id)}/accept",
        emptyList(),
        JsonObject.serializer(),
        body,
        FinanceSuggestionAccepted.serializer(),
    )
