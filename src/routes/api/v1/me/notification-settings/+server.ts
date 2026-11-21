import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, put } from "#lib/server/api/handlers/notificationSettings.ts";

export const GET = bind(endpoints.notificationSettingsGet, get);
export const PUT = bind(endpoints.notificationSettingsPut, put);
