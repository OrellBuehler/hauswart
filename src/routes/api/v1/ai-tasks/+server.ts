import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/ai-tasks.ts";

export const GET = bind(endpoints.aiTasksList, list);
export const POST = bind(endpoints.aiTasksCreate, create);
