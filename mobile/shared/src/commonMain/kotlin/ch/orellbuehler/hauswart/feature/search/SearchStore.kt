package ch.orellbuehler.hauswart.feature.search

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.generated.SearchHit
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.feature.applink.AppLink
import ch.orellbuehler.hauswart.feature.applink.routeForUrl
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay

/** The kinds of hit in the order the groups appear. */
val SEARCH_TYPES: List<String> = SearchHit.TYPE_VALUES

fun searchTypeLabel(type: String): String =
    when (type) {
        "asset_hint" -> tr("search_type_hint")
        else -> tr("search_type_$type")
    }

/** One hit. [link] is null for a hit whose address the app does not follow. */
data class SearchHitRow(
    val key: String,
    val type: String,
    val title: String,
    val snippet: String,
    val link: AppLink?,
)

/** The hits of one kind. */
data class SearchHitGroup(
    val type: String,
    val title: String,
    val hits: List<SearchHitRow>,
)

/** A filter chip: one kind (empty [type] for all) with its number of hits. */
data class SearchTypeFilter(
    val type: String,
    val title: String,
    val count: Int,
)

data class SearchState(
    /** What the person typed. */
    val query: String = "",
    /** Nothing typed yet. */
    val idle: Boolean = true,
    val loading: Boolean = false,
    val error: UiError? = null,
    /** The kind shown; empty for all. */
    val type: String = "",
    /** Chips for "all" and every kind that has hits; empty while there are fewer than two kinds. */
    val filters: List<SearchTypeFilter> = emptyList(),
    val groups: List<SearchHitGroup> = emptyList(),
    /** Hits of the search, whatever the kind filter. */
    val total: Int = 0,
    /** Hits shown with the kind filter. */
    val shown: Int = 0,
) {
    /** A search ran and found nothing. */
    val empty: Boolean get() = !idle && !loading && error == null && total == 0
}

/** Full-text search over pages, devices, rooms, tasks, defects, contacts, parts, hints and more. */
class SearchStore(
    private val app: HauswartApp,
) : Store<SearchState>(SearchState()) {
    private var hits: List<SearchHit> = emptyList()
    private var running: Job? = null
    private var generation = 0

    fun setQuery(query: String) {
        if (query == current.query) return
        update { it.copy(query = query) }
        run()
    }

    fun setType(type: String) {
        update { it.copy(type = type) }
        show()
    }

    fun retry() {
        run()
    }

    private fun run() {
        running?.cancel()
        val ticket = ++generation
        val text = current.query.trim().take(MAX_QUERY)
        if (text.isEmpty()) {
            hits = emptyList()
            update { SearchState(query = it.query) }
            return
        }
        update { it.copy(idle = false, loading = true, error = null) }
        running =
            launch({ e -> if (ticket == generation) update { it.copy(loading = false, error = e) } }) {
                delay(DELAY_MS)
                val result = app.api.search.search(q = text, limit = LIMIT)
                if (ticket != generation) return@launch
                hits = result.items.filter { safe(it.url) }
                update { it.copy(loading = false) }
                show()
            }
    }

    private fun show() {
        val counts = SEARCH_TYPES.associateWith { type -> hits.count { it.type == type } }
        val type = current.type.takeIf { (counts[it] ?: 0) > 0 }.orEmpty()
        val visible = if (type.isEmpty()) hits else hits.filter { it.type == type }
        val groups =
            SEARCH_TYPES.mapNotNull { kind ->
                val members = visible.filter { it.type == kind }
                if (members.isEmpty()) {
                    null
                } else {
                    SearchHitGroup(
                        kind,
                        searchTypeLabel(kind),
                        members.map {
                            SearchHitRow("${it.type}:${it.id}", it.type, it.title, it.snippet, routeForUrl(it.url))
                        },
                    )
                }
            }
        val kinds = SEARCH_TYPES.filter { (counts[it] ?: 0) > 0 }
        val filters =
            if (kinds.size < 2) {
                emptyList()
            } else {
                listOf(SearchTypeFilter("", tr("search_filter_all"), hits.size)) +
                    kinds.map { SearchTypeFilter(it, searchTypeLabel(it), counts.getValue(it)) }
            }
        update { it.copy(type = type, groups = groups, filters = filters, total = hits.size, shown = visible.size) }
    }

    /** A hit's url is an app path; anything else (another origin, a `//host` url) is not followed. */
    private fun safe(url: String): Boolean = url.startsWith("/") && !url.startsWith("//") && !url.contains('\\')

    private companion object {
        const val MAX_QUERY = 100
        const val LIMIT = 50L
        const val DELAY_MS = 250L
    }
}
