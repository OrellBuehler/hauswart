import type { endpoints } from "#lib/api/registry.ts";
import { countAiTasks } from "#lib/server/ai-tasks/ai-tasks.ts";
import { dashboardBalances } from "#lib/server/costs/balances.ts";
import { dashboardBudgetAlerts } from "#lib/server/costs/budgets.ts";
import { countReviewNeeded } from "#lib/server/costs/costs.ts";
import { costsYearToDate } from "#lib/server/costs/summary.ts";
import { selectAllDefects } from "#lib/server/defects/defects.ts";
import { countPendingSuggestions } from "#lib/server/finance/suggestions.ts";
import { listOrderNow } from "#lib/server/parts/order-now.ts";
import { getDashboard } from "#lib/server/tasks/dashboard.ts";
import { getStats } from "#lib/server/tasks/stats.ts";
import { dashboardWarranties } from "#lib/server/warranties/warranties.ts";
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
