import type { endpoints } from "$lib/api/registry";
import { getDashboard } from "$lib/server/tasks/dashboard";
import { getStats } from "$lib/server/tasks/stats";
import type { Handler } from "../bind";
import { wireDashboard } from "../wire";

export const get: Handler<typeof endpoints.dashboard> = async ({ ctx }) =>
  wireDashboard(await getDashboard(ctx));

export const stats: Handler<typeof endpoints.stats> = ({ ctx, query }) =>
  getStats(ctx, query);
