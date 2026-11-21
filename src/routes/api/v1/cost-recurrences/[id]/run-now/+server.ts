import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { runNow } from "#lib/server/api/handlers/cost-recurrences.ts";

export const POST = bind(endpoints.costRecurrencesRun, runNow);
