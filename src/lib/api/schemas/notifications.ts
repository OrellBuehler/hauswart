import { z } from "zod";
import { NOTIFICATION_KINDS, NOTIFICATION_TITLE_KEYS } from "../enums";
import {
  idSchema,
  isoTimestampSchema,
  paginated,
  paginationQuerySchema,
  queryBooleanSchema,
} from "./common";

export const notificationParamsSchema = z
  .record(z.string(), z.union([z.string(), z.number()]))
  .meta({ id: "NotificationParams" });

/** `titleKey` is a Paraglide message key; the reader's locale renders it with `params`. */
export const notificationSchema = z
  .object({
    id: z.string(),
    kind: z.enum(NOTIFICATION_KINDS),
    taskId: z.string().nullable(),
    titleKey: z.enum(NOTIFICATION_TITLE_KEYS),
    params: notificationParamsSchema,
    url: z.string().nullable(),
    createdAt: isoTimestampSchema,
    readAt: isoTimestampSchema.nullable(),
  })
  .meta({ id: "Notification" });
export type Notification = z.infer<typeof notificationSchema>;

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  /** Only unread notifications. */
  unread: queryBooleanSchema.optional(),
});
export const listNotificationsResponseSchema = paginated(notificationSchema);

export const notificationIdParamsSchema = z.object({ id: idSchema });

export const unreadCountResponseSchema = z.object({
  count: z.number().int().min(0),
});

export const readAllResponseSchema = z.object({
  updated: z.number().int().min(0),
});
