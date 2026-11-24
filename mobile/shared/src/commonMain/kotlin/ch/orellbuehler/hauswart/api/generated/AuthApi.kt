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

class AuthApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Sign in with a username and password
     *
     * Starts a browser session (sets the session cookie). Failed attempts are rate limited per user and client address.
     */
    suspend fun authLogin(
        body: AuthLoginRequest,
    ): AuthLoginResponse =
        http.json("POST", "/api/v1/auth/login", emptyList(), AuthLoginRequest.serializer(), body, AuthLoginResponse.serializer())

    /**
     * The calling user, how they authenticated and their effective scopes
     */
    suspend fun authMe(): AuthMeResponse =
        http.json("GET", "/api/v1/auth/me", emptyList(), AuthMeResponse.serializer())

    /**
     * Exchange a username and password for a device token
     *
     * Issues a `mobile` bearer token (scopes read, write, docs:write, costs:write; valid for 90 days). The token is shown once. Failed attempts share the login rate limit.
     */
    suspend fun authToken(
        body: AuthTokenRequest,
    ): AuthTokenResponse =
        http.json("POST", "/api/v1/auth/token", emptyList(), AuthTokenRequest.serializer(), body, AuthTokenResponse.serializer())

    /**
     * Revoke the token used for this request
     */
    suspend fun authRevokeToken() =
        http.empty("DELETE", "/api/v1/auth/token", emptyList())
}

@Serializable
data class AuthLoginRequest(
    val username: String,
    val password: String,
)

@Serializable
data class AuthLoginResponse(
    val user: User,
)

@Serializable
data class AuthMeResponse(
    val user: User,
    /** session | token */
    val auth: String,
    /** read | write | docs:write | costs:write | ha:action | admin */
    val scopes: List<String>,
) {
    companion object {
        val AUTH_VALUES: List<String> = listOf("session", "token")
        val SCOPES_VALUES: List<String> = listOf("read", "write", "docs:write", "costs:write", "ha:action", "admin")
    }
}

@Serializable
data class AuthTokenRequest(
    val username: String,
    val password: String,
    val deviceName: String,
    val platform: String? = null,
)

@Serializable
data class AuthTokenResponse(
    val token: String,
    /** date-time */
    val expiresAt: String,
    val user: User,
)
