package ch.orellbuehler.hauswart.android.ui.costs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
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
import ch.orellbuehler.hauswart.android.ui.components.DateField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.MoneyField
import ch.orellbuehler.hauswart.android.ui.components.SaveBar
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.costs.CostEditStore
import ch.orellbuehler.hauswart.feature.costs.CostOption
import ch.orellbuehler.hauswart.feature.costs.bookOfArg
import ch.orellbuehler.hauswart.i18n.tr

/** Books an entry ([id] null) or edits one. [bookArg] is a book id or `all`; [assetId] ties a new entry to a device. */
@Composable
fun CostEditScreen(
    nav: NavController,
    id: String?,
    bookArg: String?,
    assetId: String?,
) {
    val store = rememberStore(key = id ?: "new") { CostEditStore(it, id, bookOfArg(bookArg)?.ifEmpty { null }, assetId) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }

    LaunchedEffect(state.savedId) { if (state.savedId != null) nav.popBackStack() }

    AppScaffold(
        title = tr(if (state.isNew) "cost_new" else "cost_edit_title"),
        onBack = { nav.popBackStack() },
        bottomBar = { if (form != null) SaveBar(onSave = { form?.let(store::save) }, pending = state.saving) },
    ) { padding ->
        val current = form
        when {
            current != null -> {
                val view = store.view(current)
                val errors = state.fieldErrors
                Column(
                    Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    FormSection(tr("cost_form_basics")) {
                        if (state.books.size > 1) {
                            ChoiceField(
                                label = tr("cost_book"),
                                value = current.bookId,
                                options = state.books.map { it.id to it.name },
                                onChange = { form = store.withBook(current, it) },
                                error = errors["bookId"],
                            )
                        }
                        TextField(
                            label = tr("cost_title"),
                            value = current.title,
                            onChange = { form = current.copy(title = it) },
                            error = errors["title"],
                            capitalization = KeyboardCapitalization.Sentences,
                        )
                        MoneyField(
                            label = tr("cost_amount"),
                            value = current.amount,
                            onChange = { form = current.copy(amount = it) },
                            currency = current.currency,
                            error = errors["amountMinor"],
                            enabled = !state.fuelOwned,
                        )
                        SwitchField(
                            label = tr("cost_kind_refund"),
                            hint = tr("cost_kind_refund_hint"),
                            checked = current.refund,
                            onChange = { form = current.copy(refund = it) },
                            enabled = !state.fuelOwned,
                        )
                        TextField(
                            label = tr("cost_currency"),
                            value = current.currency,
                            onChange = { form = store.withCurrency(current, it) },
                            error = errors["currency"],
                            enabled = !state.fuelOwned,
                        )
                        DateField(
                            label = tr("cost_date"),
                            value = current.date,
                            onChange = { form = current.copy(date = it) },
                            error = errors["date"],
                            clearable = false,
                            enabled = !state.fuelOwned,
                        )
                        ChoiceField(
                            label = tr("cost_category"),
                            value = current.category,
                            options = state.categories.map { it.value to it.label },
                            onChange = { form = store.withCategory(current, it) },
                            error = errors["category"],
                        )
                        state.fuelNote?.let {
                            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    FormSection(tr("cost_form_payment")) {
                        ChoiceField(
                            label = tr("cost_paid_by"),
                            value = current.paidByUserId,
                            options = listOf("" to tr("cost_payer_none")) + state.people.map { it.id to it.name },
                            onChange = { form = current.copy(paidByUserId = it) },
                            error = errors["paidByUserId"],
                        )
                        if (current.paidByUserId.isEmpty()) {
                            Text(
                                tr("cost_payer_missing_hint"),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        ChoiceField(
                            label = tr("cost_split"),
                            value = current.splitMode,
                            options = state.splitModes.map { it.value to it.label },
                            onChange = { form = store.withSplitMode(current, it) },
                            error = errors["splitMode"],
                        )
                        if (view.splitHint.isNotEmpty()) {
                            Text(
                                view.splitHint,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (view.showParticipants) {
                            Text(tr("cost_for_whom"), style = MaterialTheme.typography.labelLarge)
                            state.people.forEach { person ->
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Checkbox(
                                        checked = person.id in current.participants,
                                        onCheckedChange = { form = store.toggleParticipant(current, person.id) },
                                    )
                                    Text(person.name, maxLines = 1)
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
                                val scheme = MaterialTheme.colorScheme
                                val color = if (view.sharesOk) scheme.onSurfaceVariant else scheme.error
                                Text(it, style = MaterialTheme.typography.bodySmall, color = color)
                            }
                            errors["shares"]?.let { InlineError(it) }
                        }
                        view.preview.forEach { line ->
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(line.name + " · " + line.percent, style = MaterialTheme.typography.bodyMedium)
                                Text(line.amount, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                    FormSection(tr("cost_form_links")) {
                        ChoiceField(
                            label = tr("cost_asset"),
                            value = current.assetId,
                            options = listOf("" to tr("cost_no_asset")) + state.assets.map { it.value to it.label },
                            onChange = { form = current.copy(assetId = it) },
                            error = errors["assetId"],
                            enabled = !state.fuelOwned,
                        )
                        TextField(
                            label = tr("cost_payee"),
                            value = current.payee,
                            onChange = { form = current.copy(payee = it) },
                            error = errors["payee"],
                            capitalization = KeyboardCapitalization.Words,
                        )
                        TextField(
                            label = tr("cost_notes"),
                            value = current.notes,
                            onChange = { form = current.copy(notes = it) },
                            error = errors["notes"],
                            singleLine = false,
                            minLines = 3,
                            capitalization = KeyboardCapitalization.Sentences,
                        )
                        if (state.tags.isNotEmpty()) {
                            Text(tr("cost_tags"), style = MaterialTheme.typography.labelLarge)
                            MultiChips(
                                options = state.tags.map { CostOption(it.id, it.name) },
                                selected = current.tagIds,
                                onToggle = { form = store.toggleTag(current, it) },
                            )
                        }
                        SwitchField(
                            label = tr("cost_counts_as_expense"),
                            hint = view.countsHint,
                            checked = current.countsAsExpense,
                            onChange = { form = store.withCounts(current, it) },
                        )
                        if (view.taxClassApplies) {
                            ChoiceField(
                                label = tr("cost_deductible"),
                                value = current.deductible,
                                options = state.deductibles.map { it.value to it.label },
                                onChange = { form = current.copy(deductible = it) },
                                error = errors["deductible"],
                            )
                        }
                    }
                    state.error?.let { InlineError(it.message) }
                }
            }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}
