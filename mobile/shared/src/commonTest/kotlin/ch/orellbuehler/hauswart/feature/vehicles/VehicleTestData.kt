package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.testing.TestApp

private fun String?.json(): String = if (this == null) "null" else "\"$this\""

internal fun vehicleJson(
    plate: String? = "ZH 123456",
    unit: String = "km",
    odometer: Double? = 45200.0,
    odometerDate: String = "2026-10-01",
    firstRegistration: String? = "2019-05-03",
    fuelType: String? = "petrol",
    costBookId: String? = null,
    vin: String? = null,
): String =
    """{"assetId":"a1","plate":${plate.json()},"vin":${vin.json()},"registrationNumber":null,"firstRegistration":${firstRegistration.json()},
        "fuelType":${fuelType.json()},"tireSizeSummer":"205/55 R16","tireSizeWinter":"195/65 R15","location":null,"odometerUnit":"$unit","notes":null,
        "costBookId":${costBookId.json()},
        "odometer":${if (odometer == null) "null" else """{"value":$odometer,"date":"$odometerDate","unit":"$unit"}"""},"updatedAt":null}"""

internal fun readingJson(
    id: String,
    value: Double,
    date: String,
    source: String = "manual",
    note: String? = null,
): String =
    """{"id":"$id","assetId":"a1","date":"$date","value":$value,"source":"$source","sourceId":null,"note":${note.json()},
        "createdBy":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

internal fun tireSetJson(
    id: String,
    season: String = "winter",
    mounted: Boolean = false,
    retired: Boolean = false,
    tread: Double? = 6.5,
    treadWarning: Boolean = false,
    age: Double? = null,
    mountedOn: String? = null,
): String =
    """{"id":"$id","assetId":"a1","season":"$season","brand":"Beispiel","model":null,"size":"195/65 R15","dot":null,"treadDepthMm":${tread ?: "null"},
        "treadMeasuredOn":${if (tread != null) "\"2026-09-01\"" else "null"},"treadWarning":$treadWarning,"ageYears":${age ?: "null"},
        "storageLocation":null,"storageContactId":null,"storageContactName":null,"mounted":$mounted,"mountedOn":${mountedOn.json()},"purchasedOn":null,
        "retiredAt":${if (retired) "\"2026-05-01T00:00:00.000Z\"" else "null"},"notes":null,"distance":null,"odometerUnit":"km",
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

internal fun fuelLogJson(
    id: String,
    date: String = "2026-10-01",
    odometer: Double = 45000.0,
    quantity: Double = 40.0,
    amountMinor: Long = 7200,
    fullTank: Boolean = true,
    consumption: Double? = null,
    costEntryId: String? = "c1",
    bookId: String? = "b1",
    station: String? = "Beispiel-Tankstelle",
): String =
    """{"id":"$id","assetId":"a1","date":"$date","odometer":$odometer,"odometerUnit":"km","quantity":$quantity,"unit":"l","amountMinor":$amountMinor,
        "currency":"CHF","fullTank":$fullTank,"missedPrevious":false,"station":${station.json()},"notes":null,"costEntryId":${costEntryId.json()},
        "bookId":${bookId.json()},"bookName":${if (bookId != null) "\"Auto\"" else "null"},"paidByUserId":"u1","pricePerUnitMinor":${if (amountMinor > 0) 180.0 else "null"},
        "distance":${if (consumption != null) 600.0 else "null"},"consumptionPer100":${consumption ?: "null"},"costPerDistanceMinor":${if (consumption != null) 12.0 else "null"},
        "createdBy":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

internal fun bookJson(
    id: String,
    name: String,
    isDefault: Boolean = false,
    archived: Boolean = false,
): String =
    """{"id":"$id","name":"$name","slug":"$id","icon":null,"defaultSplitMode":"ownership","taxRelevant":false,
        "archivedAt":${if (archived) "\"2026-01-01T00:00:00.000Z\"" else "null"},"sortOrder":0,"isDefault":$isDefault,"entryCount":0,"settlementCount":0,
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

internal fun page(vararg items: String) = """{"items":[${items.joinToString(",")}],"nextCursor":null}"""

internal fun TestApp.vehicleBasics(vehicle: String = vehicleJson()) {
    household()
    on("GET", "/api/v1/assets/a1/vehicle", vehicle)
    on(
        "GET",
        "/api/v1/cost-books",
        page(bookJson("b1", "Auto", isDefault = true), bookJson("b2", "Haushalt"), bookJson("b3", "Alt", archived = true)),
    )
}

internal fun statsJson(
    year: Int? = null,
    distance: Double = 12000.0,
    totalMinor: Long = 250000,
    count: Int = 12,
    otherCurrency: Int = 0,
    from: String? = "2023-04-01",
    withFuel: Boolean = true,
): String =
    """{"assetId":"a1","year":${year ?: "null"},"from":${if (from == null) "null" else "\"$from\""},"to":null,"odometerUnit":"km","distance":$distance,
        "distanceByMonth":[{"month":"2026-01","distance":500},{"month":"2026-02","distance":1000}],
        "costs":{"currency":"CHF","totalMinor":$totalMinor,"count":$count,"otherCurrencyCount":$otherCurrency,
          "byCategory":[{"category":"fuel","totalMinor":${totalMinor / 2},"count":6},{"category":"insurance","totalMinor":${totalMinor / 4},"count":1}]},
        "costPerDistanceMinor":20.8,
        "consumption":${if (withFuel) {
        """[{"unit":"l","averagePer100":7.5,"stretchCount":3,"last":[
          {"fillId":"f1","date":"2026-08-01","distance":600,"quantity":40,"consumptionPer100":6.7},
          {"fillId":"f2","date":"2026-09-01","distance":600,"quantity":48,"consumptionPer100":8.0}]}]"""
    } else {
        "[]"
    }},
        "priceTrend":${if (withFuel) """[{"fillId":"f1","date":"2026-08-01","unit":"l","pricePerUnitMinor":179.0},{"fillId":"f2","date":"2026-09-01","unit":"l","pricePerUnitMinor":183.9}]""" else "[]"},
        "tireSet":null,
        "nextTasks":[{"taskId":"k1","title":"Service","category":"maintenance","priority":"normal","assetId":"a1","assetName":"Auto","roomId":null,"roomName":null,
          "assigneeUserId":null,"assigneeName":null,"status":"open","dueKind":"exact","date":"2026-12-01","estimated":false,"estimate":null,"progress":null,
          "stepCount":0,"openNoteCount":0,"odometerAssetId":"a1","nextAppointment":null}]}"""
