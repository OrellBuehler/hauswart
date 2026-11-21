import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { readAll } from "#lib/server/api/handlers/notifications.ts";

export const POST = bind(endpoints.notificationsReadAll, readAll);
