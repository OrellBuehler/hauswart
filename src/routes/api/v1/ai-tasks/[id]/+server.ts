import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove } from "$lib/server/api/handlers/ai-tasks";

export const GET = bind(endpoints.aiTasksGet, get);
export const DELETE = bind(endpoints.aiTasksDelete, remove);
