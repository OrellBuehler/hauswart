import type { Appointment } from "$lib/api/schemas/appointments";

/** An appointment as the API answers it: a planned, timed one from 09:00 to 10:00 on 14 October 2026 in Zurich. */
export function appointmentDto(over: Partial<Appointment> = {}): Appointment {
  return {
    id: "appointment-1",
    title: "Heizungsservice",
    notes: null,
    location: null,
    allDay: false,
    startsAt: "2026-10-14T07:00:00.000Z",
    endsAt: "2026-10-14T08:00:00.000Z",
    startDate: null,
    endDate: null,
    taskId: null,
    taskTitle: null,
    occurrenceKey: null,
    assetId: null,
    assetName: null,
    contactId: null,
    contactName: null,
    status: "planned",
    commentCount: 0,
    createdByUserId: null,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...over,
  };
}

/** An all-day appointment over the given days. */
export function allDayDto(
  startDate: string,
  endDate: string = startDate,
  over: Partial<Appointment> = {},
): Appointment {
  return appointmentDto({
    allDay: true,
    startsAt: null,
    endsAt: null,
    startDate,
    endDate,
    ...over,
  });
}
