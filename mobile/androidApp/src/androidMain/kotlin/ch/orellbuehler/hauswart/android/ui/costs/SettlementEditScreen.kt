package ch.orellbuehler.hauswart.android.ui.costs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.SwapVert
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
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
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.costs.SettlementEditStore
import ch.orellbuehler.hauswart.i18n.tr

/**
 * Records a payment between two people ([id] null) or edits one. A suggested payment arrives as [from], [to] and
 * [amount]; [bookArg] is a book id or `all`.
 */
@Composable
fun SettlementEditScreen(
    nav: NavController,
    id: String?,
    from: String?,
    to: String?,
    amount: String?,
    bookArg: String?,
) {
    val store = rememberStore(key = (id ?: "new") + from + to) { SettlementEditStore(it, id, from, to, amount, bookArg) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }

    LaunchedEffect(state.savedId) { if (state.savedId != null) nav.popBackStack() }

    AppScaffold(
        title = tr(if (state.isNew) "settlement_create_title" else "settlement_edit_title"),
        onBack = { nav.popBackStack() },
        bottomBar = { if (form != null) SaveBar(onSave = { form?.let(store::save) }, pending = state.saving) },
    ) { padding ->
        val current = form
        when {
            current != null -> {
                val errors = state.fieldErrors
                Column(
                    Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    ChoiceField(
                        label = tr("settlement_from"),
                        value = current.fromUserId,
                        options = state.people.map { it.value to it.label },
                        onChange = { form = current.copy(fromUserId = it) },
                        error = errors["fromUserId"],
                    )
                    IconButton(onClick = { form = store.swap(current) }) {
                        Icon(Icons.Outlined.SwapVert, contentDescription = tr("settlement_swap"))
                    }
                    ChoiceField(
                        label = tr("settlement_to"),
                        value = current.toUserId,
                        options = state.people.map { it.value to it.label },
                        onChange = { form = current.copy(toUserId = it) },
                        error = errors["toUserId"],
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
                    )
                    DateField(
                        label = tr("cost_date"),
                        value = current.date,
                        onChange = { form = current.copy(date = it) },
                        error = errors["date"],
                        clearable = false,
                    )
                    ChoiceField(
                        label = tr("cost_book"),
                        value = current.bookId,
                        options = state.books.map { it.value to it.label },
                        onChange = { form = current.copy(bookId = it) },
                        error = errors["bookId"],
                    )
                    TextField(
                        label = tr("settlement_note"),
                        value = current.note,
                        onChange = { form = current.copy(note = it) },
                        error = errors["note"],
                        hint = tr("settlement_book_hint"),
                        capitalization = KeyboardCapitalization.Sentences,
                    )
                    state.error?.let { InlineError(it.message) }
                }
            }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}
