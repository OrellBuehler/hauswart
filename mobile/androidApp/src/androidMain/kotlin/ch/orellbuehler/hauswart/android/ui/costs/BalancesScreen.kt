package ch.orellbuehler.hauswart.android.ui.costs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.EmptyState
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.components.toneColor
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.costs.ALL_BOOKS
import ch.orellbuehler.hauswart.feature.costs.BALANCE_EMPTY
import ch.orellbuehler.hauswart.feature.costs.BALANCE_OPEN
import ch.orellbuehler.hauswart.feature.costs.BalancesStore
import ch.orellbuehler.hauswart.feature.costs.bookArgOf
import ch.orellbuehler.hauswart.i18n.tr

/** Who owes whom, the payments that square it, and the recorded payments. [bookArg] is a book id or `all`. */
@Composable
fun BalancesScreen(
    nav: NavController,
    bookArg: String?,
) {
    val store = rememberStore(key = bookArg ?: "") { BalancesStore(it, bookArg) }
    val state = store.collect()
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    var deleting by remember { mutableStateOf<String?>(null) }
    val bookValue = bookArgOf(state.bookId)

    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }

    AppScaffold(
        title = tr("balances_title"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            IconButton(onClick = { nav.openSettlement(bookArg = bookValue) }) {
                Icon(Icons.Outlined.Add, contentDescription = tr("balances_record_new"))
            }
        },
    ) { padding ->
        when {
            state.loading -> LoadingBox(Modifier.padding(padding))
            error != null && state.people.isEmpty() -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (state.showSwitcher) {
                            item(key = "books") { BookSwitcher(state.books, state.bookId, store::selectBook, Modifier.padding(top = 8.dp)) }
                        }
                        state.scopeNote?.let { note ->
                            item(key = "scope") { Note(note) }
                        }
                        item(key = "people") {
                            SectionCard(Modifier.padding(horizontal = ScreenPadding), title = tr("balances_people_title")) {
                                state.you?.let {
                                    Text(
                                        it.text,
                                        Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                                        style = MaterialTheme.typography.titleMedium,
                                        color = toneColor(it.tone),
                                    )
                                }
                                if (state.status == BALANCE_EMPTY) {
                                    Text(
                                        tr("balances_nothing"),
                                        Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                        style = MaterialTheme.typography.bodyMedium,
                                    )
                                } else {
                                    state.people.forEach { person ->
                                        Column(
                                            Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                            verticalArrangement = Arrangement.spacedBy(2.dp),
                                        ) {
                                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                                Text(
                                                    person.name,
                                                    Modifier.weight(1f),
                                                    style = MaterialTheme.typography.titleSmall,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis,
                                                )
                                                if (person.isYou) StatusChip(tr("balances_you_badge"))
                                            }
                                            Text(
                                                person.balance.text,
                                                style = MaterialTheme.typography.bodyLarge,
                                                color = toneColor(person.balance.tone),
                                            )
                                            Text(
                                                tr("balances_paid") + " " + person.paid + " · " + tr("balances_share") + " " + person.share,
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                            Text(
                                                tr("balances_sent") + " " + person.sent + " · " + tr("balances_received") + " " +
                                                    person.received,
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                    Text(
                                        tr("balances_formula"),
                                        Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                        state.notes.forEach { note -> item(key = "note-$note") { Note(note) } }
                        if (state.status != BALANCE_EMPTY) {
                            item(key = "suggested") {
                                SectionCard(Modifier.padding(horizontal = ScreenPadding), title = tr("balances_suggested_title")) {
                                    if (state.status == BALANCE_OPEN) {
                                        state.payments.forEach { payment ->
                                            ListRow(
                                                title = payment.sentence,
                                                subtitle = payment.amount,
                                                trailing = {
                                                    FilledTonalButton(
                                                        onClick = {
                                                            nav.openSettlement(
                                                                from = payment.fromUserId,
                                                                to = payment.toUserId,
                                                                amount = payment.amountInput,
                                                                bookArg = bookValue,
                                                            )
                                                        },
                                                    ) { Text(tr("balances_record"), maxLines = 1) }
                                                },
                                            )
                                        }
                                    } else {
                                        Text(
                                            tr("balances_square"),
                                            Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                            style = MaterialTheme.typography.bodyMedium,
                                        )
                                    }
                                }
                            }
                        }
                        item(key = "filters") {
                            Column(Modifier.padding(horizontal = ScreenPadding), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(tr("settlements_title"), style = MaterialTheme.typography.titleMedium)
                                ChoiceField(
                                    label = tr("settlements_filter_year"),
                                    value = state.year.toString(),
                                    options = state.years.map { it.value to it.label },
                                    onChange = store::setYear,
                                )
                                ChoiceField(
                                    label = tr("settlements_filter_person"),
                                    value = state.person,
                                    options = state.persons.map { it.value to it.label },
                                    onChange = store::setPerson,
                                )
                                if (state.bookId != ALL_BOOKS) {
                                    Text(
                                        tr("settlements_book_note"),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Text(
                                    state.settlementsCount,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        if (state.settlements.isEmpty()) {
                            val filtered = state.settlementsFiltered
                            val titleKey = if (filtered) "settlements_empty_filtered_title" else "settlements_empty_title"
                            val bodyKey = if (filtered) "costs_empty_filtered_body" else "settlements_empty_body"
                            item(key = "none") {
                                EmptyState(
                                    title = tr(titleKey),
                                    body = tr(bodyKey),
                                    action =
                                        if (state.settlementsFiltered) {
                                            { TextButton(onClick = store::resetFilters) { Text(tr("tasks_filter_reset"), maxLines = 1) } }
                                        } else {
                                            null
                                        },
                                )
                            }
                        }
                        items(state.settlements, key = { it.id }) { row ->
                            var menu by remember { mutableStateOf(false) }
                            ListRow(
                                title = row.title,
                                subtitle = row.meta,
                                subtitleLines = 2,
                                trailing = {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(row.amount, style = MaterialTheme.typography.bodyLarge)
                                        IconButton(onClick = { menu = true }) {
                                            Icon(
                                                Icons.Outlined.MoreVert,
                                                contentDescription =
                                                    tr(
                                                        "settlement_actions",
                                                        "from" to row.title,
                                                        "to" to "",
                                                    ),
                                            )
                                        }
                                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                            DropdownMenuItem(
                                                text = { Text(tr("common_edit")) },
                                                leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                                                onClick = {
                                                    menu = false
                                                    nav.openSettlement(id = row.id)
                                                },
                                            )
                                            DropdownMenuItem(
                                                text = { Text(tr("common_delete")) },
                                                leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                                                onClick = {
                                                    menu = false
                                                    deleting = row.id
                                                },
                                            )
                                        }
                                    }
                                },
                            )
                        }
                    }
                }
        }
    }

    deleting?.let { settlementId ->
        ConfirmDialog(
            title = tr("settlement_delete_title"),
            text = store.deleteText(settlementId),
            confirmLabel = tr("common_delete"),
            destructive = true,
            onConfirm = {
                deleting = null
                store.deleteSettlement(settlementId)
            },
            onDismiss = { deleting = null },
        )
    }
}

@Composable
private fun Note(text: String) {
    Text(
        text,
        Modifier.padding(horizontal = ScreenPadding),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
