import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { listAllCompletions } from "$lib/server/api/handlers/tasks";

export const GET = bind(endpoints.completionsList, listAllCompletions);
