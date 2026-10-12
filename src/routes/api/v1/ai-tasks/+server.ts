import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/ai-tasks";

export const GET = bind(endpoints.aiTasksList, list);
export const POST = bind(endpoints.aiTasksCreate, create);
