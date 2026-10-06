import { createApiClient } from "$lib/api/client";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { apiErrorMessage } from "$lib/error-message";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const api = createApiClient(fetch);
  const [settings, integrations, { household }] = await orFail(
    Promise.all([
      api.call(endpoints.notificationSettingsGet),
      api.call(endpoints.integrationsList),
      loadHousehold(api),
    ]),
    url.pathname,
  );
  const ha = integrations.items.find((i) => i.kind === "homeassistant");
  const connected = Boolean(ha?.available && ha.configured && ha.enabled);
  let services: string[] = [];
  let servicesError: string | undefined;
  if (connected) {
    try {
      services = (
        await api.call(endpoints.integrationsNotifyServices, {
          params: { kind: "homeassistant" },
        })
      ).items;
    } catch (err) {
      console.warn("notify services unavailable", err);
      servicesError = apiErrorMessage(err);
    }
  }
  return {
    settings,
    connected,
    services,
    servicesError,
    timeZone: household.timezone,
  };
};
