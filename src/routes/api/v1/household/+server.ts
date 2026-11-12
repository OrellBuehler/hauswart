import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, update } from "#lib/server/api/handlers/household.ts";

export const GET = bind(endpoints.householdGet, get);
export const PATCH = bind(endpoints.householdUpdate, update);
