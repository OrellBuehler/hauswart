package ch.orellbuehler.hauswart.feature.appointments

import ch.orellbuehler.hauswart.api.generated.NextAppointment
import ch.orellbuehler.hauswart.i18n.tr

/** The earliest planned appointment of a task as a small badge on its row: [text] is "Today, 09:00", [label] adds "Appointment:". */
data class AppointmentChip(
    val id: String,
    val text: String,
    val label: String,
)

/** The badge of a task's `nextAppointment`; null for a task without a planned appointment. */
fun appointmentChipOf(
    next: NextAppointment?,
    timeZone: String,
    today: String,
): AppointmentChip? {
    if (next == null) return null
    val text = formatAppointmentStart(next.allDay, next.startsAt, next.startDate, timeZone, today)
    if (text.isEmpty()) return null
    return AppointmentChip(next.id, text, tr("appointment_badge_prefix") + " " + text)
}
