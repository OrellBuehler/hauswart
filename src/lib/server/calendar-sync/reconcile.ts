import type {
  CalendarItemKind,
  CalendarLinkStatus,
  CalendarRemoteDeletePolicy,
} from "$lib/api/enums";
import type { DesiredItem } from "./items";
import {
  NO_UID,
  type CalendarCapabilities,
  type RemoteEvent,
} from "./provider";
import { kindOfRef } from "./ref";

/** What hauswart knows it did for one item in one target (a row of `calendar_links`). */
export interface LinkRecord {
  id: string;
  kind: CalendarItemKind;
  itemId: string;
  instanceKey: string;
  ref: string;
  /** The calendar's id of the event; null while it is not known (created, not found again yet). */
  remoteUid: string | null;
  status: CalendarLinkStatus;
  contentHash: string;
  /** When the event was written (ms since epoch); null when nothing says. */
  pushedAt: number | null;
}

/**
 * How long an event that was written without learning its id is waited for. A calendar that keeps the
 * marker shows it within seconds; after this long the event is taken for deleted (or never kept), so
 * a target that was stuck on it can write the item again.
 */
export const UNCONFIRMED_GRACE_MS = 30 * 60_000;

export interface ReconcileInput {
  /** What the target wants in the calendar now. */
  desired: readonly DesiredItem[];
  links: readonly LinkRecord[];
  /** The events found in the calendar for the span that is written, ours (with a ref) and foreign ones. */
  remote: readonly RemoteEvent[];
  capabilities: CalendarCapabilities;
  onRemoteDelete: CalendarRemoteDeletePolicy;
  /** The kinds the target carries: events of other kinds that nobody linked are left alone. */
  kinds: ReadonlySet<CalendarItemKind>;
  /** The current time (ms since epoch), for how long an event written a moment ago is waited for. */
  now: number;
}

export type SkipReason = "create_unsupported";

/**
 * One step towards the calendar looking like the desired items. Those with a remote effect are
 * `delete`, `update`, `replace` and `create`; `adopt`, `acknowledge`, `forget` and `tombstone` only
 * change what hauswart remembers, `skip` does nothing and says why.
 */
export type Operation =
  /** Writes the event. `recreate`: its earlier event is gone (somebody deleted it). */
  | {
      type: "create";
      item: DesiredItem;
      link: LinkRecord | null;
      recreate: boolean;
    }
  /** Changes the event in place. */
  | { type: "update"; item: DesiredItem; link: LinkRecord | null; uid: string }
  /** For a calendar that cannot change events but can delete and create: removes the event, then writes it again. */
  | { type: "replace"; item: DesiredItem; link: LinkRecord | null; uid: string }
  /**
   * Removes an event of ours. `obsolete`: its item is gone (the link goes with it), `orphan`: nothing
   * remembers it, `duplicate`: another event has the same name (the link stays with the one it names).
   */
  | {
      type: "delete";
      ref: string;
      uid: string;
      link: LinkRecord | null;
      reason: "obsolete" | "orphan" | "duplicate";
    }
  /** The event is there under an id the link did not have: remember the id. */
  | { type: "adopt"; item: DesiredItem; link: LinkRecord; uid: string }
  /** The event is there and cannot be changed (a calendar that only creates, or one that gives no id): remember it as it is. */
  | {
      type: "acknowledge";
      item: DesiredItem;
      link: LinkRecord | null;
      uid: string | null;
    }
  /** Forget the link and leave the event where it is (it is gone, or cannot be removed). */
  | { type: "forget"; link: LinkRecord }
  /** Somebody deleted the event on purpose: keep a note so it is not written again. */
  | { type: "tombstone"; item: DesiredItem; link: LinkRecord }
  | { type: "skip"; ref: string; reason: SkipReason };

export interface Plan {
  operations: Operation[];
  /** Refs of events written earlier that the calendar does not show (yet), so they are neither updated nor written again. */
  unconfirmed: string[];
}

const GROUP: Record<Operation["type"], number> = {
  delete: 0,
  update: 1,
  replace: 1,
  create: 2,
  adopt: 3,
  acknowledge: 3,
  forget: 3,
  tombstone: 3,
  skip: 3,
};

/** Whether an operation calls the calendar (and so counts against the size of a run). */
export function isRemote(op: Operation): boolean {
  return (
    op.type === "delete" ||
    op.type === "update" ||
    op.type === "replace" ||
    op.type === "create"
  );
}

/**
 * Compares what the target wants with what hauswart remembers (the links) and with what the
 * calendar holds, and returns the steps that make them agree. Pure: the same input gives the same
 * plan, and a calendar that is then in the planned state gives an empty plan.
 *
 * The rules, per item name (ref):
 * - Only events with our ref are ever named in a step. Foreign events are never touched, and an
 *   event of ours whose kind this target does not carry is left alone unless a link names it.
 * - Wanted and in the calendar: nothing when the link's fingerprint is the item's. Otherwise (or
 *   when nothing remembers it) it is changed in place; a calendar that cannot change events gets a
 *   delete and a new event; one that can only create keeps the event as it is.
 * - Wanted, remembered, not in the calendar: somebody deleted it. `recreate` writes it again,
 *   `forget` keeps a note and never writes it again. An event written a moment ago and not found yet
 *   (no id known) is waited for, never written twice, but only for `UNCONFIRMED_GRACE_MS`: after that
 *   it counts as deleted like any other.
 * - Wanted, not remembered, not in the calendar: written.
 * - Not wanted any more: its event is removed when the calendar allows it, the link is dropped
 *   either way. Events of ours that nothing remembers and nothing wants are removed too.
 * - Two events with one ref: the one the link names stays, the rest are removed.
 */
export function reconcile(input: ReconcileInput): Plan {
  const { capabilities: caps } = input;
  const desiredByRef = new Map(input.desired.map((d) => [d.ref, d]));
  const linkByRef = new Map(input.links.map((l) => [l.ref, l]));
  const eventsByRef = new Map<string, RemoteEvent[]>();
  for (const event of input.remote) {
    if (event.ref === null) continue;
    const list = eventsByRef.get(event.ref) ?? [];
    list.push(event);
    eventsByRef.set(event.ref, list);
  }

  const refs = [
    ...new Set([
      ...desiredByRef.keys(),
      ...linkByRef.keys(),
      ...eventsByRef.keys(),
    ]),
  ].sort();
  const ops: { op: Operation; start: number }[] = [];
  const unconfirmed: string[] = [];
  const push = (op: Operation, start = 0) => ops.push({ op, start });

  const create = (
    item: DesiredItem,
    link: LinkRecord | null,
    recreate: boolean,
  ) => {
    if (!caps.create) {
      push({ type: "skip", ref: item.ref, reason: "create_unsupported" });
      return;
    }
    push({ type: "create", item, link, recreate }, startOf(item));
  };

  for (const ref of refs) {
    const want = desiredByRef.get(ref);
    const link = linkByRef.get(ref) ?? null;
    const found = [...(eventsByRef.get(ref) ?? [])].sort(compareEvents);

    if (!want && !link) {
      const kind = kindOfRef(ref);
      if (!kind || !input.kinds.has(kind)) continue;
    }

    // The event this item is: the one the link names, else the first.
    const event =
      found.find((e) => link?.remoteUid && e.uid === link.remoteUid) ??
      found[0] ??
      null;
    const extras = found.filter((e) => e !== event);

    if (want) {
      if (!event) {
        if (link?.status === "forgotten") continue;
        if (link && link.remoteUid === null && !expired(link, input.now)) {
          unconfirmed.push(ref);
          continue;
        }
        if (link && input.onRemoteDelete === "forget") {
          push({ type: "tombstone", item: want, link });
          continue;
        }
        create(want, link, link !== null);
      } else {
        const current =
          link !== null &&
          link.status === "synced" &&
          link.contentHash === want.hash;
        if (current) {
          const known = event.uid ?? NO_UID;
          if (link.remoteUid !== known) {
            push({ type: "adopt", item: want, link, uid: known });
          }
        } else if (event.uid === null) {
          // Without an id the event cannot be changed or removed: remember it as it is.
          push({ type: "acknowledge", item: want, link, uid: null });
        } else if (caps.update) {
          push(
            { type: "update", item: want, link, uid: event.uid },
            startOf(want),
          );
        } else if (caps.create && caps.delete) {
          push(
            { type: "replace", item: want, link, uid: event.uid },
            startOf(want),
          );
        } else {
          push({ type: "acknowledge", item: want, link, uid: event.uid });
        }
      }
    } else if (link) {
      if (event && event.uid !== null && caps.delete) {
        push({ type: "delete", ref, uid: event.uid, link, reason: "obsolete" });
      } else {
        push({ type: "forget", link });
      }
    } else if (event) {
      // Nothing remembers it and nothing wants it.
      extras.unshift(event);
    }

    for (const extra of extras) {
      if (extra.uid === null || !caps.delete) continue;
      push({
        type: "delete",
        ref,
        uid: extra.uid,
        link: null,
        reason: want || link ? "duplicate" : "orphan",
      });
    }
  }

  const sorted = ops
    .map((entry, index) => ({ ...entry, index }))
    .sort(
      (a, b) =>
        GROUP[a.op.type] - GROUP[b.op.type] ||
        a.start - b.start ||
        a.index - b.index,
    );
  return { operations: sorted.map((entry) => entry.op), unconfirmed };
}

/** An event written without a known id that the calendar has not shown for too long. */
function expired(link: LinkRecord, now: number): boolean {
  return link.pushedAt === null || now - link.pushedAt >= UNCONFIRMED_GRACE_MS;
}

function startOf(item: DesiredItem): number {
  return item.when.allDay
    ? Date.parse(`${item.when.startDate}T00:00:00Z`)
    : item.when.startsAt;
}

/** Events that can be named first, then by id: the choice among duplicates does not depend on the order the calendar listed them in. */
function compareEvents(a: RemoteEvent, b: RemoteEvent): number {
  if ((a.uid === null) !== (b.uid === null)) return a.uid === null ? 1 : -1;
  return (a.uid ?? "").localeCompare(b.uid ?? "");
}

/**
 * Whether what hauswart remembers differs from what is wanted, judged without asking the calendar:
 * an item without a link, a link whose fingerprint is not the item's or whose event was never
 * found again, a link without an item. The scheduler uses it to sync soon after a change instead of
 * at the next regular run.
 */
export function hasPendingChanges(
  desired: readonly DesiredItem[],
  links: readonly LinkRecord[],
): boolean {
  const linkByRef = new Map(links.map((l) => [l.ref, l]));
  const wanted = new Set(desired.map((d) => d.ref));
  for (const item of desired) {
    const link = linkByRef.get(item.ref);
    if (!link) return true;
    if (
      link.status === "synced" &&
      (link.contentHash !== item.hash || link.remoteUid === null)
    ) {
      return true;
    }
  }
  return links.some((l) => !wanted.has(l.ref));
}
