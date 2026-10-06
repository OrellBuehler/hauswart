import { and, eq } from "drizzle-orm";
import {
  DEFAULT_PUSH_STAGES,
  type NotificationTargetChannel,
  type PushStage,
} from "$lib/api/enums";
import type {
  NotificationSettings,
  notificationSettingsResponseSchema,
} from "$lib/api/schemas/notification-settings";
import type { z } from "zod";
import { notificationPrefs, notificationTargets } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";

type Db = Pick<ServiceContext, "db">;

export interface Prefs {
  pushEnabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  pushStages: PushStage[];
}

export const DEFAULT_PREFS: Prefs = {
  pushEnabled: true,
  quietStart: null,
  quietEnd: null,
  pushStages: [...DEFAULT_PUSH_STAGES],
};

export function getPrefs(ctx: Db, userId: string): Prefs {
  const row = ctx.db
    .select()
    .from(notificationPrefs)
    .where(eq(notificationPrefs.userId, userId))
    .get();
  if (!row) return { ...DEFAULT_PREFS, pushStages: [...DEFAULT_PUSH_STAGES] };
  return {
    pushEnabled: row.pushEnabled,
    quietStart: row.quietStart,
    quietEnd: row.quietEnd,
    pushStages: row.pushStages as PushStage[],
  };
}

export interface TargetRecord {
  id: string;
  channel: NotificationTargetChannel;
  target: string;
  enabled: boolean;
}

export function listTargets(ctx: Db, userId: string): TargetRecord[] {
  return ctx.db
    .select({
      id: notificationTargets.id,
      channel: notificationTargets.channel,
      target: notificationTargets.target,
      enabled: notificationTargets.enabled,
    })
    .from(notificationTargets)
    .where(eq(notificationTargets.userId, userId))
    .orderBy(notificationTargets.channel, notificationTargets.target)
    .all();
}

/** The enabled targets of a person for one channel, for the channel that delivers to them. */
export function enabledTargets(
  ctx: Db,
  userId: string,
  channel: NotificationTargetChannel,
): string[] {
  return ctx.db
    .select({ target: notificationTargets.target })
    .from(notificationTargets)
    .where(
      and(
        eq(notificationTargets.userId, userId),
        eq(notificationTargets.channel, channel),
        eq(notificationTargets.enabled, true),
      ),
    )
    .orderBy(notificationTargets.target)
    .all()
    .map((r) => r.target);
}

export function getSettings(
  ctx: Db,
  userId: string,
): z.output<typeof notificationSettingsResponseSchema> {
  const prefs = getPrefs(ctx, userId);
  return { ...prefs, targets: listTargets(ctx, userId) };
}

/** Replaces the person's preferences and targets in one go (what the settings form sends). */
export function saveSettings(
  ctx: Db,
  userId: string,
  input: NotificationSettings,
): z.output<typeof notificationSettingsResponseSchema> {
  ctx.db.transaction((tx) => {
    tx.insert(notificationPrefs)
      .values({
        userId,
        pushEnabled: input.pushEnabled,
        quietStart: input.quietStart,
        quietEnd: input.quietEnd,
        pushStages: input.pushStages,
      })
      .onConflictDoUpdate({
        target: notificationPrefs.userId,
        set: {
          pushEnabled: input.pushEnabled,
          quietStart: input.quietStart,
          quietEnd: input.quietEnd,
          pushStages: input.pushStages,
        },
      })
      .run();
    tx.delete(notificationTargets)
      .where(eq(notificationTargets.userId, userId))
      .run();
    for (const t of input.targets) {
      tx.insert(notificationTargets)
        .values({
          userId,
          channel: t.channel,
          target: t.target,
          enabled: t.enabled,
        })
        .run();
    }
  });
  return getSettings(ctx, userId);
}
