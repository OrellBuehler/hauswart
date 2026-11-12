import { createApiClient } from "#lib/api/client.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import { loadHousehold } from "#lib/tasks/load.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const api = createApiClient(fetch);
  const [contact, appointments, household] = await Promise.all([
    orFail(
      api.call(endpoints.contactsGet, { params: { id: params.id } }),
      url.pathname,
    ),
    orFail(
      fetchAll((cursor) =>
        api.call(endpoints.appointmentsList, {
          query: {
            contactId: params.id,
            status: "planned",
            limit: 200,
            ...(cursor ? { cursor } : {}),
          },
        }),
      ),
      url.pathname,
    ),
    loadHousehold(api, url.pathname),
  ]);
  return {
    contact,
    appointments,
    timeZone: household.timeZone,
    today: household.today,
  };
};
