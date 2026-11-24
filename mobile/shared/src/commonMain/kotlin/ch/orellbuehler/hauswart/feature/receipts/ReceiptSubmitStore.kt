package ch.orellbuehler.hauswart.feature.receipts

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.feature.costs.CostOption
import ch.orellbuehler.hauswart.feature.costs.newIdempotencyKey
import ch.orellbuehler.hauswart.feature.costs.openBooks
import ch.orellbuehler.hauswart.feature.files.MAX_UPLOAD_BYTES
import ch.orellbuehler.hauswart.feature.files.UPLOAD_MIME_TYPES
import ch.orellbuehler.hauswart.feature.files.decodeBase64
import ch.orellbuehler.hauswart.feature.files.fileMime
import ch.orellbuehler.hauswart.feature.files.formatBytes
import ch.orellbuehler.hauswart.feature.files.isHeicMime
import ch.orellbuehler.hauswart.feature.files.isPdfMime
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/** The largest PDF an assistant is handed through the MCP connection. */
const val RECEIPT_PDF_READ_MAX_BYTES: Long = 4L * 1024 * 1024

/** What the form holds besides the file: [bookId] and [assetId] are empty for "leave it open". */
data class ReceiptForm(
    val note: String = "",
    val bookId: String = "",
    val assetId: String = "",
)

data class ReceiptSubmitState(
    val loading: Boolean = true,
    val loadError: UiError? = null,
    /** "Offen lassen" first, then the books that take entries. Empty when there is no choice to make. */
    val books: List<CostOption> = emptyList(),
    /** "Kein Gerät" first. */
    val assets: List<CostOption> = emptyList(),
    val initial: ReceiptForm = ReceiptForm(),
    val fileName: String? = null,
    val fileSizeText: String? = null,
    /** Why the picked file cannot be sent. */
    val fileProblem: String? = null,
    /** A PDF the assistant cannot read through the MCP connection. */
    val fileWarning: String? = null,
    val saving: Boolean = false,
    val error: String? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    /** The upload got no answer: nothing is known about the task, the list is where to look. */
    val noAnswer: Boolean = false,
    /** The id of the queued receipt; the screen says so and offers to undo. */
    val createdId: String? = null,
    /** Set after the receipt was taken back. */
    val undone: Boolean = false,
)

/** Puts a photo or PDF of a receipt in the queue (`POST /ai-tasks`). */
class ReceiptSubmitStore(
    private val app: HauswartApp,
) : Store<ReceiptSubmitState>(ReceiptSubmitState()) {
    private var name = ""
    private var mime = ""
    private var bytes = ByteArray(0)

    /** Names this upload: the same upload sent again returns the task the first one queued. */
    private var key = newIdempotencyKey()

    init {
        load()
    }

    fun retry() {
        load()
    }

    /** A picked or captured file; [mime] may be empty or null, then the extension of [name] decides. */
    fun pickFile(
        name: String,
        mime: String?,
        bytes: ByteArray,
    ) {
        val type = fileMime(mime, name)
        this.name = name
        this.mime = type
        this.bytes = bytes
        key = newIdempotencyKey()
        val problem =
            when {
                isHeicMime(type, name) -> tr("attach_error_heic")
                type !in UPLOAD_MIME_TYPES -> tr("attach_error_unsupported_type")
                bytes.isEmpty() -> tr("attach_error_empty")
                bytes.size > MAX_UPLOAD_BYTES -> tr("attach_error_too_large")
                else -> null
            }
        val warning =
            if (problem == null && isPdfMime(type) && bytes.size > RECEIPT_PDF_READ_MAX_BYTES) {
                tr("quick_receipt_pdf_too_large", "max" to formatBytes(RECEIPT_PDF_READ_MAX_BYTES))
            } else {
                null
            }
        update {
            it.copy(
                fileName = name,
                fileSizeText = formatBytes(bytes.size.toLong()),
                fileProblem = problem,
                fileWarning = warning,
                fieldErrors = emptyMap(),
                error = null,
                noAnswer = false,
            )
        }
    }

    /** [pickFile] for Swift, which hands the bytes over as Base64 text. */
    fun pickFileEncoded(
        name: String,
        mime: String?,
        base64: String,
    ) {
        pickFile(name, mime, decodeBase64(base64))
    }

    /** A file that is too large to be read at all (the apps check the size a picker states before reading it). */
    fun rejectTooLarge(name: String) {
        this.name = name
        this.bytes = ByteArray(0)
        update { it.copy(fileName = name, fileSizeText = null, fileProblem = tr("attach_error_too_large"), fileWarning = null) }
    }

    /** Call before reading a file of a known [size]: true, with the problem shown, when the server would not take it. */
    fun rejectIfTooLarge(
        name: String,
        size: Long,
    ): Boolean {
        if (size <= MAX_UPLOAD_BYTES) return false
        rejectTooLarge(name)
        return true
    }

    /** The picked file could not be read. */
    fun rejectUnreadable() {
        bytes = ByteArray(0)
        update { it.copy(fileName = null, fileSizeText = null, fileProblem = tr("m_attach_cannot_read"), fileWarning = null) }
    }

    fun clearFile() {
        bytes = ByteArray(0)
        name = ""
        update { it.copy(fileName = null, fileSizeText = null, fileProblem = null, fileWarning = null) }
    }

    fun submit(form: ReceiptForm) {
        if (current.saving) return
        val errors = mutableMapOf<String, String>()
        if (bytes.isEmpty() || current.fileName == null) {
            errors["file"] = current.fileProblem ?: tr("quick_receipt_required")
        } else if (current.fileProblem != null) {
            errors["file"] = current.fileProblem.orEmpty()
        }
        if (form.note.trim().length > RECEIPT_NOTE_MAX) errors["note"] = tr("field_too_long", "max" to RECEIPT_NOTE_MAX)
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap(), noAnswer = false) }
        // In the app's scope: leaving the screen must not cancel the upload.
        launchIn(app.background, { e -> failed(e) }) {
            val task = uploadReceipt(app, name, mime, bytes, form.note.trim(), form.bookId, form.assetId, key)
            key = newIdempotencyKey()
            update { it.copy(saving = false, createdId = task.id) }
            app.changed("costs")
        }
    }

    /** Takes the queued receipt back (deletes the task). */
    fun undo() {
        val id = current.createdId ?: return
        launch({ e -> update { it.copy(error = e.message) } }) {
            app.api.aiTasks.aiTasksDelete(id)
            update { it.copy(createdId = null, undone = true) }
            app.changed("costs")
        }
    }

    /** Ready for another receipt. */
    fun reset() {
        bytes = ByteArray(0)
        name = ""
        key = newIdempotencyKey()
        update {
            it.copy(
                fileName = null,
                fileSizeText = null,
                fileProblem = null,
                fileWarning = null,
                createdId = null,
                undone = false,
                error = null,
                fieldErrors = emptyMap(),
            )
        }
    }

    private fun failed(e: UiError) {
        val text =
            when {
                e.isNetwork -> tr("quick_error_network_receipt")
                e.code == "conflict" && e.detailCode == "idempotency_key_reused" -> {
                    key = newIdempotencyKey()
                    tr("quick_error_key_used_receipt")
                }
                else ->
                    when (e.detailCode) {
                        "empty" -> tr("attach_error_empty")
                        "too_large" -> tr("attach_error_too_large")
                        "unsupported_type" -> tr("attach_error_unsupported_type")
                        "unsupported_heic" -> tr("attach_error_heic")
                        "corrupt_image" -> tr("attach_error_corrupt")
                        "image_too_large" -> tr("attach_error_image_too_large")
                        else -> e.message
                    }
            }
        update { it.copy(saving = false, error = text, fieldErrors = e.fields, noAnswer = e.isNetwork) }
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val (books, assets) =
                coroutineScope {
                    val bookList =
                        async {
                            fetchAll { cursor ->
                                val page = app.api.costs.costBooksList(cursor = cursor, limit = 200)
                                page.items to page.nextCursor
                            }
                        }
                    val assetList =
                        async {
                            fetchAll { cursor ->
                                val page = app.api.assets.assetsList(cursor = cursor, limit = 200)
                                page.items to page.nextCursor
                            }
                        }
                    bookList.await() to assetList.await()
                }
            val open = openBooks(books)
            update {
                it.copy(
                    loading = false,
                    books =
                        if (open.size >
                            1
                        ) {
                            listOf(CostOption("", tr("quick_receipt_book_open"))) + open.map { b -> CostOption(b.id, b.name) }
                        } else {
                            emptyList()
                        },
                    assets =
                        listOf(CostOption("", tr("cost_no_asset"))) +
                            assets.map { a -> CostOption(a.id, if (a.roomName != null) "${a.name} (${a.roomName})" else a.name) },
                )
            }
        }
    }
}
