package ch.orellbuehler.hauswart.feature.vehicles

import ch.orellbuehler.hauswart.api.generated.Trigger
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class VehicleTemplatesTest {
    private val ctx = VehicleTemplateContext("a1", "2019-05-03", "2026-11-21", "km")

    @AfterTest
    fun reset() {
        I18n.locale = "de"
    }

    @Test
    fun theInspectionFollowsTheSwissRule() {
        val cases =
            listOf(
                Triple("2019-05-03", "2019-06-01", "2023-05-03"),
                Triple("2019-05-03", "2023-05-04", "2026-05-03"),
                Triple("2019-05-03", "2026-11-21", "2028-05-03"),
                Triple("2024-02-29", "2024-03-01", "2028-02-29"),
            )
        cases.forEach { (first, today, expected) -> assertEquals(expected, suggestMfkDate(first, today), "$first $today") }
        assertNull(suggestMfkDate(null, "2026-11-21"))
    }

    @Test
    fun tireTemplatesAreYearlyWithAGaragePreparation() {
        val built = buildVehicleTemplate("tires_winter", ctx, defaultSetupParams(ctx)).template!!
        val trigger = built.task.trigger as Trigger.Calendar
        assertEquals("2027-10-15", trigger.startDate)
        assertEquals(listOf(10L), trigger.byMonth)
        assertEquals(14L, trigger.earlyDays)
        assertEquals("a1:tires_winter", built.task.externalRef)
        assertEquals(VEHICLE_TEMPLATE_SOURCE, built.task.externalSource)
        assertEquals(tr("vehicle_task_tires_winter_title"), built.task.title)
        assertEquals(28L, built.preparations.single().leadDays)
    }

    @Test
    fun theServiceCountsTheVehiclesOdometer() {
        val params = defaultSetupParams(ctx).copy(serviceDistance = "20.000", serviceMonths = "18")
        val trigger = buildVehicleTemplate("service", ctx, params).template!!.task.trigger as Trigger.CounterDelta
        assertEquals("odometer:a1", trigger.entityId)
        assertEquals(20000.0, trigger.threshold)
        assertEquals(18L, trigger.orEvery?.every)
        assertEquals("month", trigger.orEvery?.unit)
        assertEquals(15000.0, defaultServiceDistance("km"))
        assertEquals(10000.0, defaultServiceDistance("mi"))
    }

    @Test
    fun wrongParametersGiveFieldErrors() {
        val bad =
            defaultSetupParams(
                ctx,
            ).copy(serviceDistance = "x", serviceMonths = "1.5", mfkDate = "", taxDay = "40", brakeFluidLastDone = "2999-01-01")
        assertEquals(setOf("serviceDistance", "serviceMonths"), buildVehicleTemplate("service", ctx, bad).errors.keys)
        assertEquals(setOf("mfkDate"), buildVehicleTemplate("mfk", ctx, bad).errors.keys)
        assertEquals(setOf("taxDay"), buildVehicleTemplate("vehicle_tax", ctx, bad).errors.keys)
        assertEquals(setOf("brakeFluidLastDone"), buildVehicleTemplate("brake_fluid", ctx, bad).errors.keys)
        assertNull(buildVehicleTemplate("service", ctx, bad).template)
    }

    @Test
    fun everyTwoYearsStartsFromTheLastTime() {
        val params = defaultSetupParams(ctx).copy(acServiceLastDone = "2025-03-10")
        val trigger = buildVehicleTemplate("ac_service", ctx, params).template!!.task.trigger as Trigger.Interval
        assertEquals("2027-03-10", trigger.startDate)
        assertEquals("completion", trigger.anchor)
        val fresh = buildVehicleTemplate("brake_fluid", ctx, defaultSetupParams(ctx)).template!!.task.trigger as Trigger.Interval
        assertEquals("2028-11-21", fresh.startDate)
    }

    @Test
    fun marksAreReadBack() {
        assertEquals("a1:service", templateMark("a1", "service").externalRef)
        assertEquals("a1:service:3", templateMark("a1", "service", 3).externalRef)
        assertEquals("service", templateOfMark(VEHICLE_TEMPLATE_SOURCE, "a1:service:3"))
        assertNull(templateOfMark(VEHICLE_TEMPLATE_SOURCE, "a1:unknown"))
        assertNull(templateOfMark("other", "a1:service"))
    }

    @Test
    fun titlesExistInBothLanguages() {
        val titles = templateTitles("service")
        assertEquals(listOf("Service", "Service"), titles.map { it.take(7) })
        assertEquals(2, templateTitles("mfk").toSet().size)
        assertEquals("de", I18n.locale)
        assertNotNull(templateSummary(buildVehicleTemplate("mfk", ctx, defaultSetupParams(ctx)).template!!))
        assertTrue(templateSummary(buildVehicleTemplate("mfk", ctx, defaultSetupParams(ctx)).template!!).isNotEmpty())
    }
}
