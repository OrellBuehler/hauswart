import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/insurance";

export const GET = bind(endpoints.insurancePoliciesList, list);
export const POST = bind(endpoints.insurancePoliciesCreate, create);
