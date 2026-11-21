package ch.orellbuehler.hauswart.feature.receipts

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.UploadFile
import ch.orellbuehler.hauswart.api.generated.AiTask
import ch.orellbuehler.hauswart.api.generated.AiTasksDismissRequest
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.feature.attachments.OpenedAttachment
import ch.orellbuehler.hauswart.feature.dashboard.TONE_DUE
import ch.orellbuehler.hauswart.feature.dashboard.TONE_MUTED
import ch.orellbuehler.hauswart.feature.dashboard.TONE_OK
import ch.orellbuehler.hauswart.feature.files.FilePayload
import ch.orellbuehler.hauswart.feature.files.ThumbnailCache
import ch.orellbuehler.hauswart.feature.files.isImageMime
import ch.orellbuehler.hauswart.i18n.tr

const val RECEIPT_NOTE_MAX = 1000
const val RECEIPT_REASON_MAX = 500

/** Tasks per page of the history; "load more" fetches the next. */
const val RECEIPTS_PAGE_SIZE = 30L

val RECEIPT_VIEWS: List<String> = listOf("all", "pending", "done", "dismissed")

/** `POST /ai-tasks`: the generated client leaves multipart out, so the upload is written by hand. */
suspend fun uploadReceipt(
    app: HauswartApp,
    fileName: String,
    mime: String,
    bytes: ByteArray,
    note: String?,
    bookId: String?,
    assetId: String?,
    idempotencyKey: String?,
): AiTask =
    app.http.multipart(
        path = "/api/v1/ai-tasks",
        fields =
            listOf(
                "note" to note?.takeIf { it.isNotBlank() },
                "bookId" to bookId?.takeIf { it.isNotEmpty() },
                "assetId" to assetId?.takeIf { it.isNotEmpty() },
                "idempotencyKey" to idempotencyKey,
            ),
        file = UploadFile("file", fileName, mime, bytes),
        response = AiTask.serializer(),
    )

fun receiptViewLabel(view: String): String =
    when (view) {
        "pending" -> tr("receipts_status_pending")
        "done" -> tr("receipts_status_done")
        "dismissed" -> tr("receipts_status_dismissed")
        else -> tr("receipts_filter_all")
    }

fun receiptStatusLabel(status: String): String =
    when (status) {
        "pending" -> tr("receipts_status_pending")
        "done" -> tr("receipts_status_done")
        "dismissed" -> tr("receipts_status_dismissed")
        else -> status
    }

private fun statusTone(status: String): String =
    when (status) {
        "pending" -> TONE_DUE
        "done" -> TONE_OK
        else -> TONE_MUTED
    }

private fun viaLabel(via: String?): String? =
    when (via) {
        null -> null
        "session" -> tr("receipts_via_session")
        "mcp" -> tr("receipts_via_mcp")
        "ha" -> tr("receipts_via_ha")
        else -> tr("receipts_via_api")
    }

/** The status filter of a link (`pending`...), or `all`. */
fun receiptViewOf(status: String?): String = if (status in RECEIPT_VIEWS) status.orEmpty() else "all"

/** Everything that waits first, then the page as it comes; each task once. */
internal fun mergePendingFirst(
    pending: List<AiTask>,
    page: List<AiTask>,
): List<AiTask> {
    val ids = pending.map { it.id }.toSet()
    return pending + page.filter { it.id !in ids }
}

internal fun appendTasks(
    shown: List<AiTask>,
    more: List<AiTask>,
): List<AiTask> {
    val ids = shown.map { it.id }.toSet()
    return shown + more.filter { it.id !in ids }
}

/** An entry a receipt became. */
data class ReceiptCostView(
    val id: String,
    val title: String,
    val date: String,
    val amount: String,
    val reviewNeeded: Boolean,
)

/** One receipt of the queue, ready to show. */
data class ReceiptRowView(
    val id: String,
    /** `pending`, `done` or `dismissed`. */
    val status: String,
    val statusLabel: String,
    val statusTone: String,
    val createdText: String,
    val byText: String,
    val note: String?,
    /** Book and device hints. */
    val hints: String?,
    /** "Wird gerade bearbeitet von ...". */
    val claimText: String?,
    val hasFile: Boolean,
    val isImage: Boolean,
    /** A preview can be fetched (a picture). */
    val hasThumb: Boolean,
    val costs: List<ReceiptCostView>,
    val resultTitle: String?,
    val resultGone: String?,
    val resultNote: String?,
    /** Who closed it, when and how. */
    val closedLine: String?,
    val dismissReason: String?,
    val canDismiss: Boolean,
    val canDelete: Boolean,
    val deleteText: String,
)

data class ReceiptsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val view: String = "all",
    val views: List<ReceiptViewOption> = emptyList(),
    val pendingCount: Int = 0,
    val rows: List<ReceiptRowView> = emptyList(),
    val countText: String = "",
    val hasMore: Boolean = false,
    val loadingMore: Boolean = false,
    val moreError: UiError? = null,
    val emptyTitle: String = "",
    val emptyBody: String = "",
    /** Thumbnail counter: changes when a picture arrived. */
    val thumbs: Int = 0,
    val busyId: String? = null,
    val actionError: UiError? = null,
    /** What the last dismiss or delete said, shown once. */
    val notice: String? = null,
    /** The file the person asked to see; the screen shows it and calls [ReceiptsStore.clearOpened]. */
    val opened: OpenedAttachment? = null,
    val opening: String? = null,
)

data class ReceiptViewOption(
    val value: String,
    val label: String,
    val badge: String?,
)

/** The receipt queue: open receipts first, the history 30 at a time. */
class ReceiptsStore(
    private val app: HauswartApp,
    initialStatus: String?,
) : Store<ReceiptsState>(ReceiptsState(view = receiptViewOf(initialStatus))) {
    private var tasks: List<AiTask> = emptyList()
    private var cursor: String? = null
    private val thumbnails =
        ThumbnailCache(
            scope = scope,
            parallel = 3,
            fetch = { id ->
                val task = tasks.first { it.id == id }
                val attachment = task.attachment
                if (attachment?.thumbUrl != null) {
                    app.api.attachments
                        .attachmentsThumb(attachment.id)
                        .bytes
                } else {
                    app.api.aiTasks
                        .aiTasksPreview(id)
                        .bytes
                }
            },
            changed = { update { it.copy(thumbs = it.thumbs + 1) } },
        )

    init {
        onChange(app, "costs") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun selectView(view: String) {
        if (view !in RECEIPT_VIEWS || view == current.view) return
        update { it.copy(view = view, rows = emptyList(), loading = true) }
        load()
    }

    fun thumbnail(id: String): ByteArray? = thumbnails.get(id)

    fun thumbnailBase64(id: String): String? = thumbnails.get(id)?.let { FilePayload(id, "image/webp", it).base64() }

    fun requestThumbnail(id: String) {
        thumbnails.request(id)
    }

    fun loadMore() {
        val next = cursor ?: return
        if (current.loadingMore) return
        update { it.copy(loadingMore = true, moreError = null) }
        launch({ e -> update { it.copy(loadingMore = false, moreError = e) } }) {
            val status = statusOf(current.view)
            val page = app.api.aiTasks.aiTasksList(cursor = next, limit = RECEIPTS_PAGE_SIZE, status = status)
            tasks = appendTasks(tasks, page.items)
            cursor = page.nextCursor
            show()
            update { it.copy(loadingMore = false) }
        }
    }

    /** Closes a waiting receipt without booking anything; [reason] is optional. */
    fun dismiss(
        id: String,
        reason: String,
    ): Boolean {
        val text = reason.trim()
        if (text.length > RECEIPT_REASON_MAX) {
            update { it.copy(actionError = UiError(tr("field_too_long", "max" to RECEIPT_REASON_MAX), "invalid_request")) }
            return false
        }
        if (current.busyId != null) return false
        update { it.copy(busyId = id, actionError = null) }
        launch({ e ->
            val conflict = e.code == "conflict"
            update { it.copy(busyId = null, actionError = if (conflict) UiError(tr("receipts_conflict"), e.code) else e) }
            if (conflict) load()
        }) {
            app.api.aiTasks.aiTasksDismiss(id, AiTasksDismissRequest(reason = text.ifEmpty { null }))
            update { it.copy(busyId = null, notice = tr("receipts_dismissed_toast")) }
            app.changed("costs")
        }
        return true
    }

    fun delete(id: String) {
        if (current.busyId != null) return
        update { it.copy(busyId = id, actionError = null) }
        launch({ e -> update { it.copy(busyId = null, actionError = e) } }) {
            app.api.aiTasks.aiTasksDelete(id)
            update { it.copy(busyId = null, notice = tr("receipts_deleted_toast")) }
            app.changed("costs")
        }
    }

    /** Fetches the file of receipt [id] to show it (a picture in the viewer, a PDF in the system viewer). */
    fun open(id: String) {
        val attachment = tasks.firstOrNull { it.id == id }?.attachment ?: return
        if (current.opening != null) return
        update { it.copy(opening = id, actionError = null) }
        launch({ e -> update { it.copy(opening = null, actionError = e) } }) {
            val body = app.api.attachments.attachmentsContent(attachment.id)
            val mime = attachment.mime.ifEmpty { body.contentType.orEmpty() }
            update {
                it.copy(
                    opening = null,
                    opened = OpenedAttachment(attachment.id, FilePayload(attachment.filename, mime, body.bytes), false),
                )
            }
        }
    }

    fun clearOpened() {
        update { it.copy(opened = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    private fun statusOf(view: String): String? = if (view == "all") null else view

    private fun load() {
        update { it.copy(loading = tasks.isEmpty() || it.rows.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val view = current.view
            val status = statusOf(view)
            val pendingCount =
                app.api.aiTasks
                    .aiTasksCount(status = "pending")
                    .count
                    .toInt()
            val page = app.api.aiTasks.aiTasksList(limit = RECEIPTS_PAGE_SIZE, status = status)
            tasks =
                if (view == "all") {
                    val pending =
                        fetchAll { c ->
                            val p = app.api.aiTasks.aiTasksList(cursor = c, limit = 100, status = "pending")
                            p.items to p.nextCursor
                        }
                    mergePendingFirst(pending, page.items)
                } else {
                    page.items
                }
            cursor = page.nextCursor
            update { it.copy(pendingCount = pendingCount) }
            show()
            update { it.copy(loading = false) }
        }
    }

    private fun show() {
        val zone = app.household.timezone
        val me = app.session.user
        val views =
            RECEIPT_VIEWS.map { v ->
                ReceiptViewOption(
                    v,
                    receiptViewLabel(v),
                    if (v == "pending" &&
                        current.pendingCount > 0
                    ) {
                        current.pendingCount.toString()
                    } else {
                        null
                    },
                )
            }
        val view = current.view
        val rows = tasks.map { rowOf(it, zone, me?.id, me?.role == "admin") }
        update {
            it.copy(
                views = views,
                rows = rows,
                hasMore = cursor != null,
                countText = tr("receipts_count", "count" to rows.size) + if (cursor != null) "+" else "",
                emptyTitle =
                    tr(
                        when (view) {
                            "pending" -> "receipts_empty_pending_title"
                            "done" -> "receipts_empty_done_title"
                            "dismissed" -> "receipts_empty_dismissed_title"
                            else -> "receipts_empty_title"
                        },
                    ),
                emptyBody =
                    tr(
                        when (view) {
                            "all" -> "receipts_empty_body"
                            "pending" -> "receipts_empty_pending_body"
                            else -> "receipts_empty_filtered_body"
                        },
                    ),
            )
        }
    }

    private fun rowOf(
        task: AiTask,
        zone: String,
        meId: String?,
        admin: Boolean,
    ): ReceiptRowView {
        val attachment = task.attachment
        val isImage = attachment != null && isImageMime(attachment.mime)
        val costs =
            task.result?.costs.orEmpty().map {
                ReceiptCostView(it.id, it.title, Dates.format(it.date), Money.format(it.amountMinor, it.currency), it.reviewNeeded)
            }
        val hints =
            listOfNotNull(
                task.bookName?.let { tr("receipts_hint_book", "name" to it) },
                task.assetName?.let { tr("receipts_hint_asset", "name" to it) },
            ).joinToString(" · ")
        val closer = task.completedByName?.let { tr("receipts_closed_by", "name" to it) }
        val closedAt = task.completedAt?.let { Dates.dateTime(it, zone) }
        return ReceiptRowView(
            id = task.id,
            status = task.status,
            statusLabel = receiptStatusLabel(task.status),
            statusTone = statusTone(task.status),
            createdText = Dates.dateTime(task.createdAt, zone),
            byText = task.createdByName?.let { tr("receipts_by", "name" to it) } ?: tr("receipts_by_unknown"),
            note = task.note?.takeIf { it.isNotBlank() },
            hints = hints.ifEmpty { null },
            claimText = if (task.status == "pending") task.claim?.let { tr("receipts_claimed", "name" to (it.byName ?: "…")) } else null,
            hasFile = attachment != null,
            isImage = isImage,
            hasThumb = isImage,
            costs = costs,
            resultTitle = if (task.status == "done" && task.result != null) tr("receipts_result_title") else null,
            resultGone = if (task.status == "done" && task.result != null && costs.isEmpty()) tr("receipts_result_gone") else null,
            resultNote =
                task.result
                    ?.note
                    ?.takeIf { it.isNotBlank() }
                    ?.let { tr("receipts_result_note") + ": " + it },
            closedLine =
                if (task.status ==
                    "pending"
                ) {
                    null
                } else {
                    listOfNotNull(closer, closedAt, viaLabel(task.completedVia)).joinToString(" · ").ifEmpty { null }
                },
            dismissReason =
                if (task.status ==
                    "dismissed"
                ) {
                    task.dismissReason?.let { tr("receipts_dismissed_reason", "reason" to it) }
                } else {
                    null
                },
            canDismiss = task.status == "pending",
            canDelete = admin || (meId != null && task.createdByUserId == meId),
            deleteText = tr(if (task.status == "done") "receipts_delete_description_done" else "receipts_delete_description"),
        )
    }
}
