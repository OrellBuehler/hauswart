import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { listAllCompletions } from "#lib/server/api/handlers/tasks.ts";

export const GET = bind(endpoints.completionsList, listAllCompletions);
