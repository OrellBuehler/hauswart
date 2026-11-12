import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { count } from "#lib/server/api/handlers/ai-tasks.ts";

export const GET = bind(endpoints.aiTasksCount, count);
