import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, put } from "$lib/server/api/handlers/notificationSettings";

export const GET = bind(endpoints.notificationSettingsGet, get);
export const PUT = bind(endpoints.notificationSettingsPut, put);
