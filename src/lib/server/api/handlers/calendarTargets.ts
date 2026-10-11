import type { z } from "zod";
import type { endpoints } from "$lib/api/registry";
import type { calendarTargetSchema } from "$lib/api/schemas/calendar-sync";
import { toIso } from "$lib/api/schemas/common";
import {
  createTarget,
  deleteTarget,
  listTargets,
  syncNow,
  updateTarget,
  type Caller,
  type TargetView,
} from "$lib/server/calendar-sync/targets";
import type { Handler } from "../bind";
import type { AuthedContext } from "../context";

/** Administrators (the `admin` scope) manage the household's targets, everybody their own. */
const callerOf = (ctx: AuthedContext): Caller => ({
  id: ctx.user.id,
  admin: ctx.principal.scopes.includes("admin"),
  locale: ctx.user.locale,
});

export function wireCalendarTarget(
  view: TargetView,
): z.input<typeof calendarTargetSchema> {
  return {
    id: view.id,
    provider: view.provider,
    level: view.level,
    ownerId: view.ownerId,
    remoteCalendarId: view.remoteCalendarId,
    name: view.name,
    enabled: view.enabled,
    config: view.config,
    capabilities: view.capabilities,
    status: view.status,
    lastError: view.lastError,
    lastOkAt: view.lastOkAt ? toIso(view.lastOkAt) : null,
    lastCheckedAt: view.lastCheckedAt ? toIso(view.lastCheckedAt) : null,
    consecutiveFailures: view.consecutiveFailures,
    lastStats: view.lastStats,
    eventCount: view.eventCount,
    canManage: view.canManage,
    createdAt: toIso(view.createdAt),
    updatedAt: toIso(view.updatedAt),
  };
}

export const list: Handler<typeof endpoints.calendarTargetsList> = ({
  ctx,
}) => ({
  items: listTargets(ctx, callerOf(ctx)).map(wireCalendarTarget),
  nextCursor: null,
});

export const create: Handler<typeof endpoints.calendarTargetsCreate> = async ({
  ctx,
  body,
}) => wireCalendarTarget(await createTarget(ctx, callerOf(ctx), body));

export const update: Handler<typeof endpoints.calendarTargetsUpdate> = ({
  ctx,
  params,
  body,
}) => wireCalendarTarget(updateTarget(ctx, callerOf(ctx), params.id, body));

export const remove: Handler<typeof endpoints.calendarTargetsDelete> = async ({
  ctx,
  params,
  query,
}) => {
  await deleteTarget(ctx, callerOf(ctx), params.id, {
    removeRemote: query.removeRemote === true,
  });
  return null;
};

export const sync: Handler<typeof endpoints.calendarTargetsSync> = async ({
  ctx,
  params,
}) => {
  const { result, target } = await syncNow(ctx, callerOf(ctx), params.id);
  return {
    ok: result.ok,
    error: result.error,
    counts: result.counts,
    target: wireCalendarTarget(target),
  };
};
