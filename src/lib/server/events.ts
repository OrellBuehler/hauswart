import type { CompletionKind } from "$lib/api/enums";
import type { ServiceContext } from "./service";

/** The slice of a task completion that other domains may react to. */
export interface CompletionFacts {
  id: string;
  taskId: string;
  kind: CompletionKind;
  userId: string | null;
  completedAt: Date;
}

export interface DomainEvents {
  /** What the household watches in outside systems changed (a task, preparation or hint reaction was saved). */
  signalNeedsChanged: { ctx: Pick<ServiceContext, "db"> };
  /** A connection to an outside system was saved, enabled or removed. */
  connectionChanged: { ctx: ServiceContext; kind: string };
  /** A completion row was written (not for replays of an idempotent request). */
  completionRecorded: { ctx: ServiceContext; completion: CompletionFacts };
  /** A cost entry booked from a finance provider was created, changed or deleted: its back-link there is to be written or removed. */
  financeLinksPending: {
    ctx: Pick<ServiceContext, "db">;
    connectionId: string;
  };
  /** A completion was undone. */
  completionRevoked: {
    ctx: ServiceContext;
    completion: CompletionFacts;
    revokedBy: string;
  };
}

type Listener<K extends keyof DomainEvents> = (
  payload: DomainEvents[K],
) => void;

const listeners: { [K in keyof DomainEvents]: Set<Listener<K>> } = {
  signalNeedsChanged: new Set(),
  connectionChanged: new Set(),
  completionRecorded: new Set(),
  completionRevoked: new Set(),
  financeLinksPending: new Set(),
};

/**
 * Subscribes to a domain event; returns the unsubscribe function. Listeners are
 * plain synchronous functions, kept in a set, so subscribing the same function
 * twice is harmless.
 */
export function onEvent<K extends keyof DomainEvents>(
  name: K,
  listener: Listener<K>,
): () => void {
  listeners[name].add(listener);
  return () => {
    listeners[name].delete(listener);
  };
}

/**
 * Runs the listeners one after the other, in subscription order, before the
 * emitter returns. A listener that throws stops the rest and the error reaches
 * the emitter: emit inside the same database transaction as the change, so the
 * change and its reactions succeed or fail together.
 */
export function emitEvent<K extends keyof DomainEvents>(
  name: K,
  payload: DomainEvents[K],
): void {
  for (const listener of [...listeners[name]]) listener(payload);
}
