package ch.orellbuehler.hauswart.feature.docs

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.ApiException
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.DocPage
import ch.orellbuehler.hauswart.api.generated.DocPageSummary
import ch.orellbuehler.hauswart.api.generated.Heading
import ch.orellbuehler.hauswart.api.generated.PagesCreateRequest
import ch.orellbuehler.hauswart.api.generated.PagesPreviewRequest
import ch.orellbuehler.hauswart.api.generated.PagesUpdateRequest
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.feature.files.FilePayload
import ch.orellbuehler.hauswart.feature.files.formatBytes
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

val DOC_SECTIONS: List<String> = PagesCreateRequest.SECTION_VALUES

fun docSectionLabel(section: String): String = if (section in DOC_SECTIONS) tr("docs_section_$section") else section

/** The longest text the server renders (200 KB). */
const val DOC_BODY_MAX_BYTES = 200 * 1024
const val DOC_TITLE_MAX = 200

/** The message for a failed save, preview or restore of a page; other failures keep their generic text. */
private fun failure(e: UiError): UiError {
    val text =
        when {
            e.detailCode == "too_large" -> tr("docs_error_too_large")
            e.detailCode == "too_complex" -> tr("docs_error_too_complex")
            e.detailCode == "unavailable" -> tr("docs_error_unavailable")
            e.code == "rate_limited" -> tr("docs_error_preview_rate_limited")
            e.code == "conflict" -> tr("docs_error_conflict")
            else -> return e
        }
    return e.copy(message = text)
}

/** A device or room a page can belong to. */
data class DocPlaceChoice(
    val id: String,
    val label: String,
)

data class DocRowItem(
    val slug: String,
    val title: String,
    val excerpt: String,
    val sectionLabel: String,
    val pinned: Boolean,
    val archived: Boolean,
    val guestVisible: Boolean,
    val commentCount: Int,
    /** The device and the room, joined with " · "; empty for none. */
    val places: String,
    /** The day it was last changed, in the household's zone. */
    val updated: String,
)

/** A group of the list: [key] is `pinned` or a section. */
data class DocGroup(
    val key: String,
    val title: String,
    val rows: List<DocRowItem>,
)

data class DocsListState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val query: String = "",
    /** The section shown; empty for all. */
    val section: String = "",
    val archived: Boolean = false,
    val groups: List<DocGroup> = emptyList(),
    /** Searching shows a flat result list in [groups] (one group with the key `results`). */
    val shown: Int = 0,
    val loaded: Boolean = false,
) {
    val filtered: Boolean get() = query.isNotBlank() || section.isNotEmpty()
    val searching: Boolean get() = query.isNotBlank()
}

/** The documentation pages: pinned first, then by section; searching lists the best matches. */
class DocsListStore(
    private val app: HauswartApp,
) : Store<DocsListState>(DocsListState()) {
    private var pages: List<DocPageSummary> = emptyList()
    private var assetNames: Map<String, String> = emptyMap()
    private var roomNames: Map<String, String> = emptyMap()
    private var job: Job? = null
    private var generation = 0

    init {
        onChange(app, "docs") { load(false) }
        load(false)
    }

    fun refresh() {
        load(false)
    }

    fun search(query: String) {
        if (query == current.query) return
        update { it.copy(query = query) }
        load(true)
    }

    fun setSection(section: String) {
        update { it.copy(section = section) }
        load(false)
    }

    fun setArchived(value: Boolean) {
        update { it.copy(archived = value) }
        load(false)
    }

    fun resetFilters() {
        update { it.copy(query = "", section = "") }
        load(false)
    }

    private fun load(delayed: Boolean) {
        job?.cancel()
        val ticket = ++generation
        val state = current
        val text = state.query.trim()
        update { it.copy(loading = !it.loaded, error = null) }
        job =
            launch({ e -> if (ticket == generation) update { it.copy(loading = false, error = e) } }) {
                if (delayed && text.isNotEmpty()) delay(SEARCH_DELAY_MS)
                val zone = app.household.get().timezone
                val found =
                    fetchAll { cursor ->
                        val page =
                            app.api.docs.pagesList(
                                cursor = cursor,
                                limit = 200,
                                section = state.section.ifEmpty { null },
                                q = text.ifEmpty { null },
                                includeArchived = if (state.archived) true else null,
                            )
                        page.items to page.nextCursor
                    }
                if (assetNames.isEmpty() && roomNames.isEmpty()) {
                    assetNames =
                        fetchAll { cursor ->
                            val page = app.api.assets.assetsList(cursor = cursor, limit = 200)
                            page.items to page.nextCursor
                        }.associate { it.id to it.name }
                    roomNames =
                        fetchAll { cursor ->
                            val page = app.api.rooms.roomsList(cursor = cursor, limit = 200)
                            page.items to page.nextCursor
                        }.associate { it.id to it.name }
                }
                if (ticket != generation) return@launch
                pages = found
                update { it.copy(groups = groupsOf(found, text.isNotEmpty(), zone), shown = found.size, loading = false, loaded = true) }
            }
    }

    private fun groupsOf(
        found: List<DocPageSummary>,
        flat: Boolean,
        zone: String,
    ): List<DocGroup> {
        fun row(p: DocPageSummary) =
            DocRowItem(
                slug = p.slug,
                title = p.title,
                excerpt = p.excerpt,
                sectionLabel = docSectionLabel(p.section),
                pinned = p.pinned,
                archived = p.archivedAt != null,
                guestVisible = p.guestVisible,
                commentCount = p.commentCount.toInt(),
                places = listOfNotNull(p.assetId?.let { assetNames[it] }, p.roomId?.let { roomNames[it] }).joinToString(" · "),
                updated = Dates.dateOf(p.updatedAt, zone)?.let { Dates.format(it) } ?: "",
            )
        if (flat) return if (found.isEmpty()) emptyList() else listOf(DocGroup("results", tr("docs_results"), found.map(::row)))
        val pinned = found.filter { it.pinned && it.archivedAt == null }
        val groups = mutableListOf<DocGroup>()
        if (pinned.isNotEmpty()) groups += DocGroup("pinned", tr("docs_pinned"), pinned.map(::row))
        DOC_SECTIONS.forEach { section ->
            val members = found.filter { it.section == section && !(it.pinned && it.archivedAt == null) }
            if (members.isNotEmpty()) groups += DocGroup(section, docSectionLabel(section), members.map(::row))
        }
        return groups
    }

    private companion object {
        const val SEARCH_DELAY_MS = 250L
    }
}

/** A file of a page the person tapped: the apps show it with the system viewer. */
class OpenedDocFile(
    val file: FilePayload,
)

/** A line of a page's table of contents; [indent] is how many levels it sits below the highest one. */
data class TocItem(
    val id: String,
    val text: String,
    val indent: Int,
)

/** A table of contents is worth showing from two headings on (the web's rule). */
const val TOC_MIN_HEADINGS = 2

/** The table of contents of a page from its headings; empty while there are fewer than [TOC_MIN_HEADINGS]. */
fun tocOf(headings: List<Heading>): List<TocItem> {
    if (headings.size < TOC_MIN_HEADINGS) return emptyList()
    val base = headings.minOf { it.level }
    return headings.map { TocItem(it.id, it.text, (it.level - base).toInt().coerceIn(0, 5)) }
}

/** The address that scrolls the page's web view to the heading [id]; the view is loaded at [DOC_BASE_URL]. */
fun tocAnchorUrl(id: String): String = "$DOC_BASE_URL#$id"

data class DocViewState(
    val slug: String,
    val loading: Boolean = true,
    val error: UiError? = null,
    /** There is no page with this address (yet). */
    val missing: Boolean = false,
    val pageId: String = "",
    val title: String = "",
    val pinned: Boolean = false,
    val archived: Boolean = false,
    /** What the web view shows, without the surrounding document: see [docDocument]. */
    val bodyHtml: String = "",
    /** The headings of the page, to jump to; empty for a page with fewer than two. */
    val toc: List<TocItem> = emptyList(),
    /** A title for a page that does not exist yet, made from the address. */
    val suggestedTitle: String = "",
    val busy: Boolean = false,
    /** A success message to show for a moment. */
    val notice: String? = null,
    /** A failed pin, archive, delete or file download; the page is still shown. */
    val actionError: UiError? = null,
    val deleted: Boolean = false,
    val opening: Boolean = false,
    val opened: OpenedDocFile? = null,
)

/** Reads one page: its rendering, and pin, archive and delete. */
class DocViewStore(
    private val app: HauswartApp,
    private val slug: String,
) : Store<DocViewState>(DocViewState(slug = slug, suggestedTitle = titleOfSlug(slug))) {
    private var page: DocPage? = null
    private val images = DocImages(app)

    init {
        onChange(app, "docs") { if (!current.deleted) load() }
        load()
    }

    fun refresh() {
        load()
    }

    /** What a tap on [url] in the page does. */
    fun linkTarget(url: String): DocLinkTarget = classifyDocLink(url, app.session.serverUrl)

    fun togglePin() {
        val p = page ?: return
        patch(PagesUpdateRequest(rev = p.rev, pinned = !p.pinned), tr(if (p.pinned) "docs_unpinned_toast" else "docs_pinned_toast"))
    }

    fun toggleArchive() {
        val p = page ?: return
        val archive = p.archivedAt == null
        patch(
            PagesUpdateRequest(rev = p.rev, archived = archive),
            tr(if (archive) "docs_archived_toast" else "docs_restored_archive_toast"),
        )
    }

    fun delete() {
        val p = page ?: return
        if (current.busy) return
        update { it.copy(busy = true, actionError = null) }
        launch({ e -> update { it.copy(busy = false, actionError = e) } }) {
            app.api.docs.pagesDelete(p.slug)
            update { it.copy(busy = false, deleted = true) }
            app.changed("docs")
        }
    }

    /** Fetches the file an attachment link points at; [DocViewState.opened] is set when it is there. */
    fun openAttachment(id: String) {
        if (current.opening) return
        update { it.copy(opening = true, actionError = null) }
        launch({ e -> update { it.copy(opening = false, actionError = e) } }) {
            val meta = app.api.attachments.attachmentsGet(id)
            val body = app.api.attachments.attachmentsContent(id, null)
            val mime = meta.mime.ifEmpty { body.contentType.orEmpty() }
            update { it.copy(opening = false, opened = OpenedDocFile(FilePayload(meta.filename, mime, body.bytes))) }
        }
    }

    fun clearOpened() {
        update { it.copy(opened = null) }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun patch(
        body: PagesUpdateRequest,
        notice: String,
    ) {
        val p = page ?: return
        if (current.busy) return
        update { it.copy(busy = true, actionError = null) }
        launch({ e ->
            update { it.copy(busy = false, actionError = failure(e)) }
            load()
        }) {
            app.api.docs.pagesUpdate(p.slug, body)
            update { it.copy(busy = false, notice = notice) }
            app.changed("docs")
        }
    }

    private fun load() {
        update { it.copy(loading = it.pageId.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val loaded =
                try {
                    app.api.docs.pagesGet(slug)
                } catch (e: ApiException) {
                    if (e.code != "not_found") throw e
                    page = null
                    update { it.copy(loading = false, missing = true, pageId = "") }
                    return@launch
                }
            val zone = app.household.get().timezone
            val assetName =
                loaded.assetId?.let {
                    optionalName {
                        app.api.assets
                            .assetsGet(it)
                            .name
                    }
                }
            val roomName =
                loaded.roomId?.let {
                    optionalName {
                        app.api.rooms
                            .roomsGet(it)
                            .name
                    }
                }
            val badges =
                listOfNotNull(
                    docSectionLabel(loaded.section),
                    if (loaded.pinned) tr("docs_pinned") else null,
                    if (loaded.guestVisible) tr("docs_guest_visible_short") else null,
                    if (loaded.archivedAt != null) tr("docs_archived") else null,
                )
            val places =
                listOfNotNull(
                    loaded.assetId?.let { id -> assetName?.let { "/assets/$id" to it } },
                    loaded.roomId?.let { id -> roomName?.let { "/rooms/$id" to it } },
                )
            val by =
                tr(
                    "docs_updated_by",
                    "name" to (loaded.updatedByName ?: tr("docs_unknown_user")),
                    "date" to Dates.dateTime(loaded.updatedAt, zone),
                    "rev" to loaded.rev,
                )
            val body = if (loaded.renderedHtml.isBlank()) docEmptyBodyHtml() else images.inline(loaded.renderedHtml)
            val html =
                docHeaderHtml(loaded.title, badges, places, by) + "<article>" + body + "</article>" +
                    docBacklinksHtml(loaded.backlinks.map { it.slug to it.title })
            page = loaded
            update {
                it.copy(
                    loading = false,
                    missing = false,
                    pageId = loaded.id,
                    title = loaded.title,
                    pinned = loaded.pinned,
                    archived = loaded.archivedAt != null,
                    bodyHtml = html,
                    toc = tocOf(loaded.headings),
                )
            }
        }
    }

    /** A linked device or room that is gone is just not shown; any other failure is a real error. */
    private suspend fun optionalName(read: suspend () -> String): String? =
        try {
            read()
        } catch (e: ApiException) {
            if (e.code == "not_found") null else throw e
        }
}

/** "water-main-shutoff" -> "Water main shutoff". */
fun titleOfSlug(slug: String): String {
    val text = slug.replace(Regex("-+"), " ").trim()
    return text.replaceFirstChar { it.uppercase() }
}

/** What the editor holds, every field as the person typed it; an id is empty for none. */
data class DocForm(
    val title: String,
    val section: String,
    val assetId: String,
    val roomId: String,
    val pinned: Boolean,
    val guestVisible: Boolean,
    val body: String,
)

data class DocEditState(
    val isNew: Boolean,
    val loading: Boolean,
    val loadError: UiError? = null,
    val initial: DocForm? = null,
    /** Grows whenever [initial] was replaced (the first load, "load the newest version"): the screen starts over with it. */
    val initialVersion: Int = 0,
    val pageId: String = "",
    val assets: List<DocPlaceChoice> = emptyList(),
    val rooms: List<DocPlaceChoice> = emptyList(),
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    /** The address of the saved page; the screen closes when it is set. */
    val savedSlug: String? = null,
    /** Somebody saved the page since it was opened: the screen asks what to do. */
    val conflict: Boolean = false,
    val conflictMessage: String = "",
    val resolving: Boolean = false,
    val previewHtml: String = "",
    val previewLoading: Boolean = false,
    val previewError: String? = null,
)

/** Creates a page ([slug] null) or edits one. */
class DocEditStore(
    private val app: HauswartApp,
    private val slug: String?,
    private val section: String,
    private val assetId: String,
    private val roomId: String,
    private val title: String,
) : Store<DocEditState>(DocEditState(isNew = slug == null, loading = true)) {
    private var rev = 0L
    private var conflictRev: Long? = null
    private val images = DocImages(app)
    private var previewJob: Job? = null
    private var previewRun = 0

    init {
        load()
    }

    fun retry() {
        load()
    }

    /** What a tap on [url] in the preview does. */
    fun linkTarget(url: String): DocLinkTarget = classifyDocLink(url, app.session.serverUrl)

    fun save(form: DocForm) {
        if (current.saving || current.resolving) return
        val errors = validate(form)
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e ->
            if (slug != null && e.code == "conflict") {
                conflictRev = ((e.details as? JsonObject)?.get("currentRev") as? JsonPrimitive)?.longOrNull
                val message =
                    conflictRev?.let { tr("editor_conflict_description", "theirs" to it, "mine" to rev) }
                        ?: tr("editor_conflict_description_unknown", "mine" to rev)
                update { it.copy(saving = false, conflict = true, conflictMessage = message) }
            } else {
                update { it.copy(saving = false, error = failure(e), fieldErrors = e.fields) }
            }
        }) {
            val saved = send(form)
            app.changed("docs")
            update { it.copy(saving = false, savedSlug = saved) }
        }
    }

    fun dismissConflict() {
        update { it.copy(conflict = false) }
    }

    /** Discards the person's changes and loads the version somebody else saved. */
    fun reloadTheirs() {
        if (slug == null || current.resolving) return
        update { it.copy(resolving = true, error = null) }
        launch({ e -> update { it.copy(resolving = false, conflict = false, error = failure(e)) } }) {
            val fresh = app.api.docs.pagesGet(slug)
            rev = fresh.rev
            update {
                it.copy(
                    resolving = false,
                    conflict = false,
                    initial = formOf(fresh),
                    initialVersion = it.initialVersion + 1,
                    previewHtml = "",
                )
            }
        }
    }

    /** Saves the person's version over the newer one; the newer one stays in the history. */
    fun keepMine(form: DocForm) {
        if (slug == null || current.resolving) return
        update { it.copy(resolving = true, error = null) }
        launch({ e -> update { it.copy(resolving = false, conflict = false, error = failure(e)) } }) {
            rev = conflictRev ?: app.api.docs
                .pagesGet(slug)
                .rev
            update { it.copy(resolving = false, conflict = false) }
            save(form)
        }
    }

    /** Renders [body] on the server for the preview tab. */
    fun preview(body: String) {
        previewJob?.cancel()
        val run = ++previewRun
        update { it.copy(previewLoading = true, previewError = null) }
        previewJob =
            launch({ e -> if (run == previewRun) update { it.copy(previewLoading = false, previewError = failure(e).message) } }) {
                delay(PREVIEW_DELAY_MS)
                val rendered =
                    app.api.docs
                        .pagesPreview(PagesPreviewRequest(bodyMd = body))
                        .html
                val html = if (rendered.isBlank()) "" else images.inline(rendered)
                if (run != previewRun) return@launch
                update { it.copy(previewLoading = false, previewHtml = html) }
            }
    }

    private fun validate(form: DocForm): Map<String, String> {
        val errors = mutableMapOf<String, String>()
        if (form.title.isBlank()) errors["title"] = tr("docs_error_title_required")
        if (form.title.trim().length > DOC_TITLE_MAX) errors["title"] = tr("field_max", "max" to DOC_TITLE_MAX)
        if (form.body.encodeToByteArray().size > DOC_BODY_MAX_BYTES) errors["bodyMd"] = tr("docs_error_too_large")
        return errors
    }

    /** Sends the form; returns the slug of the page. */
    private suspend fun send(form: DocForm): String {
        val initial = current.initial
        if (slug == null) {
            val created =
                app.api.docs.pagesCreate(
                    PagesCreateRequest(
                        title = form.title.trim(),
                        section = form.section,
                        assetId = form.assetId.ifEmpty { null },
                        roomId = form.roomId.ifEmpty { null },
                        bodyMd = form.body,
                        guestVisible = form.guestVisible,
                        pinned = form.pinned,
                    ),
                )
            return created.slug
        }
        if (initial == null || form.copy(title = form.title.trim()) == initial) return slug
        val saved =
            app.api.docs.pagesUpdate(
                slug,
                PagesUpdateRequest(
                    rev = rev,
                    title = if (form.title.trim() != initial.title) form.title.trim() else null,
                    section = if (form.section != initial.section) form.section else null,
                    assetId = if (form.assetId != initial.assetId) Patch.of(form.assetId.ifEmpty { null }) else Patch.Keep,
                    roomId = if (form.roomId != initial.roomId) Patch.of(form.roomId.ifEmpty { null }) else Patch.Keep,
                    bodyMd = if (form.body != initial.body) form.body else null,
                    guestVisible = if (form.guestVisible != initial.guestVisible) form.guestVisible else null,
                    pinned = if (form.pinned != initial.pinned) form.pinned else null,
                ),
            )
        return saved.slug
    }

    private fun formOf(p: DocPage) =
        DocForm(p.title, p.section, p.assetId.orEmpty(), p.roomId.orEmpty(), p.pinned, p.guestVisible, p.bodyMd)

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val assets =
                fetchAll { cursor ->
                    val page = app.api.assets.assetsList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            val rooms =
                fetchAll { cursor ->
                    val page = app.api.rooms.roomsList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            val existing = slug?.let { app.api.docs.pagesGet(it) }
            val form =
                if (existing != null) {
                    rev = existing.rev
                    formOf(existing)
                } else {
                    DocForm(
                        title = title,
                        section = if (section in DOC_SECTIONS) section else "general",
                        assetId = assetId,
                        roomId = roomId,
                        pinned = false,
                        guestVisible = false,
                        body = "",
                    )
                }
            update {
                it.copy(
                    loading = false,
                    initial = form,
                    initialVersion = it.initialVersion + 1,
                    pageId = existing?.id.orEmpty(),
                    assets =
                        assets
                            .filter { a -> a.archivedAt == null || a.id == form.assetId }
                            .map { a -> DocPlaceChoice(a.id, a.name) }
                            .sortedBy { c -> c.label.lowercase() },
                    rooms = rooms.map { r -> DocPlaceChoice(r.id, r.name) }.sortedBy { c -> c.label.lowercase() },
                )
            }
        }
    }

    private companion object {
        const val PREVIEW_DELAY_MS = 300L
    }
}

/** The size of a text as the editor shows it: "3 KB"; [warning] from 150 KB on. */
fun docSizeText(body: String): String = formatBytes(body.encodeToByteArray().size.toLong())

fun docSizeWarning(body: String): Boolean = body.encodeToByteArray().size > 150 * 1024

/** The markdown that embeds an attachment: an image as a picture, anything else as a link. */
fun docAttachmentMarkdown(
    id: String,
    filename: String,
    caption: String,
    isImage: Boolean,
): String {
    val label = caption.ifBlank { filename }
    return if (isImage) {
        val base = filename.substringBeforeLast('.')
        val alt = caption.ifBlank { if (Regex("^image\\d*$", RegexOption.IGNORE_CASE).matches(base)) tr("editor_alt_default") else base }
        "![$alt](attachment:$id)"
    } else {
        "[$label](attachment:$id)"
    }
}

data class DocRevisionRow(
    val rev: Long,
    val title: String,
    val current: Boolean,
    /** Who and when, with the size. */
    val details: String,
)

/** One saved state with its source. */
data class DocRevisionView(
    val rev: Long,
    val title: String,
    val markdown: String,
    val current: Boolean,
)

data class DocRevisionsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val rows: List<DocRevisionRow> = emptyList(),
    val opening: Long = 0,
    val opened: DocRevisionView? = null,
    val restoring: Boolean = false,
    val actionError: UiError? = null,
    val notice: String? = null,
    /** The page was restored: the screen closes. */
    val restored: Boolean = false,
)

/** The last 50 saved states of a page; opening one shows its source, restoring saves it as a new version. */
class DocRevisionsStore(
    private val app: HauswartApp,
    private val slug: String,
) : Store<DocRevisionsState>(DocRevisionsState()) {
    private var currentRev = 0L

    init {
        load()
    }

    fun refresh() {
        load()
    }

    fun open(rev: Long) {
        if (current.opening != 0L) return
        update { it.copy(opening = rev, actionError = null) }
        launch({ e -> update { it.copy(opening = 0, actionError = e) } }) {
            val r = app.api.docs.pageRevisionsGet(slug, rev.toString())
            update { it.copy(opening = 0, opened = DocRevisionView(r.rev, r.title, r.bodyMd, r.rev == currentRev)) }
        }
    }

    fun closeOpened() {
        update { it.copy(opened = null) }
    }

    fun restore(rev: Long) {
        if (current.restoring) return
        update { it.copy(restoring = true, actionError = null) }
        launch({ e -> update { it.copy(restoring = false, actionError = failure(e)) } }) {
            app.api.docs.pageRevisionsRestore(slug, rev.toString())
            update { it.copy(restoring = false, opened = null, restored = true, notice = tr("docs_restored_toast", "rev" to rev)) }
            app.changed("docs")
        }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun load() {
        update { it.copy(loading = it.rows.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val zone = app.household.get().timezone
            val page = app.api.docs.pagesGet(slug)
            currentRev = page.rev
            val items =
                app.api.docs
                    .pageRevisionsList(slug)
                    .items
            val rows =
                items.map { r ->
                    DocRevisionRow(
                        rev = r.rev,
                        title = r.title,
                        current = r.rev == currentRev,
                        details =
                            listOf(r.userName ?: tr("docs_unknown_user"), Dates.dateTime(r.createdAt, zone), formatBytes(r.size))
                                .joinToString(" · "),
                    )
                }
            update { it.copy(loading = false, rows = rows) }
        }
    }
}
