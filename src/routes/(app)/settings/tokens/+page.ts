import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const { items } = await orFail(
    createApiClient(fetch).call(endpoints.tokensList),
    url.pathname,
  );
  return { tokens: items.filter((token) => token.kind !== "mobile") };
};
