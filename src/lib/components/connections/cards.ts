import type { Component } from "svelte";
import type { IntegrationKind } from "$lib/api/enums";
import type { Integration } from "$lib/api/schemas/integrations";
import GenericCard from "./generic-card.svelte";
import HomeAssistantCard from "./home-assistant-card.svelte";
import KeptCard from "./kept-card.svelte";
import PaperlessCard from "./paperless-card.svelte";

export type IntegrationCardProps = {
  integration: Integration;
  /** The caller may change this connection (administrator for household kinds). */
  canEdit: boolean;
  /** The caller is an administrator (members may be limited in where a connection can point). */
  isAdmin: boolean;
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
    paperless: PaperlessCard,
  };

export function cardFor(
  kind: IntegrationKind,
): Component<IntegrationCardProps> {
  return cards[kind] ?? GenericCard;
}
