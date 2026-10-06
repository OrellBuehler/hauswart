import type { endpoints } from "$lib/api/registry";
import { getHousehold, updateHousehold } from "$lib/server/household/household";
import { recomputeHandoverDeadlines } from "$lib/server/defects/defects";
import { evaluateAll } from "$lib/server/tasks/evaluator";
import type { Handler } from "../bind";
import type { AuthedContext } from "../context";
import { wireHousehold } from "../wire";

/** The host allow-list is administrators' business (the admin scope), like the rest of the integration setup. */
const showHostAllowlist = (ctx: AuthedContext) =>
  ctx.principal.scopes.includes("admin");

export const get: Handler<typeof endpoints.householdGet> = ({ ctx }) =>
  wireHousehold(getHousehold(ctx), {
    showHostAllowlist: showHostAllowlist(ctx),
  });

export const update: Handler<typeof endpoints.householdUpdate> = async ({
  ctx,
  body,
}) => {
  const { settings: before, handoverDate: handoverBefore } = getHousehold(ctx);
  const household = updateHousehold(ctx, body);
  // Defect deadlines derived from the handover date follow it.
  if (
    household.handoverDate !== handoverBefore ||
    household.settings.defectDeadlineMonths !== before.defectDeadlineMonths
  ) {
    await recomputeHandoverDeadlines(ctx);
  }
  // The lead window decides which tasks count as "open": refresh them now, not at the next tick.
  if (household.settings.dueSoonDays !== before.dueSoonDays) {
    await evaluateAll(ctx);
  }
  return wireHousehold(household, {
    showHostAllowlist: showHostAllowlist(ctx),
  });
};
