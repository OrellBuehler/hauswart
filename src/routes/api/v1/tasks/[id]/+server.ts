import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/tasks";

export const GET = bind(endpoints.tasksGet, get);
export const PATCH = bind(endpoints.tasksUpdate, update);
export const DELETE = bind(endpoints.tasksDelete, remove);
