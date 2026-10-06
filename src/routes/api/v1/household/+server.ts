import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, update } from "$lib/server/api/handlers/household";

export const GET = bind(endpoints.householdGet, get);
export const PATCH = bind(endpoints.householdUpdate, update);
