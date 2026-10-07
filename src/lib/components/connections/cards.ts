import type { Component } from "svelte";
import type { IntegrationKind } from "$lib/api/enums";
import type { Integration } from "$lib/api/schemas/integrations";
import GenericCard from "./generic-card.svelte";
import HomeAssistantCard from "./home-assistant-card.svelte";
import KeptCard from "./kept-card.svelte";

export type IntegrationCardProps = {
  integration: Integration;
  /** The caller may change this connection (administrator for household kinds). */
  canEdit: boolean;
  /** Household time zone, for times shown to people. */
  timeZone: string;
  /** Called after the connection changed; reloads the list. */
  onchanged: () => Promise<void>;
};

/** One settings card per kind. A kind without an entry gets the generic status card; add the kind's component here. */
const cards: Partial<Record<IntegrationKind, Component<IntegrationCardProps>>> =
  {
    homeassistant: HomeAssistantCard,
    kept: KeptCard,
  };

export function cardFor(
  kind: IntegrationKind,
): Component<IntegrationCardProps> {
  return cards[kind] ?? GenericCard;
}
