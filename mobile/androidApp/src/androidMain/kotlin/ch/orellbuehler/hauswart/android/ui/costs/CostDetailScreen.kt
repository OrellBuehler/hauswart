package ch.orellbuehler.hauswart.android.ui.costs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
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
import ch.orellbuehler.hauswart.android.ui.components.ListRow
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PrimaryButton
import ch.orellbuehler.hauswart.android.ui.components.PullToRefresh
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.costs.CostDetailStore
import ch.orellbuehler.hauswart.feature.costs.CostFact
import ch.orellbuehler.hauswart.i18n.tr

@Composable
fun CostDetailScreen(
    nav: NavController,
    id: String,
) {
    val store = rememberStore(key = id) { CostDetailStore(it, id) }
    val state = store.collect()
    val cost = state.cost
    val error = state.error
    val snackbar = remember { SnackbarHostState() }
    var confirmDelete by remember { mutableStateOf(false) }

    LaunchedEffect(state.deleted) { if (state.deleted) nav.popBackStack() }
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbar.showSnackbar(it.message)
            store.dismissActionError()
        }
    }
    LaunchedEffect(state.reviewedMessage) {
        state.reviewedMessage?.let {
            snackbar.showSnackbar(it)
            store.dismissReviewedMessage()
        }
    }

    AppScaffold(
        title = cost?.title ?: tr("nav_costs"),
        onBack = { nav.popBackStack() },
        snackbarHostState = snackbar,
        actions = {
            if (cost != null) {
                IconButton(onClick = { nav.openCostEdit(id) }) { Icon(Icons.Outlined.Edit, contentDescription = tr("common_edit")) }
                if (!cost.fuelOwned) {
                    IconButton(onClick = { confirmDelete = true }, enabled = !state.deleting) {
                        Icon(Icons.Outlined.Delete, contentDescription = tr("common_delete"))
                    }
                }
            }
        },
    ) { padding ->
        when {
            cost != null ->
                PullToRefresh(onRefresh = store::refresh, modifier = Modifier.padding(padding)) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                cost.category + " · " + cost.date,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(cost.title, style = MaterialTheme.typography.headlineSmall)
                            AmountText(cost.amount, cost.refund, style = MaterialTheme.typography.headlineMedium)
                            BadgeRow(cost.badges, cost.tags, Modifier.padding(top = 4.dp))
                            cost.fuelHint?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        if (cost.reviewNeeded) {
                            Card(
                                Modifier.fillMaxWidth(),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
                            ) {
                                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Row(
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Icon(Icons.Outlined.Visibility, contentDescription = null)
                                        Text(tr("cost_review_title"), style = MaterialTheme.typography.titleSmall)
                                    }
                                    Text(tr("cost_review_body"), style = MaterialTheme.typography.bodyMedium)
                                    PrimaryButton(
                                        text = tr("cost_review_action"),
                                        pendingText = tr("common_saving"),
                                        onClick = store::markReviewed,
                                        pending = state.reviewing,
                                    )
                                }
                            }
                        }
                        SectionCard(title = tr("cost_facts")) {
                            cost.facts.forEach { fact ->
                                LabeledValue(fact.label, fact.value, onClick = factLink(nav, fact))
                            }
                        }
                        SectionCard(title = tr("cost_shares_title") + " · " + cost.splitTitle) {
                            cost.shares.forEach { share ->
                                ListRow(
                                    title = share.name,
                                    subtitle = share.percent,
                                    trailing = { Text(share.amount, style = MaterialTheme.typography.bodyLarge) },
                                )
                            }
                            Text(
                                cost.sharesNote,
                                Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        cost.notes?.let { notes ->
                            SectionCard(title = tr("cost_notes")) {
                                Text(
                                    notes,
                                    Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                            }
                        }
                        CostExtras(cost.id)
                    }
                }
            error != null -> ErrorBox(error, Modifier.padding(padding), onRetry = store::refresh)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }

    if (confirmDelete && cost != null) {
        ConfirmDialog(
            title = tr("cost_delete_title"),
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
        "defect" -> ({ nav.navigate(Routes.defect(target)) })
        else -> null
    }
}
