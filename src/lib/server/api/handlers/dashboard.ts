import type { endpoints } from "$lib/api/registry";
import { costsYearToDate } from "$lib/server/costs/summary";
import { selectAllDefects } from "$lib/server/defects/defects";
import { countPendingSuggestions } from "$lib/server/finance/suggestions";
import { listOrderNow } from "$lib/server/parts/order-now";
import { getDashboard } from "$lib/server/tasks/dashboard";
import { getStats } from "$lib/server/tasks/stats";
import { dashboardWarranties } from "$lib/server/warranties/warranties";
import type { Handler } from "../bind";
import { wireDashboard } from "../wire";

export const get: Handler<typeof endpoints.dashboard> = async ({ ctx }) =>
  wireDashboard(await getDashboard(ctx), {
    openDefects: selectAllDefects(ctx, { active: true }),
    expiringWarranties: dashboardWarranties(ctx),
    orderNow: listOrderNow(ctx),
    costsYearToDate: costsYearToDate(ctx),
    pendingFinanceSuggestions: countPendingSuggestions(ctx, ctx.user.id),
  });

export const stats: Handler<typeof endpoints.stats> = ({ ctx, query }) =>
  getStats(ctx, query);
