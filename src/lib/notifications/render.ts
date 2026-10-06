import type { Notification } from "$lib/api/schemas/notifications";
import { formatDate } from "$lib/format";
import { m } from "$lib/paraglide/messages";

type Render = (params: Record<string, string | number>) => string;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A notification's title in the reader's language: `titleKey` is a message key, `params` its values. */
export function notificationText(notification: Notification): string {
  const params: Record<string, string | number> = { ...notification.params };
  if (typeof params.date === "string") {
    params.date = CALENDAR_DATE.test(params.date)
      ? formatDate(params.date)
      : "–";
  }
  const render = m[notification.titleKey] as unknown as Render;
  return render(params);
}

/** The in-app path a notification leads to, or null when it has none (or an unsafe one). */
export function notificationPath(notification: Notification): string | null {
  const url = notification.url;
  if (!url || !url.startsWith("/") || url.startsWith("//")) return null;
  return url;
}
