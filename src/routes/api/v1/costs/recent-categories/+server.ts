import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { recentCategoryCounts } from "#lib/server/api/handlers/costs.ts";

export const GET = bind(endpoints.costsRecentCategories, recentCategoryCounts);
