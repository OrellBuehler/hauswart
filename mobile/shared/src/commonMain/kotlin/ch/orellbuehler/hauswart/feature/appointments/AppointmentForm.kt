package ch.orellbuehler.hauswart.feature.appointments

import ch.orellbuehler.hauswart.api.Patch
import ch.orellbuehler.hauswart.api.generated.Appointment
import ch.orellbuehler.hauswart.api.generated.AppointmentsCreateRequest
import ch.orellbuehler.hauswart.api.generated.AppointmentsUpdateRequest
import ch.orellbuehler.hauswart.core.Dates
import ch.orellbuehler.hauswart.i18n.tr

private val timePattern = Regex("^([01]\\d|2[0-3]):([0-5]\\d)$")

/**
 * What the form holds, every field as the person typed it. Dates are `YYYY-MM-DD` and times `HH:MM`
 * in the household's time zone (the store turns them into instants); an id is empty for none.
 */
data class AppointmentForm(
    val title: String,
    val allDay: Boolean,
    /** The first day of either kind. */
    val startDate: String,
    /** Timed appointments only. */
    val startTime: String,
    /** Empty: the same day as the start. */
    val endDate: String,
    /** Timed appointments only; empty: an hour after the start. */
    val endTime: String,
    val location: String,
    val notes: String,
    val taskId: String,
    val assetId: String,
    val contactId: String,
    /** The occurrence of the task the appointment is for; only a new appointment sends it. */
    val occurrenceKey: String,
)

/** The engine's placeholders for a task that shows no occurrence at all: there is nothing an appointment could be for. */
private val noOccurrenceKeys = listOf("none", "s:none")

internal fun pinnableOccurrenceKey(key: String?): String = if (key.isNullOrEmpty() || key in noOccurrenceKeys) "" else key

/** What a new appointment starts with, e.g. the task it is for. */
internal fun newForm(
    today: String,
    title: String = "",
    taskId: String = "",
    assetId: String = "",
    contactId: String = "",
    occurrenceKey: String = "",
): AppointmentForm =
    AppointmentForm(
        title = title,
        allDay = false,
        startDate = today,
        startTime = "",
        endDate = "",
        endTime = "",
        location = "",
        notes = "",
        taskId = taskId,
        assetId = assetId,
        contactId = contactId,
        occurrenceKey = if (taskId.isEmpty()) "" else pinnableOccurrenceKey(occurrenceKey),
    )

/** The form for an appointment as it is, in the wall-clock times of the household zone. */
internal fun formOf(
    a: Appointment,
    timeZone: String,
): AppointmentForm {
    val span = whenOf(a, timeZone)
    val s = spanOf(span, timeZone)
    val endDay =
        when (span) {
            is ApptWhen.AllDay -> span.endDate
            is ApptWhen.Timed -> localDateOf(span.endsAt, timeZone)
        }
    return AppointmentForm(
        title = a.title,
        allDay = a.allDay,
        startDate = s.first,
        startTime = s.startTime.orEmpty(),
        endDate = if (endDay == s.first) "" else endDay,
        endTime = s.endTime.orEmpty(),
        location = a.location.orEmpty(),
        notes = a.notes.orEmpty(),
        taskId = a.taskId.orEmpty(),
        assetId = a.assetId.orEmpty(),
        contactId = a.contactId.orEmpty(),
        occurrenceKey = a.occurrenceKey.orEmpty(),
    )
}

/** What the dates and times of a form say: the span, or per form field (`startDate`, `startTime`, `endDate`, `endTime`) what is wrong. */
internal data class DraftWhen(
    val span: ApptWhen?,
    val errors: Map<String, String>,
    /** The end is the default of an hour after the start, not one the person gave. */
    val endIsDefault: Boolean,
)

private fun describeProblem(problem: WhenProblem): String =
    when {
        problem.endBeforeStart && problem.field == "endDate" -> tr("appointment_error_end_before_start_date")
        problem.endBeforeStart -> tr("appointment_error_end_before_start")
        else -> tr("appointment_error_too_long", "days" to MAX_APPOINTMENT_DAYS)
    }

private fun checkDate(value: String): String? =
    when {
        value.isEmpty() -> tr("field_required")
        Dates.isValid(value) -> null
        else -> tr("field_invalid_date")
    }

private fun checkTime(value: String): String? =
    when {
        value.isEmpty() -> tr("field_required")
        timePattern.matches(value) -> null
        else -> tr("appointment_error_time_invalid")
    }

/** Instants to use as they are, instead of reading them off the form's wall-clock fields. */
internal data class KeptInstants(
    val startsAt: Long? = null,
    val endsAt: Long? = null,
)

/**
 * The span the form describes, in the household zone. The end defaults as the API does: an hour after
 * the start of a timed appointment, the same day for an all-day one. The same rules as the server
 * ([whenProblem]), worded for the form. [keep] replaces the instant of a side whose wall-clock fields
 * were not touched (see [buildUpdateRequest]).
 */
internal fun draftWhen(
    form: AppointmentForm,
    timeZone: String,
    keep: KeptInstants = KeptInstants(),
): DraftWhen {
    val errors = LinkedHashMap<String, String>()
    checkDate(form.startDate)?.let { errors["startDate"] = it }
    if (form.endDate.isNotEmpty()) checkDate(form.endDate)?.let { errors["endDate"] = it }

    if (form.allDay) {
        if (errors.isNotEmpty()) return DraftWhen(null, errors, false)
        val span = ApptWhen.AllDay(form.startDate, form.endDate.ifEmpty { form.startDate })
        whenProblem(span)?.let { return DraftWhen(null, mapOf("endDate" to describeProblem(it)), false) }
        return DraftWhen(span, errors, form.endDate.isEmpty())
    }

    checkTime(form.startTime)?.let { errors["startTime"] = it }
    val endIsDefault = form.endTime.isEmpty() && form.endDate.isEmpty()
    if (!endIsDefault) checkTime(form.endTime)?.let { errors["endTime"] = it }
    if (errors.isNotEmpty()) return DraftWhen(null, errors, endIsDefault)
    val startsAt = keep.startsAt ?: zonedTimeToInstant(form.startDate, form.startTime, timeZone)
    val endsAt =
        if (endIsDefault) {
            defaultEnd(startsAt)
        } else {
            keep.endsAt ?: zonedTimeToInstant(form.endDate.ifEmpty { form.startDate }, form.endTime, timeZone)
        }
    val span = ApptWhen.Timed(startsAt, endsAt)
    whenProblem(span)?.let { return DraftWhen(null, mapOf("endTime" to describeProblem(it)), endIsDefault) }
    return DraftWhen(span, errors, endIsDefault)
}

/** What the form shows under its fields: the span in words, or why there is none yet. Both are empty when there is nothing to say. */
data class AppointmentPreview(
    val text: String,
    val hint: String,
)

internal fun previewOf(
    form: AppointmentForm,
    timeZone: String,
    today: String,
): AppointmentPreview {
    val draft = draftWhen(form, timeZone)
    val span = draft.span
    if (span != null) return AppointmentPreview(formatWhen(span, timeZone, today), "")
    if ("startDate" in draft.errors || "startTime" in draft.errors) {
        return AppointmentPreview("", tr(if (form.allDay) "appointment_preview_missing_day" else "appointment_preview_missing"))
    }
    return AppointmentPreview(
        "",
        draft.errors.values
            .firstOrNull()
            .orEmpty(),
    )
}

/** A request, or the errors (by form field) that stop it. */
internal data class Built<T>(
    val body: T?,
    val errors: Map<String, String>,
)

private fun nullable(text: String): String? = text.trim().ifEmpty { null }

/** Length problems of the text fields, worded for the form. */
private fun checkTexts(form: AppointmentForm): Map<String, String> {
    val errors = LinkedHashMap<String, String>()
    val title = form.title.trim()
    if (title.isEmpty()) {
        errors["title"] = tr("field_required")
    } else if (title.length > APPOINTMENT_TITLE_MAX) {
        errors["title"] = tr("field_too_long", "max" to APPOINTMENT_TITLE_MAX)
    }
    if (form.location.trim().length > APPOINTMENT_LOCATION_MAX) {
        errors["location"] = tr("field_too_long", "max" to APPOINTMENT_LOCATION_MAX)
    }
    if (form.notes.trim().length > APPOINTMENT_NOTES_MAX) {
        errors["notes"] = tr("field_too_long", "max" to APPOINTMENT_NOTES_MAX)
    }
    return errors
}

/**
 * The request for a new appointment, or the errors that stop it. Without an end the server's hour
 * (timed) or the same day (all-day) applies; without an asset it takes the task's.
 */
internal fun buildCreateRequest(
    form: AppointmentForm,
    timeZone: String,
): Built<AppointmentsCreateRequest> {
    val draft = draftWhen(form, timeZone)
    val errors = checkTexts(form) + draft.errors
    val span = draft.span
    if (errors.isNotEmpty() || span == null) return Built(null, errors)
    val body =
        when (span) {
            is ApptWhen.AllDay ->
                AppointmentsCreateRequest(
                    title = form.title.trim(),
                    notes = nullable(form.notes),
                    location = nullable(form.location),
                    allDay = true,
                    startDate = span.startDate,
                    endDate = if (form.endDate.isEmpty()) null else span.endDate,
                    taskId = form.taskId.ifEmpty { null },
                    assetId = form.assetId.ifEmpty { null },
                    contactId = form.contactId.ifEmpty { null },
                    occurrenceKey = if (form.taskId.isEmpty()) null else form.occurrenceKey.ifEmpty { null },
                )
            is ApptWhen.Timed ->
                AppointmentsCreateRequest(
                    title = form.title.trim(),
                    notes = nullable(form.notes),
                    location = nullable(form.location),
                    startsAt = instantText(span.startsAt),
                    endsAt = if (draft.endIsDefault) null else instantText(span.endsAt),
                    taskId = form.taskId.ifEmpty { null },
                    assetId = form.assetId.ifEmpty { null },
                    contactId = form.contactId.ifEmpty { null },
                    occurrenceKey = if (form.taskId.isEmpty()) null else form.occurrenceKey.ifEmpty { null },
                )
        }
    return Built(body, errors)
}

/** The day an appointment ends on in the form: the start day while the end day is left empty. */
private fun endDayOf(f: AppointmentForm) = f.endDate.ifEmpty { f.startDate }

/** Whether the form changed what says when: the kind, the days and the times that apply to it. */
private fun whenChanged(
    form: AppointmentForm,
    base: AppointmentForm,
): Boolean {
    if (form.allDay != base.allDay) return true
    if (form.startDate != base.startDate || endDayOf(form) != endDayOf(base)) return true
    return !form.allDay && (form.startTime != base.startTime || form.endTime != base.endTime)
}

/**
 * The stored instants of the sides of a timed appointment the form left alone. A wall-clock time
 * cannot say which of the two 02:30 of the night the clocks go back is meant, so a side that was not
 * edited must not be worked out from its fields again: it would move to the first one.
 */
private fun untouchedInstants(
    form: AppointmentForm,
    base: AppointmentForm,
    original: Appointment,
): KeptInstants {
    val start =
        original.startsAt?.let {
            runCatching {
                kotlin.time.Instant
                    .parse(it)
                    .toEpochMilliseconds()
            }.getOrNull()
        }
    val end =
        original.endsAt?.let {
            runCatching {
                kotlin.time.Instant
                    .parse(it)
                    .toEpochMilliseconds()
            }.getOrNull()
        }
    if (form.allDay || base.allDay || start == null || end == null) return KeptInstants()
    return KeptInstants(
        startsAt = if (form.startDate == base.startDate && form.startTime == base.startTime) start else null,
        endsAt = if (endDayOf(form) == endDayOf(base) && form.endTime == base.endTime) end else null,
    )
}

/**
 * The request that changes [original] into the form, with only what differs; null `body` with no
 * errors means nothing changed. A changed start or end sends both ends, as the server keeps the stored
 * end otherwise and refuses a start behind it; the side that was not edited keeps its stored instant.
 * A new task is pinned to the occurrence it shows by the server.
 */
internal fun buildUpdateRequest(
    form: AppointmentForm,
    original: Appointment,
    timeZone: String,
): Built<AppointmentsUpdateRequest> {
    val base = formOf(original, timeZone)
    val draft = draftWhen(form, timeZone, untouchedInstants(form, base, original))
    val changesWhen = whenChanged(form, base)
    val errors = checkTexts(form) + if (changesWhen) draft.errors else emptyMap()
    if (errors.isNotEmpty()) return Built(null, errors)

    val title = form.title.trim()
    val location = nullable(form.location)
    val notes = nullable(form.notes)
    val span = draft.span
    var request = AppointmentsUpdateRequest()
    var changed = false

    fun change(next: AppointmentsUpdateRequest) {
        request = next
        changed = true
    }
    if (title != original.title) change(request.copy(title = title))
    if (location != original.location) change(request.copy(location = Patch.of(location)))
    if (notes != original.notes) change(request.copy(notes = Patch.of(notes)))
    if (changesWhen && span != null) {
        if (form.allDay != base.allDay) change(request.copy(allDay = form.allDay))
        when (span) {
            is ApptWhen.AllDay -> change(request.copy(startDate = span.startDate, endDate = span.endDate))
            is ApptWhen.Timed -> change(request.copy(startsAt = instantText(span.startsAt), endsAt = instantText(span.endsAt)))
        }
    }
    if (form.taskId != original.taskId.orEmpty()) change(request.copy(taskId = Patch.of(form.taskId.ifEmpty { null })))
    if (form.assetId != original.assetId.orEmpty()) change(request.copy(assetId = Patch.of(form.assetId.ifEmpty { null })))
    if (form.contactId != original.contactId.orEmpty()) change(request.copy(contactId = Patch.of(form.contactId.ifEmpty { null })))
    return Built(if (changed) request else null, errors)
}

/** Field errors of a rejected request, as the form's fields (`startsAt` is the form's `startTime`). */
internal fun formFieldErrors(errors: Map<String, String>): Map<String, String> =
    errors.mapKeys {
        when (it.key) {
            "startsAt" -> "startTime"
            "endsAt" -> "endTime"
            else -> it.key
        }
    }
