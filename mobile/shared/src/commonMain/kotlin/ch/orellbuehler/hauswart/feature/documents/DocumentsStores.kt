package ch.orellbuehler.hauswart.feature.documents

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.api.ApiHttp
import ch.orellbuehler.hauswart.api.generated.AssetSuggestion
import ch.orellbuehler.hauswart.api.generated.AssetsCreateRequest
import ch.orellbuehler.hauswart.api.generated.ContactSuggestion
import ch.orellbuehler.hauswart.api.generated.ContactsCreateRequest
import ch.orellbuehler.hauswart.api.generated.DocumentLinksCreateRequest
import ch.orellbuehler.hauswart.api.generated.ExternalDocument
import ch.orellbuehler.hauswart.api.generated.ExternalDocumentDetail
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.feature.applink.AppLink
import ch.orellbuehler.hauswart.feature.applink.LINK_ASSET
import ch.orellbuehler.hauswart.feature.applink.LINK_CONTACT
import ch.orellbuehler.hauswart.feature.applink.routeForUrl
import ch.orellbuehler.hauswart.feature.files.FilePayload
import ch.orellbuehler.hauswart.feature.files.ThumbnailCache
import ch.orellbuehler.hauswart.feature.files.fileNameFor
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** The document systems the app knows; only Paperless-ngx so far. */
private const val DOCUMENT_PROVIDER = "paperless"

const val DOCUMENTS_LINKED_ALL = "all"
const val DOCUMENTS_LINKED_YES = "yes"
const val DOCUMENTS_LINKED_NO = "no"

/** The choices of the "linked" filter in the order they are shown. */
val DOCUMENTS_LINKED_FILTERS: List<String> = listOf(DOCUMENTS_LINKED_ALL, DOCUMENTS_LINKED_YES, DOCUMENTS_LINKED_NO)

fun documentsLinkedLabel(filter: String): String = tr("documents_linked_$filter")

/** A file of a document the person asked for: shown by the system viewer, or handed to the share sheet when [share]. */
class OpenedDocumentFile(
    val file: FilePayload,
    val share: Boolean,
)

private fun warrantyText(
    until: String?,
    extended: String?,
): String? =
    when {
        until == null && extended == null -> null
        until != null && extended != null ->
            tr("asset_warranty_detail", "until" to Dates.format(until), "extended" to Dates.format(extended))
        else -> tr("document_suggestion_warranty", "date" to Dates.format((extended ?: until).orEmpty()))
    }

private fun placesOf(titles: List<String>): String {
    val shown = titles.take(2).joinToString(", ")
    return if (titles.size > 2) "$shown +${titles.size - 2}" else shown
}

data class DocumentRowItem(
    val id: String,
    val title: String,
    /** Correspondent, date and pages. */
    val details: String,
    /** Up to three tags. */
    val tags: List<String>,
    val moreTags: Int,
    val warranty: String,
    /** "Used at: ..."; empty when the document is linked nowhere. */
    val usedIn: String,
    val unused: Boolean,
)

data class DocumentsListState(
    val loading: Boolean = true,
    val error: UiError? = null,
    /** The caller has a working document system; null while unknown. */
    val connected: Boolean? = null,
    /** The connection's last error when the system does not answer; empty when it is fine. */
    val connectionWarning: String = "",
    val query: String = "",
    /** One of [DOCUMENTS_LINKED_FILTERS]. */
    val linked: String = DOCUMENTS_LINKED_ALL,
    val rows: List<DocumentRowItem> = emptyList(),
    val hasMore: Boolean = false,
    val loadingMore: Boolean = false,
    val moreError: UiError? = null,
    /** Changes whenever a thumbnail arrived. */
    val thumbs: Int = 0,
) {
    val filtered: Boolean get() = query.isNotBlank() || linked != DOCUMENTS_LINKED_ALL
}

/** The documents of the caller's own document system; searching asks the system itself. */
class DocumentsListStore(
    private val app: HauswartApp,
) : Store<DocumentsListState>(DocumentsListState()) {
    private var documents: List<ExternalDocument> = emptyList()
    private var cursor: String? = null
    private var job: Job? = null
    private var generation = 0
    private var provider = DOCUMENT_PROVIDER
    private val thumbnails =
        ThumbnailCache(
            scope = scope,
            parallel = 3,
            fetch = { id ->
                app.api.documents
                    .documentsThumb(provider, id)
                    .bytes
            },
            changed = { update { it.copy(thumbs = it.thumbs + 1) } },
        )

    init {
        onChange(app, "documents") { if (current.connected == true) search(false) }
        connect()
    }

    fun refresh() {
        if (current.connected == true) search(false) else connect()
    }

    fun setQuery(query: String) {
        if (query == current.query) return
        update { it.copy(query = query) }
        search(true)
    }

    fun setLinked(filter: String) {
        update { it.copy(linked = filter) }
        search(false)
    }

    fun resetFilters() {
        update { it.copy(query = "", linked = DOCUMENTS_LINKED_ALL) }
        search(false)
    }

    fun thumbnail(id: String): ByteArray? = thumbnails.get(id)

    fun thumbnailBase64(id: String): String? = thumbnails.get(id)?.let { FilePayload(id, "image/webp", it).base64() }

    fun requestThumbnail(id: String) {
        thumbnails.request(id)
    }

    fun loadMore() {
        val next = cursor ?: return
        if (current.loadingMore) return
        val ticket = generation
        update { it.copy(loadingMore = true, moreError = null) }
        launch({ e -> update { it.copy(loadingMore = false, moreError = e) } }) {
            val page = request(next)
            if (ticket != generation) return@launch
            documents = documents + page.items
            cursor = page.nextCursor
            show()
            update { it.copy(loadingMore = false) }
        }
    }

    private suspend fun request(cursor: String?) =
        app.api.documents.documentsList(
            cursor = cursor,
            limit = PAGE_SIZE,
            q = current.query.trim().ifEmpty { null },
            linked =
                when (current.linked) {
                    DOCUMENTS_LINKED_YES -> true
                    DOCUMENTS_LINKED_NO -> false
                    else -> null
                },
        )

    private fun connect() {
        update { it.copy(loading = true, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val connection =
                app.api.integrations
                    .integrationsList()
                    .items
                    .firstOrNull { it.kind == DOCUMENT_PROVIDER && it.available && it.configured && it.enabled }
            if (connection == null) {
                update { it.copy(loading = false, connected = false) }
                return@launch
            }
            provider = connection.kind
            val warning = if (connection.status == "error") tr("documents_connection_error") + " " + connection.lastError.orEmpty() else ""
            update { it.copy(connected = true, connectionWarning = warning.trim()) }
            search(false)
        }
    }

    private fun search(delayed: Boolean) {
        job?.cancel()
        val ticket = ++generation
        update { it.copy(loading = true, error = null, moreError = null) }
        job =
            launch({ e -> if (ticket == generation) update { it.copy(loading = false, error = e) } }) {
                if (delayed && current.query.isNotBlank()) delay(SEARCH_DELAY_MS)
                val page = request(null)
                if (ticket != generation) return@launch
                documents = page.items
                cursor = page.nextCursor
                show()
                update { it.copy(loading = false) }
            }
    }

    private fun show() {
        val rows =
            documents.map { doc ->
                val titles = doc.linkedTo.map { it.ownerTitle ?: tr("document_owner_${it.ownerType}") }
                DocumentRowItem(
                    id = doc.externalId.toString(),
                    title = doc.title,
                    details =
                        listOfNotNull(
                            doc.correspondentName,
                            doc.createdDate?.let { Dates.format(it) },
                            doc.pageCount?.takeIf { it > 0 }?.let { tr("document_pages", "count" to it) },
                        ).filter { it.isNotBlank() }.joinToString(" · "),
                    tags = doc.tagNames.take(3),
                    moreTags = (doc.tagNames.size - 3).coerceAtLeast(0),
                    warranty = warrantyText(doc.warrantyUntil, doc.warrantyExtendedUntil).orEmpty(),
                    usedIn = if (titles.isEmpty()) "" else tr("documents_used_in", "places" to placesOf(titles)),
                    unused = titles.isEmpty(),
                )
            }
        update { it.copy(rows = rows, hasMore = cursor != null) }
    }

    private companion object {
        const val PAGE_SIZE = 25L
        const val SEARCH_DELAY_MS = 300L
    }
}

data class DocumentFact(
    val label: String,
    val value: String,
)

/** Where a document is used. */
data class DocumentUseRow(
    val id: String,
    val title: String,
    /** "Device", "Room", ... */
    val kindLabel: String,
    val roleLabel: String,
    val label: String,
    /** The screen of the owner; null when it is gone or the app has no screen for it. */
    val link: AppLink?,
    val gone: Boolean,
)

data class DocumentDetailState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val title: String = "",
    val facts: List<DocumentFact> = emptyList(),
    val tags: List<String> = emptyList(),
    val uses: List<DocumentUseRow> = emptyList(),
    /** The address of the document in its own system, when it has one. */
    val webUrl: String? = null,
    val hasThumb: Boolean = false,
    val thumbs: Int = 0,
    val unlinkingId: String? = null,
    val opening: Boolean = false,
    val actionError: UiError? = null,
    val notice: String? = null,
    val opened: OpenedDocumentFile? = null,
)

/** One document: what it is, where hauswart uses it, and opening or sharing its file. */
class DocumentDetailStore(
    private val app: HauswartApp,
    private val externalId: String,
) : Store<DocumentDetailState>(DocumentDetailState()) {
    private var detail: ExternalDocumentDetail? = null
    private val thumbnails =
        ThumbnailCache(
            scope = scope,
            parallel = 1,
            fetch = { id ->
                app.api.documents
                    .documentsThumb(DOCUMENT_PROVIDER, id)
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

    fun thumbnail(): ByteArray? = thumbnails.get(externalId)

    fun thumbnailBase64(): String? = thumbnails.get(externalId)?.let { FilePayload(externalId, "image/webp", it).base64() }

    fun requestThumbnail() {
        thumbnails.request(externalId)
    }

    /** Fetches the preview (a PDF or an image) of the document to show it. */
    fun open() {
        fetch(original = false)
    }

    /** Fetches the original file, for the share sheet. */
    fun openOriginal() {
        fetch(original = true)
    }

    fun clearOpened() {
        update { it.copy(opened = null) }
    }

    fun unlink(linkId: String) {
        if (current.unlinkingId != null) return
        update { it.copy(unlinkingId = linkId, actionError = null) }
        launch({ e -> update { it.copy(unlinkingId = null, actionError = e) } }) {
            app.api.documents.documentLinksDelete(linkId)
            update { it.copy(unlinkingId = null, notice = tr("document_unlinked_toast")) }
            app.changed("documents")
        }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun fetch(original: Boolean) {
        if (current.opening) return
        val doc = detail ?: return
        update { it.copy(opening = true, actionError = null) }
        launch({ e -> update { it.copy(opening = false, actionError = e) } }) {
            val body =
                if (original) {
                    app.api.documents.documentsDownload(doc.provider, externalId, "1")
                } else {
                    app.api.documents.documentsPreview(doc.provider, externalId)
                }
            val sent =
                body.contentType
                    ?.substringBefore(';')
                    ?.trim()
                    .orEmpty()
            val mime = if (sent.isEmpty() || sent == "application/octet-stream") doc.mimeType ?: sent else sent
            update {
                it.copy(
                    opening = false,
                    opened = OpenedDocumentFile(FilePayload(fileNameFor(doc.title, mime), mime, body.bytes), original),
                )
            }
        }
    }

    private fun load() {
        update { it.copy(loading = it.title.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val doc = app.api.documents.documentsGet(DOCUMENT_PROVIDER, externalId)
            detail = doc
            val facts =
                listOfNotNull(
                    doc.createdDate?.let { DocumentFact(tr("documents_field_date"), Dates.format(it)) },
                    doc.correspondentName?.let { DocumentFact(tr("documents_field_correspondent"), it) },
                    doc.pageCount?.takeIf { it > 0 }?.let {
                        DocumentFact(
                            tr("documents_field_pages"),
                            tr("document_pages", "count" to it),
                        )
                    },
                    doc.noteCount.takeIf { it > 0 }?.let { DocumentFact(tr("documents_field_notes"), it.toString()) },
                    doc.warrantyUntil?.let { DocumentFact(tr("asset_warranty_until"), Dates.format(it)) },
                    doc.warrantyExtendedUntil?.let { DocumentFact(tr("asset_warranty_extended"), Dates.format(it)) },
                )
            val uses =
                doc.links.map { link ->
                    DocumentUseRow(
                        id = link.id,
                        title = link.ownerTitle ?: tr("document_owner_${link.ownerType}"),
                        kindLabel = tr("document_owner_${link.ownerType}"),
                        roleLabel = tr("document_role_${link.role}"),
                        label = link.label.orEmpty(),
                        link = routeForUrl(link.ownerUrl),
                        gone = link.ownerUrl == null,
                    )
                }
            update {
                it.copy(
                    loading = false,
                    title = doc.title,
                    facts = facts,
                    tags = doc.tagNames,
                    uses = uses,
                    webUrl = doc.webUrl,
                    hasThumb = true,
                )
            }
        }
    }
}

/** What the suggestion becomes. */
const val SUGGESTION_ASSET = "asset"
const val SUGGESTION_CONTACT = "contact"

data class SuggestionRow(
    /** `kind:provider:id`; what "ignore" remembers. */
    val key: String,
    val title: String,
    val subtitle: String,
    val warranty: String,
)

data class DocumentSuggestionsState(
    val kind: String,
    val loading: Boolean = true,
    val error: UiError? = null,
    val visible: List<SuggestionRow> = emptyList(),
    val ignored: List<SuggestionRow> = emptyList(),
    /** Nothing was suggested at all. */
    val none: Boolean = false,
    val busyKey: String? = null,
    val rowErrors: Map<String, String> = emptyMap(),
    val notice: String? = null,
    /** The address a "created" notice can open. */
    val createdLink: AppLink? = null,
)

/** Receipts that no device stands for and correspondents that no contact stands for, from the caller's synced documents. */
class DocumentSuggestionsStore(
    private val app: HauswartApp,
    private val kind: String,
) : Store<DocumentSuggestionsState>(DocumentSuggestionsState(kind = kind)) {
    private var assets: List<AssetSuggestion> = emptyList()
    private var contacts: List<ContactSuggestion> = emptyList()
    private var dismissed: Set<String> = readDismissed()

    init {
        load()
    }

    fun refresh() {
        load()
    }

    fun dismiss(key: String) {
        dismissed = dismissed + key
        saveDismissed()
        show()
    }

    fun restore(key: String) {
        dismissed = dismissed - key
        saveDismissed()
        show()
    }

    fun dismissNotice() {
        update { it.copy(notice = null, createdLink = null) }
    }

    fun adopt(key: String) {
        if (current.busyKey != null) return
        update { it.copy(busyKey = key, rowErrors = it.rowErrors - key) }
        launch({ e -> update { it.copy(busyKey = null, rowErrors = it.rowErrors + (key to e.message)) } }) {
            if (kind == SUGGESTION_ASSET) {
                adoptAsset(assets.first { keyOf(it) == key })
            } else {
                adoptContact(contacts.first { keyOf(it) == key })
            }
        }
    }

    private suspend fun adoptAsset(s: AssetSuggestion) {
        val asset =
            app.api.assets.assetsCreate(
                AssetsCreateRequest(
                    kind = "device",
                    name =
                        s.title
                            .trim()
                            .take(120)
                            .ifEmpty { tr("document_suggestion_untitled") },
                    purchaseDate = s.createdDate,
                ),
            )
        try {
            app.api.documents.documentLinksCreate(
                DocumentLinksCreateRequest(
                    provider = s.provider,
                    externalId = s.externalId,
                    ownerType = "asset",
                    ownerId = asset.id,
                    role = "receipt",
                ),
            )
        } catch (e: ApiException) {
            // Without the link the receipt would be suggested again and again: take the new device back.
            try {
                app.api.assets.assetsDelete(asset.id)
            } catch (undo: ApiException) {
                assets = assets.filterNot { keyOf(it) == keyOf(s) }
                show()
                update {
                    it.copy(
                        busyKey = null,
                        rowErrors =
                            it.rowErrors + (keyOf(s) to tr("document_suggestion_link_failed_kept", "name" to asset.name)),
                    )
                }
                app.changed("assets", "documents")
                return
            }
            throw e
        }
        assets = assets.filterNot { keyOf(it) == keyOf(s) }
        show()
        update {
            it.copy(
                busyKey = null,
                notice = tr("document_suggestion_asset_created", "name" to asset.name),
                createdLink = AppLink(LINK_ASSET, asset.id),
            )
        }
        app.changed("assets", "documents")
    }

    private suspend fun adoptContact(s: ContactSuggestion) {
        val contact =
            app.api.contacts.contactsCreate(
                ContactsCreateRequest(
                    kind = "other",
                    name = s.name.trim().take(160),
                    externalSource = s.externalSource,
                    externalRef = s.externalRef,
                ),
            )
        contacts = contacts.filterNot { keyOf(it) == keyOf(s) }
        show()
        update {
            it.copy(
                busyKey = null,
                notice = tr("document_suggestion_contact_created", "name" to contact.name),
                createdLink = AppLink(LINK_CONTACT, contact.id),
            )
        }
        app.changed("contacts", "documents")
    }

    private fun keyOf(s: AssetSuggestion) = "asset:${s.provider}:${s.externalId}"

    private fun keyOf(s: ContactSuggestion) = "contact:${s.provider}:${s.correspondentId}"

    private fun load() {
        update { it.copy(loading = true, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val items =
                app.api.documents
                    .documentsSuggestions(kind)
                    .items
            val wanted = items.filter { ((it as? JsonObject)?.get("kind") as? JsonPrimitive)?.content == kind }
            if (kind == SUGGESTION_ASSET) {
                assets = wanted.map { ApiHttp.JSON.decodeFromJsonElement(AssetSuggestion.serializer(), it) }
            } else {
                contacts = wanted.map { ApiHttp.JSON.decodeFromJsonElement(ContactSuggestion.serializer(), it) }
            }
            show()
            update { it.copy(loading = false) }
        }
    }

    private fun show() {
        val rows =
            if (kind == SUGGESTION_ASSET) {
                assets.map { s ->
                    SuggestionRow(
                        key = keyOf(s),
                        title = s.title,
                        subtitle = listOfNotNull(s.correspondentName, s.createdDate?.let { Dates.format(it) }).joinToString(" · "),
                        warranty = warrantyText(s.warrantyUntil, s.warrantyExtendedUntil).orEmpty(),
                    )
                }
            } else {
                contacts.map { s ->
                    SuggestionRow(keyOf(s), s.name, tr("document_suggestion_documents", "count" to s.documentCount), "")
                }
            }
        update { st ->
            st.copy(
                visible = rows.filter { it.key !in dismissed },
                ignored = rows.filter { it.key in dismissed },
                none = rows.isEmpty(),
            )
        }
    }

    private fun storageKey() = "dismissed-document-suggestions:${app.session.user?.id.orEmpty()}"

    private fun readDismissed(): Set<String> =
        app.settings
            .load(storageKey())
            .orEmpty()
            .split('\n')
            .filter { it.isNotBlank() }
            .toSet()

    private fun saveDismissed() {
        app.settings.save(storageKey(), dismissed.joinToString("\n"))
    }
}
