import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { recentCategoryCounts } from "$lib/server/api/handlers/costs";

export const GET = bind(endpoints.costsRecentCategories, recentCategoryCounts);
