package ch.orellbuehler.hauswart.feature.documentlinks

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.DocumentLinksCreateRequest
import ch.orellbuehler.hauswart.api.generated.ExternalDocument
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.feature.files.FilePayload
import ch.orellbuehler.hauswart.feature.files.ThumbnailCache
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay

/** The kinds of document (what the link is for), in the order the web offers them. */
val DOCUMENT_LINK_ROLES: List<String> = DocumentLinksCreateRequest.ROLE_VALUES

fun documentRoleLabel(role: String): String = tr("document_role_$role")

/** The kind of document a person most likely wants on this kind of owner; they can change it. */
fun defaultDocumentRole(ownerType: String): String =
    when (ownerType) {
        "asset" -> "manual"
        "part" -> "datasheet"
        "defect", "contact" -> "correspondence"
        "service_log", "cost" -> "invoice"
        "insurance_policy" -> "policy"
        else -> "other"
    }

/** A document of the search results. [id] is the external id as text. */
data class DocumentChoiceRow(
    val id: String,
    val title: String,
    /** Correspondent and date. */
    val details: String,
    val tags: String,
    /** It is linked to this very owner already. */
    val linkedHere: Boolean,
    /** "Also used at: ...", empty when it is not linked anywhere else. */
    val usedIn: String,
    val hasThumb: Boolean,
)

/** What the form holds as the person typed it. */
data class LinkDocumentForm(
    val role: String,
    val label: String,
)

data class LinkDocumentState(
    val query: String = "",
    val loading: Boolean = true,
    val error: UiError? = null,
    val rows: List<DocumentChoiceRow> = emptyList(),
    val hasMore: Boolean = false,
    val loadingMore: Boolean = false,
    val moreError: UiError? = null,
    val selectedId: String = "",
    val initial: LinkDocumentForm = LinkDocumentForm("other", ""),
    val submitting: Boolean = false,
    val submitError: String? = null,
    /** How many documents this dialog linked; a change closes it. */
    val linked: Int = 0,
    val thumbs: Int = 0,
) {
    val selectedTitle: String? get() = rows.firstOrNull { it.id == selectedId }?.title
}

/** Searches the caller's document system and links the chosen document to one owner. */
class LinkDocumentStore(
    private val app: HauswartApp,
    private val ownerType: String,
    private val ownerId: String,
) : Store<LinkDocumentState>(LinkDocumentState(initial = LinkDocumentForm(defaultDocumentRole(ownerType), ""))) {
    private var documents: List<ExternalDocument> = emptyList()
    private var cursor: String? = null
    private var searching: Job? = null
    private var generation = 0
    private val thumbnails =
        ThumbnailCache(
            scope = scope,
            parallel = 3,
            fetch = { id ->
                val doc = documents.first { it.externalId.toString() == id }
                app.api.documents
                    .documentsThumb(doc.provider, id)
                    .bytes
            },
            changed = { update { it.copy(thumbs = it.thumbs + 1) } },
        )

    init {
        search()
    }

    fun setQuery(query: String) {
        if (query == current.query) return
        update { it.copy(query = query) }
        search()
    }

    fun retry() {
        search()
    }

    fun loadMore() {
        val next = cursor ?: return
        if (current.loadingMore) return
        val ticket = generation
        update { it.copy(loadingMore = true, moreError = null) }
        launch({ e -> update { it.copy(loadingMore = false, moreError = e) } }) {
            val page = app.api.documents.documentsList(cursor = next, limit = PAGE_SIZE, q = current.query.trim().ifEmpty { null })
            if (ticket != generation) return@launch
            documents = documents + page.items
            cursor = page.nextCursor
            show()
            update { it.copy(loadingMore = false) }
        }
    }

    fun select(id: String) {
        update { it.copy(selectedId = id, submitError = null) }
    }

    fun thumbnail(id: String): ByteArray? = thumbnails.get(id)

    fun thumbnailBase64(id: String): String? = thumbnails.get(id)?.let { FilePayload(id, "image/webp", it).base64() }

    fun requestThumbnail(id: String) {
        thumbnails.request(id)
    }

    fun submit(form: LinkDocumentForm) {
        if (current.submitting) return
        val doc = documents.firstOrNull { it.externalId.toString() == current.selectedId }
        if (doc == null) {
            update { it.copy(submitError = tr("document_link_choose")) }
            return
        }
        update { it.copy(submitting = true, submitError = null) }
        launch({ e -> update { it.copy(submitting = false, submitError = failureText(e)) } }) {
            app.api.documents.documentLinksCreate(
                DocumentLinksCreateRequest(
                    provider = doc.provider,
                    externalId = doc.externalId,
                    ownerType = ownerType,
                    ownerId = ownerId,
                    role = form.role,
                    label = form.label.trim().ifEmpty { null },
                ),
            )
            update { it.copy(submitting = false, linked = it.linked + 1) }
            app.changed("documents")
        }
    }

    private fun failureText(e: UiError): String =
        when (e.code) {
            "conflict" -> tr("document_link_taken")
            "not_found" -> tr("document_link_not_visible")
            else -> e.message
        }

    private fun search() {
        searching?.cancel()
        val ticket = ++generation
        val text = current.query.trim()
        update { it.copy(loading = true, error = null, moreError = null) }
        searching =
            launch({ e -> if (ticket == generation) update { it.copy(loading = false, error = e) } }) {
                if (text.isNotEmpty()) delay(SEARCH_DELAY_MS)
                val page = app.api.documents.documentsList(limit = PAGE_SIZE, q = text.ifEmpty { null })
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
                val here = doc.linkedTo.any { it.ownerType == ownerType && it.ownerId == ownerId }
                DocumentChoiceRow(
                    id = doc.externalId.toString(),
                    title = doc.title,
                    details = listOfNotNull(doc.correspondentName, doc.createdDate?.let { Dates.format(it) }).joinToString(" · "),
                    tags = doc.tagNames.joinToString(", "),
                    linkedHere = here,
                    usedIn = if (here || doc.linkedTo.isEmpty()) "" else tr("document_link_used_in", "places" to linkedPlaces(doc)),
                    hasThumb = true,
                )
            }
        update { it.copy(rows = rows, hasMore = cursor != null) }
    }

    private fun linkedPlaces(doc: ExternalDocument): String {
        val names = doc.linkedTo.map { it.ownerTitle ?: tr("document_owner_${it.ownerType}") }
        val shown = names.take(2).joinToString(", ")
        return if (names.size > 2) "$shown +${names.size - 2}" else shown
    }

    private companion object {
        const val PAGE_SIZE = 25L
        const val SEARCH_DELAY_MS = 300L
    }
}
