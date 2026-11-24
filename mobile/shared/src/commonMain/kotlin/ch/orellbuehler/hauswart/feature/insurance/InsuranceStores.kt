package ch.orellbuehler.hauswart.feature.insurance

import ch.orellbuehler.hauswart.HauswartApp
import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.InsurancePoliciesCreateRequest
import ch.orellbuehler.hauswart.api.generated.InsurancePoliciesUpdateRequest
import ch.orellbuehler.hauswart.api.generated.InsurancePolicy
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.core.Money
import ch.orellbuehler.hauswart.core.Store
import ch.orellbuehler.hauswart.core.UiError
import ch.orellbuehler.hauswart.core.fetchAll
import ch.orellbuehler.hauswart.i18n.tr

data class PolicyRowItem(
    val id: String,
    val title: String,
    val type: String,
    /** The type, the insurer and the policy number. */
    val subtitle: String,
    /** "Insured: Washer, Dryer"; empty for none. */
    val covers: String,
    val annual: String,
    val deadline: DeadlineHint?,
    val archived: Boolean,
    val commentCount: Int,
)

data class InsuranceListState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val query: String = "",
    /** The type shown; empty for all. */
    val type: String = "",
    val archived: Boolean = false,
    val rows: List<PolicyRowItem> = emptyList(),
    /** Any policy at all, active or archived. */
    val hasAny: Boolean = false,
    /** Any archived policy: the switch is offered. */
    val hasArchived: Boolean = false,
    /** "CHF 1'234.50 per year"; empty while archived ones are shown. */
    val total: String = "",
    val otherCurrency: String = "",
) {
    val filtered: Boolean get() = query.isNotBlank() || type.isNotEmpty()
}

/** The policies of the household with the yearly total of the active ones. */
class InsuranceListStore(
    private val app: HauswartApp,
) : Store<InsuranceListState>(InsuranceListState()) {
    private var active: List<InsurancePolicy> = emptyList()
    private var archivedPolicies: List<InsurancePolicy> = emptyList()
    private var today = ""
    private var currency = "CHF"
    private var commentCounts: Map<String, Int> = emptyMap()

    init {
        onChange(app, "insurance") { load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun search(query: String) {
        update { it.copy(query = query) }
        show()
    }

    fun setType(type: String) {
        update { it.copy(type = type) }
        show()
    }

    fun setArchived(value: Boolean) {
        update { it.copy(archived = value) }
        show()
    }

    fun resetFilters() {
        update { it.copy(query = "", type = "") }
        show()
    }

    private fun load() {
        update { it.copy(loading = !it.hasAny, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            val household = app.household.get()
            today = app.household.today()
            currency = household.currency
            active =
                fetchAll { cursor ->
                    val page = app.api.insurance.insurancePoliciesList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            archivedPolicies =
                fetchAll { cursor ->
                    val page = app.api.insurance.insurancePoliciesList(cursor = cursor, limit = 200, archived = true)
                    page.items to page.nextCursor
                }
            commentCounts = (active + archivedPolicies).associate { it.id to it.commentCount.toInt() }
            show()
            update { it.copy(loading = false) }
        }
    }

    private fun show() {
        val state = current
        val terms =
            state.query
                .lowercase()
                .split(Regex("\\s+"))
                .filter { it.isNotEmpty() }
        val source = if (state.archived) archivedPolicies else active
        val shown =
            source.filter { p ->
                (state.type.isEmpty() || p.type == state.type) &&
                    (
                        terms.isEmpty() ||
                            listOfNotNull(p.title, p.insurerName, p.policyNumber, *p.assets.map { it.name }.toTypedArray())
                                .joinToString(" ")
                                .lowercase()
                                .let { text -> terms.all { it in text } }
                    )
            }
        var totalMinor = 0L
        var others = 0
        shown.forEach { if (it.currency == currency) totalMinor += it.annualPremiumMinor else others++ }
        update {
            it.copy(
                rows = shown.map { p -> rowOf(p, today) },
                hasAny = active.isNotEmpty() || archivedPolicies.isNotEmpty(),
                hasArchived = archivedPolicies.isNotEmpty(),
                total =
                    if (state.archived ||
                        shown.isEmpty()
                    ) {
                        ""
                    } else {
                        tr("insurance_total_per_year", "amount" to Money.format(totalMinor, currency))
                    },
                otherCurrency = if (state.archived || others == 0) "" else tr("insurance_total_other_currency", "count" to others),
            )
        }
    }
}

internal fun rowOf(
    p: InsurancePolicy,
    today: String,
): PolicyRowItem =
    PolicyRowItem(
        id = p.id,
        title = p.title,
        type = p.type,
        subtitle = listOfNotNull(insuranceTypeLabel(p.type), p.insurerName, p.policyNumber).joinToString(" · "),
        covers = if (p.assets.isEmpty()) "" else tr("insurance_covers", "assets" to p.assets.joinToString(", ") { it.name }),
        annual = Money.format(p.annualPremiumMinor, p.currency),
        deadline = if (p.archivedAt == null) deadlineHint(p.cancellationDeadline, today) else null,
        archived = p.archivedAt != null,
        commentCount = p.commentCount.toInt(),
    )

data class PolicyFact(
    val label: String,
    val value: String,
)

data class PolicyAssetItem(
    val id: String,
    val name: String,
    val kind: String,
)

data class InsuranceDetailState(
    val loading: Boolean = true,
    val error: UiError? = null,
    val loaded: Boolean = false,
    val id: String = "",
    val title: String = "",
    val typeLabel: String = "",
    val archived: Boolean = false,
    val deadline: DeadlineHint? = null,
    /** The term is over: the end date has to be moved. */
    val endedText: String = "",
    val insurerContactId: String = "",
    val insurerName: String = "",
    val facts: List<PolicyFact> = emptyList(),
    val assets: List<PolicyAssetItem> = emptyList(),
    val notes: String = "",
    val assistancePhone: String = "",
    /** The deadline date in full; empty without one. */
    val cancelBy: String = "",
    val reminderTaskId: String = "",
    val busy: Boolean = false,
    val actionError: UiError? = null,
    val notice: String? = null,
    val deleted: Boolean = false,
)

/** One policy: the terms, what it covers, the cancellation deadline and its reminder, archive and delete. */
class InsuranceDetailStore(
    private val app: HauswartApp,
    private val id: String,
) : Store<InsuranceDetailState>(InsuranceDetailState(id = id)) {
    private var policy: InsurancePolicy? = null

    init {
        onChange(app, "insurance") { if (!current.deleted) load() }
        load()
    }

    fun refresh() {
        load()
    }

    fun toggleArchive() {
        val p = policy ?: return
        if (current.busy) return
        val archive = p.archivedAt == null
        update { it.copy(busy = true, actionError = null) }
        launch({ e -> update { it.copy(busy = false, actionError = e) } }) {
            app.api.insurance.insurancePoliciesUpdate(id, InsurancePoliciesUpdateRequest(archived = archive))
            update {
                it.copy(
                    busy = false,
                    notice =
                        tr(
                            if (archive) "insurance_archived_toast" else "insurance_restored_toast",
                            "title" to p.title,
                        ),
                )
            }
            app.changed("insurance", "tasks")
        }
    }

    fun delete() {
        val p = policy ?: return
        if (current.busy) return
        update { it.copy(busy = true, actionError = null) }
        launch({ e -> update { it.copy(busy = false, actionError = e) } }) {
            app.api.insurance.insurancePoliciesDelete(p.id)
            update { it.copy(busy = false, deleted = true) }
            app.changed("insurance", "tasks")
        }
    }

    fun dismissNotice() {
        update { it.copy(notice = null) }
    }

    fun dismissActionError() {
        update { it.copy(actionError = null) }
    }

    private fun load() {
        update { it.copy(loading = !it.loaded, error = null) }
        launch({ e -> update { it.copy(loading = false, error = e) } }) {
            app.household.get()
            val today = app.household.today()
            val p = app.api.insurance.insurancePoliciesGet(id)
            policy = p
            val facts =
                listOf(
                    PolicyFact(tr("insurance_policy_number"), p.policyNumber.orEmpty()),
                    PolicyFact(
                        tr("insurance_premium"),
                        Money.format(p.premiumMinor, p.currency) + " " + insurancePerLabel(p.premiumPeriod),
                    ),
                    PolicyFact(tr("insurance_premium_annual"), Money.format(p.annualPremiumMinor, p.currency)),
                    PolicyFact(tr("insurance_deductible"), p.deductibleMinor?.let { Money.format(it, p.currency) }.orEmpty()),
                    PolicyFact(tr("insurance_start"), Dates.format(p.startDate)),
                    PolicyFact(tr("insurance_end"), p.endDate?.let { Dates.format(it) } ?: tr("insurance_end_open")),
                    PolicyFact(tr("insurance_renewal"), insuranceRenewalLabel(p.renewal)),
                ) +
                    (
                        if (p.renewal == "auto" && p.cancellationNoticeMonths != null) {
                            listOf(PolicyFact(tr("insurance_notice"), tr("insurance_notice_value", "months" to p.cancellationNoticeMonths)))
                        } else {
                            emptyList()
                        }
                    ) +
                    PolicyFact(tr("insurance_emergency"), tr(if (p.showOnEmergency) "common_yes" else "common_no"))
            val archived = p.archivedAt != null
            update {
                it.copy(
                    loading = false,
                    loaded = true,
                    title = p.title,
                    typeLabel = insuranceTypeLabel(p.type),
                    archived = archived,
                    deadline = if (archived) null else deadlineHint(p.cancellationDeadline, today),
                    endedText =
                        if (!archived && termEnded(p.endDate, today)) {
                            tr("insurance_term_ended_body", "date" to Dates.format(p.endDate.orEmpty()))
                        } else {
                            ""
                        },
                    insurerContactId = p.insurerContactId.orEmpty(),
                    insurerName = p.insurerName.orEmpty(),
                    facts = facts,
                    assets = p.assets.map { a -> PolicyAssetItem(a.id, a.name, a.kind) },
                    notes = p.notes.orEmpty(),
                    assistancePhone = p.assistancePhone.orEmpty(),
                    cancelBy = p.cancellationDeadline?.let { d -> Dates.format(d) }.orEmpty(),
                    reminderTaskId = p.reminderTaskId.orEmpty(),
                )
            }
        }
    }
}

/** What the form holds, every field as the person typed it; an id is empty for none. */
data class PolicyForm(
    val title: String,
    val type: String,
    val insurerContactId: String,
    val policyNumber: String,
    /** The premium of one period as typed. */
    val premium: String,
    val currency: String,
    val premiumPeriod: String,
    val deductible: String,
    val startDate: String,
    val endDate: String,
    val renewal: String,
    val noticeMonths: String,
    val assistancePhone: String,
    val showOnEmergency: Boolean,
    val notes: String,
    val assetIds: List<String>,
)

data class PolicyChoice(
    val id: String,
    val label: String,
    val detail: String,
)

/** What a form would give, shown while the person types. */
data class PolicyPreview(
    /** "That is CHF 1'200.00 a year."; empty for an annual premium or no amount. */
    val annual: String,
    /** The cancellation deadline in words (or why there is none). */
    val deadline: String,
    val deadlineTone: String,
    /** The reminder note shown under a coming deadline. */
    val reminder: String,
    /** The currency differs from the household's. */
    val otherCurrency: String,
)

data class InsuranceEditState(
    val isNew: Boolean,
    val loading: Boolean = true,
    val loadError: UiError? = null,
    val initial: PolicyForm? = null,
    val contacts: List<PolicyChoice> = emptyList(),
    val assets: List<PolicyChoice> = emptyList(),
    val saving: Boolean = false,
    val error: UiError? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    /** The id of the saved policy; the screen closes when it is set. */
    val savedId: String? = null,
)

/** Creates a policy ([id] null) or edits one. */
class InsuranceEditStore(
    private val app: HauswartApp,
    private val id: String?,
    private val assetId: String,
    private val type: String,
) : Store<InsuranceEditState>(InsuranceEditState(isNew = id == null)) {
    private var original: InsurancePolicy? = null
    private var today = ""
    private var householdCurrency = "CHF"

    init {
        load()
    }

    fun retry() {
        load()
    }

    /** The derived values of [form] for the live hints below the fields. */
    fun preview(form: PolicyForm): PolicyPreview {
        val validCurrency = Regex("^[A-Z]{3}$").matches(form.currency)
        val amount = if (validCurrency) Money.parse(form.premium, form.currency) else null
        val annual =
            if (amount != null && amount >= 0 && form.premiumPeriod != "annual") {
                tr("insurance_annual_preview", "amount" to Money.format(annualPremiumMinor(amount, form.premiumPeriod), form.currency))
            } else {
                ""
            }
        val months = parseNotice(form.noticeMonths)
        val deadline =
            if (months != null && months <= MAX_NOTICE_MONTHS && Dates.isValid(form.endDate)) {
                cancellationDeadline(form.renewal, form.endDate, months)
            } else {
                null
            }
        val hint = deadlineHint(deadline, today)
        val text: String
        var tone = "muted"
        var reminder = ""
        when {
            form.renewal == "fixed" -> text = tr("insurance_deadline_preview_fixed")
            deadline != null && hint != null -> {
                val date = Dates.format(deadline)
                text =
                    (
                        if (hint.overdue) {
                            tr("insurance_deadline_preview_overdue", "date" to date)
                        } else {
                            tr(
                                "insurance_deadline_preview",
                                "date" to date,
                            )
                        }
                    ) +
                    " (" +
                    ch.orellbuehler.hauswart.core
                        .relativeDays(hint.days) + ")"
                tone = if (hint.overdue) "overdue" else hint.tone
                if (!hint.overdue) reminder = tr("insurance_deadline_preview_reminder")
            }
            else -> text = tr("insurance_deadline_preview_missing")
        }
        return PolicyPreview(
            annual = annual,
            deadline = text,
            deadlineTone = tone,
            reminder = reminder,
            otherCurrency =
                if (validCurrency &&
                    form.currency != householdCurrency
                ) {
                    tr("insurance_currency_other_hint", "currency" to householdCurrency)
                } else {
                    ""
                },
        )
    }

    fun save(form: PolicyForm) {
        if (current.saving) return
        val errors = mutableMapOf<String, String>()
        val currencyOk = Regex("^[A-Z]{3}$").matches(form.currency)
        if (form.title.isBlank()) errors["title"] = tr("field_required")
        if (!currencyOk) errors["currency"] = tr("cost_currency_invalid")
        var premium: Long? = null
        var deductible: Long? = null
        if (currencyOk) {
            val decimals = Money.exponent(form.currency)
            if (form.premium.isBlank()) {
                errors["premiumMinor"] = tr("field_required")
            } else {
                premium = Money.parse(form.premium, form.currency)
                if (premium == null) errors["premiumMinor"] = tr("cost_amount_invalid", "decimals" to decimals)
            }
            if (form.deductible.isNotBlank()) {
                deductible = Money.parse(form.deductible, form.currency)
                if (deductible == null) errors["deductibleMinor"] = tr("cost_amount_invalid", "decimals" to decimals)
            }
        }
        if (form.startDate.isBlank()) {
            errors["startDate"] = tr("field_required")
        } else if (!Dates.isValid(form.startDate)) {
            errors["startDate"] = tr("field_invalid_date")
        }
        val endDate = form.endDate.ifBlank { null }
        if (endDate != null && !Dates.isValid(endDate)) {
            errors["endDate"] = tr("field_invalid_date")
        } else if (endDate != null && Dates.isValid(form.startDate) && endDate < form.startDate) {
            errors["endDate"] = tr("insurance_error_end_before_start")
        }
        val months = parseNotice(form.noticeMonths)
        if (form.noticeMonths.isNotBlank() && months == null) {
            errors["cancellationNoticeMonths"] = tr("field_number")
        } else if (months != null && months > MAX_NOTICE_MONTHS) {
            errors["cancellationNoticeMonths"] = tr("field_max", "max" to MAX_NOTICE_MONTHS)
        }
        if (errors.isNotEmpty()) {
            update { it.copy(fieldErrors = errors, error = null) }
            return
        }
        update { it.copy(saving = true, error = null, fieldErrors = emptyMap()) }
        launch({ e -> update { it.copy(saving = false, error = if (e.fields.isEmpty()) e else null, fieldErrors = e.fields) } }) {
            val before = original
            val savedId =
                if (id == null || before == null) {
                    val created =
                        app.api.insurance.insurancePoliciesCreate(
                            InsurancePoliciesCreateRequest(
                                title = form.title.trim(),
                                type = form.type,
                                insurerContactId = form.insurerContactId.ifEmpty { null },
                                policyNumber = form.policyNumber.trim().ifEmpty { null },
                                premiumMinor = premium ?: 0,
                                currency = form.currency,
                                premiumPeriod = form.premiumPeriod,
                                deductibleMinor = deductible,
                                startDate = form.startDate,
                                endDate = endDate,
                                renewal = form.renewal,
                                cancellationNoticeMonths = months?.toLong(),
                                assistancePhone = form.assistancePhone.trim().ifEmpty { null },
                                showOnEmergency = form.showOnEmergency,
                                notes = form.notes.trim().ifEmpty { null },
                                assetIds = form.assetIds,
                            ),
                        )
                    created.id
                } else {
                    val body = updateBody(form, before, premium ?: 0, deductible, endDate, months)
                    if (body != null) app.api.insurance.insurancePoliciesUpdate(id, body)
                    id
                }
            app.changed("insurance", "tasks")
            update { it.copy(saving = false, savedId = savedId) }
        }
    }

    /** The request that turns [before] into the form, with only what differs; null when nothing does. */
    private fun updateBody(
        form: PolicyForm,
        before: InsurancePolicy,
        premium: Long,
        deductible: Long?,
        endDate: String?,
        months: Int?,
    ): InsurancePoliciesUpdateRequest? {
        val title = form.title.trim()
        val number = form.policyNumber.trim().ifEmpty { null }
        val phone = form.assistancePhone.trim().ifEmpty { null }
        val notes = form.notes.trim().ifEmpty { null }
        val insurer = form.insurerContactId.ifEmpty { null }
        val coveredBefore = before.assets.map { it.id }
        val assetsChanged = form.assetIds.size != coveredBefore.size || !form.assetIds.all { it in coveredBefore }
        val body =
            InsurancePoliciesUpdateRequest(
                title = if (title != before.title) title else null,
                type = if (form.type != before.type) form.type else null,
                insurerContactId = if (insurer != before.insurerContactId) Patch.of(insurer) else Patch.Keep,
                policyNumber = if (number != before.policyNumber) Patch.of(number) else Patch.Keep,
                premiumMinor = if (premium != before.premiumMinor) premium else null,
                currency = if (form.currency != before.currency) form.currency else null,
                premiumPeriod = if (form.premiumPeriod != before.premiumPeriod) form.premiumPeriod else null,
                deductibleMinor = if (deductible != before.deductibleMinor) Patch.of(deductible) else Patch.Keep,
                startDate = if (form.startDate != before.startDate) form.startDate else null,
                endDate = if (endDate != before.endDate) Patch.of(endDate) else Patch.Keep,
                renewal = if (form.renewal != before.renewal) form.renewal else null,
                cancellationNoticeMonths =
                    if (months?.toLong() != before.cancellationNoticeMonths) Patch.of(months?.toLong()) else Patch.Keep,
                assistancePhone = if (phone != before.assistancePhone) Patch.of(phone) else Patch.Keep,
                showOnEmergency = if (form.showOnEmergency != before.showOnEmergency) form.showOnEmergency else null,
                notes = if (notes != before.notes) Patch.of(notes) else Patch.Keep,
                assetIds = if (assetsChanged) form.assetIds else null,
            )
        return if (body == InsurancePoliciesUpdateRequest()) null else body
    }

    private fun parseNotice(text: String): Int? {
        val t = text.trim()
        return if (t.isNotEmpty() && t.all { it.isDigit() } && t.length <= 6) t.toIntOrNull() else null
    }

    private fun formOf(p: InsurancePolicy) =
        PolicyForm(
            title = p.title,
            type = p.type,
            insurerContactId = p.insurerContactId.orEmpty(),
            policyNumber = p.policyNumber.orEmpty(),
            premium = Money.toInput(p.premiumMinor, p.currency),
            currency = p.currency,
            premiumPeriod = p.premiumPeriod,
            deductible = p.deductibleMinor?.let { Money.toInput(it, p.currency) }.orEmpty(),
            startDate = p.startDate,
            endDate = p.endDate.orEmpty(),
            renewal = p.renewal,
            noticeMonths = p.cancellationNoticeMonths?.toString().orEmpty(),
            assistancePhone = p.assistancePhone.orEmpty(),
            showOnEmergency = p.showOnEmergency,
            notes = p.notes.orEmpty(),
            assetIds = p.assets.map { it.id },
        )

    private fun load() {
        update { it.copy(loading = true, loadError = null) }
        launch({ e -> update { it.copy(loading = false, loadError = e) } }) {
            val household = app.household.get()
            today = app.household.today()
            householdCurrency = household.currency
            val contacts =
                fetchAll { cursor ->
                    val page = app.api.contacts.contactsList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            val assets =
                fetchAll { cursor ->
                    val page = app.api.assets.assetsList(cursor = cursor, limit = 200)
                    page.items to page.nextCursor
                }
            val existing = id?.let { app.api.insurance.insurancePoliciesGet(it) }
            original = existing
            val covered = existing?.assets?.map { it.id }.orEmpty()
            val form =
                existing?.let { formOf(it) }
                    ?: PolicyForm(
                        title = "",
                        type = if (type in INSURANCE_TYPES) type else "other",
                        insurerContactId = "",
                        policyNumber = "",
                        premium = "",
                        currency = household.currency,
                        premiumPeriod = "annual",
                        deductible = "",
                        startDate = today,
                        endDate = "",
                        renewal = "auto",
                        noticeMonths = "",
                        assistancePhone = "",
                        showOnEmergency = false,
                        notes = "",
                        assetIds = if (assets.any { it.id == assetId }) listOf(assetId) else emptyList(),
                    )
            val choices =
                assets
                    .filter { it.archivedAt == null || it.id in covered }
                    .map { PolicyChoice(it.id, it.name, it.roomName.orEmpty()) }
                    .toMutableList()
            existing?.assets?.filter { a -> choices.none { it.id == a.id } }?.forEach { choices += PolicyChoice(it.id, it.name, "") }
            update {
                it.copy(
                    loading = false,
                    initial = form,
                    contacts =
                        contacts
                            .sortedWith(compareBy({ c -> if (c.kind == "insurance") 0 else 1 }, { c -> c.name.lowercase() }))
                            .map { c -> PolicyChoice(c.id, c.name, c.company.orEmpty()) },
                    assets = choices.sortedBy { c -> c.label.lowercase() },
                )
            }
        }
    }
}
