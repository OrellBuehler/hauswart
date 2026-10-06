import { z } from "zod";
import { NOTIFICATION_TARGET_CHANNELS, PUSH_STAGES } from "../enums";

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  error: "Expected HH:MM",
});

/** A notify service name of the smart-home system, e.g. `mobile_app_example_phone`. */
export const NOTIFY_TARGET_PATTERN = /^[a-z0-9_]+$/;

export const MAX_NOTIFICATION_TARGETS = 10;

const targetFields = {
  channel: z.enum(NOTIFICATION_TARGET_CHANNELS),
  target: z.string().trim().min(1).max(100).regex(NOTIFY_TARGET_PATTERN, {
    error: "Only lowercase letters, digits and underscores.",
  }),
  enabled: z.boolean(),
};

export const notificationTargetInputSchema = z.strictObject(targetFields);

export const notificationTargetSchema = z
  .object({ id: z.string(), ...targetFields })
  .meta({ id: "NotificationTarget" });

const pushStagesSchema = z.array(z.enum(PUSH_STAGES)).max(PUSH_STAGES.length);

const prefFields = {
  pushEnabled: z.boolean(),
  /** `HH:MM` in the household time zone; both or neither. Notifications arriving in between are held back. */
  quietStart: timeOfDaySchema.nullable(),
  quietEnd: timeOfDaySchema.nullable(),
  /** Which kinds of notification reach the phone; the in-app list always has them all. */
  pushStages: pushStagesSchema,
};

/** `PUT` replaces everything: preferences and the list of targets. */
export const notificationSettingsSchema = z
  .strictObject({
    ...prefFields,
    pushStages: pushStagesSchema.transform((stages) => [...new Set(stages)]),
    targets: z
      .array(notificationTargetInputSchema)
      .max(MAX_NOTIFICATION_TARGETS),
  })
  .superRefine((value, ctx) => {
    if ((value.quietStart === null) !== (value.quietEnd === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["quietStart"],
        message: "Set both ends of the quiet hours or neither.",
      });
    }
    const seen = new Set<string>();
    value.targets.forEach((t, i) => {
      const key = `${t.channel}:${t.target}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["targets", i, "target"],
          message: "Listed twice.",
        });
      }
      seen.add(key);
    });
  });
export type NotificationSettings = z.output<typeof notificationSettingsSchema>;

export const notificationSettingsResponseSchema = z
  .object({
    ...prefFields,
    targets: z.array(notificationTargetSchema),
  })
  .meta({ id: "NotificationSettings" });
