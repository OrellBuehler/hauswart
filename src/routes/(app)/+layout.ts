import { createApiClient } from "#lib/api/client.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async ({ fetch, url, untrack }) => {
  const redirectTo = untrack(() => url.pathname + url.search);
  const me = await orFail(
    createApiClient(fetch).call(endpoints.authMe),
    redirectTo,
  );
  return { user: me.user, scopes: me.scopes };
};
