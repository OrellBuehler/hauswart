import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { parseView, viewRange } from "$lib/appointments/list";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const view = parseView(url.searchParams.get("view"));
  const redirectTo = url.pathname + url.search;
  const { household, today } = await orFail(loadHousehold(client), redirectTo);
  const range = viewRange(view, today);
  const appointments = await orFail(
    fetchAll((cursor) =>
      client.call(endpoints.appointmentsList, {
        query: { ...range, limit: 200, ...(cursor ? { cursor } : {}) },
      }),
    ),
    redirectTo,
  );
  return { view, appointments, today, timeZone: household.timezone };
};
