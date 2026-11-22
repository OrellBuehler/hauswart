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

class McpApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * MCP server (Streamable HTTP, stateless)
     *
     * The Model Context Protocol server of hauswart, for Claude Code and other MCP clients: `claude mcp add --transport http hauswart <address>/api/v1/mcp --header "Authorization: Bearer hw_..."`. Every POST carries one JSON-RPC message and is answered on its own (no session; the `Mcp-Session-Id` header is not used) with `application/json`; a notification is answered with 202 and no body. GET and DELETE are 405. The tools run through this API with the caller's token, so they offer what its scopes allow and completions are attributed to the token's kind. A request with an `Origin` header other than the app's own is refused with 403 `csrf_failed` (DNS rebinding); clients that are not browsers send none. Protocol and tools: mcp/README.md.
     */
    suspend fun mcp(
        body: JsonElement,
    ): String =
        http.json("POST", "/api/v1/mcp", emptyList(), JsonElement.serializer(), body, String.serializer())
}
