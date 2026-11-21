package ch.orellbuehler.hauswart.android.ui.costbooks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Sell
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.costbooks.CostTagsStore
import ch.orellbuehler.hauswart.feature.costbooks.tagColorHex
import ch.orellbuehler.hauswart.i18n.tr

/** The colour dot of a tag. */
@Composable
internal fun TagDot(
    color: String,
    size: Int = 20,
) {
    val argb = 0xFF000000 or tagColorHex(color).toLong(16)
    Box(Modifier.size(size.dp).clip(CircleShape).background(Color(argb)))
}

@Composable
fun CostTagsScreen(nav: NavController) {
    val store = rememberStore { CostTagsStore(it) }
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
        title = tr("costtag_settings_title"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.openTagEdit(null) }) { Icon(Icons.Outlined.Add, contentDescription = tr("costtag_new")) }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.rows.isEmpty() -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            state.rows.isEmpty() ->
                EmptyState(
                    title = tr("costtag_empty_title"),
                    body = tr("costtag_empty_body"),
                    icon = Icons.Outlined.Sell,
                    modifier = Modifier.padding(padding),
                )
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(contentPadding = PaddingValues(bottom = 88.dp), verticalArrangement = Arrangement.spacedBy(0.dp)) {
                        item {
                            Text(
                                tr("costtag_settings_description") + " " + state.countText,
                                Modifier.padding(horizontal = ScreenPadding, vertical = 8.dp),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        items(state.rows, key = { it.id }) { tag ->
                            ListRow(
                                title = tag.name,
                                subtitle = tag.colorLabel + " · " + tag.entryCountText,
                                leading = { TagDot(tag.color) },
                                trailing = {
                                    Row {
                                        ActionMenu(
                                            description = tr("costtag_actions", "name" to tag.name),
                                            enabled = state.busyId != tag.id,
                                            actions =
                                                listOf(
                                                    MenuAction(tr("common_edit"), { nav.openTagEdit(tag.id) }),
                                                    MenuAction(tr("common_delete"), { deleteId = tag.id }, destructive = true),
                                                ),
                                        )
                                    }
                                },
                                onClick = { nav.openTagEdit(tag.id) },
                            )
                        }
                    }
                }
        }
    }

    deleteId?.let { id ->
        ConfirmDialog(
            title = tr("costtag_delete_title"),
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
