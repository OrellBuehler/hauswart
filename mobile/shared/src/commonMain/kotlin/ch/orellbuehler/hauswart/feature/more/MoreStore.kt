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
)

/** The navigation list behind the "more" tab: everything that is not a tab, grouped like the web sidebar. */
class MoreStore(
    app: HauswartApp,
) : Store<MoreState>(
        run {
            val user = app.session.user
            MoreState(
                userName = user?.displayName?.ifBlank { null } ?: user?.username ?: "",
                username = user?.username ?: "",
                groups = moreGroups(),
            )
        },
    )

private fun item(id: String) = MoreItem(id, tr("nav_$id"))

fun moreGroups(): List<MoreGroup> =
    listOf(
        MoreGroup(tr("nav_group_overview"), listOf(item("appointments"))),
        MoreGroup(tr("nav_group_home"), listOf(item("inventory"), item("rooms"), item("plants"), item("docs"), item("documents"))),
        MoreGroup(tr("nav_group_upkeep"), listOf(item("defects"), item("parts"), item("contacts"), item("emergency"))),
        MoreGroup(tr("nav_group_finance"), listOf(item("warranties"), item("insurance"))),
    )
