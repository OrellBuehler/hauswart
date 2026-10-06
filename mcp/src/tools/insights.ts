import { z } from "zod";
import { endpoints } from "../../../src/lib/api/registry";
import type { Stats } from "../../../src/lib/api/schemas/dashboard";
import { moreHint, plural, renderNotification } from "../format";
import { defineTool } from "../tool";

const date = z.iso.date();

const group = (g: Stats["total"]) => ({
  done: g.done,
  skipped: g.skipped,
  onTime: g.onTime,
  onTimeShare: g.onTimeShare === null ? null : Math.round(g.onTimeShare * 100),
});

export const getStats = defineTool({
  name: "get_stats",
  title: "Completion statistics",
  description:
    "Who did how much: tasks done and skipped, and the share done on time (percent), in total, per person and per category, by completion date. Default period: the last 90 days; at most 800 days.",
  mode: "read",
  input: {
    from: date.optional().describe("First day, YYYY-MM-DD"),
    to: date.optional().describe("Last day, YYYY-MM-DD"),
  },
  async handler(args, ctx) {
    const [stats, users] = await Promise.all([
      ctx.api.call(endpoints.stats, { query: args }),
      ctx.users(),
    ]);
    const byUser = Object.fromEntries(
      Object.entries(stats.byUser).map(([id, g]) => [
        users.get(id) ?? (id === "_unassigned" ? "unassigned" : id),
        group(g),
      ]),
    );
    return {
      summary: `${plural(stats.total.done, "task")} done and ${stats.total.skipped} skipped from ${stats.from} to ${stats.to}.`,
      data: {
        from: stats.from,
        to: stats.to,
        total: group(stats.total),
        byUser,
        byCategory: Object.fromEntries(
          Object.entries(stats.byCategory).map(([k, g]) => [k, group(g)]),
        ),
      },
    };
  },
});

export const listNotifications = defineTool({
  name: "list_notifications",
  title: "List notifications",
  description:
    "The token user's notifications (reminders for due, overdue and soon-due tasks, preparations, the daily digest), unread first, as readable text. Read-only: it does not mark anything read.",
  mode: "read",
  input: {
    unread: z
      .boolean()
      .default(true)
      .describe("Only unread ones; default true"),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    const page = await ctx.api.call(endpoints.notificationsList, {
      query: {
        unread: args.unread ? "true" : undefined,
        limit: args.limit,
        cursor: args.cursor,
      },
    });
    return {
      summary: `${plural(page.items.length, args.unread ? "unread notification" : "notification")}.${moreHint(page.nextCursor)}`,
      data: {
        notifications: page.items.map((n) => ({
          id: n.id,
          kind: n.kind,
          text: renderNotification(n),
          taskId: n.taskId,
          read: n.readAt ? true : false,
          created: n.createdAt.slice(0, 10),
        })),
        nextCursor: page.nextCursor,
      },
    };
  },
});
