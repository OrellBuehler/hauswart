import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const emergency = await orFail(
    createApiClient(fetch).call(endpoints.emergencyGet),
    url.pathname,
  );
  return { emergency };
};
