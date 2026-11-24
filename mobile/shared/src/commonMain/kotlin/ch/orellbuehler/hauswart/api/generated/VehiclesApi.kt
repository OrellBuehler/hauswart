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

class VehiclesApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * Details of a vehicle
     *
     * Plate, VIN, registration data, tire sizes, where it is kept and the newest odometer reading. A vehicle whose details were never saved answers with empty ones (and kilometres). Only a vehicle has this: 404 `not_found` for an asset of another kind, as for a missing asset.
     */
    suspend fun vehiclesGet(
        id: String,
    ): Vehicle =
        http.json("GET", "/api/v1/assets/${ApiHttp.segment(id)}/vehicle", emptyList(), Vehicle.serializer())

    /**
     * Save the details of a vehicle
     *
     * Replaces the details: a field left out is cleared and the odometer unit goes back to km. Changing the unit relabels the readings, it does not convert them. `costBookId` is the cost book the fuel fills of the vehicle are booked into when a fill names none (an open book, else 400 on `costBookId`; omitted it is cleared like every other field). Only a vehicle can take this: 400 `invalid_request` for an asset of another kind, 404 `not_found` for a missing asset.
     */
    suspend fun vehiclesPut(
        id: String,
        body: VehiclesPutRequest,
    ): Vehicle =
        http.json("PUT", "/api/v1/assets/${ApiHttp.segment(id)}/vehicle", emptyList(), VehiclesPutRequest.serializer(), body, Vehicle.serializer())

    /**
     * A vehicle in numbers
     *
     * For a year (year=) or for all time: distance driven (from the odometer readings, per month too), the cost entries of the vehicle that count as an expense in the household currency by category and per distance unit, the average and the last ten consumption values (full-to-full) per unit, the price per unit of the fuel, the mounted tire set and the next tasks of the vehicle. Only a vehicle has this: 404 `not_found` for an asset of another kind, as for a missing asset.
     */
    suspend fun vehicleStats(
        id: String,
        year: Long? = null,
    ): VehicleStats =
        http.json("GET", "/api/v1/assets/${ApiHttp.segment(id)}/vehicle/stats", listOf("year" to year), VehicleStats.serializer())

    /**
     * Fuel log (Tankbuch) of a vehicle, newest first
     *
     * Every fill-up or charge with its price per unit and, on a full fill that closes a stretch, the distance since the previous full fill, the consumption per 100 and the cost per distance (full-to-full method: partial fills in between are added up, a fill flagged missedPrevious starts the chain again, litres and kWh are counted apart). Filter by year. Only a vehicle has this: 404 `not_found` for an asset of another kind, as for a missing asset.
     */
    suspend fun fuelLogsList(
        id: String,
        cursor: String? = null,
        limit: Long? = null,
        year: Long? = null,
    ): FuelLogsListResponse =
        http.json("GET", "/api/v1/assets/${ApiHttp.segment(id)}/fuel-logs", listOf("cursor" to cursor, "limit" to limit, "year" to year), FuelLogsListResponse.serializer())

    /**
     * Log a fill-up or charge
     *
     * In one transaction: the odometer becomes a reading of the vehicle (source fuel_log; a value lower than the reading before is a 400 on odometer) and, unless amountMinor is 0, a cost entry of the category fuel is booked for the vehicle (title like "Tanken <station>", paid by paidByUserId, default the caller, split by splitMode, default the split of its book). The book is bookId (an open book, else 400 on bookId), else the vehicle's own book (costBookId of its details, while that book is open), else the default book. The cost entry is the fuel log entry's own: its amount, currency and date change through PATCH /fuel-logs/{id} only, and its device stays the vehicle. It needs costs:write because it books money. `receiptTaskId` books the fill for a task of the receipt queue: its cost entry is flagged `reviewNeeded` and recorded on the task (`bookedSoFar`), as for `POST /costs` (400 on the field for an unknown task or a free fill, which has no cost entry; 409 for a task that is not waiting any more). A reading below the one before its date or above the one after it is a 400 on the value field (`odometer` here) whose `details` carry `code` (`lower_than_previous` or `higher_than_next`), `field` and `reading` (`{value, date}` of the neighbouring reading in the way) besides the English field error; no such code for any other problem. Only a vehicle can take this: 400 `invalid_request` for an asset of another kind, 404 `not_found` for a missing asset.
     */
    suspend fun fuelLogsCreate(
        id: String,
        body: FuelLogsCreateRequest,
    ): FuelLog =
        http.json("POST", "/api/v1/assets/${ApiHttp.segment(id)}/fuel-logs", emptyList(), FuelLogsCreateRequest.serializer(), body, FuelLog.serializer())

    /**
     * A fuel log entry
     */
    suspend fun fuelLogsGet(
        id: String,
    ): FuelLog =
        http.json("GET", "/api/v1/fuel-logs/${ApiHttp.segment(id)}", emptyList(), FuelLog.serializer())

    /**
     * Change a fuel log entry
     *
     * The reading follows the date and the odometer; the cost entry follows the amount, currency, date, station, payer, split and book (`bookId` moves it to another open book; a tax class is reset when the book is not tax relevant, as for any move). The fuel log entry owns the amount, currency and date of its cost entry: they change here only (`PATCH /costs/{id}` refuses other values, and any other device, with 409 `conflict`, `details.fuelLogId`; the cost entry's `fuelLogId` points back). A change of station or unit rewrites the cost entry's title and payee only while each still is what this entry wrote there last time, so a title or payee edited on the cost entry stays. An entry made free loses its cost entry, one that costs something now and has none gets one. A reading below the one before its date or above the one after it is a 400 on the value field (`odometer` here) whose `details` carry `code` (`lower_than_previous` or `higher_than_next`), `field` and `reading` (`{value, date}` of the neighbouring reading in the way) besides the English field error; no such code for any other problem.
     */
    suspend fun fuelLogsUpdate(
        id: String,
        body: FuelLogsUpdateRequest,
    ): FuelLog =
        http.json("PATCH", "/api/v1/fuel-logs/${ApiHttp.segment(id)}", emptyList(), FuelLogsUpdateRequest.serializer(), body, FuelLog.serializer())

    /**
     * Delete a fuel log entry
     *
     * The odometer reading it wrote and the cost entry it booked are deleted with it (receipts attached to that cost entry too); the cost entry cannot be deleted on its own (`DELETE /costs/{id}` is a 409 `conflict`, `details.fuelLogId`).
     */
    suspend fun fuelLogsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/fuel-logs/${ApiHttp.segment(id)}", emptyList())

    /**
     * Tire sets of a vehicle
     *
     * The mounted set first, then by season; retired sets only with includeRetired=true. Each set carries the distance driven on it, a treadWarning (below 3 mm for summer, 4 mm for winter and all-season) and its age from the DOT code. Only a vehicle has this: 404 `not_found` for an asset of another kind, as for a missing asset.
     */
    suspend fun tireSetsList(
        id: String,
        cursor: String? = null,
        limit: Long? = null,
        includeRetired: Boolean? = null,
    ): TireSetsListResponse =
        http.json("GET", "/api/v1/assets/${ApiHttp.segment(id)}/tire-sets", listOf("cursor" to cursor, "limit" to limit, "includeRetired" to includeRetired), TireSetsListResponse.serializer())

    /**
     * Add a tire set to a vehicle
     *
     * The set is not mounted; mount it with the mount endpoint. Only a vehicle can take this: 400 `invalid_request` for an asset of another kind, 404 `not_found` for a missing asset.
     */
    suspend fun tireSetsCreate(
        id: String,
        body: TireSetsCreateRequest,
    ): TireSetDetail =
        http.json("POST", "/api/v1/assets/${ApiHttp.segment(id)}/tire-sets", emptyList(), TireSetsCreateRequest.serializer(), body, TireSetDetail.serializer())

    /**
     * A tire set with its mount and measurement history
     */
    suspend fun tireSetsGet(
        id: String,
    ): TireSetDetail =
        http.json("GET", "/api/v1/tire-sets/${ApiHttp.segment(id)}", emptyList(), TireSetDetail.serializer())

    /**
     * Change or retire a tire set
     *
     * Whether the set is mounted and its tread depth change through the mount and tread endpoints only. retired: true takes a mounted set off first.
     */
    suspend fun tireSetsUpdate(
        id: String,
        body: TireSetsUpdateRequest,
    ): TireSetDetail =
        http.json("PATCH", "/api/v1/tire-sets/${ApiHttp.segment(id)}", emptyList(), TireSetsUpdateRequest.serializer(), body, TireSetDetail.serializer())

    /**
     * Delete a tire set
     *
     * Its events, the odometer readings they wrote and its attachments go with it. Retire the set instead to keep its history.
     */
    suspend fun tireSetsDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/tire-sets/${ApiHttp.segment(id)}", emptyList())

    /**
     * Mount a tire set
     *
     * Takes the mounted set off (an unmounted event of the same day) and mounts this one. With an odometer value the vehicle gets that reading (source tire_change). A reading below the one before its date or above the one after it is a 400 on the value field (`odometer` here) whose `details` carry `code` (`lower_than_previous` or `higher_than_next`), `field` and `reading` (`{value, date}` of the neighbouring reading in the way) besides the English field error; no such code for any other problem. Nothing is changed when the odometer value is refused or when the date is before the day the set that would be taken off was mounted (400 on `date`; the same day is fine). 409 for a retired set and for one that is already mounted. Only a vehicle can take this: 400 `invalid_request` for an asset of another kind, 404 `not_found` for a missing asset.
     */
    suspend fun tireSetsMount(
        id: String,
        setId: String,
        body: TireSetsMountRequest,
    ): TireSetDetail =
        http.json("POST", "/api/v1/assets/${ApiHttp.segment(id)}/tire-sets/${ApiHttp.segment(setId)}/mount", emptyList(), TireSetsMountRequest.serializer(), body, TireSetDetail.serializer())

    /**
     * Record a tread depth measurement
     *
     * Adds a measurement event; the newest measurement is the set's current depth. With an odometer value the vehicle gets that reading as well. A reading below the one before its date or above the one after it is a 400 on the value field (`odometer` here) whose `details` carry `code` (`lower_than_previous` or `higher_than_next`), `field` and `reading` (`{value, date}` of the neighbouring reading in the way) besides the English field error; no such code for any other problem.
     */
    suspend fun tireSetsTread(
        id: String,
        body: TireSetsTreadRequest,
    ): TireSetDetail =
        http.json("POST", "/api/v1/tire-sets/${ApiHttp.segment(id)}/tread", emptyList(), TireSetsTreadRequest.serializer(), body, TireSetDetail.serializer())

    /**
     * Odometer readings of a vehicle, newest first
     *
     * Every reading ever recorded, by date and then by when it was entered. Readings are never pruned. Only a vehicle has this: 404 `not_found` for an asset of another kind, as for a missing asset.
     */
    suspend fun odometerList(
        id: String,
        cursor: String? = null,
        limit: Long? = null,
    ): OdometerListResponse =
        http.json("GET", "/api/v1/assets/${ApiHttp.segment(id)}/odometer", listOf("cursor" to cursor, "limit" to limit), OdometerListResponse.serializer())

    /**
     * Record an odometer reading
     *
     * The date defaults to today and must not be in the future. A value lower than the reading before it or higher than the reading after it (by date) is a 400 on `value` with `details.code` `lower_than_previous` or `higher_than_next`, `details.field` and `details.reading` (`{value, date}` of the reading in the way), unless `force` is true (a replaced instrument cluster). The newest reading becomes the signal `odometer:<asset id>` that tasks with a counter trigger read, so due dates, estimates and notifications follow at once. Only a vehicle can take this: 400 `invalid_request` for an asset of another kind, 404 `not_found` for a missing asset.
     */
    suspend fun odometerCreate(
        id: String,
        body: OdometerCreateRequest,
    ): OdometerReading =
        http.json("POST", "/api/v1/assets/${ApiHttp.segment(id)}/odometer", emptyList(), OdometerCreateRequest.serializer(), body, OdometerReading.serializer())

    /**
     * Delete an odometer reading
     *
     * Deletes a reading a person typed in; the vehicle's newest remaining reading becomes its current one. A reading written for a completion, a service log entry, a fuel log entry or a tire change belongs to that record and goes when the record is changed or deleted: deleting it here is a 409 `conflict` that names the owner (`details.source`, `details.sourceId`). A reading whose record no longer exists is free and can be deleted.
     */
    suspend fun odometerDelete(
        id: String,
    ) =
        http.empty("DELETE", "/api/v1/odometer-readings/${ApiHttp.segment(id)}", emptyList())
}

@Serializable
data class VehiclesPutRequest(
    val plate: Patch<String> = Patch.Keep,
    val vin: Patch<String> = Patch.Keep,
    val registrationNumber: Patch<String> = Patch.Keep,
    /** date */
    val firstRegistration: Patch<String> = Patch.Keep,
    /** petrol | diesel | electric | hybrid | plugin_hybrid | other */
    val fuelType: Patch<String> = Patch.Keep,
    val tireSizeSummer: Patch<String> = Patch.Keep,
    val tireSizeWinter: Patch<String> = Patch.Keep,
    val location: Patch<String> = Patch.Keep,
    /** km | mi */
    val odometerUnit: String? = null,
    val notes: Patch<String> = Patch.Keep,
    val costBookId: Patch<String> = Patch.Keep,
) {
    companion object {
        val FUEL_TYPE_VALUES: List<String> = listOf("petrol", "diesel", "electric", "hybrid", "plugin_hybrid", "other")
        val ODOMETER_UNIT_VALUES: List<String> = listOf("km", "mi")
    }
}

@Serializable
data class FuelLogsListResponse(
    val items: List<FuelLog>,
    val nextCursor: String?,
)

@Serializable
data class FuelLogsCreateRequestSharesItem(
    val userId: String,
    val shareBps: Long,
)

@Serializable
data class FuelLogsCreateRequest(
    /** date */
    val date: String? = null,
    val odometer: Double,
    val quantity: Double,
    /** l | kWh */
    val unit: String? = null,
    val amountMinor: Long,
    val currency: String? = null,
    val fullTank: Boolean? = null,
    val missedPrevious: Boolean? = null,
    val station: String? = null,
    val notes: String? = null,
    val bookId: String? = null,
    val paidByUserId: String? = null,
    /** ownership | equal | custom | none */
    val splitMode: String? = null,
    val shares: List<FuelLogsCreateRequestSharesItem>? = null,
    val receiptTaskId: String? = null,
) {
    companion object {
        val UNIT_VALUES: List<String> = listOf("l", "kWh")
        val SPLIT_MODE_VALUES: List<String> = listOf("ownership", "equal", "custom", "none")
    }
}

@Serializable
data class FuelLogsUpdateRequestSharesItem(
    val userId: String,
    val shareBps: Long,
)

@Serializable
data class FuelLogsUpdateRequest(
    /** date */
    val date: String? = null,
    val odometer: Double? = null,
    val quantity: Double? = null,
    /** l | kWh */
    val unit: String? = null,
    val amountMinor: Long? = null,
    val currency: String? = null,
    val fullTank: Boolean? = null,
    val missedPrevious: Boolean? = null,
    val station: Patch<String> = Patch.Keep,
    val notes: Patch<String> = Patch.Keep,
    val bookId: String? = null,
    val paidByUserId: Patch<String> = Patch.Keep,
    /** ownership | equal | custom | none */
    val splitMode: String? = null,
    val shares: List<FuelLogsUpdateRequestSharesItem>? = null,
) {
    companion object {
        val UNIT_VALUES: List<String> = listOf("l", "kWh")
        val SPLIT_MODE_VALUES: List<String> = listOf("ownership", "equal", "custom", "none")
    }
}

@Serializable
data class TireSetsListResponse(
    val items: List<TireSet>,
    val nextCursor: String?,
)

@Serializable
data class TireSetsCreateRequest(
    /** summer | winter | all_season */
    val season: String,
    val brand: String? = null,
    val model: String? = null,
    val size: String? = null,
    val dot: String? = null,
    val treadDepthMm: Double? = null,
    /** date */
    val treadMeasuredOn: String? = null,
    val storageLocation: String? = null,
    val storageContactId: String? = null,
    /** date */
    val purchasedOn: String? = null,
    val notes: String? = null,
) {
    companion object {
        val SEASON_VALUES: List<String> = listOf("summer", "winter", "all_season")
    }
}

@Serializable
data class TireSetsUpdateRequest(
    /** summer | winter | all_season */
    val season: String? = null,
    val brand: Patch<String> = Patch.Keep,
    val model: Patch<String> = Patch.Keep,
    val size: Patch<String> = Patch.Keep,
    val dot: Patch<String> = Patch.Keep,
    val storageLocation: Patch<String> = Patch.Keep,
    val storageContactId: Patch<String> = Patch.Keep,
    /** date */
    val purchasedOn: Patch<String> = Patch.Keep,
    val notes: Patch<String> = Patch.Keep,
    val retired: Boolean? = null,
) {
    companion object {
        val SEASON_VALUES: List<String> = listOf("summer", "winter", "all_season")
    }
}

@Serializable
data class TireSetsMountRequest(
    /** date */
    val date: String? = null,
    val odometer: Double? = null,
)

@Serializable
data class TireSetsTreadRequest(
    /** date */
    val date: String? = null,
    val treadDepthMm: Double,
    val odometer: Double? = null,
)

@Serializable
data class OdometerListResponse(
    val items: List<OdometerReading>,
    val nextCursor: String?,
)

@Serializable
data class OdometerCreateRequest(
    /** date */
    val date: String? = null,
    val value: Double,
    val note: String? = null,
    val force: Boolean? = null,
)
