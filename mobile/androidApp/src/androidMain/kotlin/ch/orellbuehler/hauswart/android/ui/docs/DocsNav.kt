package ch.orellbuehler.hauswart.android.ui.docs

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import ch.orellbuehler.hauswart.android.ui.nav.Routes

private const val DOC_NEW = "docs/new?section={section}&assetId={assetId}&roomId={roomId}&title={title}"
private const val DOC_EDIT = "docs/{slug}/edit"
private const val DOC_HISTORY = "docs/{slug}/history"

private val slugArgument = listOf(navArgument("slug") { type = NavType.StringType })
private val newArguments =
    listOf("section", "assetId", "roomId", "title").map { name ->
        navArgument(name) {
            type = NavType.StringType
            defaultValue = ""
        }
    }

fun NavGraphBuilder.docsGraph(nav: NavController) {
    composable(Routes.DOCS) { DocsScreen(nav) }
    composable(DOC_NEW, arguments = newArguments) { entry ->
        val args = entry.arguments
        DocEditScreen(
            nav = nav,
            slug = null,
            section = args?.getString("section").orEmpty(),
            assetId = args?.getString("assetId").orEmpty(),
            roomId = args?.getString("roomId").orEmpty(),
            title = args?.getString("title").orEmpty(),
        )
    }
    composable(Routes.DOC_ROUTE, arguments = slugArgument) { entry ->
        DocScreen(nav, requireNotNull(entry.arguments?.getString("slug")))
    }
    composable(DOC_EDIT, arguments = slugArgument) { entry ->
        DocEditScreen(nav, requireNotNull(entry.arguments?.getString("slug")), "", "", "", "")
    }
    composable(DOC_HISTORY, arguments = slugArgument) { entry ->
        DocRevisionsScreen(nav, requireNotNull(entry.arguments?.getString("slug")))
    }
}

internal fun NavController.openDocNew(
    section: String = "",
    title: String = "",
) = navigate("docs/new?section=${Routes.arg(section)}&assetId=&roomId=&title=${Routes.arg(title)}")

internal fun NavController.openDocEdit(slug: String) = navigate("docs/${Routes.arg(slug)}/edit")

internal fun NavController.openDocHistory(slug: String) = navigate("docs/${Routes.arg(slug)}/history")
