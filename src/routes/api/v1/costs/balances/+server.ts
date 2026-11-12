import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { balances } from "#lib/server/api/handlers/costs.ts";

export const GET = bind(endpoints.costsBalances, balances);
