import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/cost-recurrences";

export const GET = bind(endpoints.costRecurrencesList, list);
export const POST = bind(endpoints.costRecurrencesCreate, create);
