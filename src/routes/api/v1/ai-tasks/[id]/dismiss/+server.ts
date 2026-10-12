import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { dismiss } from "$lib/server/api/handlers/ai-tasks";

export const POST = bind(endpoints.aiTasksDismiss, dismiss);
