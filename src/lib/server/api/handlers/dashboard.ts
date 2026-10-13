import type { endpoints } from "$lib/api/registry";
import { countAiTasks } from "$lib/server/ai-tasks/ai-tasks";
import { dashboardBalances } from "$lib/server/costs/balances";
import { dashboardBudgetAlerts } from "$lib/server/costs/budgets";
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
 * A part of the dashboard (the caller's balances, the budget alerts), or null when it cannot be worked out: each is one
 * card and must not take the tasks, defects and everything else down with it. Logged by event, error name and code only,
 * as `bind` does.
 */
function orNull<T>(event: string, compute: () => T): T | null {
  try {
    return compute();
  } catch (err) {
    console.error(
      JSON.stringify({
        event,
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
    balances: orNull("dashboard.balances_failed", () =>
      dashboardBalances(ctx, ctx.user.id),
    ),
    budgetAlerts: orNull("dashboard.budget_alerts_failed", () =>
      dashboardBudgetAlerts(ctx),
    ),
    pendingFinanceSuggestions: countPendingSuggestions(ctx, ctx.user.id),
    reviewNeededCount: countReviewNeeded(ctx),
    pendingReceiptCount: countAiTasks(ctx, { status: "pending" }),
  });

export const stats: Handler<typeof endpoints.stats> = ({ ctx, query }) =>
  getStats(ctx, query);
