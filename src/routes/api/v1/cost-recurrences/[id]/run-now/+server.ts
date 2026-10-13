import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { runNow } from "$lib/server/api/handlers/cost-recurrences";

export const POST = bind(endpoints.costRecurrencesRun, runNow);
