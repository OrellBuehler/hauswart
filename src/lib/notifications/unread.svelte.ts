import { api } from "$lib/api/browser";
import { endpoints } from "$lib/api/registry";

/** The unread count shown on the bell; shared so the notifications page can update it. */
export const unread = $state({ count: 0 });

export async function refreshUnread(): Promise<void> {
  try {
    const { count } = await api.call(endpoints.notificationsUnreadCount);
    unread.count = count;
  } catch (err) {
    // The badge keeps its last value; a failed poll is not worth interrupting the user.
    console.error(
      "unread count refresh failed",
      err instanceof Error ? err.name : "unknown",
    );
  }
}
