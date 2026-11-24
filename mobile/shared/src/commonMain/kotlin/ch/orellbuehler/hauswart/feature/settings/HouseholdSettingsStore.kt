package ch.orellbuehler.hauswart.feature.settings

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.i18n.tr

data class HouseholdInfoRow(
    val label: String,
    val value: String,
)

data class HouseholdSettingsState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val rows: List<HouseholdInfoRow> = emptyList(),
    /** Hosts members may connect, shown to administrators only. */
    val allowedHosts: List<String> = emptyList(),
    /** Changing them needs the administrator scope that a device token never has. */
    val readOnlyNote: String = tr("household_description_readonly"),
    val browserUrl: String = "",
)

/** The household's name, time zone, currency and reminders, read-only on the phone. */
class HouseholdSettingsStore(
    private val app: HauswartApp,
) : Store<HouseholdSettingsState>(HouseholdSettingsState(browserUrl = browserUrl(app.session.serverUrl ?: "", "settings/household"))) {
    init {
        load()
    }

    fun refresh() {
        load()
    }

    private fun load() {
        update { it.copy(loading = it.rows.isEmpty(), error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val household = app.api.household.householdGet()
            val settings = household.settings
            val rows =
                listOf(
                    HouseholdInfoRow(tr("household_name"), household.name),
                    HouseholdInfoRow(tr("household_handover"), household.handoverDate?.let { Dates.format(it) } ?: "–"),
                    HouseholdInfoRow(tr("household_due_soon"), settings.dueSoonDays.toString()),
                    HouseholdInfoRow(tr("household_digest"), settings.digestTime),
                    HouseholdInfoRow(tr("household_timezone"), household.timezone),
                    HouseholdInfoRow(tr("household_currency"), household.currency),
                )
            update {
                it.copy(
                    loading = false,
                    rows = rows,
                    allowedHosts = settings.integrationHostAllowlist.orEmpty(),
                    readOnlyNote = tr("household_description_readonly"),
                )
            }
        }
    }
}
