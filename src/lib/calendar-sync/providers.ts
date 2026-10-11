import {
  CALENDAR_PROVIDERS,
  INTEGRATION_LEVELS,
  type CalendarProviderKind,
} from "$lib/api/enums";
import type { Integration } from "$lib/api/schemas/integrations";
import { isUsable } from "$lib/connections/connection";
import { m } from "$lib/paraglide/messages";

/** The connected systems the caller can add a calendar of: working connection, and for the household's own connection an administrator. */
export function creatableProviders(
  integrations: readonly Integration[],
  isAdmin: boolean,
): CalendarProviderKind[] {
  return CALENDAR_PROVIDERS.filter((kind) => {
    if (INTEGRATION_LEVELS[kind] === "household" && !isAdmin) return false;
    return isUsable(integrations.find((i) => i.kind === kind));
  });
}

/** Whether the connection a provider writes through is switched on and saved. */
export function providerUsable(
  integrations: readonly Integration[],
  kind: CalendarProviderKind,
): boolean {
  return isUsable(integrations.find((i) => i.kind === kind));
}

const PROVIDER_NAMES: Record<CalendarProviderKind, () => string> = {
  homeassistant: () => m.integration_ha_name(),
};

/** The name of a calendar system as people know it. */
export function providerName(kind: CalendarProviderKind): string {
  return PROVIDER_NAMES[kind]();
}
