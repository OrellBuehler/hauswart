package ch.orellbuehler.hauswart.android.ui.insurance

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
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
import ch.orellbuehler.hauswart.android.ui.components.SectionCard
import ch.orellbuehler.hauswart.android.ui.components.SwitchField
import ch.orellbuehler.hauswart.android.ui.components.TextField
import ch.orellbuehler.hauswart.android.ui.components.toneColor
import ch.orellbuehler.hauswart.android.ui.docs.ChoicePicker
import ch.orellbuehler.hauswart.android.ui.docs.MultiChoicePicker
import ch.orellbuehler.hauswart.android.ui.docs.PickOption
import ch.orellbuehler.hauswart.android.ui.nav.Routes
import ch.orellbuehler.hauswart.android.ui.rememberStore
import ch.orellbuehler.hauswart.feature.insurance.INSURANCE_PERIODS
import ch.orellbuehler.hauswart.feature.insurance.INSURANCE_RENEWALS
import ch.orellbuehler.hauswart.feature.insurance.INSURANCE_TYPES
import ch.orellbuehler.hauswart.feature.insurance.InsuranceEditStore
import ch.orellbuehler.hauswart.feature.insurance.insurancePeriodLabel
import ch.orellbuehler.hauswart.feature.insurance.insuranceRenewalLabel
import ch.orellbuehler.hauswart.feature.insurance.insuranceTypeLabel
import ch.orellbuehler.hauswart.i18n.tr

/** Creates a policy when [id] is null, else edits it. */
@Composable
fun InsuranceEditScreen(
    nav: NavController,
    id: String?,
    assetId: String,
    type: String,
) {
    val store = rememberStore(key = id ?: "new") { InsuranceEditStore(it, id, assetId, type) }
    val state = store.collect()
    val initial = state.initial
    val loadError = state.loadError
    var form by remember(initial) { mutableStateOf(initial) }

    LaunchedEffect(state.savedId) {
        val saved = state.savedId ?: return@LaunchedEffect
        if (id == null) {
            nav.navigate(Routes.insurance(saved)) { popUpTo(nav.currentBackStackEntry?.destination?.id ?: 0) { inclusive = true } }
        } else {
            nav.popBackStack()
        }
    }

    AppScaffold(
        title = tr(if (state.isNew) "insurance_new" else "insurance_edit_title"),
        onBack = { nav.popBackStack() },
        bottomBar = { if (form != null) SaveBar(onSave = { form?.let(store::save) }, pending = state.saving) },
    ) { padding ->
        val current = form
        when {
            current != null -> {
                val preview = store.preview(current)
                val errors = state.fieldErrors
                Column(
                    Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(ScreenPadding),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    SectionCard(title = tr("insurance_form_basics")) {
                        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            TextField(
                                label = tr("insurance_title_label"),
                                value = current.title,
                                onChange = { form = current.copy(title = it) },
                                error = errors["title"],
                                hint = tr("insurance_title_placeholder"),
                                capitalization = KeyboardCapitalization.Sentences,
                            )
                            ChoiceField(
                                label = tr("insurance_type_label"),
                                value = current.type,
                                options = INSURANCE_TYPES.map { it to insuranceTypeLabel(it) },
                                onChange = { form = current.copy(type = it) },
                                error = errors["type"],
                            )
                            TextField(
                                label = tr("insurance_policy_number_label"),
                                value = current.policyNumber,
                                onChange = { form = current.copy(policyNumber = it) },
                                error = errors["policyNumber"],
                            )
                            ChoicePicker(
                                label = tr("insurance_insurer_label"),
                                value = current.insurerContactId,
                                options = state.contacts.map { PickOption(it.id, it.label, it.detail) },
                                noneLabel = tr("m_insurance_insurer_none"),
                                onChange = { form = current.copy(insurerContactId = it) },
                                error = errors["insurerContactId"],
                            )
                            Text(
                                tr("insurance_insurer_hint"),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    SectionCard(title = tr("insurance_form_cover")) {
                        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                tr("insurance_assets_hint"),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            MultiChoicePicker(
                                label = tr("insurance_assets_label"),
                                values = current.assetIds,
                                options = state.assets.map { PickOption(it.id, it.label, it.detail) },
                                emptyText = tr("insurance_assets_none"),
                                onChange = { form = current.copy(assetIds = it) },
                                error = errors["assetIds"],
                            )
                        }
                    }
                    SectionCard(title = tr("insurance_form_premium")) {
                        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            MoneyField(
                                label = tr("insurance_premium_label"),
                                value = current.premium,
                                onChange = { form = current.copy(premium = it) },
                                currency = current.currency,
                                error = errors["premiumMinor"],
                            )
                            TextField(
                                label = tr("insurance_currency_label"),
                                value = current.currency,
                                onChange = { form = current.copy(currency = it.uppercase().filter { c -> c in 'A'..'Z' }.take(3)) },
                                error = errors["currency"],
                                hint = preview.otherCurrency.ifEmpty { null },
                                capitalization = KeyboardCapitalization.Characters,
                            )
                            ChoiceField(
                                label = tr("insurance_period_label"),
                                value = current.premiumPeriod,
                                options = INSURANCE_PERIODS.map { it to insurancePeriodLabel(it) },
                                onChange = { form = current.copy(premiumPeriod = it) },
                                error = errors["premiumPeriod"],
                            )
                            if (preview.annual.isNotEmpty()) Text(preview.annual, style = MaterialTheme.typography.bodyMedium)
                            MoneyField(
                                label = tr("insurance_deductible_label"),
                                value = current.deductible,
                                onChange = { form = current.copy(deductible = it) },
                                currency = current.currency,
                                error = errors["deductibleMinor"],
                            )
                        }
                    }
                    SectionCard(title = tr("insurance_form_term")) {
                        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            DateField(
                                label = tr("insurance_start_label"),
                                value = current.startDate,
                                onChange = { form = current.copy(startDate = it) },
                                error = errors["startDate"],
                                clearable = false,
                            )
                            DateField(
                                label = tr("insurance_end_label"),
                                value = current.endDate,
                                onChange = { form = current.copy(endDate = it) },
                                error = errors["endDate"],
                            )
                            Text(
                                tr("insurance_end_label_hint"),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                INSURANCE_RENEWALS.forEach { renewal ->
                                    FilterChip(
                                        selected = current.renewal == renewal,
                                        onClick = { form = current.copy(renewal = renewal) },
                                        label = { Text(insuranceRenewalLabel(renewal), maxLines = 1) },
                                    )
                                }
                            }
                            Text(
                                tr("insurance_renewal_hint"),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (current.renewal == "auto") {
                                TextField(
                                    label = tr("insurance_notice_label"),
                                    value = current.noticeMonths,
                                    onChange = { form = current.copy(noticeMonths = it.filter { c -> c.isDigit() }.take(3)) },
                                    error = errors["cancellationNoticeMonths"],
                                    hint = tr("insurance_notice_hint"),
                                    keyboardType = KeyboardType.Number,
                                )
                            }
                            Text(tr("insurance_deadline_preview_title"), style = MaterialTheme.typography.labelMedium)
                            Text(preview.deadline, color = toneColor(preview.deadlineTone))
                            if (preview.reminder.isNotEmpty()) {
                                Text(
                                    preview.reminder,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    SectionCard(title = tr("insurance_form_help")) {
                        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            TextField(
                                label = tr("insurance_assistance_label"),
                                value = current.assistancePhone,
                                onChange = { form = current.copy(assistancePhone = it) },
                                error = errors["assistancePhone"],
                                hint = tr("insurance_assistance_hint"),
                                keyboardType = KeyboardType.Phone,
                            )
                            SwitchField(
                                label = tr("insurance_emergency_label"),
                                hint = tr("insurance_emergency_hint"),
                                checked = current.showOnEmergency,
                                onChange = { form = current.copy(showOnEmergency = it) },
                            )
                        }
                    }
                    SectionCard(title = tr("insurance_form_more")) {
                        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextField(
                                label = tr("insurance_notes_label"),
                                value = current.notes,
                                onChange = { form = current.copy(notes = it) },
                                error = errors["notes"],
                                singleLine = false,
                                minLines = 4,
                                capitalization = KeyboardCapitalization.Sentences,
                            )
                            if (state.isNew) {
                                Text(
                                    tr("insurance_files_after_create"),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
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
