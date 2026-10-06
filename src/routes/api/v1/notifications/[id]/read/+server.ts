import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { read } from "$lib/server/api/handlers/notifications";

export const POST = bind(endpoints.notificationsRead, read);
