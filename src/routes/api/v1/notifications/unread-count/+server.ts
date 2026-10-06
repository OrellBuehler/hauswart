import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { count } from "$lib/server/api/handlers/notifications";

export const GET = bind(endpoints.notificationsUnreadCount, count);
