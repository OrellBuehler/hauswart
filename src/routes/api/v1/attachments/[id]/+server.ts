import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/attachments";

export const GET = bind(endpoints.attachmentsGet, get);
export const PATCH = bind(endpoints.attachmentsUpdate, update);
export const DELETE = bind(endpoints.attachmentsDelete, remove);
