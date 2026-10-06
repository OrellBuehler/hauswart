import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { remove, update } from "$lib/server/api/handlers/comments";

export const PATCH = bind(endpoints.commentsUpdate, update);
export const DELETE = bind(endpoints.commentsDelete, remove);
