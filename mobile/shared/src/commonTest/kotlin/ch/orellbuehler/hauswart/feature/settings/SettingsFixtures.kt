package ch.orellbuehler.hauswart.feature.settings

internal fun integrationJson(
    kind: String,
    level: String = "user",
    configured: Boolean = true,
    enabled: Boolean = true,
    status: String = "ok",
    baseUrl: String? = "https://docs.example.org",
    lastError: String? = null,
    failures: Int = 0,
) = """{"kind":"$kind","level":"$level","available":true,"capabilities":[],"configured":$configured,"enabled":$enabled,
    "baseUrl":${if (baseUrl == null) "null" else "\"$baseUrl\""},"allowInsecureTls":false,"config":{},"status":"$status",
    "lastError":${if (lastError == null) "null" else "\"$lastError\""},"lastOkAt":"2026-11-21T05:00:00.000Z",
    "lastCheckedAt":"2026-11-21T05:30:00.000Z","consecutiveFailures":$failures}"""

internal fun listOfIntegrations(vararg items: String) = """{"items":[${items.joinToString(",")}],"nextCursor":null}"""

internal fun calendarTargetJson(
    id: String = "c1",
    enabled: Boolean = true,
    status: String = "ok",
    canManage: Boolean = false,
    lastError: String? = null,
) = """{"id":"$id","provider":"homeassistant","level":"household","ownerId":null,"remoteCalendarId":"calendar.house","remoteName":"House",
    "name":"Household","enabled":$enabled,
    "config":{"kinds":["appointments","task_due"],"direction":"push","scope":"all","timedMode":"all_day","dueTime":"08:00",
      "dueDurationMinutes":30,"alarmMinutes":null,"titlePrefix":"","onRemoteDelete":"recreate","conflictPolicy":"hauswart_wins","locale":"de"},
    "capabilities":{"create":true,"update":true,"delete":true,"alarms":false},"status":"$status",
    "lastError":${if (lastError == null) "null" else "\"$lastError\""},"lastOkAt":"2026-11-21T05:00:00.000Z",
    "lastCheckedAt":"2026-11-21T05:30:00.000Z","nextAttemptAt":null,"consecutiveFailures":0,
    "lastStats":{"created":2,"updated":0,"replaced":0,"deleted":0,"adopted":0,"forgotten":0,"skipped":0,"failed":0,"unconfirmed":0,"remaining":0},
    "eventCount":12,"canManage":$canManage,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""
