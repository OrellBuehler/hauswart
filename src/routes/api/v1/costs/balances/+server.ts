import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { balances } from "$lib/server/api/handlers/costs";

export const GET = bind(endpoints.costsBalances, balances);
