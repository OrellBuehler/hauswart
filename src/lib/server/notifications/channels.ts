import type { UserLocale } from "$lib/api/enums";

export interface NotificationRecipient {
  id: string;
  locale: UserLocale;
}

/** What a channel gets to see; the stored row, with the parameters already parsed. */
export interface DeliverableNotification {
  id: string;
  userId: string | null;
  kind: string;
  taskId: string | null;
  titleKey: string;
  params: Record<string, string | number>;
  url: string | null;
  createdAt: Date;
}

/**
 * An outward delivery path (web push, a smart-home notify service, ...). The in-app
 * list needs no channel: every notification is stored. A channel is called once
 * per new notification with everyone it concerns (a household notification
 * names all users); failures are logged by channel name and never block the
 * others or the evaluation that produced the notification.
 */
export interface NotificationChannel {
  name: string;
  deliver(
    notification: DeliverableNotification,
    recipients: NotificationRecipient[],
  ): void | Promise<void>;
}

const channels = new Map<string, NotificationChannel>();

/** Adds (or replaces, by name) a channel; returns a function that removes it. */
export function registerNotificationChannel(
  channel: NotificationChannel,
): () => void {
  channels.set(channel.name, channel);
  return () => {
    if (channels.get(channel.name) === channel) channels.delete(channel.name);
  };
}

export function registeredChannels(): string[] {
  return [...channels.keys()];
}

export async function deliverToChannels(
  notification: DeliverableNotification,
  recipients: NotificationRecipient[],
): Promise<void> {
  for (const channel of channels.values()) {
    try {
      await channel.deliver(notification, recipients);
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "notifications.channel_failed",
          channel: channel.name,
          name: err instanceof Error ? err.name : "NonError",
        }),
      );
    }
  }
}
