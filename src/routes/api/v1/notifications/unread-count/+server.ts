import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { count } from "#lib/server/api/handlers/notifications.ts";

export const GET = bind(endpoints.notificationsUnreadCount, count);
