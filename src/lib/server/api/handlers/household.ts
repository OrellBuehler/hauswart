import type { endpoints } from "$lib/api/registry";
import { getHousehold, updateHousehold } from "$lib/server/household/household";
import { evaluateAll } from "$lib/server/tasks/evaluator";
import type { Handler } from "../bind";
import { wireHousehold } from "../wire";

export const get: Handler<typeof endpoints.householdGet> = ({ ctx }) =>
  wireHousehold(getHousehold(ctx));

export const update: Handler<typeof endpoints.householdUpdate> = async ({
  ctx,
  body,
}) => {
  const before = getHousehold(ctx).settings;
  const household = updateHousehold(ctx, body);
  // The lead window decides which tasks count as "open": refresh them now, not at the next tick.
  if (household.settings.dueSoonDays !== before.dueSoonDays) {
    await evaluateAll(ctx);
  }
  return wireHousehold(household);
};
