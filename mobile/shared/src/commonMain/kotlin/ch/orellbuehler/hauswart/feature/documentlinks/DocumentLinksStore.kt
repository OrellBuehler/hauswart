package ch.orellbuehler.hauswart.feature.documentlinks

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.api.generated.DocumentLink
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.feature.files.FilePayload
import ch.orellbuehler.hauswart.feature.files.ThumbnailCache
import ch.orellbuehler.hauswart.feature.files.fileNameFor
import ch.orellbuehler.hauswart.i18n.tr

/** The document systems the app knows; only Paperless-ngx so far. */
private const val DOCUMENT_PROVIDER = "paperless"

/** One linked document as the screen shows it. */
data class DocumentLinkRow(
    val id: String,
    /** The caller's own account in the document system may read the document. */
    val available: Boolean,
    /** The document's title; "Not shared with you" when the caller may not read it. */
    val title: String,
    /** "Invoice", "Manual", ... */
    val roleLabel: String,
    /** Correspondent, date, pages and the link's label, joined with " · ". */
    val details: String,
    val hasThumb: Boolean,
    val canOpen: Boolean,
)

data class DocumentLinksState(
    val loading: Boolean = true,
    val error: UiError? = null,
    /** The caller has a working document system; null while unknown or when it could not be asked. */
    val connected: Boolean? = null,
    val rows: List<DocumentLinkRow> = emptyList(),
    val unlinkingId: String? = null,
    /** The link whose document is being fetched to open it. */
    val opening: String? = null,
    /** A failed unlink or download; the list is still shown. */
    val actionError: UiError? = null,
    /** Changes whenever a thumbnail arrived. */
    val thumbs: Int = 0,
    /** Ready for the system viewer; the screen calls [DocumentLinksStore.clearOpened] once it did. */
    val opened: FilePayload? = null,
) {
    /**
     * Without a document system and without links there is nothing to show or do, so the section
     * stays away instead of announcing an empty list on every screen.
     */
    val visible: Boolean get() = error != null || (!loading && (connected == true || rows.isNotEmpty()))

    /** Documents can be linked: the caller has a document system. */
    val canLink: Boolean get() = connected == true
}

/**
 * The documents of the caller's document system that are linked to one owner (`ownerType` +
 * `ownerId`): list with thumbnails, open the preview, unlink. Linking a new one is [LinkDocumentStore].
 */
class DocumentLinksStore(
    private val app: HauswartApp,
    private val ownerType: String,
    private val ownerId: String,
) : Store<DocumentLinksState>(DocumentLinksState()) {
    private var links: List<DocumentLink> = emptyList()
    private val thumbnails =
        ThumbnailCache(
            scope = scope,
            parallel = 3,
            fetch = { id ->
                val link = links.first { it.id == id }
                app.api.documents
                    .documentsThumb(link.provider, link.externalId.toString())
                    .bytes
            },
            changed = { update { it.copy(thumbs = it.thumbs + 1) } },
        )

    init {
        onChange(app, "documents") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun thumbnail(id: String): ByteArray? = thumbnails.get(id)

    fun thumbnailBase64(id: String): String? = thumbnails.get(id)?.let { FilePayload(id, "image/webp", it).base64() }

    fun requestThumbnail(id: String) {
        thumbnails.request(id)
    }

    /** Fetches the preview (a PDF or an image) of the linked document to show it. */
    fun open(id: String) {
        fetch(id, original = false)
    }

    /** Fetches the original file of the linked document, for the share sheet. */
    fun openOriginal(id: String) {
        fetch(id, original = true)
    }

    fun clearOpened() {
        update { it.copy(opened = null) }
    }

    fun unlink(id: String) {
        if (current.unlinkingId != null) return
        update { it.copy(unlinkingId = id, actionError = null) }
        launch({ e -> update { it.copy(unlinkingId = null, actionError = e) } }) {
            app.api.documents.documentLinksDelete(id)
            links = links.filterNot { it.id == id }
            show()
            update { it.copy(unlinkingId = null) }
            app.changed("documents")
        }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun fetch(
        id: String,
        original: Boolean,
    ) {
        if (current.opening != null) return
        val link = links.firstOrNull { it.id == id } ?: return
        update { it.copy(opening = id, actionError = null) }
        launch({ e -> update { it.copy(opening = null, actionError = e) } }) {
            val externalId = link.externalId.toString()
            val body =
                if (original) {
                    app.api.documents.documentsDownload(link.provider, externalId, "1")
                } else {
                    app.api.documents.documentsPreview(link.provider, externalId)
                }
            val sent =
                body.contentType
                    ?.substringBefore(';')
                    ?.trim()
                    .orEmpty()
            val mime = if (sent.isEmpty() || sent == "application/octet-stream") link.document?.mimeType ?: sent else sent
            val title = link.document?.title ?: tr("document_unavailable")
            update { it.copy(opening = null, opened = FilePayload(fileNameFor(title, mime), mime, body.bytes)) }
        }
    }

    private fun load() {
        update { it.copy(loading = it.rows.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val connected =
                try {
                    app.api.integrations
                        .integrationsList()
                        .items
                        .any { it.kind == DOCUMENT_PROVIDER && it.available && it.configured && it.enabled }
                } catch (e: ApiException) {
                    // Which document system the caller has is not known: the links are still shown, linking is not offered.
                    if (e.code == "unauthenticated") throw e
                    null
                }
            links =
                fetchAll { cursor ->
                    val page = app.api.documents.documentLinksList(cursor = cursor, limit = 200, ownerType = ownerType, ownerId = ownerId)
                    page.items to page.nextCursor
                }
            show()
            update { it.copy(loading = false, connected = connected) }
        }
    }

    private fun show() {
        val rows =
            links.map { link ->
                val doc = link.document
                val available = link.available && doc != null
                DocumentLinkRow(
                    id = link.id,
                    available = available,
                    title = if (available && doc != null) doc.title else tr("document_unavailable"),
                    roleLabel = tr("document_role_${link.role}"),
                    details =
                        listOfNotNull(
                            doc?.correspondentName,
                            doc?.createdDate?.let { Dates.format(it) },
                            doc?.pageCount?.takeIf { it > 0 }?.let { tr("document_pages", "count" to it) },
                            link.label,
                        ).filter { it.isNotBlank() }.joinToString(" · "),
                    hasThumb = available && link.thumbUrl != null,
                    canOpen = available && link.previewUrl != null,
                )
            }
        update { it.copy(rows = rows) }
    }
}
