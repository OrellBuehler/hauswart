package ch.orellbuehler.hauswart.api

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Every failed call. [code] is one of the server's error codes (`unauthenticated`, `forbidden`,
 * `invalid_request`, `not_found`, `conflict`, `rate_limited`, `gone`, `upstream_error`,
 * `invalid_credentials`, `internal`, ...) or, for failures without a response, [NETWORK] or
 * [INVALID_RESPONSE]. [status] is 0 without a response.
 */
class ApiException(
    val status: Int,
    val code: String,
    override val message: String,
    val details: JsonElement? = null,
    val retryAfterSeconds: Long? = null,
    cause: Throwable? = null,
) : Exception(message, cause) {
    val isNetwork: Boolean get() = code == NETWORK

    /** Per-field messages of a 400 (`details.body.fieldErrors`, first message each); empty otherwise. */
    val fieldErrors: Map<String, String>
        get() {
            val body = (details as? JsonObject)?.get("body") as? JsonObject
            val fields = body?.get("fieldErrors") as? JsonObject ?: return emptyMap()
            return fields
                .mapNotNull { (key, value) ->
                    val first = (value as? JsonArray)?.firstOrNull() as? JsonPrimitive
                    first?.let { key to it.content }
                }.toMap()
        }

    /** Messages of a 400 that belong to no field (`details.body.formErrors`). */
    val formErrors: List<String>
        get() {
            val body = (details as? JsonObject)?.get("body") as? JsonObject
            return (body?.get("formErrors") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
        }

    /** `details.code` of a 400 that names its reason (e.g. `lower_than_previous`), else null. */
    val detailCode: String?
        get() = ((details as? JsonObject)?.get("code") as? JsonPrimitive)?.content

    companion object {
        const val NETWORK = "network"
        const val INVALID_RESPONSE = "invalid_response"
    }
}
