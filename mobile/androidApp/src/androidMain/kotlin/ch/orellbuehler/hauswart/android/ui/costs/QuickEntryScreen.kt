package ch.orellbuehler.hauswart.android.ui.costs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.DateField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.PrimaryButton
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.costs.CostOption
import ch.orellbuehler.hauswart.feature.costs.QuickEntryStore
import ch.orellbuehler.hauswart.feature.costs.QuickForm
import ch.orellbuehler.hauswart.feature.costs.bookOfArg
import ch.orellbuehler.hauswart.i18n.tr

/** The fast entry: the amount, what it was for, who paid and who it is for. [bookArg] is a book id or `all`. */
@Composable
fun QuickEntryScreen(
    nav: NavController,
    bookArg: String?,
) {
    val store = rememberStore(key = bookArg ?: "") { QuickEntryStore(it, bookOfArg(bookArg)?.ifEmpty { null }) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }
    var expanded by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }

    LaunchedEffect(state.savedId) { if (state.savedId != null) nav.popBackStack() }
    LaunchedEffect(initial) { if (initial != null) focus.requestFocus() }

    AppScaffold(
        title = tr("quick_title"),
        onBack = { nav.popBackStack() },
        bottomBar = {
            val current = form
            if (current != null) {
                Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
                    PrimaryButton(
                        text = store.view(current, expanded).saveLabel,
                        pendingText = tr("quick_saving"),
                        onClick = { store.save(current) },
                        pending = state.saving,
                        modifier = Modifier.padding(horizontal = ScreenPadding, vertical = 12.dp),
                    )
                }
            }
        },
    ) { padding ->
        val current = form
        when {
            current != null -> {
                val view = store.view(current, expanded)
                Column(
                    Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    OutlinedTextField(
                        value = current.amount,
                        onValueChange = { form = current.copy(amount = it) },
                        modifier = Modifier.fillMaxWidth().focusRequester(focus),
                        label = { Text(tr("cost_amount"), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        isError = state.fieldErrors["amountMinor"] != null,
                        supportingText = state.fieldErrors["amountMinor"]?.let { message -> { Text(message) } },
                        singleLine = true,
                        textStyle = MaterialTheme.typography.headlineSmall,
                        suffix = { Text(state.currency) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Next),
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Label(tr("cost_category"))
                        SingleChips(view.categoryChips, current.category, { form = current.copy(category = it) })
                        if (view.canExpand) TextButton(onClick = { expanded = !expanded }) { Text(view.expandLabel, maxLines = 1) }
                        state.fieldErrors["category"]?.let { InlineError(it) }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Label(tr("cost_paid_by"))
                        SingleChips(state.payers, current.paidByUserId, { form = current.copy(paidByUserId = it) })
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Label(tr("cost_for_whom"))
                        MultiChips(
                            options = state.people.map { CostOption(it.id, it.name) },
                            selected = current.participants,
                            onToggle = { form = store.toggleParticipant(current, it) },
                            extra = {
                                FilterChip(
                                    selected = view.notSharedOn,
                                    onClick = { form = store.chooseNotShared(current) },
                                    label = { Text(tr("quick_split_not_shared"), maxLines = 1) },
                                )
                            },
                        )
                        Text(
                            view.splitText,
                            style = MaterialTheme.typography.bodySmall,
                            color = if (view.unchosen) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        state.fieldErrors["participants"]?.let { InlineError(it) }
                    }
                    if (view.bookChips.isNotEmpty()) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Label(tr("cost_book"))
                            SingleChips(view.bookChips, current.bookId, { form = store.withBook(current, it) })
                        }
                    }
                    TextButton(onClick = { more = !more }) { Text(tr("quick_more"), maxLines = 1) }
                    if (more) {
                        DateField(
                            label = tr("cost_date"),
                            value = current.date,
                            onChange = { form = current.copy(date = it) },
                            error = state.fieldErrors["date"],
                            clearable = false,
                        )
                        TextField(
                            label = tr("cost_payee"),
                            value = current.payee,
                            onChange = { form = current.copy(payee = it) },
                            error = state.fieldErrors["payee"],
                            capitalization = KeyboardCapitalization.Words,
                        )
                        TextField(
                            label = tr("cost_title"),
                            value = current.title,
                            onChange = { form = current.copy(title = it) },
                            error = state.fieldErrors["title"],
                            hint = tr("quick_title_hint"),
                            capitalization = KeyboardCapitalization.Sentences,
                        )
                    }
                    TextButton(onClick = { nav.navigate(Routes.costNew(bookOf(current))) }) {
                        Text(tr("quick_full_form"), maxLines = 1)
                    }
                    state.error?.let { InlineError(it.message) }
                }
            }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}

private fun bookOf(form: QuickForm): String? = form.bookId.ifEmpty { null }

@Composable
private fun Label(text: String) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
