package ch.orellbuehler.hauswart.core

import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.serialization.json.JsonElement

/**
 * A failure as the user sees it. [message] is localized and ready to show; [fields] are the
 * server's per-field messages of a rejected form (English, keyed by the request's field name).
 */
data class UiError(
    val message: String,
    val code: String,
    val fields: Map<String, String> = emptyMap(),
    val detailCode: String? = null,
    /** The response's `details` as the server sent them (a rejected reading names its neighbour there), else null. */
    val details: JsonElement? = null,
) {
    val isNetwork: Boolean get() = code == ApiException.NETWORK
    val isNotFound: Boolean get() = code == "not_found"

    fun field(name: String): String? = fields[name]
}

fun uiErrorOf(e: Throwable): UiError {
    if (e !is ApiException) return UiError(tr("m_error_unknown"), "unknown")
    val message =
        when (e.code) {
            ApiException.NETWORK -> tr("m_error_network")
            ApiException.INVALID_RESPONSE -> tr("m_error_invalid_response")
            "unauthenticated" -> tr("m_error_unauthenticated")
            "invalid_credentials" -> tr("m_error_invalid_credentials")
            "forbidden" -> tr("m_error_forbidden")
            "not_found", "gone" -> tr("m_error_not_found")
            "conflict" -> e.message.takeUnless { it == "Conflict" } ?: tr("m_error_conflict")
            "rate_limited" -> tr("m_error_rate_limited")
            "upstream_error" -> tr("m_error_upstream")
            "invalid_request" ->
                e.formErrors.firstOrNull()
                    ?: e.fieldErrors.entries
                        .firstOrNull()
                        ?.let { "${it.key}: ${it.value}" }
                    ?: tr("m_error_invalid_request")
            else -> tr("m_error_server")
        }
    return UiError(message, e.code, e.fieldErrors, e.detailCode, e.details)
}
