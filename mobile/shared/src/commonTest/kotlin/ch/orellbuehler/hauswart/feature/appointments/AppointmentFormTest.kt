package ch.orellbuehler.hauswart.feature.appointments

import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.i18n.I18n
import ch.orellbuehler.hauswart.i18n.tr
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AppointmentFormTest {
    @BeforeTest
    fun german() {
        I18n.locale = "de"
    }

    @AfterTest
    fun reset() {
        I18n.locale = "de"
    }

    private fun form(
        title: String = "Boiler service",
        startDate: String = "2026-06-15",
        startTime: String = "09:00",
    ) = newForm(TODAY).copy(title = title, startDate = startDate, startTime = startTime)

    @Test
    fun aNewFormStartsToday() {
        val form = newForm(TODAY, title = "x", taskId = "t1", occurrenceKey = "2026-12-01")
        assertEquals(TODAY, form.startDate)
        assertEquals("2026-12-01", form.occurrenceKey)
        assertEquals("", newForm(TODAY, taskId = "t1", occurrenceKey = "none").occurrenceKey)
        assertEquals("", newForm(TODAY, taskId = "t1", occurrenceKey = "s:none").occurrenceKey)
        assertEquals("", newForm(TODAY, occurrenceKey = "2026-12-01").occurrenceKey)
    }

    @Test
    fun theFormOfAnExistingAppointmentIsInWallClockTime() {
        val timed =
            formOf(
                timed("a", "2026-06-15T07:00:00Z", "2026-06-15T08:30:00Z", location = "Cellar", taskId = "t1", occurrenceKey = "k"),
                ZONE,
            )
        assertEquals("2026-06-15", timed.startDate)
        assertEquals("09:00", timed.startTime)
        assertEquals("10:30", timed.endTime)
        assertEquals("", timed.endDate)
        assertEquals("Cellar", timed.location)
        assertEquals("t1", timed.taskId)
        assertEquals("k", timed.occurrenceKey)

        val overnight = formOf(timed("b", "2026-06-15T21:00:00Z", "2026-06-16T01:00:00Z"), ZONE)
        assertEquals("2026-06-16", overnight.endDate)

        val all = formOf(allDay("c", "2026-06-15", "2026-06-17"), ZONE)
        assertEquals(true, all.allDay)
        assertEquals("2026-06-17", all.endDate)
        assertEquals("", all.startTime)
    }

    @Test
    fun aTimedCreateSendsInstantsAndLeavesTheDefaultEndOut() {
        val built = buildCreateRequest(form(), ZONE)
        val body = assertNotNull(built.body)
        assertEquals("2026-06-15T07:00:00.000Z", body.startsAt)
        assertNull(body.endsAt)
        assertNull(body.allDay)
        assertEquals("Boiler service", body.title)

        val explicit = assertNotNull(buildCreateRequest(form().copy(endTime = "10:30"), ZONE).body)
        assertEquals("2026-06-15T08:30:00.000Z", explicit.endsAt)

        val overnight =
            assertNotNull(buildCreateRequest(form(startTime = "23:00").copy(endDate = "2026-06-16", endTime = "01:00"), ZONE).body)
        assertEquals("2026-06-15T21:00:00.000Z", overnight.startsAt)
        assertEquals(
            "2026-06-15T23:00:00.000Z".replace("15T", "16T").replace("23:00", "23:00").let {
                "2026-06-15T23:00:00.000Z"
            },
            overnight.endsAt,
        )
    }

    @Test
    fun anAllDayCreateSendsDates() {
        val body = assertNotNull(buildCreateRequest(form().copy(allDay = true, startTime = "ignored"), ZONE).body)
        assertEquals(true, body.allDay)
        assertEquals("2026-06-15", body.startDate)
        assertNull(body.endDate)
        assertNull(body.startsAt)

        val range = assertNotNull(buildCreateRequest(form().copy(allDay = true, endDate = "2026-06-17"), ZONE).body)
        assertEquals("2026-06-17", range.endDate)
    }

    @Test
    fun theTrimmedTextAndTheLinksGoOut() {
        val body =
            assertNotNull(
                buildCreateRequest(
                    form(
                        title = "  Service  ",
                    ).copy(location = " Cellar ", notes = "  ", taskId = "t1", occurrenceKey = "k", assetId = "a1", contactId = "c1"),
                    ZONE,
                ).body,
            )
        assertEquals("Service", body.title)
        assertEquals("Cellar", body.location)
        assertNull(body.notes)
        assertEquals("t1", body.taskId)
        assertEquals("k", body.occurrenceKey)
        assertEquals("a1", body.assetId)
        assertEquals("c1", body.contactId)

        val noTask = assertNotNull(buildCreateRequest(form().copy(occurrenceKey = "k"), ZONE).body)
        assertNull(noTask.occurrenceKey)
        assertNull(noTask.taskId)
    }

    @Test
    fun theFormExplainsWhatIsMissingOrWrong() {
        val cases =
            listOf(
                form(title = " ") to mapOf("title" to tr("field_required")),
                form(title = "x".repeat(APPOINTMENT_TITLE_MAX + 1)) to
                    mapOf("title" to tr("field_too_long", "max" to APPOINTMENT_TITLE_MAX)),
                form(startDate = "") to mapOf("startDate" to tr("field_required")),
                form(startDate = "2026-02-30") to mapOf("startDate" to tr("field_invalid_date")),
                form(startTime = "") to mapOf("startTime" to tr("field_required")),
                form(startTime = "25:00") to mapOf("startTime" to tr("appointment_error_time_invalid")),
                form().copy(endTime = "08:00") to mapOf("endTime" to tr("appointment_error_end_before_start")),
                form().copy(
                    endDate = "2026-07-15",
                    endTime = "09:00",
                ) to mapOf("endTime" to tr("appointment_error_too_long", "days" to 14)),
                form().copy(allDay = true, endDate = "2026-06-14") to mapOf("endDate" to tr("appointment_error_end_before_start_date")),
                form().copy(allDay = true, endDate = "2026-06-29") to mapOf("endDate" to tr("appointment_error_too_long", "days" to 14)),
                form().copy(location = "x".repeat(APPOINTMENT_LOCATION_MAX + 1)) to
                    mapOf("location" to tr("field_too_long", "max" to APPOINTMENT_LOCATION_MAX)),
                form().copy(notes = "x".repeat(APPOINTMENT_NOTES_MAX + 1)) to
                    mapOf("notes" to tr("field_too_long", "max" to APPOINTMENT_NOTES_MAX)),
            )
        cases.forEach { (f, errors) ->
            val built = buildCreateRequest(f, ZONE)
            assertNull(built.body, f.toString())
            assertEquals(errors, built.errors, f.toString())
        }
    }

    @Test
    fun theEndDefaultsToAnHourInThePreview() {
        val preview = previewOf(form(), ZONE, TODAY)
        assertEquals("Mo, 15.06. · 09:00–10:00", preview.text.replace("2026", ""))
        assertEquals("", preview.hint)
        assertEquals(tr("appointment_preview_missing"), previewOf(form(startTime = ""), ZONE, TODAY).hint)
        assertEquals(tr("appointment_preview_missing_day"), previewOf(form(startDate = "").copy(allDay = true), ZONE, TODAY).hint)
        assertEquals(tr("appointment_error_end_before_start"), previewOf(form().copy(endTime = "08:00"), ZONE, TODAY).hint)
    }

    private val stored = timed("a", "2026-06-15T07:00:00Z", "2026-06-15T08:00:00Z", title = "Service", location = "Cellar")

    @Test
    fun anUnchangedFormSendsNothing() {
        val built = buildUpdateRequest(formOf(stored, ZONE), stored, ZONE)
        assertNull(built.body)
        assertTrue(built.errors.isEmpty())
    }

    @Test
    fun anUpdateSendsOnlyWhatChanged() {
        val base = formOf(stored, ZONE)
        val title = assertNotNull(buildUpdateRequest(base.copy(title = " New "), stored, ZONE).body)
        assertEquals("New", title.title)
        assertEquals(Patch.Keep, title.location)
        assertNull(title.startsAt)

        val cleared = assertNotNull(buildUpdateRequest(base.copy(location = ""), stored, ZONE).body)
        assertEquals(Patch.of<String>(null), cleared.location)
        assertNull(cleared.title)

        val moved = assertNotNull(buildUpdateRequest(base.copy(startTime = "10:00", endTime = "11:00"), stored, ZONE).body)
        assertEquals("2026-06-15T08:00:00.000Z", moved.startsAt)
        assertEquals("2026-06-15T09:00:00.000Z", moved.endsAt)

        val links = assertNotNull(buildUpdateRequest(base.copy(taskId = "t9", assetId = "a9", contactId = "c9"), stored, ZONE).body)
        assertEquals(Patch.of("t9"), links.taskId)
        assertEquals(Patch.of("a9"), links.assetId)
        assertEquals(Patch.of("c9"), links.contactId)
    }

    @Test
    fun anUntouchedSideKeepsItsStoredInstant() {
        // 02:30 of the night the clocks go back happens twice; the stored end is the second one.
        val repeated = timed("r", "2026-10-24T22:00:00Z", "2026-10-25T01:30:00Z", title = "Night")
        val base = formOf(repeated, ZONE)
        val renamed = buildUpdateRequest(base.copy(title = "Other"), repeated, ZONE)
        assertNull(renamed.body?.endsAt)

        val startMoved =
            assertNotNull(
                buildUpdateRequest(base.copy(startDate = "2026-10-24", startTime = "23:30", endDate = "2026-10-25"), repeated, ZONE).body,
            )
        assertEquals("2026-10-25T01:30:00.000Z", startMoved.endsAt)
        assertEquals("2026-10-24T21:30:00.000Z", startMoved.startsAt)
    }

    @Test
    fun switchingTheKindSendsTheNewDates() {
        val base = formOf(stored, ZONE)
        val body = assertNotNull(buildUpdateRequest(base.copy(allDay = true), stored, ZONE).body)
        assertEquals(true, body.allDay)
        assertEquals("2026-06-15", body.startDate)
        assertEquals("2026-06-15", body.endDate)
        assertNull(body.startsAt)
    }

    @Test
    fun anUpdateWithAnImpossibleEndSaysSo() {
        val built = buildUpdateRequest(formOf(stored, ZONE).copy(endTime = "08:30"), stored, ZONE)
        assertNull(built.body)
        assertEquals(mapOf("endTime" to tr("appointment_error_end_before_start")), built.errors)
    }

    @Test
    fun serverFieldNamesBecomeFormFields() {
        assertEquals(
            mapOf("startTime" to "a", "endTime" to "b", "title" to "c", "taskId" to "d"),
            formFieldErrors(mapOf("startsAt" to "a", "endsAt" to "b", "title" to "c", "taskId" to "d")),
        )
    }
}
