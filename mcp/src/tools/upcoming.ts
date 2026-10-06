import { z } from "zod";
import { endpoints } from "../../../src/lib/api/registry";
import type { Dashboard } from "../../../src/lib/api/schemas/dashboard";
import { plural } from "../format";
import { defineTool } from "../tool";

type DashboardTask = Dashboard["upcoming"]["overdue"][number];

const HORIZONS = {
  today: ["overdue", "today"],
  week: ["overdue", "today", "thisWeek"],
  all: ["overdue", "today", "thisWeek", "later", "signalBased"],
} as const;

const row = (t: DashboardTask) => ({
  id: t.taskId,
  title: t.title,
  category: t.category,
  priority: t.priority === "normal" ? null : t.priority,
  status: t.status,
  date: t.date,
  estimated: t.estimated ? true : null,
  progress: t.progress,
  asset: t.assetName,
  room: t.roomName,
  assignee: t.assigneeName,
});

export const listUpcoming = defineTool({
  name: "list_upcoming",
  title: "List upcoming tasks",
  description:
    "What needs doing: tasks grouped as overdue, today, thisWeek, later (next 60 days) and signalBased (no date, driven by a sensor), plus preparations that are due to start and, household-wide, openDefects (by deadline), expiringWarranties and orderNow (spare parts to order). Start here for 'what is due', 'what should I do today/this week'. horizon: today = overdue + today, week (default) = also this week, all = also later and signal-based. mine: only tasks currently assigned to the token's user. Each task has an id for get_task / complete_task.",
  mode: "read",
  input: {
    horizon: z.enum(["today", "week", "all"]).default("week"),
    mine: z.boolean().default(false),
  },
  async handler({ horizon, mine }, ctx) {
    const dash = await ctx.api.call(endpoints.dashboard);
    const keep = (t: DashboardTask) => !mine || t.assigneeUserId === ctx.me.id;
    const buckets = HORIZONS[horizon];
    const upcoming = Object.fromEntries(
      buckets.map((b) => [b, dash.upcoming[b].filter(keep).map(row)]),
    );
    const total = Object.values(upcoming).reduce((n, a) => n + a.length, 0);
    const mineIds = new Set(
      buckets.flatMap((b) =>
        dash.upcoming[b].filter(keep).map((t) => t.taskId),
      ),
    );
    const preparations = dash.preparations.filter(
      (p) => !mine || mineIds.has(p.taskId),
    );
    const counts = Object.entries(upcoming)
      .map(([bucket, items]) => `${items.length} ${bucket}`)
      .join(", ");
    const attention = [
      dash.openDefects.length > 0 &&
        plural(dash.openDefects.length, "open defect"),
      dash.expiringWarranties.length > 0 &&
        `${dash.expiringWarranties.length} expiring ${dash.expiringWarranties.length === 1 ? "warranty" : "warranties"}`,
      dash.orderNow.length > 0 && `${dash.orderNow.length} to order`,
    ].filter(Boolean);
    return {
      summary: `${plural(total, "task")} (${counts}) as of ${dash.today}${mine ? " for you" : ""}.${attention.length > 0 ? ` Also: ${attention.join(", ")}.` : ""}`,
      data: {
        asOf: dash.today,
        ...upcoming,
        openDefects: dash.openDefects.map((d) => ({
          id: d.id,
          title: d.title,
          number: d.number,
          status: d.status,
          severity: d.severity,
          deadline: d.date,
          room: d.roomName,
          asset: d.assetName,
        })),
        expiringWarranties: dash.expiringWarranties.map((w) => ({
          assetId: w.assetId,
          asset: w.title,
          until: w.date,
          status: w.status,
          daysLeft: w.daysLeft,
        })),
        orderNow: dash.orderNow.map((i) => ({
          part: i.partName,
          task: i.taskTitle,
          quantity: i.quantity,
          orderBy: i.orderBy,
          late: i.late ? true : null,
        })),
        preparations: preparations.map((p) => ({
          taskId: p.taskId,
          task: p.taskTitle,
          title: p.title,
          state: p.state,
          date: p.date,
        })),
      },
    };
  },
});
