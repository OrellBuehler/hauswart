package ch.orellbuehler.hauswart.feature.inventory

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.AssetContact
import ch.orellbuehler.hauswart.api.generated.AssetContactsLinkRequest
import ch.orellbuehler.hauswart.api.generated.AssetHintsCreateRequest
import ch.orellbuehler.hauswart.api.generated.AssetNote
import ch.orellbuehler.hauswart.api.generated.AssetNotesCreateRequest
import ch.orellbuehler.hauswart.api.generated.AssetNotesUpdateRequest
import ch.orellbuehler.hauswart.api.generated.AssetPart
import ch.orellbuehler.hauswart.api.generated.AssetPartsLinkRequest
import ch.orellbuehler.hauswart.api.generated.AssetServiceLogCreateRequest
import ch.orellbuehler.hauswart.api.generated.AssetServiceLogUpdateRequest
import ch.orellbuehler.hauswart.api.generated.Hint
import ch.orellbuehler.hauswart.api.generated.HintsUpdateRequest
import ch.orellbuehler.hauswart.api.generated.ServiceLogEntry
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

private const val NOTE_MAX_LENGTH = 2000
private const val HINT_TITLE_MAX = 200
private const val PAGE_SIZE = 20L

// ---------------------------------------------------------------- care hints

val HINT_KINDS: List<String> = AssetHintsCreateRequest.KIND_VALUES

fun hintKindLabel(kind: String): String = if (kind in HINT_KINDS) tr("hint_kind_$kind") else kind

data class HintForm(
    val kind: String = "tip",
    val title: String = "",
    val body: String = "",
    val pinned: Boolean = false,
    val guestVisible: Boolean = false,
)

data class HintItem(
    val id: String,
    val kind: String,
    val kindLabel: String,
    val title: String,
    val body: String,
    val pinned: Boolean,
    val guestVisible: Boolean,
    /** "Reaktion: sensor wechselt auf «on» …", shown read-only: the reaction is edited in the web app. */
    val reactionNote: String?,
    val taskId: String?,
    val taskTitle: String?,
    val canMoveUp: Boolean,
    val canMoveDown: Boolean,
    /** What the edit form starts with. */
    val form: HintForm,
)

private fun reactionNote(hint: Hint): String? {
    val reaction = hint.reaction ?: return null
    val notify = reaction.notify
    val who =
        when {
            notify is JsonArray -> tr("hint_reaction_notify_custom")
            notify is JsonPrimitive && notify.contentOrNull == "assignee" -> tr("hint_reaction_notify_assignee")
            else -> tr("hint_reaction_notify_all")
        }
    return tr("hint_reaction_summary", "entity" to reaction.entityId, "to" to reaction.toState, "who" to who)
}

fun hintItems(hints: List<Hint>): List<HintItem> =
    hints.mapIndexed { index, hint ->
        HintItem(
            id = hint.id,
            kind = hint.kind,
            kindLabel = hintKindLabel(hint.kind),
            title = hint.title,
            body = hint.bodyMd.trim(),
            pinned = hint.pinned,
            guestVisible = hint.guestVisible,
            reactionNote = reactionNote(hint),
            taskId = hint.taskId,
            taskTitle = hint.taskTitle,
            canMoveUp = index > 0 && hints[index - 1].pinned == hint.pinned,
            canMoveDown = index < hints.size - 1 && hints[index + 1].pinned == hint.pinned,
            form = HintForm(hint.kind, hint.title, hint.bodyMd, hint.pinned, hint.guestVisible),
        )
    }

data class HintsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val items: List<HintItem> = emptyList(),
    val saving: Boolean = false,
    /** A failed save, shown in the form. */
    val formError: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    /** True after a save; the form closes and calls [AssetHintsStore.ackSaved]. */
    val saved: Boolean = false,
    val busy: Boolean = false,
    val actionError: UiError? = null,
    val notice: InventoryNotice? = null,
)

class AssetHintsStore(
    private val app: HauswartApp,
    private val assetId: String,
) : Store<HintsState>(HintsState()) {
    private var hints: List<Hint> = emptyList()

    init {
        onChange(app, "assets") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun clearForm() {
        update { it.copy(saving = false, formError = null, fieldErrors = emptyMap(), saved = false) }
    }

    fun ackSaved() {
        update { it.copy(saved = false) }
    }

    /** Adds a hint ([hintId] null) or changes one. */
    fun save(
        hintId: String?,
        form: HintForm,
    ) {
        if (current.saving) return
        val title = form.title.trim()
        if (title.isEmpty() || title.length > HINT_TITLE_MAX) {
            update { it.copy(fieldErrors = mapOf("title" to tr("m_field_required")), formError = null) }
            return
        }
        update { it.copy(saving = true, formError = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, formError = if (e.fields.isEmpty()) e else null, fieldErrors = e.fields) } }) {
            val saved =
                if (hintId == null) {
                    app.api.hints.assetHintsCreate(
                        assetId,
                        AssetHintsCreateRequest(
                            title = title,
                            bodyMd = form.body.trim(),
                            kind = form.kind,
                            pinned = form.pinned,
                            guestVisible = form.guestVisible,
                        ),
                    )
                } else {
                    app.api.hints.hintsUpdate(
                        hintId,
                        HintsUpdateRequest(
                            title = title,
                            bodyMd = form.body.trim(),
                            kind = form.kind,
                            pinned = form.pinned,
                            guestVisible = form.guestVisible,
                        ),
                    )
                }
            update {
                it.copy(
                    saving = false,
                    saved = true,
                    notice = InventoryNotice(tr(if (hintId == null) "hint_created_toast" else "hint_saved_toast", "title" to saved.title)),
                )
            }
            app.changed("assets")
        }
    }

    fun togglePin(hintId: String) {
        val hint = hints.firstOrNull { it.id == hintId } ?: return
        patch { app.api.hints.hintsUpdate(hintId, HintsUpdateRequest(pinned = !hint.pinned)) }
    }

    fun toggleGuest(hintId: String) {
        val hint = hints.firstOrNull { it.id == hintId } ?: return
        patch { app.api.hints.hintsUpdate(hintId, HintsUpdateRequest(guestVisible = !hint.guestVisible)) }
    }

    /** Swaps a hint with its neighbour of the same pin state; sort orders are renumbered so equal values cannot block a move. */
    fun move(
        hintId: String,
        delta: Int,
    ) {
        val index = hints.indexOfFirst { it.id == hintId }
        val target = index + delta
        if (index < 0 || target !in hints.indices || hints[target].pinned != hints[index].pinned) return
        val order = hints.toMutableList().also { it.add(target, it.removeAt(index)) }
        patch {
            order.forEachIndexed { position, hint ->
                val wanted = position * 10L
                if (hint.sortOrder != wanted) app.api.hints.hintsUpdate(hint.id, HintsUpdateRequest(sortOrder = wanted))
            }
        }
    }

    fun delete(hintId: String) {
        val hint = hints.firstOrNull { it.id == hintId } ?: return
        patch {
            app.api.hints.hintsDelete(hintId)
            update { it.copy(notice = InventoryNotice(tr("hint_deleted_toast", "title" to hint.title))) }
        }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun patch(block: suspend () -> Unit) {
        if (current.busy) return
        update { it.copy(busy = true, actionError = null) }
        launch({ e ->
            update { it.copy(busy = false, actionError = e) }
            app.changed("assets")
        }) {
            block()
            update { it.copy(busy = false) }
            app.changed("assets")
        }
    }

    private fun load() {
        update { it.copy(loading = hints.isEmpty() && it.items.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            hints =
                fetchAll { cursor ->
                    val page = app.api.hints.assetHintsList(assetId, cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            update { it.copy(loading = false, items = hintItems(hints)) }
        }
    }
}

// ------------------------------------------------------------ asset notes

data class NoteItem(
    val id: String,
    val body: String,
    /** First line, cut: for labels. */
    val excerpt: String,
    /** "Anna · 21.11.2026, 14:30". */
    val meta: String,
    val resolved: Boolean,
    /** "Erledigt 21.11.2026, 14:30 von Anna"; null for an open note. */
    val doneText: String?,
    /** The defect the note became; null otherwise. */
    val defectId: String?,
    val viaService: Boolean,
)

/** A note's text as one line for a label: the first line, cut to [max] characters with an ellipsis. */
fun noteExcerpt(
    body: String,
    max: Int = 60,
): String {
    val first =
        body
            .trim()
            .lineSequence()
            .firstOrNull()
            ?.trim() ?: ""
    return if (first.length > max) first.take(max - 1).trimEnd() + "…" else first
}

/** The open notes as a plain-text list to take to the garage; empty without notes. */
fun formatNotesList(
    heading: String,
    bodies: List<String>,
): String {
    val items =
        bodies
            .map { it.replace("\r\n", "\n").replace('\r', '\n').trim() }
            .filter { it.isNotEmpty() }
            .map { body ->
                body
                    .split("\n")
                    .mapIndexed { index, line ->
                        if (index == 0) {
                            "- " + line.trimEnd()
                        } else if (line.isBlank()) {
                            ""
                        } else {
                            "  " + line.trimEnd()
                        }
                    }.joinToString("\n")
            }
    return if (items.isEmpty()) "" else (listOf(heading) + items).joinToString("\n")
}

data class NotesState(
    val loading: Boolean = true,
    val error: UiError? = null,
    /** The open notes, newest first. */
    val open: List<NoteItem> = emptyList(),
    val canAdd: Boolean = true,
    val maxLength: Int = NOTE_MAX_LENGTH,
    val saving: Boolean = false,
    val formError: UiError? = null,
    val saved: Boolean = false,
    val busyId: String? = null,
    val actionError: UiError? = null,
    val notice: InventoryNotice? = null,
    val resolvedShown: Boolean = false,
    val resolvedLoading: Boolean = false,
    val resolvedError: UiError? = null,
    val resolved: List<NoteItem> = emptyList(),
    val resolvedHasMore: Boolean = false,
    /** The open notes as text to share; empty without open notes. */
    val shareText: String = "",
    val shareTitle: String = "",
)

class AssetNotesStore(
    private val app: HauswartApp,
    private val assetId: String,
) : Store<NotesState>(NotesState()) {
    private var openNotes: List<AssetNote> = emptyList()
    private var resolvedCursor: String? = null
    private var resolvedLoaded = false
    private var timeZone = "UTC"

    init {
        onChange(app, "assets") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun clearForm() {
        update { it.copy(saving = false, formError = null, saved = false) }
    }

    fun ackSaved() {
        update { it.copy(saved = false) }
    }

    /** Adds a note ([noteId] null) or changes the text of one. */
    fun save(
        noteId: String?,
        text: String,
    ) {
        if (current.saving) return
        val body = text.trim()
        if (body.isEmpty()) {
            update { it.copy(formError = UiError(tr("field_required"), "invalid_request")) }
            return
        }
        if (body.length > NOTE_MAX_LENGTH) {
            update { it.copy(formError = UiError(tr("field_too_long", "max" to NOTE_MAX_LENGTH), "invalid_request")) }
            return
        }
        update { it.copy(saving = true, formError = null) }
        launch({ e -> update { it.copy(saving = false, formError = e) } }) {
            if (noteId == null) {
                app.api.assetNotes.assetNotesCreate(assetId, AssetNotesCreateRequest(body))
            } else {
                app.api.assetNotes.assetNotesUpdate(noteId, AssetNotesUpdateRequest(body = body))
            }
            update {
                it.copy(
                    saving = false,
                    saved = true,
                    notice =
                        InventoryNotice(
                            tr(
                                if (noteId ==
                                    null
                                ) {
                                    "asset_notes_added_toast"
                                } else {
                                    "asset_notes_saved_toast"
                                },
                            ),
                        ),
                )
            }
            app.changed("assets")
        }
    }

    fun resolve(noteId: String) = setStatus(noteId, "resolved")

    fun reopen(noteId: String) = setStatus(noteId, "open")

    private var lastResolvedId: String? = null

    /** Takes the last "resolved" back. */
    fun undo() {
        val id = lastResolvedId ?: return
        lastResolvedId = null
        update { it.copy(notice = null) }
        setStatus(id, "open")
    }

    private fun setStatus(
        noteId: String,
        status: String,
    ) {
        if (current.busyId != null) return
        update { it.copy(busyId = noteId, actionError = null) }
        launch({ e -> update { it.copy(busyId = null, actionError = e) } }) {
            app.api.assetNotes.assetNotesUpdate(noteId, AssetNotesUpdateRequest(status = status))
            lastResolvedId = if (status == "resolved") noteId else null
            update {
                it.copy(
                    busyId = null,
                    notice =
                        InventoryNotice(
                            tr(
                                if (status ==
                                    "resolved"
                                ) {
                                    "asset_notes_resolved_toast"
                                } else {
                                    "asset_notes_reopened_toast"
                                },
                            ),
                            undo = status == "resolved",
                        ),
                )
            }
            app.changed("assets")
        }
    }

    fun delete(noteId: String) {
        if (current.busyId != null) return
        update { it.copy(busyId = noteId, actionError = null) }
        launch({ e -> update { it.copy(busyId = null, actionError = e) } }) {
            app.api.assetNotes.assetNotesDelete(noteId)
            update { it.copy(busyId = null, notice = InventoryNotice(tr("asset_notes_deleted_toast"))) }
            app.changed("assets")
        }
    }

    fun toDefect(noteId: String) {
        if (current.busyId != null) return
        update { it.copy(busyId = noteId, actionError = null) }
        launch({ e -> update { it.copy(busyId = null, actionError = e) } }) {
            val result = app.api.assetNotes.assetNotesToDefect(noteId)
            update { it.copy(busyId = null, notice = InventoryNotice(tr("asset_notes_to_defect_toast"), defectId = result.defect.id)) }
            app.changed("assets", "defects")
        }
    }

    fun toggleResolved() {
        val shown = !current.resolvedShown
        update { it.copy(resolvedShown = shown) }
        if (shown && !resolvedLoaded) loadResolved(more = false)
    }

    fun loadMoreResolved() {
        if (resolvedCursor != null && !current.resolvedLoading) loadResolved(more = true)
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun item(note: AssetNote): NoteItem {
        val who = note.createdByName
        val at = Dates.dateTime(note.createdAt, timeZone)
        val done =
            note.resolvedAt?.let { instant ->
                val whenText = Dates.dateTime(instant, timeZone)
                val name = note.resolvedByName
                if (name !=
                    null
                ) {
                    tr("asset_notes_resolved_by", "when" to whenText, "name" to name)
                } else {
                    tr(
                        "asset_notes_resolved_at",
                        "when" to whenText,
                    )
                }
            }
        return NoteItem(
            id = note.id,
            body = note.body,
            excerpt = noteExcerpt(note.body),
            meta = if (who.isNullOrBlank()) at else "$who · $at",
            resolved = note.status == "resolved",
            doneText = done,
            defectId = note.defectId,
            viaService = note.defectId == null && note.serviceLogId != null,
        )
    }

    private fun load() {
        update { it.copy(loading = it.open.isEmpty() && openNotes.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            timeZone = app.household.get().timezone
            openNotes =
                fetchAll { cursor ->
                    val page = app.api.assetNotes.assetNotesList(assetId, cursor = cursor, limit = 200, status = "open")
                    page.items to page.nextCursor
                }
            val heading = openNotes.firstOrNull()?.let { tr("asset_notes_list_title", "asset" to it.assetName) } ?: ""
            update {
                it.copy(
                    loading = false,
                    open = openNotes.map(::item),
                    shareTitle = heading,
                    shareText = formatNotesList(heading, openNotes.map { n -> n.body }),
                )
            }
            if (resolvedLoaded) loadResolved(more = false)
        }
    }

    private fun loadResolved(more: Boolean) {
        update { it.copy(resolvedLoading = true, resolvedError = null) }
        launch({ e -> update { it.copy(resolvedLoading = false, resolvedError = e) } }) {
            val page =
                app.api.assetNotes.assetNotesList(
                    assetId,
                    cursor = if (more) resolvedCursor else null,
                    limit = PAGE_SIZE,
                    status = "resolved",
                )
            resolvedCursor = page.nextCursor
            resolvedLoaded = true
            val items = page.items.map(::item)
            update {
                it.copy(
                    resolvedLoading = false,
                    resolved = if (more) it.resolved + items else items,
                    resolvedHasMore = page.nextCursor != null,
                )
            }
        }
    }
}

// ------------------------------------------------------------ service log

val SERVICE_KINDS: List<String> = AssetServiceLogCreateRequest.KIND_VALUES

fun serviceKindLabel(kind: String): String = if (kind in SERVICE_KINDS) tr("service_kind_$kind") else kind

data class ServiceForm(
    val kind: String = "maintenance",
    val date: String = "",
    val title: String = "",
    val details: String = "",
    /** Empty for none. */
    val contactId: String = "",
    val cost: String = "",
    /** Open notes this work took care of. */
    val resolvedNoteIds: List<String> = emptyList(),
)

data class ServiceItem(
    val id: String,
    val kind: String,
    val kindLabel: String,
    val dateText: String,
    val title: String,
    val details: String,
    val contactId: String?,
    val contactName: String?,
    val costText: String?,
    val form: ServiceForm,
)

data class NoteChoice(
    val id: String,
    val excerpt: String,
)

data class ServiceLogState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val items: List<ServiceItem> = emptyList(),
    val hasMore: Boolean = false,
    val loadingMore: Boolean = false,
    /** The first choice (empty value) is "no contact". */
    val contactOptions: List<InventoryChoice> = emptyList(),
    val kindOptions: List<InventoryChoice> = SERVICE_KINDS.map { InventoryChoice(it, serviceKindLabel(it)) },
    /** The open notes of the asset, to tick off with the entry. */
    val openNotes: List<NoteChoice> = emptyList(),
    val currency: String = "CHF",
    /** What the form for a new entry starts with. */
    val blank: ServiceForm = ServiceForm(),
    val saving: Boolean = false,
    val formError: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val saved: Boolean = false,
    val actionError: UiError? = null,
    val notice: InventoryNotice? = null,
)

class AssetServiceLogStore(
    private val app: HauswartApp,
    private val assetId: String,
) : Store<ServiceLogState>(ServiceLogState()) {
    private var entries: List<ServiceLogEntry> = emptyList()
    private var cursor: String? = null
    private var currency = "CHF"

    init {
        onChange(app, "assets", "tasks", "contacts") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun clearForm() {
        update { it.copy(saving = false, formError = null, fieldErrors = emptyMap(), saved = false) }
    }

    fun ackSaved() {
        update { it.copy(saved = false) }
    }

    fun loadMore() {
        val next = cursor ?: return
        if (current.loadingMore) return
        update { it.copy(loadingMore = true) }
        launch({ e -> update { it.copy(loadingMore = false, actionError = e) } }) {
            val page = app.api.serviceLog.assetServiceLogList(assetId, cursor = next, limit = PAGE_SIZE)
            entries = entries + page.items
            cursor = page.nextCursor
            update { it.copy(loadingMore = false, items = entries.map(::item), hasMore = cursor != null) }
        }
    }

    /** Adds an entry ([entryId] null) or changes one. */
    fun save(
        entryId: String?,
        form: ServiceForm,
    ) {
        if (current.saving) return
        val entry = entryId?.let { id -> entries.firstOrNull { it.id == id } }
        val entryCurrency = entry?.currency ?: currency
        val errors = mutableMapOf<String, String>()
        if (form.title.isBlank()) errors["title"] = tr("m_field_required")
        if (!Dates.isValid(form.date)) errors["date"] = tr("m_field_required")
        val cost = form.cost.trim()
        val costMinor = if (cost.isEmpty()) null else Money.parse(cost, entryCurrency)
        if (cost.isNotEmpty() && costMinor == null) errors["costMinor"] = tr("field_number")
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, formError = null) }
            return
        }
        update { it.copy(saving = true, formError = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, formError = if (e.fields.isEmpty()) e else null, fieldErrors = e.fields) } }) {
            val notes = form.resolvedNoteIds.takeIf { it.isNotEmpty() }
            val saved =
                if (entryId == null) {
                    app.api.serviceLog.assetServiceLogCreate(
                        assetId,
                        AssetServiceLogCreateRequest(
                            date = form.date,
                            kind = form.kind,
                            title = form.title.trim(),
                            descriptionMd = form.details.trim(),
                            contactId = form.contactId.ifEmpty { null },
                            costMinor = costMinor,
                            currency = if (costMinor == null) null else entryCurrency,
                            resolvedNoteIds = notes,
                        ),
                    )
                } else {
                    app.api.serviceLog.assetServiceLogUpdate(
                        assetId,
                        entryId,
                        AssetServiceLogUpdateRequest(
                            date = form.date,
                            kind = form.kind,
                            title = form.title.trim(),
                            descriptionMd = form.details.trim(),
                            contactId = Patch.of(form.contactId.ifEmpty { null }),
                            costMinor = Patch.of(costMinor),
                            currency = Patch.of(if (costMinor == null) null else entryCurrency),
                            resolvedNoteIds = notes,
                        ),
                    )
                }
            update {
                it.copy(
                    saving = false,
                    saved = true,
                    notice =
                        InventoryNotice(
                            tr(
                                if (entryId ==
                                    null
                                ) {
                                    "service_created_toast"
                                } else {
                                    "service_saved_toast"
                                },
                                "title" to saved.title,
                            ),
                        ),
                )
            }
            app.changed("assets")
        }
    }

    fun delete(entryId: String) {
        val entry = entries.firstOrNull { it.id == entryId } ?: return
        launch({ e -> update { it.copy(actionError = e) } }) {
            app.api.serviceLog.assetServiceLogDelete(assetId, entryId)
            update { it.copy(notice = InventoryNotice(tr("service_deleted_toast", "title" to entry.title))) }
            app.changed("assets")
        }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun item(entry: ServiceLogEntry): ServiceItem {
        val cost = entry.costMinor?.let { Money.format(it, entry.currency ?: currency) }
        return ServiceItem(
            id = entry.id,
            kind = entry.kind,
            kindLabel = serviceKindLabel(entry.kind),
            dateText = Dates.format(entry.date),
            title = entry.title,
            details = entry.descriptionMd.trim(),
            contactId = entry.contactId,
            contactName = entry.contactName,
            costText = cost,
            form =
                ServiceForm(
                    kind = entry.kind,
                    date = entry.date,
                    title = entry.title,
                    details = entry.descriptionMd,
                    contactId = entry.contactId ?: "",
                    cost = entry.costMinor?.let { Money.toInput(it, entry.currency ?: currency) } ?: "",
                ),
        )
    }

    private fun load() {
        update { it.copy(loading = it.items.isEmpty() && entries.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val household = app.household.get()
            currency = household.currency
            val page = app.api.serviceLog.assetServiceLogList(assetId, limit = PAGE_SIZE)
            entries = page.items
            cursor = page.nextCursor
            val contacts =
                fetchAll { c ->
                    val p = app.api.contacts.contactsList(cursor = c, limit = 200)
                    p.items to p.nextCursor
                }
            val notes =
                fetchAll { c ->
                    val p = app.api.assetNotes.assetNotesList(assetId, cursor = c, limit = 200, status = "open")
                    p.items to p.nextCursor
                }
            update {
                it.copy(
                    loading = false,
                    items = entries.map(::item),
                    hasMore = cursor != null,
                    currency = currency,
                    blank = ServiceForm(date = app.household.today()),
                    contactOptions = listOf(InventoryChoice("", tr("m_none"))) + contacts.map { c -> InventoryChoice(c.id, c.name) },
                    openNotes = notes.map { n -> NoteChoice(n.id, noteExcerpt(n.body)) },
                )
            }
        }
    }
}

// --------------------------------------------------------------- contacts

val ASSET_CONTACT_ROLES: List<String> = AssetContactsLinkRequest.ROLE_VALUES

fun assetContactRoleLabel(role: String): String = if (role in ASSET_CONTACT_ROLES) tr("contact_role_$role") else role

data class ContactLinkItem(
    val linkId: String,
    val contactId: String,
    val name: String,
    val company: String?,
    val roleLabel: String,
    val emergency: Boolean,
)

data class ContactLinksState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val items: List<ContactLinkItem> = emptyList(),
    /** Every contact, to pick one to link. */
    val contactOptions: List<InventoryChoice> = emptyList(),
    val roleOptions: List<InventoryChoice> = ASSET_CONTACT_ROLES.map { InventoryChoice(it, assetContactRoleLabel(it)) },
    val saving: Boolean = false,
    val formError: UiError? = null,
    val saved: Boolean = false,
    val busy: Boolean = false,
    val actionError: UiError? = null,
    val notice: InventoryNotice? = null,
)

class AssetContactsStore(
    private val app: HauswartApp,
    private val assetId: String,
) : Store<ContactLinksState>(ContactLinksState()) {
    private var links: List<AssetContact> = emptyList()
    private var lastUnlinked: AssetContact? = null

    init {
        onChange(app, "assets", "contacts") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun clearForm() {
        update { it.copy(saving = false, formError = null, saved = false) }
    }

    fun ackSaved() {
        update { it.copy(saved = false) }
    }

    fun link(
        contactId: String,
        role: String,
    ) {
        if (current.saving) return
        if (contactId.isEmpty()) {
            update { it.copy(formError = UiError(tr("contact_link_choose"), "invalid_request")) }
            return
        }
        update { it.copy(saving = true, formError = null) }
        launch({ e ->
            val taken = if (e.code == "conflict") e.copy(message = tr("contact_link_taken")) else e
            update { it.copy(saving = false, formError = taken) }
        }) {
            app.api.contacts.assetContactsLink(assetId, AssetContactsLinkRequest(contactId = contactId, role = role))
            update { it.copy(saving = false, saved = true, notice = InventoryNotice(tr("contact_linked_toast"))) }
            app.changed("assets")
        }
    }

    fun unlink(linkId: String) {
        val link = links.firstOrNull { it.id == linkId } ?: return
        if (current.busy) return
        update { it.copy(busy = true, actionError = null) }
        launch({ e -> update { it.copy(busy = false, actionError = e) } }) {
            app.api.contacts.assetContactsUnlink(assetId, linkId)
            lastUnlinked = link
            update {
                it.copy(
                    busy = false,
                    notice = InventoryNotice(tr("contact_unlinked_toast", "name" to link.contact.name), undo = true),
                )
            }
            app.changed("assets")
        }
    }

    /** Links the contact that was just unlinked again. */
    fun undo() {
        val link = lastUnlinked ?: return
        lastUnlinked = null
        update { it.copy(notice = null) }
        launch({ e -> update { it.copy(actionError = e) } }) {
            app.api.contacts.assetContactsLink(assetId, AssetContactsLinkRequest(contactId = link.contactId, role = link.role))
            update { it.copy(notice = InventoryNotice(tr("toast_undone"))) }
            app.changed("assets")
        }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun load() {
        update { it.copy(loading = links.isEmpty() && it.items.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            links =
                fetchAll { cursor ->
                    val page = app.api.contacts.assetContactsList(assetId, cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            val contacts =
                fetchAll { cursor ->
                    val page = app.api.contacts.contactsList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            update {
                it.copy(
                    loading = false,
                    items =
                        links.map { l ->
                            ContactLinkItem(
                                l.id,
                                l.contactId,
                                l.contact.name,
                                l.contact.company,
                                assetContactRoleLabel(l.role),
                                l.contact.emergency,
                            )
                        },
                    contactOptions = contacts.map { c -> InventoryChoice(c.id, c.name) },
                )
            }
        }
    }
}

// ------------------------------------------------------------ spare parts

data class PartLinkItem(
    val partId: String,
    val name: String,
    /** Part number and supplier. */
    val subtitle: String,
    val stockText: String,
    val stockTone: String,
    val priceText: String?,
    val archived: Boolean,
)

data class PartLinksState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val items: List<PartLinkItem> = emptyList(),
    /** Parts that are not linked yet. */
    val partOptions: List<InventoryChoice> = emptyList(),
    val saving: Boolean = false,
    val formError: UiError? = null,
    val saved: Boolean = false,
    val busy: Boolean = false,
    val actionError: UiError? = null,
    val notice: InventoryNotice? = null,
)

class AssetPartsStore(
    private val app: HauswartApp,
    private val assetId: String,
) : Store<PartLinksState>(PartLinksState()) {
    private var links: List<AssetPart> = emptyList()
    private var lastUnlinked: String? = null

    init {
        onChange(app, "assets", "parts") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun clearForm() {
        update { it.copy(saving = false, formError = null, saved = false) }
    }

    fun ackSaved() {
        update { it.copy(saved = false) }
    }

    fun link(partId: String) {
        if (current.saving) return
        if (partId.isEmpty()) {
            update { it.copy(formError = UiError(tr("part_link_choose"), "invalid_request")) }
            return
        }
        update { it.copy(saving = true, formError = null) }
        launch({ e ->
            val taken = if (e.code == "conflict") e.copy(message = tr("part_link_taken")) else e
            update { it.copy(saving = false, formError = taken) }
        }) {
            app.api.parts.assetPartsLink(assetId, AssetPartsLinkRequest(partId = partId))
            update { it.copy(saving = false, saved = true, notice = InventoryNotice(tr("part_linked_toast"))) }
            app.changed("assets", "parts")
        }
    }

    fun unlink(partId: String) {
        val link = links.firstOrNull { it.partId == partId } ?: return
        if (current.busy) return
        update { it.copy(busy = true, actionError = null) }
        launch({ e -> update { it.copy(busy = false, actionError = e) } }) {
            app.api.parts.assetPartsUnlink(assetId, partId)
            lastUnlinked = partId
            update { it.copy(busy = false, notice = InventoryNotice(tr("part_unlinked_toast", "name" to link.part.name), undo = true)) }
            app.changed("assets", "parts")
        }
    }

    fun undo() {
        val partId = lastUnlinked ?: return
        lastUnlinked = null
        update { it.copy(notice = null) }
        launch({ e -> update { it.copy(actionError = e) } }) {
            app.api.parts.assetPartsLink(assetId, AssetPartsLinkRequest(partId = partId))
            update { it.copy(notice = InventoryNotice(tr("toast_undone"))) }
            app.changed("assets", "parts")
        }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun load() {
        update { it.copy(loading = links.isEmpty() && it.items.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            links =
                fetchAll { cursor ->
                    val page = app.api.parts.assetPartsList(assetId, cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            val parts =
                fetchAll { cursor ->
                    val page = app.api.parts.partsList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            val linked = links.map { it.partId }.toSet()
            update {
                it.copy(
                    loading = false,
                    items =
                        links.map { l ->
                            val p = l.part
                            PartLinkItem(
                                partId = l.partId,
                                name = p.name,
                                subtitle = listOfNotNull(p.partNumber, p.supplier).filter { s -> s.isNotBlank() }.joinToString(" · "),
                                stockText = stockText(p.stockCount, p.minStock),
                                stockTone = stockTone(p.stockCount, p.minStock),
                                priceText = p.unitPriceMinor?.let { m -> Money.format(m, p.currency) },
                                archived = p.archivedAt != null,
                            )
                        },
                    partOptions = parts.filter { p -> p.id !in linked }.map { p -> InventoryChoice(p.id, p.name) },
                )
            }
        }
    }
}
