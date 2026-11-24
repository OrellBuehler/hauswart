package ch.orellbuehler.hauswart.android.ui.recurring

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ConfirmDialog
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.LabeledValue
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.StatusChip
import ch.orellbuehler.hauswart.android.ui.costs.AmountText
import ch.orellbuehler.hauswart.android.ui.costs.BadgeRow
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.costs.CostFact
import ch.orellbuehler.hauswart.feature.recurring.RECURRING_ACTION_PAUSE
import ch.orellbuehler.hauswart.feature.recurring.RECURRING_ACTION_RESUME
import ch.orellbuehler.hauswart.feature.recurring.RECURRING_ACTION_RUN
import ch.orellbuehler.hauswart.feature.recurring.RecurringDetailStore
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun RecurringDetailScreen(
    nav: NavController,
    id: String,
) {
    val store = rememberStore(key = id) { RecurringDetailStore(it, id) }
    val state = store.collect()
    val r = state.recurrence
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    var confirmDelete by remember { mutableStateOf(false) }
    val viewLabel = tr("finance_view")
    val busy = state.busyAction != null

    LaunchedEffect(state.deleted) { if (state.deleted) nav.popBackStack() }
    LaunchedEffect(state.notice) {
        val notice = state.notice ?: return@LaunchedEffect
        store.dismissNotice()
        val result = snackbar.showSnackbar(notice.message, if (notice.entryId != null) viewLabel else null)
        if (result == SnackbarResult.ActionPerformed) notice.entryId?.let { nav.navigate(Routes.cost(it)) }
    }
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }

    AppScaffold(
        title = r?.title ?: tr("recurrence_title"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            if (r != null) {
                IconButton(onClick = { nav.openRecurringEdit(id) }) { Icon(Icons.Outlined.Edit, contentDescription = tr("common_edit")) }
                IconButton(onClick = { confirmDelete = true }, enabled = !busy) {
                    Icon(Icons.Outlined.Delete, contentDescription = tr("common_delete"))
                }
            }
        },
    ) { padding ->
        when {
            r != null ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                r.categoryLine,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(r.title, style = MaterialTheme.typography.headlineSmall)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                AmountText(r.amount, r.refund, style = MaterialTheme.typography.headlineMedium)
                                StatusChip(r.stateLabel, tone = r.stateTone)
                            }
                            BadgeRow(emptyList(), r.tags, Modifier.padding(top = 4.dp))
                        }
                        r.error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (r.canPause) {
                                OutlinedButton(onClick = store::pause, enabled = !busy) {
                                    Text(
                                        tr(
                                            if (state.busyAction ==
                                                RECURRING_ACTION_PAUSE
                                            ) {
                                                "recurrence_pausing"
                                            } else {
                                                "recurrence_pause"
                                            },
                                        ),
                                        maxLines = 1,
                                    )
                                }
                            }
                            if (r.canResume) {
                                OutlinedButton(onClick = store::resume, enabled = !busy) {
                                    Text(
                                        tr(
                                            if (state.busyAction ==
                                                RECURRING_ACTION_RESUME
                                            ) {
                                                "recurrence_resuming"
                                            } else {
                                                "recurrence_resume"
                                            },
                                        ),
                                        maxLines = 1,
                                    )
                                }
                            }
                            if (r.canRun) {
                                OutlinedButton(onClick = store::runNow, enabled = !busy && r.runEnabled) {
                                    Text(
                                        tr(
                                            if (state.busyAction ==
                                                RECURRING_ACTION_RUN
                                            ) {
                                                "recurrence_running"
                                            } else {
                                                "recurrence_run_now"
                                            },
                                        ),
                                        maxLines = 1,
                                    )
                                }
                            }
                        }
                        if (r.canRun) {
                            Text(
                                tr("recurrence_run_hint"),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        SectionCard(title = tr("recurrence_rule_label") + " · " + r.ruleText) {
                            r.clampNote?.let {
                                Text(it, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall)
                            }
                            r.facts.take(4).forEach { fact -> LabeledValue(fact.label, fact.value) }
                        }
                        SectionCard(title = tr("recurrence_upcoming")) {
                            r.upcoming.forEach { Text(it, Modifier.padding(horizontal = 16.dp, vertical = 2.dp)) }
                            r.upcomingNote?.let {
                                Text(it, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.bodyMedium)
                            }
                            Text(
                                tr("recurrence_entries_note"),
                                Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        SectionCard(title = tr("recurrence_facts")) {
                            r.facts.drop(4).forEach { fact -> LabeledValue(fact.label, fact.value, onClick = factLink(nav, fact)) }
                        }
                        r.notes?.let { notes ->
                            SectionCard(title = tr("cost_notes")) {
                                Text(
                                    notes,
                                    Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                            }
                        }
                    }
                }
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }

    if (confirmDelete) {
        ConfirmDialog(
            title = tr("recurrence_delete_title"),
            text = store.deleteText(),
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

private fun factLink(
    nav: NavController,
    fact: CostFact,
): (() -> Unit)? {
    val target = fact.linkId ?: return null
    return when (fact.linkKind) {
        "asset" -> ({ nav.navigate(Routes.asset(target)) })
        "room" -> ({ nav.navigate(Routes.room(target)) })
        else -> null
    }
}
