package ch.orellbuehler.hauswart.android.ui.docs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PrimaryButton
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.android.ui.sections.AttachmentsSection
import ch.orellbuehler.hauswart.android.ui.sections.CommentsSection
import ch.orellbuehler.hauswart.android.ui.sections.DocumentLinksSection
import ch.orellbuehler.hauswart.android.ui.sections.viewFile
import ch.orellbuehler.hauswart.feature.docs.DocViewStore
import ch.orellbuehler.hauswart.i18n.tr
import kotlinx.coroutines.launch

@Composable
fun DocScreen(
    nav: NavController,
    slug: String,
) {
    val store = rememberStore(key = slug) { DocViewStore(it, slug) }
    val state = store.collect()
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var extras by rememberSaveable { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val cannotOpen = tr("m_cannot_open")
    val reportCannotOpen: () -> Unit = { scope.launch { snackbar.showSnackbar(cannotOpen) } }
    val onLink =
        rememberDocLinkHandler(nav, store::linkTarget, store::openAttachment, reportCannotOpen)

    LaunchedEffect(state.deleted) { if (state.deleted) nav.popBackStack() }
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
        if (!context.viewFile(opened.file)) snackbar.showSnackbar(cannotOpen)
    }

    AppScaffold(
        title = state.title.ifEmpty { tr("nav_docs") },
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            if (state.pageId.isNotEmpty()) {
                if (state.opening) CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
                IconButton(onClick = { nav.openDocEdit(slug) }) { Icon(Icons.Outlined.Edit, contentDescription = tr("common_edit")) }
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = tr("docs_actions")) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text(tr("docs_history")) },
                        leadingIcon = { Icon(Icons.Outlined.History, contentDescription = null) },
                        onClick = {
                            menu = false
                            nav.openDocHistory(slug)
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(tr(if (state.pinned) "docs_unpin" else "docs_pin")) },
                        leadingIcon = { Icon(Icons.Outlined.PushPin, contentDescription = null) },
                        enabled = !state.busy,
                        onClick = {
                            menu = false
                            store.togglePin()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(tr(if (state.archived) "docs_unarchive" else "docs_archive")) },
                        leadingIcon = {
                            Icon(
                                if (state.archived) Icons.Outlined.Unarchive else Icons.Outlined.Archive,
                                contentDescription = null,
                            )
                        },
                        enabled = !state.busy,
                        onClick = {
                            menu = false
                            store.toggleArchive()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(tr("common_delete")) },
                        leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                        enabled = !state.busy,
                        onClick = {
                            menu = false
                            confirmDelete = true
                        },
                    )
                }
            }
        },
    ) { padding ->
        when {
            state.missing ->
                EmptyState(
                    title = tr("docs_missing_title"),
                    body = tr("docs_missing_body", "slug" to slug),
                    icon = Icons.Outlined.Description,
                    modifier = Modifier.padding(padding),
                    action = {
                        PrimaryButton(text = tr("docs_missing_create"), onClick = { nav.openDocNew(title = state.suggestedTitle) })
                    },
                )
            state.pageId.isNotEmpty() ->
                Column(Modifier.padding(padding).fillMaxSize()) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = ScreenPadding, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FilterChip(
                            selected = !extras,
                            onClick = { extras = false },
                            label = { Text(tr("m_docs_tab_page"), maxLines = 1) },
                        )
                        FilterChip(
                            selected = extras,
                            onClick = { extras = true },
                            label = { Text(tr("m_docs_tab_extras"), maxLines = 1) },
                        )
                    }
                    if (extras) {
                        Column(
                            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(ScreenPadding),
                            verticalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            AttachmentsSection(ownerType = "page", ownerId = state.pageId)
                            DocumentLinksSection(ownerType = "page", ownerId = state.pageId)
                            CommentsSection(ownerType = "doc_page", ownerId = state.pageId)
                        }
                    } else {
                        DocWebView(bodyHtml = state.bodyHtml, onLink = onLink, modifier = Modifier.fillMaxSize())
                    }
                }
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }

    if (confirmDelete) {
        ConfirmDialog(
            title = tr("docs_delete_title"),
            text = tr("docs_delete_description", "title" to state.title),
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                confirmDelete = false
                store.delete()
            },
            onDismiss = { confirmDelete = false },
        )
    }
}
