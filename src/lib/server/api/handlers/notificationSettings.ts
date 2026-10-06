import type { endpoints } from "$lib/api/registry";
import { performDoneAction } from "$lib/server/notifications/actions";
import { ApiError } from "$lib/api/errors";
import { getSettings, saveSettings } from "$lib/server/notifications/settings";
import type { Handler } from "../bind";

export const get: Handler<typeof endpoints.notificationSettingsGet> = ({
  ctx,
}) => getSettings(ctx, ctx.user.id);

export const put: Handler<typeof endpoints.notificationSettingsPut> = ({
  ctx,
  body,
}) => saveSettings(ctx, ctx.user.id, body);

/** Only a token issued for the smart-home system may report taps; a token of another kind with the scope is refused. */
export const action: Handler<typeof endpoints.haAction> = async ({
  ctx,
  body,
}) => {
  if (ctx.principal.auth !== "token" || ctx.principal.token.kind !== "ha") {
    throw new ApiError(
      "forbidden",
      "This endpoint requires an API token of kind ha",
    );
  }
  return performDoneAction(ctx, body.action);
};
