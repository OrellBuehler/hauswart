import { todayIn } from "$lib/dates";
import type { ApiClient } from "./client";
import { endpoints } from "./registry";

/** The household and today's date (`YYYY-MM-DD`) in its time zone. */
export async function loadHousehold(client: ApiClient) {
  const household = await client.call(endpoints.householdGet);
  return { household, today: todayIn(household.timezone, Date.now()) };
}
