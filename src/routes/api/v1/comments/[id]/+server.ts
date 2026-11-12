import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { remove, update } from "#lib/server/api/handlers/comments.ts";

export const PATCH = bind(endpoints.commentsUpdate, update);
export const DELETE = bind(endpoints.commentsDelete, remove);
