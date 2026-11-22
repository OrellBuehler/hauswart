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

class IntegrationsApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * The integrations and their connection status
     *
     * One entry per kind: the household's connection, or the caller's own for kinds each person connects. Never contains the access token; the address and settings of a household connection are shown to administrators only.
     */
    suspend fun integrationsList(): IntegrationsListResponse =
        http.json("GET", "/api/v1/integrations", emptyList(), IntegrationsListResponse.serializer())

    /**
     * Create or change a connection
     *
     * Household-level kinds need an administrator. A new connection needs the token, and so does a changed address (a stored token is never sent to another host); a blank token keeps the stored one. The status resets to `unknown` until the next check.
     */
    suspend fun integrationsSave(
        kind: String,
        body: IntegrationsSaveRequest,
    ): Integration =
        http.json("PUT", "/api/v1/integrations/${ApiHttp.segment(kind)}", emptyList(), IntegrationsSaveRequest.serializer(), body, Integration.serializer())

    /**
     * Remove a connection
     *
     * Household-level kinds need an administrator. Tasks, assets and hints that refer to the system keep working without live data.
     */
    suspend fun integrationsDelete(
        kind: String,
    ) =
        http.empty("DELETE", "/api/v1/integrations/${ApiHttp.segment(kind)}", emptyList())

    /**
     * Check the connection now
     *
     * Calls the system once and records the outcome as the connection's status. An unreachable system is a normal answer (`ok: false` with an error code and message), not an HTTP error. Household-level kinds need an administrator.
     */
    suspend fun integrationsTest(
        kind: String,
    ): IntegrationTest =
        http.json("POST", "/api/v1/integrations/${ApiHttp.segment(kind)}/test", emptyList(), IntegrationTest.serializer())

    /**
     * Entities of the connected system (entity picker)
     *
     * From a short-lived cache of the system's states. Filter by `q` (id or name) and `domain`. 404 when the kind has no connection or no such operation; 502 `upstream_error` when the system does not answer.
     */
    suspend fun integrationsEntities(
        kind: String,
        q: String? = null,
        domain: String? = null,
        limit: Long? = null,
    ): IntegrationsEntitiesResponse =
        http.json("GET", "/api/v1/integrations/${ApiHttp.segment(kind)}/entities", listOf("q" to q, "domain" to domain, "limit" to limit), IntegrationsEntitiesResponse.serializer())

    /**
     * Notify services of the connected system
     *
     * Candidates for a person's notification targets.
     */
    suspend fun integrationsNotifyServices(
        kind: String,
    ): IntegrationsNotifyServicesResponse =
        http.json("GET", "/api/v1/integrations/${ApiHttp.segment(kind)}/notify-services", emptyList(), IntegrationsNotifyServicesResponse.serializer())

    /**
     * Calendars of the connected system
     */
    suspend fun integrationsCalendars(
        kind: String,
    ): IntegrationsCalendarsResponse =
        http.json("GET", "/api/v1/integrations/${ApiHttp.segment(kind)}/calendars", emptyList(), IntegrationsCalendarsResponse.serializer())

    /**
     * Devices of the connected system that no asset represents yet
     *
     * Suggestions for the inventory: manufacturer, model, name and area of every enabled device that matches no asset (by external reference, name, or manufacturer and model). Creating an asset from one is a separate call with `externalSource` and `externalRef`.
     */
    suspend fun integrationsDevices(
        kind: String,
    ): IntegrationsDevicesResponse =
        http.json("GET", "/api/v1/integrations/${ApiHttp.segment(kind)}/devices", emptyList(), IntegrationsDevicesResponse.serializer())

    /**
     * Areas of the connected system (area picker)
     *
     * Every area with its name, the name of its floor when the system has floors, and the id of the room that already stores it in `haAreaId` (null when none does). Candidates for `POST /rooms/import-areas`. 404 without a connection or for a kind without areas; 502 `upstream_error` when the system does not answer.
     */
    suspend fun integrationsAreas(
        kind: String,
    ): IntegrationsAreasResponse =
        http.json("GET", "/api/v1/integrations/${ApiHttp.segment(kind)}/areas", emptyList(), IntegrationsAreasResponse.serializer())

    /**
     * Tags of the connected document system
     *
     * From the caller's own connection (each person connects their own account). 404 without a connection or for a kind without tags; 502 `upstream_error` when the system does not answer.
     */
    suspend fun integrationsTags(
        kind: String,
        q: String? = null,
    ): IntegrationsTagsResponse =
        http.json("GET", "/api/v1/integrations/${ApiHttp.segment(kind)}/tags", listOf("q" to q), IntegrationsTagsResponse.serializer())

    /**
     * Correspondents of the connected document system
     */
    suspend fun integrationsCorrespondents(
        kind: String,
        q: String? = null,
    ): IntegrationsCorrespondentsResponse =
        http.json("GET", "/api/v1/integrations/${ApiHttp.segment(kind)}/correspondents", listOf("q" to q), IntegrationsCorrespondentsResponse.serializer())

    /**
     * Custom fields of the connected document system
     *
     * Candidates for the warranty fields: pick date fields.
     */
    suspend fun integrationsCustomFields(
        kind: String,
        q: String? = null,
    ): IntegrationsCustomFieldsResponse =
        http.json("GET", "/api/v1/integrations/${ApiHttp.segment(kind)}/custom-fields", listOf("q" to q), IntegrationsCustomFieldsResponse.serializer())

    /**
     * Groups of the connected document system
     *
     * Candidates for the groups that get access to pushed documents. The account needs the permission to view groups, otherwise 502 `upstream_error` with `details.code` `forbidden`.
     */
    suspend fun integrationsGroups(
        kind: String,
        q: String? = null,
    ): IntegrationsGroupsResponse =
        http.json("GET", "/api/v1/integrations/${ApiHttp.segment(kind)}/groups", listOf("q" to q), IntegrationsGroupsResponse.serializer())

    /**
     * Storage paths of the connected document system
     */
    suspend fun integrationsStoragePaths(
        kind: String,
        q: String? = null,
    ): IntegrationsStoragePathsResponse =
        http.json("GET", "/api/v1/integrations/${ApiHttp.segment(kind)}/storage-paths", listOf("q" to q), IntegrationsStoragePathsResponse.serializer())

    /**
     * Categories of the connected finance app (category map picker)
     *
     * Your own connection only. 404 when you have no connection of this kind or it has no such operation; 502 `upstream_error` when the system does not answer.
     */
    suspend fun integrationsCategories(
        kind: String,
    ): IntegrationsCategoriesResponse =
        http.json("GET", "/api/v1/integrations/${ApiHttp.segment(kind)}/categories", emptyList(), IntegrationsCategoriesResponse.serializer())

    /**
     * Accounts of the connected finance app
     */
    suspend fun integrationsAccounts(
        kind: String,
    ): IntegrationsAccountsResponse =
        http.json("GET", "/api/v1/integrations/${ApiHttp.segment(kind)}/accounts", emptyList(), IntegrationsAccountsResponse.serializer())
}

@Serializable
data class IntegrationsListResponse(
    val items: List<Integration>,
    val nextCursor: String?,
)

@Serializable
data class IntegrationsSaveRequest(
    val baseUrl: String,
    val token: String? = null,
    val allowInsecureTls: Boolean? = null,
    val config: JsonObject? = null,
    val enabled: Boolean? = null,
)

@Serializable
data class IntegrationsEntitiesResponse(
    val items: List<ExternalEntity>,
    val total: Long,
)

@Serializable
data class IntegrationsNotifyServicesResponse(
    val items: List<String>,
)

@Serializable
data class IntegrationsCalendarsResponse(
    val items: List<ExternalCalendar>,
)

@Serializable
data class IntegrationsDevicesResponse(
    val items: List<ExternalDevice>,
)

@Serializable
data class IntegrationsAreasResponse(
    val items: List<ExternalArea>,
)

@Serializable
data class IntegrationsTagsResponse(
    val items: List<ExternalTag>,
)

@Serializable
data class IntegrationsCorrespondentsResponse(
    val items: List<ExternalCorrespondent>,
)

@Serializable
data class IntegrationsCustomFieldsResponse(
    val items: List<ExternalCustomField>,
)

@Serializable
data class IntegrationsGroupsResponse(
    val items: List<ExternalGroup>,
)

@Serializable
data class IntegrationsStoragePathsResponse(
    val items: List<ExternalStoragePath>,
)

@Serializable
data class IntegrationsCategoriesResponse(
    val items: List<FinanceCategory>,
)

@Serializable
data class IntegrationsAccountsResponse(
    val items: List<FinanceAccount>,
)
