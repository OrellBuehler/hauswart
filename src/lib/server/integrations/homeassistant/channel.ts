import { getDB } from "$lib/server/db";
import type {
  DeliveryOutcome,
  NotificationChannel,
} from "$lib/server/notifications/channels";
import { enabledTargets } from "$lib/server/notifications/settings";
import { resolveConnection } from "$lib/server/connections/connections";
import { appUrlOf } from "./adapter";
import { clientFor, householdConnection } from "./connection";
import { errorCode } from "./errors";
import { renderPush } from "./render";

/** The channel name stored on deliveries and in `notification_targets.channel`. */
export const CHANNEL_NAME = "ha_notify";

/**
 * Pushes notifications to the notify services the recipient chose
 * (`notification_targets`). Without a connection, or without targets, it does
 * nothing. One call per target; a failing target is reported as `failed` with
 * a short error code and does not stop the others. The core decided before
 * whether and when to push (preferences, quiet hours).
 */
export function createNotifyChannel(): NotificationChannel {
  return {
    name: CHANNEL_NAME,
    async deliver(notification, recipient, request) {
      const db = getDB();
      const row = householdConnection(db);
      if (!row) return [];
      const wanted = enabledTargets({ db }, recipient.id, "ha_notify").filter(
        (t) => !request.targets || request.targets.includes(t),
      );
      if (wanted.length === 0) return [];
      const connection = resolveConnection(row);
      const client = clientFor(connection);
      const payload = renderPush({
        notification,
        locale: recipient.locale,
        appUrl: appUrlOf(connection.config),
        actions: request.actions,
      });
      const outcomes: DeliveryOutcome[] = [];
      for (const target of wanted) {
        try {
          await client.sendNotification(target, payload);
          outcomes.push({ status: "sent", target });
        } catch (err) {
          outcomes.push({ status: "failed", target, error: errorCode(err) });
        }
      }
      return outcomes;
    },
  };
}
