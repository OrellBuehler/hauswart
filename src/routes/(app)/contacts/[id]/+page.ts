import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const api = createApiClient(fetch);
  const contact = await orFail(
    api.call(endpoints.contactsGet, { params: { id: params.id } }),
    url.pathname,
  );
  return { contact };
};
