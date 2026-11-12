import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { preview } from "#lib/server/api/handlers/ai-tasks.ts";

export const GET = bind(endpoints.aiTasksPreview, preview);
