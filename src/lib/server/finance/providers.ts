import {
  COMPLETION_SOURCES,
  TASK_SOURCES,
  type CompletionSource,
  type IntegrationKind,
  type TaskSource,
} from "$lib/api/enums";
import type { ConnectionRow } from "$lib/server/connections/connections";
import type { ServiceContext } from "$lib/server/service";

/** What a sync run did, by name (`suggestions`, `autoAccepted`, `tasksCreated`, ...). */
export interface FinanceSyncResult {
  ok: boolean;
  /** Present when `ok` is false: a short code and a message safe to show. */
  error?: { code: string; message: string };
  stats: Record<string, number>;
}

/**
 * A finance system a person connects: it offers costs, assets and bill tasks
 * as suggestions of its owner and keeps tasks of bills current. Registered at
 * startup by its adapter; the core only calls `sync`.
 */
export interface FinanceProvider {
  kind: IntegrationKind;
  /** Runs one sync of the person's own connection now. Provider failures are a result, not a throw. */
  sync(
    ctx: ServiceContext,
    connection: ConnectionRow,
  ): Promise<FinanceSyncResult>;
}

const providers = new Map<IntegrationKind, FinanceProvider>();

/** Adds (or replaces) the provider of a kind; returns a function that removes it. */
export function registerFinanceProvider(provider: FinanceProvider): () => void {
  providers.set(provider.kind, provider);
  return () => {
    if (providers.get(provider.kind) === provider) {
      providers.delete(provider.kind);
    }
  };
}

export function financeProviders(): FinanceProvider[] {
  return [...providers.values()];
}

/** The `tasks.source` of what a provider of this kind creates: its own name when the enum knows it, else `system`. */
export function taskSourceFor(kind: IntegrationKind): TaskSource {
  return (TASK_SOURCES as readonly string[]).includes(kind)
    ? (kind as TaskSource)
    : "system";
}

export function completionSourceFor(kind: IntegrationKind): CompletionSource {
  return (COMPLETION_SOURCES as readonly string[]).includes(kind)
    ? (kind as CompletionSource)
    : "system";
}
