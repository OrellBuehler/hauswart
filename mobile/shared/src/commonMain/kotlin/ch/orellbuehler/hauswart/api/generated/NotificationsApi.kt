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

class NotificationsApi internal constructor(
    private val http: ApiHttp,
) {
    /**
     * The caller's notifications, unread first
     *
     * Own and household-wide notifications. Text is a message key plus params, rendered in the reader's language.
     */
    suspend fun notificationsList(
        cursor: String? = null,
        limit: Long? = null,
        unread: Boolean? = null,
    ): NotificationsListResponse =
        http.json("GET", "/api/v1/notifications", listOf("cursor" to cursor, "limit" to limit, "unread" to unread), NotificationsListResponse.serializer())

    /**
     * Number of unread notifications
     */
    suspend fun notificationsUnreadCount(): NotificationsUnreadCountResponse =
        http.json("GET", "/api/v1/notifications/unread-count", emptyList(), NotificationsUnreadCountResponse.serializer())

    /**
     * Mark all notifications read
     */
    suspend fun notificationsReadAll(): NotificationsReadAllResponse =
        http.json("POST", "/api/v1/notifications/read-all", emptyList(), NotificationsReadAllResponse.serializer())

    /**
     * Mark a notification read
     *
     * Other users' notifications are not visible: 404.
     */
    suspend fun notificationsRead(
        id: String,
    ): Notification =
        http.json("POST", "/api/v1/notifications/${ApiHttp.segment(id)}/read", emptyList(), Notification.serializer())

    /**
     * The caller's push preferences and notification targets
     *
     * Own settings only. `pushStages` are the kinds of notification that reach the phone (the in-app list always has all of them); notifications arriving between `quietStart` and `quietEnd` (household time zone) are held back and sent afterwards. A target is a notify service of the connected smart-home system.
     */
    suspend fun notificationSettingsGet(): NotificationSettings =
        http.json("GET", "/api/v1/me/notification-settings", emptyList(), NotificationSettings.serializer())

    /**
     * Replace the caller's push preferences and targets
     *
     * Replaces preferences and the whole list of targets (at most 10). Target names are lowercase letters, digits and underscores.
     */
    suspend fun notificationSettingsPut(
        body: NotificationSettingsPutRequest,
    ): NotificationSettings =
        http.json("PUT", "/api/v1/me/notification-settings", emptyList(), NotificationSettingsPutRequest.serializer(), body, NotificationSettings.serializer())

    /**
     * A button on a pushed notification was tapped
     *
     * Called by the smart-home system when someone taps "done" on a notification: `{"action": "HW_DONE_<token>"}` with an API token of kind `ha` and the `ha:action` scope. The token resolves to the task occurrence the notification was about and to the person it was sent to; the completion is attributed to that person (source `notification`), not to the calling token. 404 for an unknown action, 410 `gone` when the token expired, its task is gone, the occurrence was settled otherwise, or the first completion was undone. Tapping again (or a retried request) answers 200 with the first completion and `replayed: true`.
     */
    suspend fun haAction(
        body: HaActionRequest,
    ): NotificationActionResult =
        http.json("POST", "/api/v1/ha/action", emptyList(), HaActionRequest.serializer(), body, NotificationActionResult.serializer())
}

@Serializable
data class NotificationsListResponse(
    val items: List<Notification>,
    val nextCursor: String?,
)

@Serializable
data class NotificationsUnreadCountResponse(
    val count: Long,
)

@Serializable
data class NotificationsReadAllResponse(
    val updated: Long,
)

@Serializable
data class NotificationSettingsPutRequestTargetsItem(
    /** ha_notify */
    val channel: String,
    val target: String,
    val enabled: Boolean,
)

@Serializable
data class NotificationSettingsPutRequest(
    val pushEnabled: Boolean,
    val quietStart: String?,
    val quietEnd: String?,
    /** prep | due_soon | due | overdue | digest | hint | comment */
    val pushStages: List<String>,
    val targets: List<NotificationSettingsPutRequestTargetsItem>,
) {
    companion object {
        val PUSH_STAGES_VALUES: List<String> = listOf("prep", "due_soon", "due", "overdue", "digest", "hint", "comment")
    }
}

@Serializable
data class HaActionRequest(
    val action: String,
)
