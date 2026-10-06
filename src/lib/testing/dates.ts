import { addDays } from "$lib/dates";
import { todayInHouseholdZone } from "$lib/server/config";

/** Today in the household zone plus `offset` days, for tests that go through the real clock. */
export function today(offset = 0): string {
  return addDays(todayInHouseholdZone(), offset);
}
