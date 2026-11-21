package ch.orellbuehler.hauswart.feature.inventory

import ch.orellbuehler.hauswart.api.ApiHttp
import ch.orellbuehler.hauswart.api.generated.Asset
import ch.orellbuehler.hauswart.api.generated.Task

internal fun decodeAsset(json: String): Asset = ApiHttp.JSON.decodeFromString(Asset.serializer(), json)

internal fun decodeTask(json: String): Task = ApiHttp.JSON.decodeFromString(Task.serializer(), json)

internal fun String?.json(): String = if (this == null) "null" else "\"$this\""

internal fun page(vararg items: String) = """{"items":[${items.joinToString(",")}],"nextCursor":null}"""

internal fun assetJson(
    id: String,
    name: String,
    kind: String = "device",
    roomId: String? = null,
    roomName: String? = null,
    warrantyUntil: String? = null,
    extended: String? = null,
    archived: Boolean = false,
    plate: String? = null,
    manufacturer: String? = null,
    species: String? = null,
): String =
    """{"id":"$id","kind":"$kind","name":"$name","slug":"$id","qrSlug":"qr$id","roomId":${roomId.json()},"roomName":${roomName.json()},
        "category":null,"manufacturer":${manufacturer.json()},"model":null,"serialNumber":null,"purchaseDate":null,"installedDate":null,
        "warrantyUntil":${warrantyUntil.json()},"warrantyExtendedUntil":${extended.json()},"warrantySource":"manual","showOnEmergency":false,
        "notes":null,"species":${species.json()},"light":null,"waterNotes":null,"photoAttachmentId":null,"photoUrl":null,
        "externalSource":null,"externalRef":null,"archivedAt":${if (archived) "\"2026-02-01T00:00:00.000Z\"" else "null"},"commentCount":0,
        "vehicle":${if (plate == null) "null" else """{"plate":"$plate","odometer":null}"""},
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

internal fun roomJson(
    id: String,
    name: String,
    sortOrder: Int = 0,
    icon: String? = null,
): String =
    """{"id":"$id","name":"$name","slug":"$id","haAreaId":null,"icon":${icon.json()},"sortOrder":$sortOrder,"notes":null,
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

internal fun taskJson(
    id: String,
    status: String,
    dueDate: String? = null,
    assetId: String? = null,
    roomId: String? = null,
    title: String = "Task $id",
    category: String = "maintenance",
): String =
    """{"id":"$id","title":"$title","descriptionMd":"","category":"$category","priority":"normal","effortMinutes":null,
        "assetId":${assetId.json()},"assetName":null,"roomId":${roomId.json()},"roomName":null,
        "trigger":{"type":"interval","v":1,"every":7,"unit":"day","anchor":"completion","startDate":"2026-01-01"},
        "assignMode":"none","assigneeUserId":null,"rotationOrder":[],"rotationStrategy":"alternate","notifyMode":"all","graceDays":0,
        "dueSoonDays":null,"snoozedUntil":null,"archivedAt":null,"source":"manual","externalSource":null,"externalRef":null,
        "externalUrl":null,"createdBy":null,"commentCount":0,"openNoteCount":0,"nextAppointment":null,
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z",
        "state":{"status":"$status","dueDate":${dueDate.json()},"dueKind":"exact","occurrenceKey":"k","windowStart":null,"progress":null,
        "estimate":null,"missedCount":0,"reasons":[],"currentAssigneeUserId":null,"evaluatedAt":"2026-01-01T00:00:00.000Z"}}"""

internal fun hintJson(
    id: String,
    title: String,
    pinned: Boolean = false,
    sortOrder: Int = 0,
    assetId: String = "a1",
): String =
    """{"id":"$id","assetId":"$assetId","assetName":"Oven","title":"$title","bodyMd":"","kind":"tip","pinned":$pinned,"sortOrder":$sortOrder,
        "guestVisible":false,"taskId":null,"taskTitle":null,"reaction":null,"commentCount":0,
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

internal fun noteJson(
    id: String,
    body: String,
    status: String = "open",
): String =
    """{"id":"$id","assetId":"a1","assetName":"Oven","body":"$body","status":"$status","resolvedAt":null,"resolvedBy":null,
        "resolvedByName":null,"serviceLogId":null,"defectId":null,"createdBy":"u1","createdByName":"Anna",
        "createdAt":"2026-01-01T10:00:00.000Z","updatedAt":"2026-01-01T10:00:00.000Z"}"""

internal fun contactJson(
    id: String,
    name: String,
): String =
    """{"id":"$id","kind":"installer","name":"$name","company":null,"phone":null,"email":null,"url":null,"address":null,"notes":null,
        "emergency":false,"guestVisible":false,"sortOrder":0,"externalSource":null,"externalRef":null,
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

internal fun partJson(
    id: String,
    name: String,
    stock: Int = 3,
    min: Int = 1,
): String =
    """{"id":"$id","name":"$name","partNumber":null,"supplier":null,"shopUrl":null,"unitPriceMinor":1250,"currency":"CHF","stockCount":$stock,
        "minStock":$min,"reorderQty":1,"leadTimeDays":0,"orderedAt":null,"orderedQty":0,"lowStock":false,"notes":null,"archivedAt":null,
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

internal fun serviceJson(
    id: String,
    title: String,
    costMinor: Int? = null,
): String =
    """{"id":"$id","assetId":"a1","assetName":"Oven","date":"2026-11-01","kind":"maintenance","title":"$title","descriptionMd":"",
        "contactId":null,"contactName":null,"completionId":null,"costMinor":${costMinor ?: "null"},"currency":${if (costMinor == null) "null" else "\"CHF\""},
        "costEntryId":null,"costs":{"totalMinor":0,"count":0},"odometer":null,"performedBy":null,"createdBy":null,"commentCount":0,
        "createdAt":"2026-11-01T00:00:00.000Z","updatedAt":"2026-11-01T00:00:00.000Z"}"""
