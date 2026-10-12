import type { IntegrationKind } from "$lib/api/enums";
import type { ServiceContext } from "$lib/server/service";

/** A connection with its token decrypted; only adapters ever see this. */
export interface ResolvedConnection {
  id: string;
  kind: IntegrationKind;
  userId: string | null;
  baseUrl: string;
  token: string;
  allowInsecureTls: boolean;
  /** Household-wide connections and those of administrators may reach loopback addresses; members' may not. */
  allowLoopback: boolean;
  config: Record<string, unknown>;
}

export interface ConnectionTestResult {
  ok: boolean;
  /** Present when `ok` is false. */
  error?: { code: string; message: string };
  /** Harmless facts for the settings page: version, location name. */
  info?: Record<string, string | number | boolean | null>;
}

/** Answers a read-only question of the UI (an entity picker, a device list). Throws `IntegrationError`. */
export type IntegrationOperation = (
  connection: ResolvedConnection,
  query: Record<string, string>,
  ctx: ServiceContext,
) => Promise<unknown>;

export interface IntegrationAdapter {
  kind: IntegrationKind;
  /**
   * Normalises what a person entered (the address, the kind-specific config)
   * before it is saved. Throws `IntegrationError("invalid_input", ...)`.
   */
  validate?(input: { baseUrl: string; config: Record<string, unknown> }): {
    baseUrl: string;
    config: Record<string, unknown>;
  };
  /**
   * Checks settings a person just submitted against what only the database knows (say, that the records they name
   * exist), which `validate` cannot because it has no database. Gets the settings `validate` returned; throws
   * `IntegrationError("invalid_input", message, { field: "config" })`, which the save turns into a 400 on that field.
   * Not run by a save that sends no settings (the stored ones stay), so a stale reference never blocks switching a
   * connection off.
   */
  checkReferences?(ctx: ServiceContext, config: Record<string, unknown>): void;
  /** Calls the system once and reports whether it answers and accepts the token. Never throws for an unreachable system. */
  test(connection: ResolvedConnection): Promise<ConnectionTestResult>;
  describe(): { capabilities: string[] };
  operations?: Record<string, IntegrationOperation>;
}

const adapters = new Map<IntegrationKind, IntegrationAdapter>();

/** Adds (or replaces) the adapter of a kind; returns a function that removes it. */
export function registerIntegration(adapter: IntegrationAdapter): () => void {
  adapters.set(adapter.kind, adapter);
  return () => {
    if (adapters.get(adapter.kind) === adapter) adapters.delete(adapter.kind);
  };
}

export function getIntegration(
  kind: IntegrationKind,
): IntegrationAdapter | undefined {
  return adapters.get(kind);
}
