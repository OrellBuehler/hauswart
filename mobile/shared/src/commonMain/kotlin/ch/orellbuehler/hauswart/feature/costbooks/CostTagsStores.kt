package ch.orellbuehler.hauswart.feature.costbooks

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.CostTag
import ch.orellbuehler.hauswart.api.generated.CostTagsCreateRequest
import ch.orellbuehler.hauswart.api.generated.CostTagsUpdateRequest
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.feature.costs.CostOption
import ch.orellbuehler.hauswart.i18n.tr

const val COST_TAG_NAME_MAX = 40
const val MAX_COST_TAGS = 200

val TAG_COLORS: List<String> = CostTag.COLOR_VALUES

fun tagColorLabel(color: String): String = if (color in TAG_COLORS) tr("costtag_color_$color") else color

/** The colour of a tag key as `RRGGBB` hex (without the `#`): a keyed palette, so both apps draw the same dot. */
fun tagColorHex(color: String): String =
    when (color) {
        "red" -> "EF4444"
        "orange" -> "F97316"
        "amber" -> "F59E0B"
        "green" -> "16A34A"
        "teal" -> "0D9488"
        "blue" -> "3B82F6"
        "violet" -> "8B5CF6"
        "pink" -> "EC4899"
        else -> "6B7280"
    }

fun tagColorOptions(): List<CostOption> = TAG_COLORS.map { CostOption(it, tagColorLabel(it)) }

/** The palette colour (not grey) the fewest tags have so far, the first on a tie, so a run of new tags tells apart. */
internal fun nextTagColor(tags: List<CostTag>): String {
    val palette = TAG_COLORS.filter { it != "gray" }
    return palette.minByOrNull { color -> tags.count { it.color == color } } ?: "gray"
}

private fun nameKey(name: String): String = name.trim().lowercase()

data class TagRowView(
    val id: String,
    val name: String,
    val color: String,
    val colorLabel: String,
    val entryCountText: String,
)

data class CostTagsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val rows: List<TagRowView> = emptyList(),
    val countText: String = "",
    val busyId: String? = null,
    val actionError: UiError? = null,
    val notice: String? = null,
)

/** The cost tags with how many entries carry each. */
class CostTagsStore(
    private val app: HauswartApp,
) : Store<CostTagsState>(CostTagsState()) {
    private var tags: List<CostTag> = emptyList()

    init {
        onChange(app, "costs") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun delete(id: String) {
        val tag = tags.firstOrNull { it.id == id } ?: return
        if (current.busyId != null) return
        update { it.copy(busyId = id, actionError = null) }
        launch({ e -> update { it.copy(busyId = null, actionError = e) } }) {
            app.api.costs.costTagsDelete(id)
            update { it.copy(busyId = null, notice = tr("costtag_deleted_toast", "name" to tag.name)) }
            app.changed("costs")
        }
    }

    /** The sentence under the delete confirmation: what the tag is taken off, and that the entries stay. */
    fun deleteText(id: String): String {
        val tag = tags.firstOrNull { it.id == id } ?: return ""
        return if (tag.entryCount == 0L) {
            tr("costtag_delete_description_unused", "name" to tag.name)
        } else {
            tr("costtag_delete_description", "name" to tag.name, "count" to tag.entryCount)
        }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    private fun load() {
        update { it.copy(loading = tags.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            tags =
                app.api.costs
                    .costTagsList()
                    .items
            update {
                it.copy(
                    loading = false,
                    rows =
                        tags.map { t ->
                            TagRowView(
                                t.id,
                                t.name,
                                t.color,
                                tagColorLabel(t.color),
                                tr(
                                    "costtag_entry_count",
                                    "count" to t.entryCount,
                                ),
                            )
                        },
                    countText = tr("costtag_count", "count" to tags.size),
                )
            }
        }
    }
}

data class TagForm(
    val name: String = "",
    val color: String = "gray",
)

data class TagEditState(
    val isNew: Boolean,
    val loading: Boolean,
    val loadError: UiError? = null,
    val initial: TagForm? = null,
    val colors: List<CostOption> = emptyList(),
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    val savedId: String? = null,
)

/** Makes a cost tag ([id] null) or renames and recolours one. */
class TagEditStore(
    private val app: HauswartApp,
    private val id: String?,
) : Store<TagEditState>(TagEditState(isNew = id == null, loading = true, colors = tagColorOptions())) {
    private var tags: List<CostTag> = emptyList()
    private var tag: CostTag? = null

    init {
        load()
    }

    fun retry() {
        load()
    }

    fun save(form: TagForm) {
        if (current.saving) return
        val name = form.name.trim()
        val problem =
            when {
                name.isEmpty() -> tr("m_field_required")
                name.length > COST_TAG_NAME_MAX -> tr("field_too_long", "max" to COST_TAG_NAME_MAX)
                tags.any { it.id != id && nameKey(it.name) == nameKey(name) } -> tr("costtag_error_name_taken")
                else -> null
            }
        if (problem != null) {
            update { it.copy(fieldErrors = mapOf("name" to problem), error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e ->
            val fields =
                if (e.code == "conflict") {
                    mapOf(
                        "name" to
                            if (id == null &&
                                tags.size >= MAX_COST_TAGS
                            ) {
                                tr("costtag_error_limit", "max" to MAX_COST_TAGS)
                            } else {
                                tr("costtag_error_name_taken")
                            },
                    )
                } else {
                    e.fields
                }
            update { it.copy(saving = false, error = if (fields.isEmpty()) e else null, fieldErrors = fields) }
        }) {
            val before = tag
            val saved =
                if (before == null) {
                    app.api.costs.costTagsCreate(CostTagsCreateRequest(name = name, color = form.color))
                } else {
                    val request =
                        CostTagsUpdateRequest(
                            name = name.takeIf { it != before.name },
                            color = form.color.takeIf { it != before.color },
                        )
                    if (request == CostTagsUpdateRequest()) before else app.api.costs.costTagsUpdate(before.id, request)
                }
            app.changed("costs")
            update { it.copy(saving = false, savedId = saved.id) }
        }
    }

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            tags =
                app.api.costs
                    .costTagsList()
                    .items
            tag = id?.let { wanted -> tags.firstOrNull { it.id == wanted } }
            if (id != null && tag == null) {
                update { it.copy(loading = false, loadError = UiError(tr("m_error_not_found"), "not_found")) }
                return@launch
            }
            val form = tag?.let { TagForm(it.name, it.color) } ?: TagForm(color = nextTagColor(tags))
            update { it.copy(loading = false, initial = form) }
        }
    }
}
