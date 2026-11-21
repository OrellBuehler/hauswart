import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, remove, update } from "#lib/server/api/handlers/attachments.ts";

export const GET = bind(endpoints.attachmentsGet, get);
export const PATCH = bind(endpoints.attachmentsUpdate, update);
export const DELETE = bind(endpoints.attachmentsDelete, remove);
