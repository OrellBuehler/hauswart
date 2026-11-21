package ch.orellbuehler.hauswart.android.ui.recurring

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
import ch.orellbuehler.hauswart.android.ui.costs.FormSection
import ch.orellbuehler.hauswart.android.ui.costs.MultiChips
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.costs.CostOption
import ch.orellbuehler.hauswart.feature.recurring.RecurringEditStore
import ch.orellbuehler.hauswart.i18n.tr

/** Sets up a recurring cost when [id] is null, else changes it. [book] starts a new one in that book. */
@Composable
fun RecurringEditScreen(
    nav: NavController,
    id: String?,
    book: String?,
) {
    val store = rememberStore(key = id ?: "new") { RecurringEditStore(it, id, book) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }

    LaunchedEffect(state.savedId) {
        val saved = state.savedId ?: return@LaunchedEffect
        nav.popBackStack()
        if (id == null) nav.navigate(Routes.recurring(saved))
    }

    AppScaffold(
        title = tr(if (state.isNew) "recurrence_new_title" else "recurrence_edit_title"),
        onBack = { nav.popBackStack() },
        bottomBar = { if (form != null) SaveBar(onSave = { form?.let(store::save) }, pending = state.saving) },
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
                    FormSection(tr("recurrence_form_template")) {
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
                            hint = tr("recurrence_title_placeholder"),
                            capitalization = KeyboardCapitalization.Sentences,
                        )
                        SwitchField(
                            label = tr("cost_kind_refund"),
                            hint = tr("cost_kind_refund_hint"),
                            checked = current.refund,
                            onChange = { form = current.copy(refund = it) },
                        )
                        MoneyField(
                            label = tr("cost_amount"),
                            value = current.amount,
                            onChange = { form = current.copy(amount = it) },
                            currency = current.currency,
                            error = errors["amountMinor"],
                        )
                        TextField(
                            label = tr("cost_currency"),
                            value = current.currency,
                            onChange = { form = store.withCurrency(current, it) },
                            error = errors["currency"],
                            capitalization = KeyboardCapitalization.Characters,
                        )
                        ChoiceField(
                            label = tr("cost_category"),
                            value = current.category,
                            options = state.categories.pairs(),
                            onChange = { form = store.withCategory(current, it) },
                            error = errors["category"],
                        )
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
                            error = errors["notes"],
                            singleLine = false,
                            minLines = 2,
                            capitalization = KeyboardCapitalization.Sentences,
                        )
                    }
                    FormSection(tr("recurrence_form_rule")) {
                        ChoiceField(
                            label = tr("recurrence_frequency"),
                            value = current.frequency,
                            options = state.frequencies.pairs(),
                            onChange = { form = current.copy(frequency = it) },
                        )
                        TextField(
                            label = tr("recurrence_interval") + " (" + view.intervalUnit + ")",
                            value = current.interval,
                            onChange = { form = store.withInterval(current, it) },
                            error = errors["interval"],
                            keyboardType = KeyboardType.Number,
                        )
                        TextField(
                            label = tr("recurrence_day"),
                            value = current.dayOfMonth,
                            onChange = { form = store.withDay(current, it) },
                            error = errors["dayOfMonth"],
                            hint = tr("recurrence_day_hint"),
                            keyboardType = KeyboardType.Number,
                        )
                        DateField(
                            label = tr("recurrence_start"),
                            value = current.startDate,
                            onChange = { form = store.withStartDate(current, it) },
                            error = errors["startDate"],
                            clearable = false,
                        )
                        DateField(
                            label = tr("recurrence_end"),
                            value = current.endDate,
                            onChange = { form = current.copy(endDate = it) },
                            error = errors["endDate"],
                        )
                        Text(tr("recurrence_preview_title"), style = MaterialTheme.typography.labelLarge)
                        Text(view.ruleText ?: view.previewInvalid, style = MaterialTheme.typography.bodyMedium)
                        view.clampNote?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        view.immediateWarning?.let {
                            Text(
                                it,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                        view.upcoming.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
                        view.ruleHint?.let {
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
                        TextField(
                            label = tr("cost_payee"),
                            value = current.payee,
                            onChange = { form = current.copy(payee = it) },
                            error = errors["payee"],
                            capitalization = KeyboardCapitalization.Words,
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
                                Row(
                                    Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
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
                                error = errors["deductible"],
                            )
                        }
                    }
                    FormSection(tr("cost_form_links")) {
                        ChoiceField(
                            label = tr("cost_asset"),
                            value = current.assetId,
                            options = listOf("" to tr("cost_no_asset")) + state.assets.pairs(),
                            onChange = { form = current.copy(assetId = it) },
                            error = errors["assetId"],
                        )
                        ChoiceField(
                            label = tr("cost_room"),
                            value = current.roomId,
                            options = listOf("" to tr("cost_no_room")) + state.rooms.pairs(),
                            onChange = { form = current.copy(roomId = it) },
                            error = errors["roomId"],
                        )
                    }
                    state.error?.let { InlineError(it.message) }
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
