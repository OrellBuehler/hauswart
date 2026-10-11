import type { z } from "zod";
import type { endpoints } from "$lib/api/registry";
import type { appointmentSchema } from "$lib/api/schemas/appointments";
import { toIso } from "$lib/api/schemas/common";
import {
  createAppointment,
  deleteAppointment,
  getAppointment,
  listAppointments,
  updateAppointment,
  type AppointmentRecord,
} from "$lib/server/appointments/appointments";
import { completeAppointment } from "$lib/server/appointments/complete";
import type { Handler } from "../bind";
import { wireCompletion } from "../wire";
import { completionSourceFor, wireTaskFor } from "./tasks";

const iso = (value: Date | null) => (value ? toIso(value) : null);
const instant = (value: string | undefined) =>
  value === undefined ? undefined : Date.parse(value);

export function wireAppointment(
  a: AppointmentRecord,
): z.input<typeof appointmentSchema> {
  return {
    id: a.id,
    title: a.title,
    notes: a.notes,
    location: a.location,
    allDay: a.allDay,
    startsAt: iso(a.startsAt),
    endsAt: iso(a.endsAt),
    startDate: a.startDate,
    endDate: a.endDate,
    taskId: a.taskId,
    taskTitle: a.taskTitle,
    occurrenceKey: a.occurrenceKey,
    assetId: a.assetId,
    assetName: a.assetName,
    contactId: a.contactId,
    contactName: a.contactName,
    status: a.status,
    commentCount: a.commentCount,
    createdByUserId: a.createdByUserId,
    createdAt: toIso(a.createdAt),
    updatedAt: toIso(a.updatedAt),
  };
}

export const list: Handler<typeof endpoints.appointmentsList> = ({
  ctx,
  query,
}) => {
  const { cursor, limit, ...filter } = query;
  const page = listAppointments(ctx, filter, { cursor, limit });
  return {
    items: page.items.map(wireAppointment),
    nextCursor: page.nextCursor,
  };
};

export const create: Handler<typeof endpoints.appointmentsCreate> = ({
  ctx,
  body,
}) =>
  wireAppointment(
    createAppointment(
      ctx,
      {
        ...body,
        startsAt: instant(body.startsAt),
        endsAt: instant(body.endsAt),
      },
      ctx.user.id,
    ),
  );

export const get: Handler<typeof endpoints.appointmentsGet> = ({
  ctx,
  params,
}) => wireAppointment(getAppointment(ctx, params.id));

export const update: Handler<typeof endpoints.appointmentsUpdate> = ({
  ctx,
  params,
  body,
}) =>
  wireAppointment(
    updateAppointment(ctx, params.id, {
      ...body,
      startsAt: instant(body.startsAt),
      endsAt: instant(body.endsAt),
    }),
  );

export const remove: Handler<typeof endpoints.appointmentsDelete> = ({
  ctx,
  params,
}) => {
  deleteAppointment(ctx, params.id);
  return null;
};

export const complete: Handler<typeof endpoints.appointmentsComplete> = async ({
  ctx,
  params,
  body,
}) => {
  const result = await completeAppointment(ctx, params.id, {
    userId: ctx.user.id,
    source: completionSourceFor(ctx.principal),
    note: body.note,
    completedAt: instant(body.completedAt),
  });
  return {
    appointment: wireAppointment(result.appointment),
    completion: result.completion ? wireCompletion(result.completion) : null,
    task: result.task ? wireTaskFor(ctx)(result.task) : null,
    replayed: result.replayed,
  };
};
