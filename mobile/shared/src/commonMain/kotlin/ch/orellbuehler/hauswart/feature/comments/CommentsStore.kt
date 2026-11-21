package ch.orellbuehler.hauswart.feature.comments

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.Comment
import ch.orellbuehler.hauswart.api.generated.CommentsCreateRequest
import ch.orellbuehler.hauswart.api.generated.CommentsUpdateRequest
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.feature.files.nowMillis
import ch.orellbuehler.hauswart.feature.files.relativeInstant
import ch.orellbuehler.hauswart.i18n.tr

/** The longest comment the server takes. */
const val COMMENT_MAX_LENGTH = 10_000

/** One comment as the screen shows it. */
data class CommentRow(
    val id: String,
    val author: String,
    /** "5 minutes ago". */
    val whenText: String,
    /** The full date and time, for a long press or an accessibility label. */
    val whenFull: String,
    val edited: Boolean,
    val body: String,
    /** Gone: the thread keeps a placeholder ("Comment deleted") in its place. */
    val deleted: Boolean,
    val canEdit: Boolean,
    val canDelete: Boolean,
    /** The parts of [body]: plain text and links, in order. */
    val segments: List<TextSegment>,
)

data class CommentsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val rows: List<CommentRow> = emptyList(),
    /** Comments that are not deleted. */
    val count: Int = 0,
    val adding: Boolean = false,
    val addError: UiError? = null,
    /** How many comments this screen added so far; a change tells the composer to empty. */
    val added: Int = 0,
    /** The comment whose edit is being saved. */
    val savingId: String? = null,
    val editError: UiError? = null,
    /** How many edits were saved so far; a change tells the editor to close. */
    val edited: Int = 0,
    val deletingId: String? = null,
    /** A failed delete; the comment is still shown. */
    val actionError: UiError? = null,
)

/**
 * The comments of one owner (`ownerType` + `ownerId`, the comments registry's entity type and id, e.g. `task` and a task id): list, add, edit
 * and delete. Used by [CommentsSection] on the detail screens of every commentable entity.
 */
class CommentsStore(
    private val app: HauswartApp,
    private val ownerType: String,
    private val ownerId: String,
) : Store<CommentsState>(CommentsState()) {
    private var comments: List<Comment> = emptyList()

    init {
        onChange(app, "comments") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    /** Adds [text] (trimmed) as a new comment. Nothing happens for blank text. */
    fun add(text: String) {
        val body = text.trim()
        if (body.isEmpty() || current.adding) return
        if (body.length > COMMENT_MAX_LENGTH) {
            update { it.copy(addError = UiError(tr("field_too_long", "max" to COMMENT_MAX_LENGTH), "invalid_request")) }
            return
        }
        update { it.copy(adding = true, addError = null) }
        launch({ e -> update { it.copy(adding = false, addError = e) } }) {
            val created = app.api.comments.commentsCreate(CommentsCreateRequest(ownerType, ownerId, body))
            comments = comments.filterNot { it.id == created.id } + created
            show()
            update { it.copy(adding = false, added = it.added + 1) }
            app.changed("comments")
        }
    }

    /** Saves the edited [text] of comment [id]; the same text again just closes the editor. */
    fun edit(
        id: String,
        text: String,
    ) {
        val body = text.trim()
        val old = comments.firstOrNull { it.id == id } ?: return
        if (body.isEmpty() || current.savingId != null) return
        if (body == old.bodyMd) {
            update { it.copy(editError = null, edited = it.edited + 1) }
            return
        }
        if (body.length > COMMENT_MAX_LENGTH) {
            update { it.copy(editError = UiError(tr("field_too_long", "max" to COMMENT_MAX_LENGTH), "invalid_request")) }
            return
        }
        update { it.copy(savingId = id, editError = null) }
        launch({ e -> update { it.copy(savingId = null, editError = e) } }) {
            val saved = app.api.comments.commentsUpdate(id, CommentsUpdateRequest(body))
            comments = comments.map { if (it.id == saved.id) saved else it }
            show()
            update { it.copy(savingId = null, edited = it.edited + 1) }
            app.changed("comments")
        }
    }

    fun delete(id: String) {
        if (current.deletingId != null) return
        update { it.copy(deletingId = id, actionError = null) }
        launch({ e -> update { it.copy(deletingId = null, actionError = e) } }) {
            app.api.comments.commentsDelete(id)
            comments =
                comments.map {
                    if (it.id == id) it.copy(bodyMd = "", deleted = true, canEdit = false, canDelete = false) else it
                }
            show()
            update { it.copy(deletingId = null) }
            app.changed("comments")
        }
    }

    fun dismissEditError() {
        update { it.copy(editError = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun load() {
        update { it.copy(loading = comments.isEmpty() && it.rows.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            comments =
                fetchAll { cursor ->
                    val page = app.api.comments.commentsList(cursor = cursor, limit = 200, entityType = ownerType, entityId = ownerId)
                    page.items to page.nextCursor
                }
            app.household.get()
            show()
            update { it.copy(loading = false) }
        }
    }

    private fun show() {
        val zone = app.household.timezone
        val now = nowMillis()
        val rows =
            comments.map { c ->
                CommentRow(
                    id = c.id,
                    author = c.author?.displayName?.takeIf { it.isNotBlank() } ?: tr("comments_unknown_author"),
                    whenText = relativeInstant(c.createdAt, zone, now),
                    whenFull = Dates.dateTime(c.createdAt, zone),
                    edited = c.editedAt != null && !c.deleted,
                    body = c.bodyMd,
                    deleted = c.deleted,
                    canEdit = c.canEdit && !c.deleted,
                    canDelete = c.canDelete && !c.deleted,
                    segments = if (c.deleted) emptyList() else linkify(c.bodyMd),
                )
            }
        update { it.copy(rows = rows, count = rows.count { r -> !r.deleted }) }
    }
}
