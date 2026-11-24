import { createApiClient } from "#lib/api/client.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const { items } = await orFail(
    createApiClient(fetch).call(endpoints.usersList),
    url.pathname,
  );
  return { users: items };
};
