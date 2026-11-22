package ch.orellbuehler.hauswart.feature.more

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.i18n.tr

/** [id] names the destination (`appointments`, `inventory`, ...); the apps map it to a screen. */
data class MoreItem(
    val id: String,
    val title: String,
)

data class MoreGroup(
    val title: String,
    val items: List<MoreItem>,
)

data class MoreState(
    val userName: String,
    val username: String,
    val groups: List<MoreGroup>,
    /** The person has a working connection to a document system; the "Documents" row waits for it, as in the web sidebar. */
    val documentSystem: Boolean = false,
)

private val DOCUMENT_PROVIDERS = setOf("paperless")

/**
 * The navigation list behind the "more" tab: everything that is not a tab, grouped like the web sidebar. The
 * "Documents" row is shown only while the person has a document system connected.
 */
class MoreStore(
    private val app: HauswartApp,
) : Store<MoreState>(
        run {
            val user = app.session.user
            MoreState(
                userName = user?.displayName?.ifBlank { null } ?: user?.username ?: "",
                username = user?.username ?: "",
                groups = moreGroups(documentSystem = false),
            )
        },
    ) {
    init {
        onChange(app, "documents", "integrations") { load() }
        load()
    }

    private fun load() {
        launch({ _ -> show(false) }) {
            val usable =
                app.api.integrations
                    .integrationsList()
                    .items
                    .any { it.kind in DOCUMENT_PROVIDERS && it.available && it.configured && it.enabled }
            show(usable)
        }
    }

    private fun show(documentSystem: Boolean) {
        update { it.copy(documentSystem = documentSystem, groups = moreGroups(documentSystem)) }
    }
}

private fun item(id: String) = MoreItem(id, tr("nav_$id"))

fun moreGroups(documentSystem: Boolean = false): List<MoreGroup> =
    listOf(
        MoreGroup(tr("nav_group_overview"), listOf(item("appointments"))),
        MoreGroup(
            tr("nav_group_home"),
            listOfNotNull(
                item("inventory"),
                item("rooms"),
                item("plants"),
                item("docs"),
                if (documentSystem) item("documents") else null,
            ),
        ),
        MoreGroup(tr("nav_group_upkeep"), listOf(item("defects"), item("parts"), item("contacts"), item("emergency"))),
        MoreGroup(tr("nav_group_finance"), listOf(item("warranties"), item("insurance"))),
    )
