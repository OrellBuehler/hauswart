import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { action } from "$lib/server/api/handlers/notificationSettings";

export const POST = bind(endpoints.haAction, action);
