import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { count } from "$lib/server/api/handlers/ai-tasks";

export const GET = bind(endpoints.aiTasksCount, count);
