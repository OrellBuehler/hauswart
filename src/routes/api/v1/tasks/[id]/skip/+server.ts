import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { skip } from "$lib/server/api/handlers/tasks";

export const POST = bind(endpoints.tasksSkip, skip);
