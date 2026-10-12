import type { endpoints } from "$lib/api/registry";
import type { DashboardBalances } from "$lib/api/schemas/costs";
import { countAiTasks } from "$lib/server/ai-tasks/ai-tasks";
import { dashboardBalances } from "$lib/server/costs/balances";
import { countReviewNeeded } from "$lib/server/costs/costs";
import { costsYearToDate } from "$lib/server/costs/summary";
import { selectAllDefects } from "$lib/server/defects/defects";
import { countPendingSuggestions } from "$lib/server/finance/suggestions";
import { listOrderNow } from "$lib/server/parts/order-now";
import { getDashboard } from "$lib/server/tasks/dashboard";
import { getStats } from "$lib/server/tasks/stats";
import { dashboardWarranties } from "$lib/server/warranties/warranties";
import type { Handler } from "../bind";
import { wireDashboard } from "../wire";

/**
 * The caller's balances, or null when they cannot be worked out: they are one card of the dashboard and must not take
 * the tasks, defects and everything else down with them. Logged by error name and code only, as `bind` does.
 */
function balancesOrNull(
  ctx: Parameters<typeof dashboardBalances>[0],
  userId: string,
): DashboardBalances | null {
  try {
    return dashboardBalances(ctx, userId);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "dashboard.balances_failed",
        name: err instanceof Error ? err.name : "NonError",
        code:
          typeof (err as { code?: unknown } | null)?.code === "string"
            ? (err as { code: string }).code
            : undefined,
      }),
    );
    return null;
  }
}

export const get: Handler<typeof endpoints.dashboard> = async ({ ctx }) =>
  wireDashboard(await getDashboard(ctx), {
    openDefects: selectAllDefects(ctx, { active: true }),
    expiringWarranties: dashboardWarranties(ctx),
    orderNow: listOrderNow(ctx),
    costsYearToDate: costsYearToDate(ctx),
    balances: balancesOrNull(ctx, ctx.user.id),
    pendingFinanceSuggestions: countPendingSuggestions(ctx, ctx.user.id),
    reviewNeededCount: countReviewNeeded(ctx),
    pendingReceiptCount: countAiTasks(ctx, { status: "pending" }),
  });

export const stats: Handler<typeof endpoints.stats> = ({ ctx, query }) =>
  getStats(ctx, query);
