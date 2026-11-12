import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import {
  get,
  remove,
  update,
} from "#lib/server/api/handlers/cost-recurrences.ts";

export const GET = bind(endpoints.costRecurrencesGet, get);
export const PATCH = bind(endpoints.costRecurrencesUpdate, update);
export const DELETE = bind(endpoints.costRecurrencesDelete, remove);
