package ch.orellbuehler.hauswart.android.ui.defects

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
import ch.orellbuehler.hauswart.android.ui.components.DateField
import ch.orellbuehler.hauswart.android.ui.components.ErrorBox
import ch.orellbuehler.hauswart.android.ui.components.InlineError
import ch.orellbuehler.hauswart.android.ui.components.LoadingBox
import ch.orellbuehler.hauswart.android.ui.components.SaveBar
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.defects.DEADLINE_MODE_MANUAL
import ch.orellbuehler.hauswart.feature.defects.DefectEditStore
import ch.orellbuehler.hauswart.i18n.tr

/** Records a defect when [id] is null, else edits it; [assetId] and [roomId] preset a new one. */
@Composable
fun DefectEditScreen(
    nav: NavController,
    id: String?,
    assetId: String?,
    roomId: String?,
) {
    val store = rememberStore(key = id ?: "new") { DefectEditStore(it, id, assetId, roomId) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }

    LaunchedEffect(state.savedId) {
        val saved = state.savedId ?: return@LaunchedEffect
        if (id == null) {
            nav.navigate(Routes.defect(saved)) { popUpTo(Routes.DEFECTS) }
        } else {
            nav.popBackStack()
        }
    }

    AppScaffold(
        title = if (state.isNew) tr("defect_new") else tr("defect_edit_title", "number" to state.number),
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
                        label = tr("defect_title"),
                        value = current.title,
                        onChange = { form = current.copy(title = it) },
                        error = state.fieldErrors["title"],
                        capitalization = KeyboardCapitalization.Sentences,
                    )
                    TextField(
                        label = tr("defect_description"),
                        value = current.description,
                        onChange = { form = current.copy(description = it) },
                        error = state.fieldErrors["descriptionMd"],
                        singleLine = false,
                        minLines = 3,
                        capitalization = KeyboardCapitalization.Sentences,
                    )
                    ChoiceField(
                        label = tr("defect_severity"),
                        value = current.severity,
                        options = state.severities.pairs(),
                        onChange = { form = current.copy(severity = it) },
                        error = state.fieldErrors["severity"],
                    )
                    ChoiceField(
                        label = tr("defect_room"),
                        value = current.roomId,
                        options = state.rooms.pairs(),
                        onChange = { form = current.copy(roomId = it) },
                        error = state.fieldErrors["roomId"],
                    )
                    ChoiceField(
                        label = tr("defect_asset"),
                        value = current.assetId,
                        options = state.assets.pairs(),
                        onChange = { form = store.withAsset(current, it) },
                        error = state.fieldErrors["assetId"],
                    )
                    TextField(
                        label = tr("defect_location_detail"),
                        value = current.locationDetail,
                        onChange = { form = current.copy(locationDetail = it) },
                        error = state.fieldErrors["locationDetail"],
                        hint = tr("defect_location_detail_placeholder"),
                    )
                    DateField(
                        label = tr("defect_discovered_on"),
                        value = current.discoveredOn,
                        onChange = { form = current.copy(discoveredOn = it) },
                        error = state.fieldErrors["discoveredOn"],
                        clearable = false,
                    )
                    ChoiceField(
                        label = tr("defect_responsible"),
                        value = current.contactId,
                        options = state.contacts.pairs(),
                        onChange = { form = current.copy(contactId = it) },
                        error = state.fieldErrors["responsibleContactId"],
                    )
                    if (state.noContacts) {
                        Text(
                            tr("defect_responsible_empty"),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    ChoiceField(
                        label = tr("defect_deadline"),
                        value = current.deadlineMode,
                        options = state.deadlineModes.pairs(),
                        onChange = { form = current.copy(deadlineMode = it) },
                    )
                    if (current.deadlineMode == DEADLINE_MODE_MANUAL) {
                        DateField(
                            label = tr("defect_deadline_date"),
                            value = current.deadlineDate,
                            onChange = { form = current.copy(deadlineDate = it) },
                            error = state.fieldErrors["deadlineDate"],
                            clearable = false,
                        )
                    }
                    store.deadlineHints(current).forEach {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    state.error?.let { InlineError(it.message) }
                }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}
