package ch.orellbuehler.hauswart.android.ui.documents

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.openUri
import ch.orellbuehler.hauswart.android.ui.nav.open
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.android.ui.sections.shareFile
import ch.orellbuehler.hauswart.android.ui.sections.viewFile
import ch.orellbuehler.hauswart.feature.documents.DocumentDetailStore
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun DocumentDetailScreen(
    nav: NavController,
    id: String,
) {
    val store = rememberStore(key = id) { DocumentDetailStore(it, id) }
    val state = store.collect()
    val error = state.error
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var unlinkId by remember { mutableStateOf<String?>(null) }
    val cannotOpen = tr("m_cannot_open")

    LaunchedEffect(state.notice) {
        state.notice?.let {
            snackbar.showSnackbar(it)
            store.dismissNotice()
        }
    }
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }
    LaunchedEffect(state.opened) {
        val opened = state.opened ?: return@LaunchedEffect
        store.clearOpened()
        val done = if (opened.share) context.shareFile(opened.file) else context.viewFile(opened.file)
        if (!done) snackbar.showSnackbar(cannotOpen)
    }

    AppScaffold(
        title = state.title.ifEmpty { tr("nav_documents") },
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            if (state.opening) CircularProgressIndicator(Modifier.padding(end = 12.dp), strokeWidth = 2.dp)
        },
    ) { padding ->
        when {
            state.title.isNotEmpty() ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            DocumentThumb(state.thumbs, store::requestThumbnail, store::thumbnail, width = 72.dp, height = 96.dp)
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilledTonalButton(onClick = store::open, enabled = !state.opening) {
                                    Icon(Icons.Outlined.OpenInNew, contentDescription = null)
                                    Text(tr("document_open_preview"), Modifier.padding(start = 8.dp), maxLines = 1)
                                }
                                FilledTonalButton(onClick = store::openOriginal, enabled = !state.opening) {
                                    Icon(Icons.Outlined.Download, contentDescription = null)
                                    Text(tr("document_download_original"), Modifier.padding(start = 8.dp), maxLines = 1)
                                }
                            }
                        }
                        SectionCard {
                            state.facts.forEach { LabeledValue(it.label, it.value) }
                            if (state.tags.isNotEmpty()) LabeledValue(tr("documents_field_tags"), state.tags.joinToString(", "))
                            state.webUrl?.let { url ->
                                LabeledValue(tr("documents_open_in_system"), url, onClick = { context.openUri(url) })
                            }
                        }
                        SectionCard(title = tr("documents_links_title")) {
                            if (state.uses.isEmpty()) {
                                Text(tr("documents_links_none"), Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                            }
                            state.uses.forEach { use ->
                                ListRow(
                                    title = if (use.gone) tr("documents_owner_gone") else use.title,
                                    subtitle =
                                        listOf(
                                            use.kindLabel,
                                            use.roleLabel,
                                            use.label,
                                        ).filter { it.isNotEmpty() }.joinToString(" · "),
                                    trailing = {
                                        if (state.unlinkingId == use.id) {
                                            CircularProgressIndicator(Modifier.padding(4.dp), strokeWidth = 2.dp)
                                        } else {
                                            IconButton(onClick = { unlinkId = use.id }) {
                                                Icon(
                                                    Icons.Outlined.LinkOff,
                                                    contentDescription =
                                                        tr(
                                                            "documents_unlink_aria",
                                                            "owner" to use.title,
                                                        ),
                                                )
                                            }
                                        }
                                    },
                                    onClick = use.link?.let { link -> { nav.open(link) } },
                                )
                            }
                        }
                    }
                }
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }

    unlinkId?.let { linkId ->
        ConfirmDialog(
            title = tr("document_unlink_title"),
            text = tr("document_unlink_description", "title" to state.title),
            confirmLabel = tr("document_unlink"),
            destructive = true,
            onConfirm = {
                unlinkId = null
                store.unlink(linkId)
            },
            onDismiss = { unlinkId = null },
        )
    }
}
