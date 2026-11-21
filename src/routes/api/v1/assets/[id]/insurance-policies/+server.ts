import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { listForAsset } from "#lib/server/api/handlers/insurance.ts";

export const GET = bind(endpoints.assetInsurancePoliciesList, listForAsset);
