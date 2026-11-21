import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { snooze } from "#lib/server/api/handlers/tasks.ts";

export const POST = bind(endpoints.tasksSnooze, snooze);
