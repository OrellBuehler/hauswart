import { and, eq, lt, lte, or } from "drizzle-orm";
import { householdTimeZone } from "$lib/server/config";
import {
  notificationDeliveries,
  notifications,
  taskState,
  users,
} from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { ACTION_TOKEN_TTL_MS, mintActionToken } from "./actions";
import {
  allChannels,
  getChannel,
  type ChannelAction,
  type DeliverableNotification,
  type DeliveryOutcome,
  type NotificationChannel,
  type NotificationRecipient,
} from "./channels";
import { inQuietHours } from "./quiet-hours";
import { getPrefs } from "./settings";

/** Stages that offer a "done" button: they are about one occurrence of a task. */
const ACTIONABLE_KINDS = new Set(["prep", "due_soon", "due", "overdue"]);
export const MAX_DELIVERY_ATTEMPTS = 3;
/** A held-back or failed notification older than this is not sent any more. */
export const DELIVERY_EXPIRY_MS = 24 * 60 * 60 * 1000;
const RETRY_BASE_MS = 2 * 60 * 1000;

type Ctx = Pick<ServiceContext, "db" | "now">;

function logChannelFailure(channel: string, err: unknown): void {
  // Channel and error name only: addresses and message texts are household data.
  console.error(
    JSON.stringify({
      event: "notifications.channel_failed",
      channel,
      name: err instanceof Error ? err.name : "NonError",
    }),
  );
}

async function runChannel(
  channel: NotificationChannel,
  notification: DeliverableNotification,
  recipient: NotificationRecipient,
  actions: ChannelAction[],
  targets?: string[],
): Promise<DeliveryOutcome[]> {
  try {
    const outcomes = await channel.deliver(notification, recipient, {
      actions,
      ...(targets ? { targets } : {}),
    });
    return Array.isArray(outcomes) ? outcomes : [];
  } catch (err) {
    logChannelFailure(channel.name, err);
    return [
      {
        status: "failed",
        error: err instanceof Error ? err.name : "unknown",
      },
    ];
  }
}

interface AttemptInput {
  notification: DeliverableNotification;
  recipient: NotificationRecipient;
  channel: NotificationChannel;
  attempts: number;
  targets?: string[];
}

/** One delivery attempt through one channel; stores a row per target that was addressed. */
async function attempt(ctx: Ctx, input: AttemptInput): Promise<void> {
  const { notification, recipient, channel } = input;
  const minted =
    ACTIONABLE_KINDS.has(notification.kind) && notification.taskId
      ? mintActionToken()
      : null;
  const actions: ChannelAction[] = minted
    ? [{ id: minted.token, kind: "complete" }]
    : [];
  const outcomes = await runChannel(
    channel,
    notification,
    recipient,
    actions,
    input.targets,
  );
  for (const outcome of outcomes) {
    if (outcome.status === "skipped") continue;
    const sent = outcome.status === "sent";
    ctx.db
      .insert(notificationDeliveries)
      .values({
        notificationId: notification.id,
        userId: recipient.id,
        channel: channel.name,
        target: outcome.target ?? "",
        status: outcome.status,
        errorCode: outcome.error ?? null,
        attempts: input.attempts,
        occurrenceKey: notification.occurrenceKey ?? null,
        sentAt: new Date(ctx.now),
        ...(sent && minted
          ? {
              actionTokenHash: minted.hash,
              actionExpiresAt: new Date(ctx.now + ACTION_TOKEN_TTL_MS),
            }
          : {}),
      })
      .run();
  }
}

function holdBack(
  ctx: Ctx,
  notification: DeliverableNotification,
  recipient: NotificationRecipient,
  channel: NotificationChannel,
): void {
  ctx.db
    .insert(notificationDeliveries)
    .values({
      notificationId: notification.id,
      userId: recipient.id,
      channel: channel.name,
      target: "",
      status: "deferred",
      attempts: 0,
      occurrenceKey: notification.occurrenceKey ?? null,
      sentAt: new Date(ctx.now),
    })
    .run();
}

/**
 * Sends a new notification to the outward channels, one recipient at a time:
 * people who turned push off or who do not want this kind get nothing outside
 * the app; during their quiet hours the delivery is held back (`deferred`) and
 * `retryDeliveries` sends it afterwards. Task stages carry a one-time "done"
 * token (seven days) per recipient. A channel's failure is recorded on its
 * delivery row and never stops the others.
 */
export async function deliverToChannels(
  ctx: Ctx,
  notification: DeliverableNotification,
  recipients: NotificationRecipient[],
): Promise<void> {
  const channels = allChannels();
  if (channels.length === 0) return;
  const tz = householdTimeZone();
  for (const recipient of recipients) {
    const prefs = getPrefs(ctx, recipient.id);
    if (!prefs.pushEnabled) continue;
    if (!(prefs.pushStages as string[]).includes(notification.kind)) continue;
    const quiet = inQuietHours(ctx.now, tz, prefs.quietStart, prefs.quietEnd);
    for (const channel of channels) {
      if (quiet) holdBack(ctx, notification, recipient, channel);
      else
        await attempt(ctx, { notification, recipient, channel, attempts: 1 });
    }
  }
}

/** Delivery rows older than this are deleted; the notifications themselves stay. */
export const DELIVERY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Housekeeping: drops delivery rows (and with them their used or expired tokens) after 90 days. */
export function pruneDeliveries(ctx: Ctx): number {
  return ctx.db
    .delete(notificationDeliveries)
    .where(
      lt(
        notificationDeliveries.sentAt,
        new Date(ctx.now - DELIVERY_RETENTION_MS),
      ),
    )
    .returning({ id: notificationDeliveries.id })
    .all().length;
}

function retryDelay(attempts: number): number {
  return RETRY_BASE_MS * 2 ** (attempts - 1);
}

export interface RetrySummary {
  sent: number;
  skipped: number;
  retried: number;
}

/**
 * Works through held-back deliveries whose quiet hours are over and failed
 * ones that have attempts left (2, 4 minutes ... apart, three tries in all).
 * What is stale is dropped instead: older than a day, already read, or about a
 * task occurrence that has since been settled.
 */
export async function retryDeliveries(ctx: Ctx): Promise<RetrySummary> {
  const summary: RetrySummary = { sent: 0, skipped: 0, retried: 0 };
  const rows = ctx.db
    .select()
    .from(notificationDeliveries)
    .where(
      or(
        eq(notificationDeliveries.status, "deferred"),
        and(
          eq(notificationDeliveries.status, "failed"),
          lte(notificationDeliveries.attempts, MAX_DELIVERY_ATTEMPTS - 1),
        ),
      ),
    )
    .all();
  const tz = householdTimeZone();
  for (const row of rows) {
    const deferred = row.status === "deferred";
    if (
      !deferred &&
      ctx.now - row.sentAt.getTime() < retryDelay(row.attempts)
    ) {
      continue;
    }
    const drop = (code: string) => {
      ctx.db
        .update(notificationDeliveries)
        .set({ status: "skipped", errorCode: code })
        .where(eq(notificationDeliveries.id, row.id))
        .run();
      summary.skipped += 1;
    };
    const channel = getChannel(row.channel);
    if (!channel) continue;
    if (ctx.now - row.sentAt.getTime() > DELIVERY_EXPIRY_MS) {
      drop("expired");
      continue;
    }
    const notification = ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, row.notificationId))
      .get();
    if (!notification || notification.readAt) {
      drop("read");
      continue;
    }
    if (ACTIONABLE_KINDS.has(notification.kind) && notification.taskId) {
      const state = ctx.db
        .select({ occurrenceKey: taskState.occurrenceKey })
        .from(taskState)
        .where(eq(taskState.taskId, notification.taskId))
        .get();
      if (
        !state ||
        (row.occurrenceKey && state.occurrenceKey !== row.occurrenceKey)
      ) {
        drop("stale");
        continue;
      }
    }
    const person = ctx.db
      .select({ id: users.id, locale: users.locale })
      .from(users)
      .where(eq(users.id, row.userId))
      .get();
    if (!person) {
      drop("no_recipient");
      continue;
    }
    const prefs = getPrefs(ctx, person.id);
    if (!prefs.pushEnabled) {
      drop("push_off");
      continue;
    }
    if (
      deferred &&
      inQuietHours(ctx.now, tz, prefs.quietStart, prefs.quietEnd)
    ) {
      continue;
    }
    ctx.db
      .delete(notificationDeliveries)
      .where(eq(notificationDeliveries.id, row.id))
      .run();
    await attempt(ctx, {
      notification: {
        id: notification.id,
        userId: notification.userId,
        kind: notification.kind,
        taskId: notification.taskId,
        titleKey: notification.titleKey,
        params: notification.paramsJson,
        url: notification.url,
        createdAt: notification.createdAt,
        occurrenceKey: row.occurrenceKey,
      },
      recipient: person,
      channel,
      attempts: row.attempts + 1,
      ...(deferred || row.target === "" ? {} : { targets: [row.target] }),
    });
    if (deferred) summary.sent += 1;
    else summary.retried += 1;
  }
  return summary;
}
