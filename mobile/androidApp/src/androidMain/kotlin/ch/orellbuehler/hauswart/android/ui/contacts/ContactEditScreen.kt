package ch.orellbuehler.hauswart.android.ui.contacts

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
import ch.orellbuehler.hauswart.android.ui.components.SaveBar
import ch.orellbuehler.hauswart.android.ui.components.ScreenPadding
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.contacts.CONTACT_KINDS
import ch.orellbuehler.hauswart.feature.contacts.ContactEditStore
import ch.orellbuehler.hauswart.feature.contacts.contactKindLabel
import ch.orellbuehler.hauswart.i18n.tr

/** Creates a contact when [id] is null, else edits it. */
@Composable
fun ContactEditScreen(
    nav: NavController,
    id: String?,
) {
    val store = rememberStore(key = id ?: "new") { ContactEditStore(it, id) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }

    LaunchedEffect(state.savedId) { if (state.savedId != null) nav.popBackStack() }

    AppScaffold(
        title = tr(if (state.isNew) "contact_create_title" else "contact_edit_title"),
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
                        label = tr("contact_kind"),
                        value = current.kind,
                        options = CONTACT_KINDS.map { it to contactKindLabel(it) },
                        onChange = { form = current.copy(kind = it) },
                        error = state.fieldErrors["kind"],
                    )
                    TextField(
                        label = tr("contact_name"),
                        value = current.name,
                        onChange = { form = current.copy(name = it) },
                        error = state.fieldErrors["name"],
                        capitalization = KeyboardCapitalization.Words,
                    )
                    TextField(
                        label = tr("contact_company"),
                        value = current.company,
                        onChange = { form = current.copy(company = it) },
                        error = state.fieldErrors["company"],
                        capitalization = KeyboardCapitalization.Words,
                    )
                    TextField(
                        label = tr("contact_phone"),
                        value = current.phone,
                        onChange = { form = current.copy(phone = it) },
                        error = state.fieldErrors["phone"],
                        keyboardType = KeyboardType.Phone,
                    )
                    TextField(
                        label = tr("contact_email"),
                        value = current.email,
                        onChange = { form = current.copy(email = it) },
                        error = state.fieldErrors["email"],
                        keyboardType = KeyboardType.Email,
                    )
                    TextField(
                        label = tr("contact_url"),
                        value = current.url,
                        onChange = { form = current.copy(url = it) },
                        error = state.fieldErrors["url"],
                        hint = tr("contact_url_hint"),
                        keyboardType = KeyboardType.Uri,
                    )
                    TextField(
                        label = tr("contact_address"),
                        value = current.address,
                        onChange = { form = current.copy(address = it) },
                        error = state.fieldErrors["address"],
                        singleLine = false,
                        minLines = 2,
                        capitalization = KeyboardCapitalization.Words,
                    )
                    TextField(
                        label = tr("contact_notes"),
                        value = current.notes,
                        onChange = { form = current.copy(notes = it) },
                        error = state.fieldErrors["notes"],
                        singleLine = false,
                        minLines = 3,
                        capitalization = KeyboardCapitalization.Sentences,
                    )
                    SwitchField(
                        label = tr("contact_emergency"),
                        hint = tr("contact_emergency_hint"),
                        checked = current.emergency,
                        onChange = { form = current.copy(emergency = it) },
                    )
                    SwitchField(
                        label = tr("contact_guest_visible"),
                        hint = tr("contact_guest_visible_hint"),
                        checked = current.guestVisible,
                        onChange = { form = current.copy(guestVisible = it) },
                    )
                    state.error?.let { InlineError(it.message) }
                }
            loadError != null -> ErrorBox(loadError, Modifier.padding(padding), onRetry = store::retry)
            else -> LoadingBox(Modifier.padding(padding))
        }
    }
}
