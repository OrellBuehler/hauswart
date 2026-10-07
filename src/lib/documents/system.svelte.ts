import { DOCUMENT_PROVIDERS, type DocumentProviderKind } from "$lib/api/enums";
import { isUsable, loadIntegrations } from "$lib/connections/connection";

/** The document system the caller has a working connection to (saved and switched on), or null. */
export async function findDocumentProvider(): Promise<DocumentProviderKind | null> {
  const list = await loadIntegrations();
  return (
    DOCUMENT_PROVIDERS.find((kind) =>
      isUsable(list.find((integration) => integration.kind === kind)),
    ) ?? null
  );
}

/**
 * Whether the caller can use a document system, for components that offer actions only then
 * (linking, sending a file). `provider` is `undefined` until the lookup finished. The integrations
 * list is shared and cached, so many instances on one page ask once.
 */
export class DocumentSystem {
  provider = $state<DocumentProviderKind | null | undefined>(undefined);

  /** Starts the lookup; call it from an `$effect` and return its result so a leaving component stops waiting. */
  start(): () => void {
    let cancelled = false;
    findDocumentProvider().then(
      (kind) => {
        if (!cancelled) this.provider = kind;
      },
      (err: unknown) => {
        console.warn("integrations unavailable", err);
        if (!cancelled) this.provider = null;
      },
    );
    return () => {
      cancelled = true;
    };
  }
}
