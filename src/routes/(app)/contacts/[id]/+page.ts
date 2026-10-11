import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { loadHousehold } from "$lib/tasks/load";
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
