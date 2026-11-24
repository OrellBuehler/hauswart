package ch.orellbuehler.hauswart.android.ui.inbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.costs.MultiChips
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.costs.CostOption
import ch.orellbuehler.hauswart.feature.inbox.SuggestionAcceptStore
import ch.orellbuehler.hauswart.i18n.tr

/** Accepts the suggestion [id] with changes: the screen behind "Anpassen". */
@Composable
fun SuggestionAcceptScreen(
    nav: NavController,
    id: String,
) {
    val store = rememberStore(key = id) { SuggestionAcceptStore(it, id) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }

    LaunchedEffect(state.done) { if (state.done != null) nav.popBackStack() }

    AppScaffold(
        title = state.dialogTitle.ifEmpty { tr("finance_inbox_title") },
        onBack = { nav.popBackStack() },
        bottomBar = {
            if (form != null) {
                Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
                    Button(
                        onClick = { form?.let(store::save) },
                        enabled = !state.saving,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = ScreenPadding, vertical = 12.dp),
                    ) {
                        if (state.saving) CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
                        Text(if (state.saving) tr("finance_accepting") else state.submitLabel, maxLines = 1)
                    }
                }
            }
        },
    ) { padding ->
        val current = form
        when {
            current != null -> {
                val errors = state.fieldErrors
                val view = store.view(current)
                Column(
                    Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(tr("finance_accept_description"), style = MaterialTheme.typography.bodySmall)
                    Text(state.facts, style = MaterialTheme.typography.bodyMedium)
                    TextField(
                        label = state.titleLabel,
                        value = current.title,
                        onChange = { form = current.copy(title = it) },
                        error = errors["title"],
                        capitalization = KeyboardCapitalization.Sentences,
                    )
                    when (state.kind) {
                        "asset" -> {
                            ChoiceField(
                                label = tr("asset_kind"),
                                value = current.assetKind,
                                options = state.assetKinds.pairs(),
                                onChange = { form = current.copy(assetKind = it) },
                            )
                            ChoiceField(
                                label = tr("cost_room"),
                                value = current.roomId,
                                options = listOf("" to tr("cost_no_room")) + state.rooms.pairs(),
                                onChange = { form = current.copy(roomId = it) },
                            )
                        }
                        "cost" -> {
                            if (state.books.size > 1) {
                                ChoiceField(
                                    label = tr("cost_book"),
                                    value = current.bookId,
                                    options = state.books.map { it.id to it.name },
                                    onChange = { form = store.withBook(current, it) },
                                    error = errors["bookId"],
                                )
                            }
                            ChoiceField(
                                label = tr("cost_category"),
                                value = current.category,
                                options = state.categories.pairs(),
                                onChange = { form = store.withCategory(current, it) },
                            )
                            ChoiceField(
                                label = tr("cost_paid_by"),
                                value = current.paidByUserId,
                                options = listOf("" to tr("cost_payer_none")) + state.people.map { it.id to it.name },
                                onChange = { form = current.copy(paidByUserId = it) },
                            )
                            ChoiceField(
                                label = tr("cost_asset"),
                                value = current.assetId,
                                options = listOf("" to tr("cost_no_asset")) + state.assets.pairs(),
                                onChange = { form = current.copy(assetId = it) },
                            )
                            ChoiceField(
                                label = tr("cost_room"),
                                value = current.roomId,
                                options = listOf("" to tr("cost_no_room")) + state.rooms.pairs(),
                                onChange = { form = current.copy(roomId = it) },
                            )
                            ChoiceField(
                                label = tr("cost_split"),
                                value = current.splitMode,
                                options = state.splitModes.pairs(),
                                onChange = { form = store.withSplitMode(current, it) },
                            )
                            if (view.splitHint.isNotEmpty()) {
                                Text(
                                    view.splitHint,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            if (view.showParticipants) {
                                state.people.forEach { person ->
                                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                        Checkbox(
                                            checked = person.id in current.participants,
                                            onCheckedChange = { form = store.toggleParticipant(current, person.id) },
                                        )
                                        Text(person.name)
                                    }
                                }
                                errors["participantIds"]?.let { InlineError(it) }
                            }
                            if (view.showShares) {
                                state.people.forEach { person ->
                                    TextField(
                                        label = tr("cost_shares_person", "name" to person.name),
                                        value = current.shares[person.id].orEmpty(),
                                        onChange = { form = store.withShare(current, person.id, it) },
                                        keyboardType = KeyboardType.Decimal,
                                    )
                                }
                                TextButton(
                                    onClick = { form = store.equalizeShares(current) },
                                ) { Text(tr("cost_shares_equalize"), maxLines = 1) }
                                view.sharesStatus?.let {
                                    Text(
                                        it,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = shareStatusColor(view.sharesOk),
                                    )
                                }
                                errors["shares"]?.let { InlineError(it) }
                            }
                            view.preview.forEach { line ->
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(line.name + " · " + line.percent, style = MaterialTheme.typography.bodyMedium)
                                    Text(line.amount, style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                            SwitchField(
                                label = tr("cost_counts_as_expense"),
                                hint = tr("cost_counts_as_expense_hint"),
                                checked = current.countsAsExpense,
                                onChange = { form = store.withCounts(current, it) },
                            )
                            if (view.taxClassApplies) {
                                ChoiceField(
                                    label = tr("cost_deductible"),
                                    value = current.deductible,
                                    options = state.deductibles.pairs(),
                                    onChange = { form = current.copy(deductible = it) },
                                )
                            }
                            if (state.tags.isNotEmpty()) {
                                Text(tr("costtag_picker_label"), style = MaterialTheme.typography.labelLarge)
                                MultiChips(
                                    options = state.tags.map { CostOption(it.id, it.name) },
                                    selected = current.tagIds,
                                    onToggle = { form = store.toggleTag(current, it) },
                                )
                            }
                            TextField(
                                label = tr("cost_notes"),
                                value = current.notes,
                                onChange = { form = current.copy(notes = it) },
                                singleLine = false,
                                minLines = 2,
                                capitalization = KeyboardCapitalization.Sentences,
                            )
                        }
                    }
                    state.error?.let { InlineError(it) }
                }
            }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}

private fun List<CostOption>.pairs(): List<Pair<String, String>> = map { it.value to it.label }

@Composable
private fun shareStatusColor(ok: Boolean) = if (ok) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error
