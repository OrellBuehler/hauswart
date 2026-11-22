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

class CalendarApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * The calendars hauswart pushes items into
     *
     * The household's targets and the caller's own (another person's are not visible). A target pushes appointments, due dates, preparations and deadlines into one calendar of a connected system (`direction` is `push`: the calendar is never read back, edits there are not noticed until the item changes in hauswart). Every target has the calendar it writes into (`remoteCalendarId`, and `remoteName`, its name in the connected system, which follows a rename there), its health (`status`, `lastError`, `consecutiveFailures`, `lastCheckedAt`, and `nextAttemptAt`: not before when it is tried again, by the back-off after failures), what the last run did (`lastStats`), what the calendar allows (`capabilities`) and whether the caller may change it (`canManage`).
     */
    suspend fun calendarTargetsList(): CalendarTargetsListResponse =
        http.json("GET", "/api/v1/calendar-targets", emptyList(), CalendarTargetsListResponse.serializer())

    /**
     * Add a calendar to push items into
     *
     * `provider` is the connected system, `remoteCalendarId` a calendar from `GET /integrations/{provider}/calendars` (one that allows creating events). Calendars of the household's connection are administrators' business and always carry everything (`scope` `all`); a person's own connection gives targets of that person. `config.kinds` says what goes in (`appointments`, `task_due`, `preparations`, `defect_deadlines`, `insurance_deadlines`, `warranty_ends`); items that only have a date become all-day events or, with `timedMode` `timed`, events of `dueDurationMinutes` from `dueTime`. The first sync follows at once. 404 without a working connection or adapter, 400 on `remoteCalendarId` for a calendar that does not exist (`details.code` `calendar_not_found`) or cannot take events (`calendar_unsupported`), 409 for a calendar that already has a target, 502 `upstream_error` when the system does not answer.
     */
    suspend fun calendarTargetsCreate(
        body: CalendarTargetsCreateRequest,
    ): CalendarTarget =
        http.json("POST", "/api/v1/calendar-targets", emptyList(), CalendarTargetsCreateRequest.serializer(), body, CalendarTarget.serializer())

    /**
     * Change a calendar target
     *
     * `config` is merged over the stored settings (send the fields that change). The next sync applies it: events of kinds that are no longer carried are removed from the calendar when it allows deleting. Household targets need an administrator; another person's target is a 404.
     */
    suspend fun calendarTargetsUpdate(
        id: String,
        body: CalendarTargetsUpdateRequest,
    ): CalendarTarget =
        http.json("PATCH", "/api/v1/calendar-targets/${ApiHttp.segment(id)}", emptyList(), CalendarTargetsUpdateRequest.serializer(), body, CalendarTarget.serializer())

    /**
     * Remove a calendar target
     *
     * The events hauswart wrote stay in the calendar, and a new target for the same calendar takes them over, unless `removeRemote=true`: then the events carrying hauswart's marker are deleted first, while no sync of the target can run (409 `conflict` with `details.code` `busy` when one is running right now: try again in a moment; 400 on `removeRemote` for a calendar that cannot delete events; 409 when the connection is switched off; 502 `upstream_error` when the system fails). A failure before an event was touched leaves the target as it was; one that stops after the removal began (`details.deleted`, `details.remaining`, `details.disabled` true) leaves the target in place but switched off, so that the next sync does not write the events again, and a second try continues. Household targets need an administrator.
     */
    suspend fun calendarTargetsDelete(
        id: String,
        removeRemote: Boolean? = null,
    ) =
        http.empty("DELETE", "/api/v1/calendar-targets/${ApiHttp.segment(id)}", listOf("removeRemote" to removeRemote))

    /**
     * Sync a calendar target now
     *
     * Runs the sync of the target at once, whatever the back-off says, and answers with what it did (`counts`) and the fresh target. A run is limited in size: `counts.remaining` is the work left for the next run. A failed run is a normal answer (`ok: false` with an error `code`, also on the target as `lastError`): `unauthorized`, `forbidden`, `timeout`, `network`, `tls`, `server`, `blocked_host` and other codes of the connection, `calendar_missing`, `unsupported` (the calendar cannot take events), `unconfirmed` (the calendar did not show events just written), `config_invalid`, `busy` (a run is going on), `disabled` and `no_connection`. Household targets need an administrator.
     */
    suspend fun calendarTargetsSync(
        id: String,
    ): CalendarSync =
        http.json("POST", "/api/v1/calendar-targets/${ApiHttp.segment(id)}/sync", emptyList(), CalendarSync.serializer())
}

@Serializable
data class CalendarTargetsListResponse(
    val items: List<CalendarTarget>,
    val nextCursor: String?,
)

@Serializable
data class CalendarTargetsCreateRequest(
    /** homeassistant */
    val provider: String,
    val remoteCalendarId: String,
    val name: String? = null,
    val enabled: Boolean? = null,
    val config: CalendarTargetConfig,
)

@Serializable
data class CalendarTargetsUpdateRequest(
    val name: String? = null,
    val enabled: Boolean? = null,
    val config: CalendarTargetConfig? = null,
)
