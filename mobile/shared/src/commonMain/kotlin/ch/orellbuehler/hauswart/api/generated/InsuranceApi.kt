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

class InsuranceApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * List insurance policies
     *
     * Active policies by cancellation deadline (those without one last), then title. Filter by covered asset, type and a text (q: title, policy number or the insurer's name); archived=true lists the archived ones instead. Every policy carries the assets it covers, the insurer's name, the premium normalised to a year and the cancellation deadline derived from the end date and the notice period.
     *
     * @param type motor_liability | motor_partial_casco | motor_full_casco | household | personal_liability | building | legal | travel | health | life | other
     */
    suspend fun insurancePoliciesList(
        cursor: String? = null,
        limit: Long? = null,
        assetId: String? = null,
        type: String? = null,
        archived: Boolean? = null,
        q: String? = null,
    ): InsurancePoliciesListResponse =
        http.json("GET", "/api/v1/insurance-policies", listOf("cursor" to cursor, "limit" to limit, "assetId" to assetId, "type" to type, "archived" to archived, "q" to q), InsurancePoliciesListResponse.serializer())

    /**
     * Create an insurance policy
     *
     * currency defaults to the household's. A policy that renews by itself (renewal auto) with an end date and a notice period gets a cancellation deadline and keeps a reminder task due on that day. endDate is the last day of cover.
     */
    suspend fun insurancePoliciesCreate(
        body: InsurancePoliciesCreateRequest,
    ): InsurancePolicy =
        http.json("POST", "/api/v1/insurance-policies", emptyList(), InsurancePoliciesCreateRequest.serializer(), body, InsurancePolicy.serializer())

    /**
     * Get an insurance policy
     */
    suspend fun insurancePoliciesGet(
        id: String,
    ): InsurancePolicy =
        http.json("GET", "/api/v1/insurance-policies/${ApiHttp.segment(id)}", emptyList(), InsurancePolicy.serializer())

    /**
     * Update an insurance policy
     *
     * assetIds replaces the covered assets; archived archives or restores the policy (its reminder task follows). After an automatic renewal, move endDate to the end of the next term: the cancellation deadline and the reminder follow.
     */
    suspend fun insurancePoliciesUpdate(
        id: String,
        body: InsurancePoliciesUpdateRequest,
    ): InsurancePolicy =
        http.json("PATCH", "/api/v1/insurance-policies/${ApiHttp.segment(id)}", emptyList(), InsurancePoliciesUpdateRequest.serializer(), body, InsurancePolicy.serializer())

    /**
     * Delete an insurance policy
     *
     * Comments, attachments, document links and reminder tasks go with it. Archive the policy to keep it.
     */
    suspend fun insurancePoliciesDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/insurance-policies/${ApiHttp.segment(id)}", emptyList())

    /**
     * Insurance policies that cover an asset
     *
     * The same policies as GET /insurance-policies?assetId=, for the asset page; 404 for an unknown asset. Active policies unless archived=true.
     */
    suspend fun assetInsurancePoliciesList(
        id: String,
        cursor: String? = null,
        limit: Long? = null,
        archived: Boolean? = null,
    ): AssetInsurancePoliciesListResponse =
        http.json("GET", "/api/v1/assets/${ApiHttp.segment(id)}/insurance-policies", listOf("cursor" to cursor, "limit" to limit, "archived" to archived), AssetInsurancePoliciesListResponse.serializer())
}

@Serializable
data class InsurancePoliciesListResponse(
    val items: List<InsurancePolicy>,
    val nextCursor: String?,
)

@Serializable
data class InsurancePoliciesCreateRequest(
    val title: String,
    /** motor_liability | motor_partial_casco | motor_full_casco | household | personal_liability | building | legal | travel | health | life | other */
    val type: String? = null,
    val insurerContactId: String? = null,
    val policyNumber: String? = null,
    val premiumMinor: Long,
    val currency: String? = null,
    /** monthly | quarterly | semiannual | annual */
    val premiumPeriod: String? = null,
    val deductibleMinor: Long? = null,
    /** date */
    val startDate: String,
    /** date */
    val endDate: String? = null,
    /** auto | fixed */
    val renewal: String? = null,
    val cancellationNoticeMonths: Long? = null,
    val assistancePhone: String? = null,
    val showOnEmergency: Boolean? = null,
    val notes: String? = null,
    val assetIds: List<String>? = null,
) {
    companion object {
        val TYPE_VALUES: List<String> = listOf("motor_liability", "motor_partial_casco", "motor_full_casco", "household", "personal_liability", "building", "legal", "travel", "health", "life", "other")
        val PREMIUM_PERIOD_VALUES: List<String> = listOf("monthly", "quarterly", "semiannual", "annual")
        val RENEWAL_VALUES: List<String> = listOf("auto", "fixed")
    }
}

@Serializable
data class InsurancePoliciesUpdateRequest(
    val title: String? = null,
    /** motor_liability | motor_partial_casco | motor_full_casco | household | personal_liability | building | legal | travel | health | life | other */
    val type: String? = null,
    val insurerContactId: Patch<String> = Patch.Keep,
    val policyNumber: Patch<String> = Patch.Keep,
    val premiumMinor: Long? = null,
    val currency: String? = null,
    /** monthly | quarterly | semiannual | annual */
    val premiumPeriod: String? = null,
    val deductibleMinor: Patch<Long> = Patch.Keep,
    /** date */
    val startDate: String? = null,
    /** date */
    val endDate: Patch<String> = Patch.Keep,
    /** auto | fixed */
    val renewal: String? = null,
    val cancellationNoticeMonths: Patch<Long> = Patch.Keep,
    val assistancePhone: Patch<String> = Patch.Keep,
    val showOnEmergency: Boolean? = null,
    val notes: Patch<String> = Patch.Keep,
    val assetIds: List<String>? = null,
    val archived: Boolean? = null,
) {
    companion object {
        val TYPE_VALUES: List<String> = listOf("motor_liability", "motor_partial_casco", "motor_full_casco", "household", "personal_liability", "building", "legal", "travel", "health", "life", "other")
        val PREMIUM_PERIOD_VALUES: List<String> = listOf("monthly", "quarterly", "semiannual", "annual")
        val RENEWAL_VALUES: List<String> = listOf("auto", "fixed")
    }
}

@Serializable
data class AssetInsurancePoliciesListResponse(
    val items: List<InsurancePolicy>,
    val nextCursor: String?,
)
