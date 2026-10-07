import { DOCUMENT_PROVIDERS, type DocumentProviderKind } from "$lib/api/enums";
import type { Integration } from "$lib/api/schemas/integrations";
import {
  isUsable,
  loadIntegrations,
  onIntegrationsForgotten,
} from "$lib/connections/connection";

export interface DocumentConnection {
  provider: DocumentProviderKind;
  integration: Integration;
}

/** The caller's working connection to a document system (saved and switched on) with its health, or null. */
export async function findDocumentConnection(): Promise<DocumentConnection | null> {
  const list = await loadIntegrations();
  for (const provider of DOCUMENT_PROVIDERS) {
    const integration = list.find((item) => item.kind === provider);
    if (integration && isUsable(integration)) {
      return { provider, integration };
    }
  }
  return null;
}

/**
 * Whether the caller can use a document system, for components that offer actions only then
 * (linking, sending a file). `provider` is `undefined` until the lookup finished. The integrations
 * list is shared and cached, so many instances on one page ask once.
 */
export class DocumentSystem {
  provider = $state<DocumentProviderKind | null | undefined>(undefined);
  /** The connection as the API lists it (status, last error), for pages that show its health. */
  integration = $state.raw<Integration | null | undefined>(undefined);

  /**
   * Starts the lookup; call it from an `$effect` and return its result so a leaving component stops
   * waiting. It asks again when a connection was saved, tested or removed in this tab.
   */
  start(): () => void {
    let cancelled = false;
    let latest = 0;
    const load = () => {
      const ticket = ++latest;
      findDocumentConnection().then(
        (connection) => {
          if (cancelled || ticket !== latest) return;
          this.provider = connection?.provider ?? null;
          this.integration = connection?.integration ?? null;
        },
        (err: unknown) => {
          console.warn("integrations unavailable", err);
          if (cancelled || ticket !== latest) return;
          this.provider = null;
          this.integration = null;
        },
      );
    };
    load();
    const stop = onIntegrationsForgotten(load);
    return () => {
      cancelled = true;
      stop();
    };
  }
}
