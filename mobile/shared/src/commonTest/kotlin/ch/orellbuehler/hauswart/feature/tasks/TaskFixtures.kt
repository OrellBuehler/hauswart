package ch.orellbuehler.hauswart.feature.tasks

import ch.orellbuehler.hauswart.testing.TestApp

internal const val INTERVAL = """{"v":1,"type":"interval","every":3,"unit":"month","anchor":"completion","startDate":"2026-10-01"}"""
internal const val ODOMETER = """{"v":1,"type":"counter_delta","entityId":"odometer:a1","threshold":15000,"unit":"km"}"""
internal const val BILL = """{"v":1,"type":"kept_bill","billId":"b1","dueDate":"2026-12-31","status":"open"}"""

private fun String?.json(): String = if (this == null) "null" else "\"$this\""

internal fun taskJson(
    id: String,
    title: String,
    status: String = "due",
    dueDate: String? = "2026-11-25",
    trigger: String = INTERVAL,
    assetId: String? = null,
    assetName: String? = null,
    roomId: String? = null,
    roomName: String? = null,
    category: String = "maintenance",
    assignee: String? = null,
    archived: Boolean = false,
    snoozedUntil: String? = null,
    openNotes: Int = 0,
    description: String = "",
    externalSource: String? = null,
    commentCount: Int = 0,
    nextAppointment: String = "null",
    extra: String = "",
): String =
    """{"id":"$id","title":"$title","descriptionMd":"$description","category":"$category","priority":"normal","effortMinutes":null,
        "assetId":${assetId.json()},"assetName":${assetName.json()},"roomId":${roomId.json()},"roomName":${roomName.json()},
        "trigger":$trigger,"assignMode":"none","assigneeUserId":null,"rotationOrder":[],"rotationStrategy":"alternate",
        "notifyMode":"assignee","graceDays":0,"dueSoonDays":null,"snoozedUntil":${snoozedUntil.json()},
        "archivedAt":${if (archived) "\"2026-01-01T00:00:00.000Z\"" else "null"},"source":"manual","externalSource":${externalSource.json()},
        "externalRef":null,"externalUrl":null,"createdBy":null,"commentCount":$commentCount,"stepCount":0,"openNoteCount":$openNotes,"nextAppointment":$nextAppointment,
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z",
        "state":{"status":"$status","dueDate":${dueDate.json()},"dueKind":"exact","occurrenceKey":"k1","windowStart":null,"progress":null,
        "estimate":null,"missedCount":0,"reasons":["never_completed"],"currentAssigneeUserId":${assignee.json()},"evaluatedAt":"2026-01-01T00:00:00.000Z"}$extra}"""

internal fun detailJson(
    task: String,
    preparations: String = "[]",
): String = task.dropLast(1) + ""","preparations":$preparations,"recentCompletions":[],"steps":[],"stepsSource":null}"""

internal fun completionJson(
    id: String,
    taskId: String = "t1",
    kind: String = "done",
    createdAt: String = "2026-01-01T00:00:00.000Z",
): String =
    """{"id":"$id","taskId":"$taskId","taskTitle":"Filter","kind":"$kind","source":"manual","completedAt":"2026-01-01T10:00:00.000Z",
        "completedDate":"2026-01-01","userId":"u1","userName":"Anna","counterValue":null,"occurrenceKey":"k1","dueDateAtCompletion":null,
        "note":"done","revokedAt":null,"createdAt":"$createdAt"}"""

internal fun page(vararg items: String) = """{"items":[${items.joinToString(",")}],"nextCursor":null}"""

internal fun TestApp.tasks(vararg items: String) = on("GET", "/api/v1/tasks", page(*items))

internal fun TestApp.places() {
    on(
        "GET",
        "/api/v1/rooms",
        page(
            """{"id":"r1","name":"Kitchen","slug":"kitchen","haAreaId":null,"icon":null,"sortOrder":0,"notes":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}""",
        ),
    )
    on("GET", "/api/v1/assets", page())
}
