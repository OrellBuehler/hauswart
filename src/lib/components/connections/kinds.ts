import type { Component } from "svelte";
import FileTextIcon from "@lucide/svelte/icons/file-text";
import HouseIcon from "@lucide/svelte/icons/house";
import PiggyBankIcon from "@lucide/svelte/icons/piggy-bank";
import type { IntegrationKind } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";

export const kindMeta: Record<
  IntegrationKind,
  { name: () => string; description: () => string; icon: Component }
> = {
  homeassistant: {
    name: () => m.integration_ha_name(),
    description: () => m.integration_ha_description(),
    icon: HouseIcon,
  },
  paperless: {
    name: () => m.integration_paperless_name(),
    description: () => m.integration_paperless_description(),
    icon: FileTextIcon,
  },
  kept: {
    name: () => m.integration_kept_name(),
    description: () => m.integration_kept_description(),
    icon: PiggyBankIcon,
  },
};
