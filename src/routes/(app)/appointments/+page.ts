import { createApiClient } from "#lib/api/client.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { loadHousehold } from "#lib/api/household.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import { parseView, viewRange } from "#lib/appointments/list.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url, untrack }) => {
  const client = createApiClient(fetch);
  const view = parseView(url.searchParams.get("view"));
  const redirectTo = untrack(() => url.pathname + url.search);
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
