package ch.orellbuehler.hauswart.feature.insurance

import ch.orellbuehler.hauswart.feature.inventory.assetJson
import ch.orellbuehler.hauswart.feature.inventory.contactJson
import ch.orellbuehler.hauswart.feature.inventory.json
import ch.orellbuehler.hauswart.feature.inventory.page
import ch.orellbuehler.hauswart.i18n.tr
import ch.orellbuehler.hauswart.testing.TestApp
import ch.orellbuehler.hauswart.testing.await
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class InsuranceStoresTest {
    private val server = TestApp().also { it.signIn() }
    private val app = server.app

    @AfterTest
    fun tearDown() = server.close()

    private fun policy(
        id: String,
        title: String,
        premium: Long = 120_000,
        period: String = "annual",
        currency: String = "CHF",
        deadline: String? = "2099-09-30",
        archived: Boolean = false,
        endDate: String? = "2099-12-31",
        assistance: String? = null,
    ) = """{"id":"$id","title":"$title","type":"household","insurerContactId":"c1","insurerName":"Example Insurance","policyNumber":"P-$id",
        "premiumMinor":$premium,"currency":"$currency","premiumPeriod":"$period","annualPremiumMinor":${premium * (if (period == "monthly") 12 else 1)},
        "deductibleMinor":50000,"startDate":"2024-01-01","endDate":${endDate.json()},"renewal":"auto","cancellationNoticeMonths":3,
        "cancellationDeadline":${deadline.json()},"assistancePhone":${assistance.json()},"showOnEmergency":true,"notes":"A note",
        "assets":[{"id":"a1","name":"Boiler","kind":"device"}],"reminderTaskId":"t1","commentCount":2,
        "archivedAt":${if (archived) "\"2026-02-01T00:00:00.000Z\"" else "null"},
        "createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""

    @Test
    fun theListTotalsTheActivePoliciesInTheHouseholdCurrency() =
        runTest {
            server.household()
            server.on(
                "GET",
                "/api/v1/insurance-policies",
                page(
                    policy("p1", "Household"),
                    policy("p2", "Travel", premium = 10_000, period = "monthly"),
                    policy("p3", "Foreign", currency = "EUR"),
                ),
            )
            val store = InsuranceListStore(app)
            val state = store.await { !it.loading && it.rows.isNotEmpty() }
            assertEquals(3, state.rows.size)
            assertEquals(tr("insurance_total_per_year", "amount" to "CHF 2'400.00"), state.total)
            assertEquals(tr("insurance_total_other_currency", "count" to 1), state.otherCurrency)
            assertEquals(tr("insurance_covers", "assets" to "Boiler"), state.rows[0].covers)
            assertTrue(state.hasAny)
            store.close()
        }

    @Test
    fun searchAndTypeNarrowTheList() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/insurance-policies", page(policy("p1", "Household"), policy("p2", "Travel")))
            val store = InsuranceListStore(app)
            store.await { it.rows.size == 2 }
            store.search("trav")
            assertEquals(listOf("p2"), store.await { it.rows.size == 1 }.rows.map { it.id })
            store.search("example boiler")
            assertEquals(2, store.await { it.rows.size == 2 }.rows.size)
            store.setType("life")
            assertTrue(store.await { it.rows.isEmpty() }.filtered)
            store.close()
        }

    @Test
    fun archivedPoliciesAreListedSeparately() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/insurance-policies", page(policy("p1", "Household")))
            val store = InsuranceListStore(app)
            store.await { it.rows.isNotEmpty() }
            server.on("GET", "/api/v1/insurance-policies", page(policy("p1", "Household"), policy("old", "Old policy", archived = true)))
            store.refresh()
            store.await { it.hasArchived }
            store.setArchived(true)
            val state = store.await { it.archived }
            assertTrue(state.archived)
            assertTrue(server.requestsTo("GET", "/api/v1/insurance-policies").any { "archived=true" in it.query })
            store.close()
        }

    @Test
    fun theDetailShowsTheTermsAndTheDeadline() =
        runTest {
            server.household()
            server.on(
                "GET",
                "/api/v1/insurance-policies/p1",
                policy("p1", "Household", assistance = "0800 000 000", endDate = "2020-01-01", deadline = null),
            )
            val store = InsuranceDetailStore(app, "p1")
            val state = store.await { it.loaded }
            assertEquals(tr("insurance_type_household"), state.typeLabel)
            assertEquals("0800 000 000", state.assistancePhone)
            assertEquals("c1", state.insurerContactId)
            assertEquals("t1", state.reminderTaskId)
            assertTrue(state.endedText.isNotEmpty())
            assertEquals("", state.cancelBy)
            assertNull(state.deadline)
            val premium = state.facts.first { it.label == tr("insurance_premium") }.value
            assertTrue(premium.startsWith("CHF 1'200.00") && premium.endsWith(tr("insurance_per_annual")), premium)
            store.close()
        }

    @Test
    fun archivingAndDeletingPolicies() =
        runTest {
            server.household()
            server.on("GET", "/api/v1/insurance-policies/p1", policy("p1", "Household"))
            server.on("PATCH", "/api/v1/insurance-policies/p1", policy("p1", "Household", archived = true))
            server.on("DELETE", "/api/v1/insurance-policies/p1", "", HttpStatusCode.NoContent)
            val store = InsuranceDetailStore(app, "p1")
            store.await { it.loaded }
            store.toggleArchive()
            assertEquals(tr("insurance_archived_toast", "title" to "Household"), store.await { it.notice != null }.notice)
            assertTrue(
                server
                    .requestsTo("PATCH", "/api/v1/insurance-policies/p1")
                    .single()
                    .json["archived"]!!
                    .jsonPrimitive.boolean,
            )
            store.delete()
            assertTrue(store.await { it.deleted }.deleted)
            store.close()
        }

    private fun editSetup() {
        server.household()
        server.on("GET", "/api/v1/contacts", page(contactJson("c1", "Example Insurance")))
        server.on("GET", "/api/v1/assets", page(assetJson("a1", "Boiler"), assetJson("a2", "Washer")))
    }

    @Test
    fun aNewPolicyStartsFromTodayAndTheHouseholdCurrency() =
        runTest {
            editSetup()
            val store = InsuranceEditStore(app, null, "a2", "life")
            val state = store.await { !it.loading }
            val form = state.initial!!
            assertEquals("CHF", form.currency)
            assertEquals("life", form.type)
            assertEquals(listOf("a2"), form.assetIds)
            assertEquals(app.household.today(), form.startDate)
            assertEquals(listOf("Boiler", "Washer"), state.assets.map { it.label })
            store.close()
        }

    @Test
    fun theFormIsCheckedBeforeSending() =
        runTest {
            editSetup()
            val store = InsuranceEditStore(app, null, "", "")
            val form = store.await { !it.loading }.initial!!
            store.save(form.copy(title = " ", premium = "", startDate = "", endDate = "2020-01-01", noticeMonths = "x"))
            var errors = store.await { it.fieldErrors.isNotEmpty() }.fieldErrors
            assertEquals(tr("field_required"), errors["title"])
            assertEquals(tr("field_required"), errors["premiumMinor"])
            assertEquals(tr("field_required"), errors["startDate"])
            assertEquals(tr("field_number"), errors["cancellationNoticeMonths"])
            store.save(form.copy(title = "A", premium = "1.234", endDate = "2020-01-01", noticeMonths = "999", currency = "ch"))
            errors = store.await { "currency" in it.fieldErrors }.fieldErrors
            assertEquals(tr("cost_currency_invalid"), errors["currency"])
            store.save(form.copy(title = "A", premium = "1.234", endDate = "2020-01-01", noticeMonths = "999"))
            errors = store.await { "premiumMinor" in it.fieldErrors && "currency" !in it.fieldErrors }.fieldErrors
            assertEquals(tr("cost_amount_invalid", "decimals" to 2), errors["premiumMinor"])
            assertEquals(tr("insurance_error_end_before_start"), errors["endDate"])
            assertEquals(tr("field_max", "max" to 120), errors["cancellationNoticeMonths"])
            assertTrue(server.requestsTo("POST", "/api/v1/insurance-policies").isEmpty())
            store.close()
        }

    @Test
    fun aPolicyIsCreatedWithMinorUnits() =
        runTest {
            editSetup()
            server.on("POST", "/api/v1/insurance-policies", policy("p9", "Household"), HttpStatusCode.Created)
            val store = InsuranceEditStore(app, null, "", "")
            val form = store.await { !it.loading }.initial!!
            store.save(
                form.copy(
                    title = " Household ",
                    premium = "1'200.50",
                    deductible = "500",
                    endDate = "2099-12-31",
                    noticeMonths = "3",
                    insurerContactId = "c1",
                    assetIds = listOf("a1"),
                    notes = " ",
                ),
            )
            assertEquals("p9", store.await { it.savedId != null }.savedId)
            val body = server.requestsTo("POST", "/api/v1/insurance-policies").single().json
            assertEquals("Household", body["title"]!!.jsonPrimitive.content)
            assertEquals(120_050, body["premiumMinor"]!!.jsonPrimitive.content.toLong())
            assertEquals(50_000, body["deductibleMinor"]!!.jsonPrimitive.content.toLong())
            assertEquals(3, body["cancellationNoticeMonths"]!!.jsonPrimitive.content.toInt())
            assertEquals(
                "a1",
                body["assetIds"]!!
                    .jsonArray
                    .single()
                    .jsonPrimitive.content,
            )
            assertNull(body["notes"])
            store.close()
        }

    @Test
    fun anEditSendsOnlyTheChangesAndClearsWithNull() =
        runTest {
            editSetup()
            server.on("GET", "/api/v1/insurance-policies/p1", policy("p1", "Household"))
            server.on("PATCH", "/api/v1/insurance-policies/p1", policy("p1", "Household"))
            val store = InsuranceEditStore(app, "p1", "", "")
            val form = store.await { !it.loading }.initial!!
            assertEquals("1200.00", form.premium)
            assertEquals("500.00", form.deductible)
            store.save(form.copy(endDate = "2100-12-31", deductible = "", assetIds = listOf("a1", "a2")))
            store.await { it.savedId != null }
            val body = server.requestsTo("PATCH", "/api/v1/insurance-policies/p1").single().json
            assertEquals("2100-12-31", body["endDate"]!!.jsonPrimitive.content)
            assertEquals(JsonNull, body["deductibleMinor"])
            assertEquals(2, body["assetIds"]!!.jsonArray.size)
            assertNull(body["title"])
            assertNull(body["premiumMinor"])
            store.close()
        }

    @Test
    fun anUnchangedFormSendsNothing() =
        runTest {
            editSetup()
            server.on("GET", "/api/v1/insurance-policies/p1", policy("p1", "Household"))
            val store = InsuranceEditStore(app, "p1", "", "")
            val form = store.await { !it.loading }.initial!!
            store.save(form)
            assertEquals("p1", store.await { it.savedId != null }.savedId)
            assertTrue(server.requestsTo("PATCH", "/api/v1/insurance-policies/p1").isEmpty())
            store.close()
        }

    @Test
    fun theLivePreviewDerivesTheDeadlineAndTheAnnualAmount() =
        runTest {
            editSetup()
            val store = InsuranceEditStore(app, null, "", "")
            val form = store.await { !it.loading }.initial!!
            val preview =
                store.preview(
                    form.copy(premium = "100", premiumPeriod = "monthly", renewal = "auto", endDate = "2099-12-31", noticeMonths = "3"),
                )
            assertEquals(tr("insurance_annual_preview", "amount" to "CHF 1'200.00"), preview.annual)
            assertTrue(preview.deadline.startsWith(tr("insurance_deadline_preview", "date" to "30.09.2099").dropLast(0)))
            assertEquals(tr("insurance_deadline_preview_reminder"), preview.reminder)
            assertEquals(tr("insurance_deadline_preview_fixed"), store.preview(form.copy(renewal = "fixed")).deadline)
            assertEquals(tr("insurance_deadline_preview_missing"), store.preview(form).deadline)
            assertEquals("", store.preview(form.copy(premium = "100")).annual)
            assertTrue(store.preview(form.copy(currency = "EUR")).otherCurrency.isNotEmpty())
            store.close()
        }
}
