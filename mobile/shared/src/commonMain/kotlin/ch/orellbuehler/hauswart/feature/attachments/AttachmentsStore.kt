package ch.orellbuehler.hauswart.feature.attachments

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.Attachment
import ch.orellbuehler.hauswart.api.generated.AttachmentsUpdateRequest
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.core.uiErrorOf
import ch.orellbuehler.hauswart.feature.files.FilePayload
import ch.orellbuehler.hauswart.feature.files.MAX_UPLOAD_BYTES
import ch.orellbuehler.hauswart.feature.files.ThumbnailCache
import ch.orellbuehler.hauswart.feature.files.UPLOAD_MIME_TYPES
import ch.orellbuehler.hauswart.feature.files.decodeBase64
import ch.orellbuehler.hauswart.feature.files.fileMime
import ch.orellbuehler.hauswart.feature.files.formatBytes
import ch.orellbuehler.hauswart.feature.files.isHeicMime
import ch.orellbuehler.hauswart.feature.files.isImageMime
import ch.orellbuehler.hauswart.feature.files.isPdfMime
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

/** The longest caption the server takes. */
const val ATTACHMENT_CAPTION_MAX = 500

/** Owners whose files a guest can be shown. */
val GUEST_OWNER_TYPES: List<String> = listOf("asset", "room", "page", "task", "asset_hint")

/** One stored file as the screen shows it. [kind] is `image`, `pdf` or `file`. */
data class AttachmentRow(
    val id: String,
    val filename: String,
    /** The caption, else the file name. */
    val label: String,
    /** The caption as saved; empty for none. */
    val caption: String,
    val mime: String,
    val kind: String,
    val hasThumb: Boolean,
    val sizeText: String,
    val guestVisible: Boolean,
)

/** A file on its way to the server, or one that was refused or failed. */
data class AttachmentUploadRow(
    val id: Int,
    val name: String,
    val sizeText: String,
    val failed: Boolean,
    val error: String,
    /** Trying again can help (network, server busy); false for a file the server will refuse again. */
    val canRetry: Boolean,
)

/** A file the person asked for: shown by the system viewer, or handed to the share sheet when [share]. */
class OpenedAttachment(
    val file: FilePayload,
    val share: Boolean,
)

data class AttachmentsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val rows: List<AttachmentRow> = emptyList(),
    val uploads: List<AttachmentUploadRow> = emptyList(),
    /** The owner's files can be marked visible to guests. */
    val guestOwner: Boolean = false,
    /** Changes whenever a thumbnail arrived; the screen asks [AttachmentsStore.thumbnail] again. */
    val thumbs: Int = 0,
    /** The file whose delete or guest switch is running. */
    val busyId: String? = null,
    /** The file being fetched to open or share. */
    val opening: String? = null,
    /** A failed delete, switch or download; the list is still shown. */
    val actionError: UiError? = null,
    val captionSaving: Boolean = false,
    val captionError: String? = null,
    /** How many captions were saved so far; a change closes the caption dialog. */
    val captioned: Int = 0,
    /** Ready to show or share; the screen calls [AttachmentsStore.clearOpened] once it did. */
    val opened: OpenedAttachment? = null,
)

/**
 * The files of one owner (`ownerType` + `ownerId`, e.g. `task` and a task id): list with lazily
 * loaded thumbnails, upload, caption, guest visibility, delete, and fetching a file to open it.
 */
class AttachmentsStore(
    private val app: HauswartApp,
    private val ownerType: String,
    private val ownerId: String,
) : Store<AttachmentsState>(AttachmentsState(guestOwner = ownerType in GUEST_OWNER_TYPES)) {
    private var attachments: List<Attachment> = emptyList()
    private val pending = LinkedHashMap<Int, PendingUpload>()
    private var nextUpload = 1
    private val gate = Semaphore(2)
    private val thumbnails =
        ThumbnailCache(
            scope = scope,
            parallel = 3,
            fetch = { id ->
                app.api.attachments
                    .attachmentsThumb(id)
                    .bytes
            },
            changed = { update { it.copy(thumbs = it.thumbs + 1) } },
        )

    private class PendingUpload(
        val name: String,
        val mime: String,
        val bytes: ByteArray,
        var failed: Boolean,
        var error: String,
        var canRetry: Boolean,
    )

    init {
        onChange(app, "attachments") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    /** The thumbnail (a WebP) of attachment [id] once it is there; ask for it with [requestThumbnail]. */
    fun thumbnail(id: String): ByteArray? = thumbnails.get(id)

    /** The thumbnail as Base64 text, for Swift. */
    fun thumbnailBase64(id: String): String? = thumbnails.get(id)?.let { FilePayload(id, "image/webp", it).base64() }

    fun thumbnailFailed(id: String): Boolean = thumbnails.hasFailed(id)

    /** Fetches the thumbnail of [id] in the background, unless it is there already. */
    fun requestThumbnail(id: String) {
        thumbnails.request(id)
    }

    /** Uploads a picked or captured file; [mime] may be empty or null, then the extension of [name] decides. */
    fun upload(
        name: String,
        mime: String?,
        bytes: ByteArray,
    ) {
        val type = fileMime(mime, name)
        val problem = problemWith(name, type, bytes.size.toLong())
        val id = nextUpload++
        pending[id] = PendingUpload(name, type, bytes, problem != null, problem.orEmpty(), false)
        showUploads()
        if (problem == null) start(id)
    }

    /** Reports a file that is too large to be read at all (the apps check the size a picker states before reading it). */
    fun rejectTooLarge(name: String) {
        val id = nextUpload++
        pending[id] = PendingUpload(name, "", ByteArray(0), true, tr("attach_error_too_large"), false)
        showUploads()
    }

    /** [upload] for Swift, which hands the bytes over as Base64 text. */
    fun uploadEncoded(
        name: String,
        mime: String?,
        base64: String,
    ) {
        upload(name, mime, decodeBase64(base64))
    }

    fun retryUpload(id: Int) {
        val job = pending[id] ?: return
        if (!job.failed || !job.canRetry) return
        start(id)
    }

    fun dismissUpload(id: Int) {
        pending.remove(id)
        showUploads()
    }

    fun saveCaption(
        id: String,
        caption: String,
    ) {
        if (current.captionSaving) return
        val text = caption.trim()
        if (text.length > ATTACHMENT_CAPTION_MAX) {
            update { it.copy(captionError = tr("field_too_long", "max" to ATTACHMENT_CAPTION_MAX)) }
            return
        }
        update { it.copy(captionSaving = true, captionError = null) }
        launch({ e -> update { it.copy(captionSaving = false, captionError = e.message) } }) {
            val saved = app.api.attachments.attachmentsUpdate(id, AttachmentsUpdateRequest(caption = Patch.of(text.ifEmpty { null })))
            replace(saved)
            update { it.copy(captionSaving = false, captioned = it.captioned + 1) }
            app.changed("attachments")
        }
    }

    fun setGuestVisible(
        id: String,
        visible: Boolean,
    ) {
        if (current.busyId != null) return
        update { it.copy(busyId = id, actionError = null) }
        launch({ e -> update { it.copy(busyId = null, actionError = e) } }) {
            val saved = app.api.attachments.attachmentsUpdate(id, AttachmentsUpdateRequest(guestVisible = visible))
            replace(saved)
            update { it.copy(busyId = null) }
            app.changed("attachments")
        }
    }

    fun delete(id: String) {
        if (current.busyId != null) return
        update { it.copy(busyId = id, actionError = null) }
        launch({ e -> update { it.copy(busyId = null, actionError = e) } }) {
            app.api.attachments.attachmentsDelete(id)
            attachments = attachments.filterNot { it.id == id }
            showRows()
            update { it.copy(busyId = null) }
            app.changed("attachments")
        }
    }

    /** Fetches file [id] to show it (an image in the viewer, anything else in the system viewer). */
    fun open(id: String) {
        fetch(id, share = false)
    }

    /** Fetches file [id] to hand it to the share sheet. */
    fun share(id: String) {
        fetch(id, share = true)
    }

    fun clearOpened() {
        update { it.copy(opened = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun fetch(
        id: String,
        share: Boolean,
    ) {
        if (current.opening != null) return
        val attachment = attachments.firstOrNull { it.id == id } ?: return
        update { it.copy(opening = id, actionError = null) }
        launch({ e -> update { it.copy(opening = null, actionError = e) } }) {
            val body = app.api.attachments.attachmentsContent(id, if (share) "1" else null)
            val mime = attachment.mime.ifEmpty { body.contentType.orEmpty() }
            update { it.copy(opening = null, opened = OpenedAttachment(FilePayload(attachment.filename, mime, body.bytes), share)) }
        }
    }

    private fun problemWith(
        name: String,
        mime: String,
        size: Long,
    ): String? =
        when {
            isHeicMime(mime, name) -> tr("attach_error_heic")
            mime !in UPLOAD_MIME_TYPES -> tr("attach_error_unsupported_type")
            size == 0L -> tr("attach_error_empty")
            size > MAX_UPLOAD_BYTES -> tr("attach_error_too_large")
            else -> null
        }

    private fun start(id: Int) {
        val job = pending[id] ?: return
        job.failed = false
        job.error = ""
        showUploads()
        scope.launch {
            try {
                gate.withPermit {
                    val created = uploadAttachment(app, ownerType, ownerId, job.name, job.mime, job.bytes)
                    pending.remove(id)
                    attachments = attachments.filterNot { it.id == created.id } + created
                    showRows()
                    showUploads()
                    app.changed("attachments")
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                job.failed = true
                job.error = uploadErrorMessage(e)
                job.canRetry = e is ApiException && (e.status == 0 || e.status == 429 || e.status >= 500)
                showUploads()
            }
        }
    }

    private fun uploadErrorMessage(e: Exception): String {
        if (e !is ApiException) return uiErrorOf(e).message
        return when (e.detailCode) {
            "empty" -> tr("attach_error_empty")
            "too_large" -> tr("attach_error_too_large")
            "unsupported_type" -> tr("attach_error_unsupported_type")
            "unsupported_heic" -> tr("attach_error_heic")
            "corrupt_image" -> tr("attach_error_corrupt")
            "image_too_large" -> tr("attach_error_image_too_large")
            else ->
                when {
                    e.status == 0 -> tr("attach_error_network")
                    e.status == 413 -> tr("attach_error_too_large")
                    e.status == 415 -> tr("attach_error_unsupported_type")
                    else -> uiErrorOf(e).message
                }
        }
    }

    private fun replace(saved: Attachment) {
        attachments = attachments.map { if (it.id == saved.id) saved else it }
        showRows()
    }

    private fun load() {
        update { it.copy(loading = it.rows.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            attachments =
                fetchAll { cursor ->
                    val page = app.api.attachments.attachmentsList(cursor = cursor, limit = 200, ownerType = ownerType, ownerId = ownerId)
                    page.items to page.nextCursor
                }
            showRows()
            update { it.copy(loading = false) }
        }
    }

    private fun showRows() {
        val rows =
            attachments.map { a ->
                AttachmentRow(
                    id = a.id,
                    filename = a.filename,
                    label = a.caption?.takeIf { it.isNotBlank() } ?: a.filename,
                    caption = a.caption.orEmpty(),
                    mime = a.mime,
                    kind =
                        when {
                            isImageMime(a.mime) -> "image"
                            isPdfMime(a.mime) -> "pdf"
                            else -> "file"
                        },
                    hasThumb = a.thumbUrl != null,
                    sizeText = formatBytes(a.size),
                    guestVisible = a.guestVisible,
                )
            }
        update { it.copy(rows = rows) }
    }

    private fun showUploads() {
        val rows =
            pending.map { (id, job) ->
                AttachmentUploadRow(id, job.name, formatBytes(job.bytes.size.toLong()), job.failed, job.error, job.canRetry)
            }
        update { it.copy(uploads = rows) }
    }
}
