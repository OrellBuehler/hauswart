import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, remove, update } from "#lib/server/api/handlers/insurance.ts";

export const GET = bind(endpoints.insurancePoliciesGet, get);
export const PATCH = bind(endpoints.insurancePoliciesUpdate, update);
export const DELETE = bind(endpoints.insurancePoliciesDelete, remove);
