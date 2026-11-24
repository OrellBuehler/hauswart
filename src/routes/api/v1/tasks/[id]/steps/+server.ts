import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { putSteps } from "#lib/server/api/handlers/tasks.ts";

export const PUT = bind(endpoints.tasksStepsPut, putSteps);
