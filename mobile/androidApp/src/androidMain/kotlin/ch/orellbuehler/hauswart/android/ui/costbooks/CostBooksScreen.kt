package ch.orellbuehler.hauswart.android.ui.costbooks

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.SectionTitle
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.costbooks.BookRowView
import ch.orellbuehler.hauswart.feature.costbooks.CostBooksStore
import ch.orellbuehler.hauswart.i18n.tr

/** The cost books: the ones that take entries in their order, and the archived ones. */
@Composable
fun CostBooksScreen(nav: NavController) {
    val store = rememberStore { CostBooksStore(it) }
    val state = store.collect()
    val snackbar = remember { SnackbarHostState() }
    var deleteId by rememberSaveable { mutableStateOf<String?>(null) }
    val error = state.error

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

    AppScaffold(
        title = tr("costbook_settings_title"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.openBookEdit(null) }) { Icon(Icons.Outlined.Add, contentDescription = tr("costbook_new")) }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.total == 0 -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            state.total == 0 ->
                EmptyState(
                    title = tr("costbook_empty_title"),
                    body = tr("costbook_empty_body"),
                    icon = Icons.Outlined.MenuBook,
                    modifier = Modifier.padding(padding),
                )
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(
                        contentPadding = PaddingValues(start = ScreenPadding, end = ScreenPadding, bottom = 88.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item {
                            Text(
                                tr("costbook_settings_description"),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        item { SectionTitle(tr("costbook_open_section")) }
                        items(state.open, key = { it.id }) { book ->
                            BookCard(book, state.busyId == book.id, nav, store, onDelete = {
                                deleteId =
                                    book.id
                            })
                        }
                        if (state.archived.isNotEmpty()) {
                            item {
                                Column {
                                    SectionTitle(tr("costbook_archived_section"))
                                    Text(
                                        tr("costbook_archived_section_hint"),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            items(state.archived, key = { it.id }) { book ->
                                BookCard(book, state.busyId == book.id, nav, store, onDelete = { deleteId = book.id })
                            }
                        }
                    }
                }
        }
    }

    deleteId?.let { id ->
        ConfirmDialog(
            title = tr("costbook_delete_title"),
            text = store.deleteText(id),
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                deleteId = null
                store.delete(id)
            },
            onDismiss = { deleteId = null },
        )
    }
}

@Composable
private fun BookCard(
    book: BookRowView,
    busy: Boolean,
    nav: NavController,
    store: CostBooksStore,
    onDelete: () -> Unit,
) {
    SectionCard {
        Row(
            Modifier.clickable { nav.navigate(Routes.COSTS) }.padding(start = 16.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(book.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (book.isDefault) StatusChip(tr("costbook_default_badge"), tone = "ok")
                    if (book.archived) StatusChip(tr("costbook_archived_badge"))
                    if (book.taxRelevant) StatusChip(tr("costbook_tax_badge"))
                }
                Text(book.meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            ActionMenu(
                description = tr("costbook_actions", "name" to book.name),
                enabled = !busy,
                actions =
                    listOfNotNull(
                        MenuAction(tr("common_edit"), { nav.openBookEdit(book.id) }),
                        if (book.canMakeDefault) MenuAction(tr("costbook_make_default"), { store.makeDefault(book.id) }) else null,
                        if (book.canMoveUp) MenuAction(tr("costbook_move_up"), { store.move(book.id, -1) }) else null,
                        if (book.canMoveDown) MenuAction(tr("costbook_move_down"), { store.move(book.id, 1) }) else null,
                        if (book.archived) {
                            MenuAction(tr("costbook_restore"), { store.restore(book.id) })
                        } else {
                            MenuAction(tr("costbook_archive"), { store.archive(book.id) })
                        },
                        MenuAction(tr("common_delete"), onDelete, destructive = true),
                    ),
            )
        }
    }
}
