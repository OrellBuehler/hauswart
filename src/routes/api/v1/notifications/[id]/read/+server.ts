import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { read } from "#lib/server/api/handlers/notifications.ts";

export const POST = bind(endpoints.notificationsRead, read);
