import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { complete } from "$lib/server/api/handlers/ai-tasks";

export const POST = bind(endpoints.aiTasksComplete, complete);
