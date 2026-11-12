import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { putSteps } from "$lib/server/api/handlers/tasks";

export const PUT = bind(endpoints.tasksStepsPut, putSteps);
