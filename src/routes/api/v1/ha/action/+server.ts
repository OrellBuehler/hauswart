import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { action } from "#lib/server/api/handlers/notificationSettings.ts";

export const POST = bind(endpoints.haAction, action);
