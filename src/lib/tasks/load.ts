import type { ApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { todayIn } from "$lib/dates";

const MAX_PAGES = 10;

/** Follows `nextCursor` until the list ends (a household has dozens of rooms and assets, not thousands). */
async function allPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{
    items: T[];
    nextCursor: string | null;
  }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return items;
}

/** The household's time zone and its current calendar date. */
export async function loadHousehold(client: ApiClient, redirectTo: string) {
  const household = await orFail(
    client.call(endpoints.householdGet),
    redirectTo,
  );
  return {
    timeZone: household.timezone,
    today: todayIn(household.timezone, Date.now()),
    dueSoonDays: household.settings.dueSoonDays,
  };
}

export async function loadDirectory(client: ApiClient, redirectTo: string) {
  const { items } = await orFail(
    client.call(endpoints.usersDirectory),
    redirectTo,
  );
  return items;
}

export async function loadPlaces(client: ApiClient, redirectTo: string) {
  const [rooms, assets] = await Promise.all([
    orFail(
      allPages((cursor) =>
        client.call(endpoints.roomsList, {
          query: { limit: 200, ...(cursor ? { cursor } : {}) },
        }),
      ),
      redirectTo,
    ),
    orFail(
      allPages((cursor) =>
        client.call(endpoints.assetsList, {
          query: { limit: 200, ...(cursor ? { cursor } : {}) },
        }),
      ),
      redirectTo,
    ),
  ]);
  return { rooms, assets };
}
