import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { accounts } from "$lib/server/api/handlers/finance";

export const GET = bind(endpoints.integrationsAccounts, accounts);
