import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async ({ fetch, url, untrack }) => {
  const redirectTo = untrack(() => url.pathname + url.search);
  const me = await orFail(
    createApiClient(fetch).call(endpoints.authMe),
    redirectTo,
  );
  return { user: me.user, scopes: me.scopes };
};
