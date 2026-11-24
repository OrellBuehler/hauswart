package ch.orellbuehler.hauswart.android.ui.costbooks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.SaveBar
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.costbooks.BookEditStore
import ch.orellbuehler.hauswart.i18n.tr

/** Makes a cost book when [id] is null, else changes it. */
@Composable
fun BookEditScreen(
    nav: NavController,
    id: String?,
) {
    val store = rememberStore(key = "book-" + (id ?: "new")) { BookEditStore(it, id) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }

    LaunchedEffect(state.savedId) { if (state.savedId != null) nav.popBackStack() }

    AppScaffold(
        title = tr(if (state.isNew) "costbook_create_title" else "costbook_edit_title"),
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
                    Text(
                        tr(if (state.isNew) "costbook_create_description" else "costbook_edit_description"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    TextField(
                        label = tr("costbook_name"),
                        value = current.name,
                        onChange = { form = current.copy(name = it) },
                        error = state.fieldErrors["name"],
                        hint = tr("costbook_name_placeholder"),
                        capitalization = KeyboardCapitalization.Words,
                    )
                    ChoiceField(
                        label = tr("costbook_icon"),
                        value = current.icon,
                        options = listOf("" to tr("m_costbooks_icon_none")) + state.icons.map { it.value to it.label },
                        onChange = { form = current.copy(icon = it) },
                    )
                    ChoiceField(
                        label = tr("costbook_default_split"),
                        value = current.defaultSplitMode,
                        options = state.splits.map { it.value to it.label },
                        onChange = { form = current.copy(defaultSplitMode = it) },
                    )
                    Text(
                        store.splitHint(current.defaultSplitMode),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    SwitchField(
                        label = tr("costbook_tax_relevant"),
                        hint = tr("costbook_tax_relevant_hint"),
                        checked = current.taxRelevant,
                        onChange = { form = current.copy(taxRelevant = it) },
                    )
                    state.error?.let { InlineError(it.message) }
                }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}
