import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/insurance.ts";

export const GET = bind(endpoints.insurancePoliciesList, list);
export const POST = bind(endpoints.insurancePoliciesCreate, create);
