import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { snooze } from "$lib/server/api/handlers/tasks";

export const POST = bind(endpoints.tasksSnooze, snooze);
