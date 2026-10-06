import { api } from "./browser";
import { endpoints } from "./registry";

let cached: Promise<string> | undefined;

/** The household's currency for forms in the browser; fetched once, retried after a failure. */
export function householdCurrency(): Promise<string> {
  cached ??= api.call(endpoints.householdGet).then(
    (household) => household.currency,
    (err) => {
      cached = undefined;
      throw err;
    },
  );
  return cached;
}
