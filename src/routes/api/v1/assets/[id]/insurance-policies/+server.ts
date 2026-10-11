import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { listForAsset } from "$lib/server/api/handlers/insurance";

export const GET = bind(endpoints.assetInsurancePoliciesList, listForAsset);
