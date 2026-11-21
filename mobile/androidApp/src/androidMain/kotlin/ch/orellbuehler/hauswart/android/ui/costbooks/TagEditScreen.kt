package ch.orellbuehler.hauswart.android.ui.costbooks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import ch.orellbuehler.hauswart.android.ui.collect
import ch.orellbuehler.hauswart.android.ui.components.AppScaffold
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.SaveBar
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.costs.SingleChips
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.costbooks.TagEditStore
import ch.orellbuehler.hauswart.i18n.tr

/** Makes a cost tag when [id] is null, else renames and recolours it. */
@Composable
fun TagEditScreen(
    nav: NavController,
    id: String?,
) {
    val store = rememberStore(key = "tag-" + (id ?: "new")) { TagEditStore(it, id) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }

    LaunchedEffect(state.savedId) { if (state.savedId != null) nav.popBackStack() }

    AppScaffold(
        title = tr(if (state.isNew) "costtag_create_title" else "costtag_edit_title"),
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
                    TextField(
                        label = tr("costtag_name"),
                        value = current.name,
                        onChange = { form = current.copy(name = it) },
                        error = state.fieldErrors["name"],
                        hint = tr("costtag_name_placeholder"),
                        capitalization = KeyboardCapitalization.Words,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(tr("costtag_color"))
                        TagDot(current.color)
                    }
                    SingleChips(options = state.colors, selected = current.color, onSelect = { form = current.copy(color = it) })
                    state.error?.let { InlineError(it.message) }
                }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}
