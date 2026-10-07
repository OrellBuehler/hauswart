import { api } from "$lib/api/browser";
import { endpoints } from "$lib/api/registry";
import type { Integration } from "$lib/api/schemas/integrations";

const TTL_MS = 60_000;

let cached: { at: number; promise: Promise<Integration[]> } | undefined;

/** The integrations as the API lists them, shared between pickers for a minute so a form with five of them asks once. */
export function loadIntegrations(force = false): Promise<Integration[]> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    return cached.promise;
  }
  const promise = api
    .call(endpoints.integrationsList)
    .then((page) => page.items);
  cached = { at: Date.now(), promise };
  promise.catch(() => {
    if (cached?.promise === promise) cached = undefined;
  });
  return promise;
}

const forgetListeners = new Set<() => void>();

/** Calls `listener` whenever the loaded integrations were forgotten, so what depends on them can ask again. Returns the way to stop. */
export function onIntegrationsForgotten(listener: () => void): () => void {
  forgetListeners.add(listener);
  return () => void forgetListeners.delete(listener);
}

/** Forget what was loaded (a connection was saved, tested or removed). */
export function forgetIntegrations(): void {
  cached = undefined;
  for (const listener of forgetListeners) listener();
}

/** A connection that pickers can ask: an adapter runs, a connection is saved and switched on. */
export function isUsable(integration: Integration | undefined): boolean {
  return Boolean(
    integration &&
    integration.available &&
    integration.configured &&
    integration.enabled,
  );
}

export function homeAssistantOf(
  list: readonly Integration[],
): Integration | undefined {
  return list.find((i) => i.kind === "homeassistant");
}
