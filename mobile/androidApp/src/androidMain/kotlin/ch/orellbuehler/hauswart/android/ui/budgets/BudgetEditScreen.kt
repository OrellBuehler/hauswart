package ch.orellbuehler.hauswart.android.ui.budgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ChoiceField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.MoneyField
import ch.orellbuehler.hauswart.android.ui.components.SaveBar
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.budgets.BudgetEditStore
import ch.orellbuehler.hauswart.i18n.tr

/** Makes a budget when [id] is null, else changes it. */
@Composable
fun BudgetEditScreen(
    nav: NavController,
    id: String?,
    period: String?,
) {
    val store = rememberStore(key = id ?: "new") { BudgetEditStore(it, id, period) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }

    LaunchedEffect(state.savedId) { if (state.savedId != null) nav.popBackStack() }

    AppScaffold(
        title = tr(if (state.isNew) "budget_create_title" else "budget_edit_title"),
        onBack = { nav.popBackStack() },
        bottomBar = { if (form != null) SaveBar(onSave = { form?.let(store::save) }, pending = state.saving) },
    ) { padding ->
        val current = form
        when {
            current != null ->
                Column(
                    Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    ChoiceField(
                        label = tr("budget_book"),
                        value = current.bookId,
                        options = state.books.map { it.value to it.label },
                        onChange = { form = current.copy(bookId = it) },
                        error = state.fieldErrors["bookId"],
                    )
                    ChoiceField(
                        label = tr("budget_category"),
                        value = current.category,
                        options = state.categories.map { it.value to it.label },
                        onChange = { form = current.copy(category = it) },
                        error = state.fieldErrors["category"],
                    )
                    ChoiceField(
                        label = tr("budget_period"),
                        value = current.period,
                        options = state.periods.map { it.value to it.label },
                        onChange = { form = current.copy(period = it) },
                        error = state.fieldErrors["period"],
                    )
                    MoneyField(
                        label = tr("budget_amount"),
                        value = current.amount,
                        onChange = { form = current.copy(amount = it) },
                        currency = state.currency,
                        error = state.fieldErrors["amountMinor"],
                    )
                    if (!state.isNew) {
                        SwitchField(
                            label = tr("budget_active"),
                            hint = tr("budget_active_hint"),
                            checked = current.active,
                            onChange = { form = current.copy(active = it) },
                        )
                    }
                    state.error?.let { InlineError(it.message) }
                }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}
