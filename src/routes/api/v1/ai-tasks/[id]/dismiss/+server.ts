import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { dismiss } from "#lib/server/api/handlers/ai-tasks.ts";

export const POST = bind(endpoints.aiTasksDismiss, dismiss);
