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
  /** The task occurrence the notification is about; set for task stages. */
  occurrenceKey?: string | null;
}

/** A button the channel may offer. `complete` marks the task occurrence done; `id` is a one-time token. */
export interface ChannelAction {
  id: string;
  kind: "complete";
}

export interface DeliveryRequest {
  actions: ChannelAction[];
  /** Only these targets (a retry of failed deliveries); undefined = all of the recipient's targets. */
  targets?: string[];
}

/** What happened for one target of the recipient; `skipped` leaves no trace. */
export interface DeliveryOutcome {
  status: "sent" | "failed" | "skipped";
  /** What was addressed, e.g. a notify service name. */
  target?: string;
  /** A short machine-readable code, never a message. */
  error?: string;
}

/**
 * An outward delivery path (web push, a smart-home notify service, ...). The
 * in-app list needs no channel: every notification is stored. A channel is
 * called once per recipient and notification, after the core applied the
 * person's push preferences and quiet hours; it finds the recipient's targets
 * itself and reports one outcome per target. A thrown error counts as one
 * failed delivery, logged by channel name, and never blocks the others.
 */
export interface NotificationChannel {
  name: string;
  deliver(
    notification: DeliverableNotification,
    recipient: NotificationRecipient,
    request: DeliveryRequest,
  ): DeliveryOutcome[] | Promise<DeliveryOutcome[]>;
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

export function getChannel(name: string): NotificationChannel | undefined {
  return channels.get(name);
}

export function allChannels(): NotificationChannel[] {
  return [...channels.values()];
}
