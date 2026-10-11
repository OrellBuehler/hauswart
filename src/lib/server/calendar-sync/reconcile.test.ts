import { describe, expect, it } from "vitest";
import type {
  CalendarItemKind,
  CalendarRemoteDeletePolicy,
} from "$lib/api/enums";
import { itemHash, type DesiredItem } from "./items";
import {
  NO_UID,
  type CalendarCapabilities,
  type RemoteEvent,
} from "./provider";
import {
  hasPendingChanges,
  isRemote,
  reconcile,
  UNCONFIRMED_GRACE_MS,
  type LinkRecord,
  type Operation,
  type ReconcileInput,
} from "./reconcile";

const T0 = Date.parse("2026-06-15T10:00:00Z");

const FULL: CalendarCapabilities = {
  create: true,
  update: true,
  delete: true,
  alarms: false,
};
const CREATE_DELETE: CalendarCapabilities = { ...FULL, update: false };
const CREATE_ONLY: CalendarCapabilities = {
  ...FULL,
  update: false,
  delete: false,
};
const NO_CREATE: CalendarCapabilities = { ...FULL, create: false };

function item(ref: string, over: Partial<DesiredItem> = {}): DesiredItem {
  const kind: CalendarItemKind = ref.startsWith("appointment-")
    ? "appointments"
    : "task_due";
  const base = {
    ref,
    summary: `Title of ${ref}`,
    description: "",
    location: null,
    when: {
      allDay: true as const,
      startDate: "2026-06-20",
      endDate: "2026-06-21",
    },
    path: `/tasks/${ref}`,
    alarmMinutes: null,
    ...over,
  };
  return {
    ...base,
    kind,
    itemId: ref,
    instanceKey: "",
    hash: itemHash(base),
  };
}

function link(
  desired: DesiredItem,
  over: Partial<LinkRecord> = {},
): LinkRecord {
  return {
    id: `link-${desired.ref}`,
    kind: desired.kind,
    itemId: desired.itemId,
    instanceKey: desired.instanceKey,
    ref: desired.ref,
    remoteUid: `uid-${desired.ref}`,
    status: "synced",
    contentHash: desired.hash,
    pushedAt: T0,
    ...over,
  };
}

const event = (ref: string | null, uid: string | null = `uid-${ref}`) =>
  ({ ref, uid }) satisfies RemoteEvent;

const KINDS = new Set<CalendarItemKind>(["task_due", "appointments"]);

function input(over: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    desired: [],
    links: [],
    remote: [],
    capabilities: FULL,
    onRemoteDelete: "recreate",
    kinds: KINDS,
    now: T0,
    ...over,
  };
}

const named = (op: Operation): string => {
  switch (op.type) {
    case "create":
      return `create ${op.item.ref}${op.recreate ? " (again)" : ""}`;
    case "update":
    case "replace":
    case "adopt":
      return `${op.type} ${op.item.ref} ${op.uid}`;
    case "acknowledge":
      return `acknowledge ${op.item.ref} ${op.uid}`;
    case "delete":
      return `delete ${op.ref} ${op.uid} (${op.reason})`;
    case "forget":
      return `forget ${op.link.ref}`;
    case "tombstone":
      return `tombstone ${op.item.ref}`;
    case "skip":
      return `skip ${op.ref} (${op.reason})`;
  }
};
const plan = (over: Partial<ReconcileInput>) =>
  reconcile(input(over)).operations.map(named);

const A = item("task-a");
const B = item("task-b");
const EDITED_A = item("task-a", { summary: "Another title" });

describe("reconcile", () => {
  describe("an item that is wanted", () => {
    it("is written when nothing remembers it and the calendar has no event", () => {
      expect(plan({ desired: [A] })).toEqual(["create task-a"]);
    });

    it("is left alone when the link has its fingerprint and the event is there", () => {
      expect(
        plan({ desired: [A], links: [link(A)], remote: [event("task-a")] }),
      ).toEqual([]);
    });

    it("is changed in place when its fingerprint changed", () => {
      expect(
        plan({
          desired: [EDITED_A],
          links: [link(A)],
          remote: [event("task-a")],
        }),
      ).toEqual(["update task-a uid-task-a"]);
    });

    it("is replaced (deleted, then written) by a calendar that cannot change events but can do both", () => {
      expect(
        plan({
          desired: [EDITED_A],
          links: [link(A)],
          remote: [event("task-a")],
          capabilities: CREATE_DELETE,
        }),
      ).toEqual(["replace task-a uid-task-a"]);
    });

    it("keeps the event as it is in a calendar that only creates, and remembers the new fingerprint", () => {
      expect(
        plan({
          desired: [EDITED_A],
          links: [link(A)],
          remote: [event("task-a")],
          capabilities: CREATE_ONLY,
        }),
      ).toEqual(["acknowledge task-a uid-task-a"]);
    });

    it("adopts an event of ours that nothing remembers by changing it to the current content", () => {
      expect(
        plan({ desired: [A], remote: [event("task-a", "found")] }),
      ).toEqual(["update task-a found"]);
      expect(
        plan({
          desired: [A],
          remote: [event("task-a", "found")],
          capabilities: CREATE_ONLY,
        }),
      ).toEqual(["acknowledge task-a found"]);
    });

    it("takes over the id of an event written a moment ago when the content is current", () => {
      expect(
        plan({
          desired: [A],
          links: [link(A, { remoteUid: null })],
          remote: [event("task-a", "assigned-by-the-calendar")],
        }),
      ).toEqual(["adopt task-a assigned-by-the-calendar"]);
      expect(
        plan({
          desired: [A],
          links: [link(A, { remoteUid: "old" })],
          remote: [event("task-a", "new")],
        }),
      ).toEqual(["adopt task-a new"]);
    });

    it("is remembered as existing when the calendar gives its events no ids, and then left in peace", () => {
      expect(
        plan({
          desired: [A],
          links: [link(A, { remoteUid: null })],
          remote: [event("task-a", null)],
        }),
      ).toEqual(["adopt task-a "]);
      const settled = link(A, { remoteUid: NO_UID });
      expect(
        plan({
          desired: [A],
          links: [settled],
          remote: [event("task-a", null)],
        }),
      ).toEqual([]);
      // It cannot be removed either, and when it is gone it is a deleted event like any other.
      expect(
        plan({ links: [settled], remote: [event("task-a", null)] }),
      ).toEqual(["forget task-a"]);
      expect(plan({ desired: [A], links: [settled] })).toEqual([
        "create task-a (again)",
      ]);
      expect(hasPendingChanges([A], [settled])).toBe(false);
    });

    it("is waited for when written a moment ago and not shown yet, never written twice", () => {
      const result = reconcile(
        input({ desired: [A], links: [link(A, { remoteUid: null })] }),
      );
      expect(result.operations).toEqual([]);
      expect(result.unconfirmed).toEqual(["task-a"]);
    });

    it("is waited for until just before the wait is over", () => {
      const written = link(A, {
        remoteUid: null,
        pushedAt: T0 - UNCONFIRMED_GRACE_MS + 1,
      });
      const result = reconcile(input({ desired: [A], links: [written] }));
      expect(result.operations).toEqual([]);
      expect(result.unconfirmed).toEqual(["task-a"]);
    });

    it("counts as deleted when it was never shown in half an hour, and is written again", () => {
      const written = link(A, {
        remoteUid: null,
        pushedAt: T0 - UNCONFIRMED_GRACE_MS,
      });
      const result = reconcile(input({ desired: [A], links: [written] }));
      expect(result.operations.map(named)).toEqual(["create task-a (again)"]);
      expect(result.unconfirmed).toEqual([]);
    });

    it("counts as deleted on purpose after the wait when the target says forget", () => {
      const written = link(A, {
        remoteUid: null,
        pushedAt: T0 - UNCONFIRMED_GRACE_MS - 1,
      });
      expect(
        plan({ desired: [A], links: [written], onRemoteDelete: "forget" }),
      ).toEqual(["tombstone task-a"]);
    });

    it("is not waited for when nothing says when it was written", () => {
      expect(
        plan({
          desired: [A],
          links: [link(A, { remoteUid: null, pushedAt: null })],
        }),
      ).toEqual(["create task-a (again)"]);
    });

    it("is found by its id when the event shows up, whenever that is", () => {
      const written = link(A, {
        remoteUid: null,
        pushedAt: T0 - 10 * UNCONFIRMED_GRACE_MS,
      });
      expect(
        plan({
          desired: [A],
          links: [written],
          remote: [event("task-a", "x")],
        }),
      ).toEqual(["adopt task-a x"]);
    });

    it("is written again when somebody deleted its event and the target says recreate", () => {
      expect(plan({ desired: [A], links: [link(A)] })).toEqual([
        "create task-a (again)",
      ]);
    });

    it("is noted and never written again when the target says forget", () => {
      expect(
        plan({
          desired: [A],
          links: [link(A)],
          onRemoteDelete: "forget" satisfies CalendarRemoteDeletePolicy,
        }),
      ).toEqual(["tombstone task-a"]);
    });

    it("stays deleted while the note holds, whatever happens to the item", () => {
      const note = link(A, { status: "forgotten", remoteUid: null });
      expect(plan({ desired: [A], links: [note] })).toEqual([]);
      expect(plan({ desired: [EDITED_A], links: [note] })).toEqual([]);
    });

    it("comes back when the event shows up again after it was noted as deleted", () => {
      const note = link(A, { status: "forgotten", remoteUid: null });
      expect(
        plan({ desired: [A], links: [note], remote: [event("task-a")] }),
      ).toEqual(["update task-a uid-task-a"]);
    });

    it("is skipped when the calendar cannot create events", () => {
      expect(plan({ desired: [A], capabilities: NO_CREATE })).toEqual([
        "skip task-a (create_unsupported)",
      ]);
      expect(
        plan({ desired: [A], links: [link(A)], capabilities: NO_CREATE }),
      ).toEqual(["skip task-a (create_unsupported)"]);
    });

    it("is remembered as it is when its event has no id and needs a change", () => {
      expect(
        plan({
          desired: [EDITED_A],
          links: [link(A, { remoteUid: null })],
          remote: [event("task-a", null)],
        }),
      ).toEqual(["acknowledge task-a null"]);
      // An event that is current but has no id is remembered as existing (see below), nothing more.
      expect(
        plan({
          desired: [A],
          links: [link(A, { remoteUid: null })],
          remote: [event("task-a", null)],
        }),
      ).toEqual(["adopt task-a "]);
    });
  });

  describe("an item that is not wanted any more", () => {
    it("loses its event and its link when the calendar allows deleting", () => {
      expect(plan({ links: [link(A)], remote: [event("task-a")] })).toEqual([
        "delete task-a uid-task-a (obsolete)",
      ]);
    });

    it("loses only its link when the calendar cannot delete, and the event stays", () => {
      expect(
        plan({
          links: [link(A)],
          remote: [event("task-a")],
          capabilities: CREATE_ONLY,
        }),
      ).toEqual(["forget task-a"]);
    });

    it("loses only its link when the event is gone already", () => {
      expect(plan({ links: [link(A)] })).toEqual(["forget task-a"]);
    });

    it("loses a note about a deleted event", () => {
      expect(
        plan({ links: [link(A, { status: "forgotten", remoteUid: null })] }),
      ).toEqual(["forget task-a"]);
    });

    it("loses its event even when the kind is no longer carried, because a link names it", () => {
      expect(
        plan({
          links: [link(A)],
          remote: [event("task-a")],
          kinds: new Set<CalendarItemKind>(["appointments"]),
        }),
      ).toEqual(["delete task-a uid-task-a (obsolete)"]);
    });
  });

  describe("events nothing remembers and nothing wants", () => {
    it("are removed when they are ours and of a kind the target carries", () => {
      expect(plan({ remote: [event("task-x", "u1")] })).toEqual([
        "delete task-x u1 (orphan)",
      ]);
    });

    it("stay when the calendar cannot delete, or the event has no id", () => {
      expect(
        plan({ remote: [event("task-x")], capabilities: CREATE_ONLY }),
      ).toEqual([]);
      expect(plan({ remote: [event("task-x", null)] })).toEqual([]);
    });

    it("stay when their kind is not carried by the target or is unknown to this version", () => {
      expect(
        plan({
          remote: [event("warranty-x"), event("future-kind-x")],
        }),
      ).toEqual([]);
    });
  });

  describe("duplicates", () => {
    it("keep the event the link names and remove the others", () => {
      expect(
        plan({
          desired: [A],
          links: [link(A, { remoteUid: "second" })],
          remote: [event("task-a", "first"), event("task-a", "second")],
        }),
      ).toEqual(["delete task-a first (duplicate)"]);
    });

    it("keep the lowest id when no link names one, whatever order the calendar lists them in", () => {
      const a = plan({
        desired: [A],
        remote: [event("task-a", "b"), event("task-a", "a")],
      });
      const b = plan({
        desired: [A],
        remote: [event("task-a", "a"), event("task-a", "b")],
      });
      expect(a).toEqual(b);
      expect(a).toContain("delete task-a b (duplicate)");
      expect(a).toContain("update task-a a");
    });

    it("are left alone when the calendar cannot delete", () => {
      expect(
        plan({
          desired: [A],
          links: [link(A)],
          remote: [event("task-a"), event("task-a", "other")],
          capabilities: CREATE_ONLY,
        }),
      ).toEqual([]);
    });
  });

  describe("events that are not ours", () => {
    it("are never named in a step, whatever the capabilities and the items", () => {
      const foreign = Array.from({ length: 20 }, (_, i) =>
        event(null, `foreign-${i}`),
      );
      // Even an event that has the id of a link, but not our ref, is not touched.
      const lookalike = event(null, "uid-task-a");
      for (const capabilities of [FULL, CREATE_DELETE, CREATE_ONLY]) {
        for (const links of [[], [link(A)]]) {
          const ops = reconcile(
            input({
              desired: [EDITED_A, B],
              links,
              remote: [...foreign, lookalike],
              capabilities,
            }),
          ).operations;
          for (const op of ops) {
            const uid =
              "uid" in op && typeof op.uid === "string" ? op.uid : null;
            expect(uid === null || !uid.startsWith("foreign-")).toBe(true);
            expect(uid).not.toBe("uid-task-a");
          }
        }
      }
    });

    it("do not make a wanted item look written, and the item is created next to them", () => {
      expect(
        plan({ desired: [A], remote: [event(null, "uid-task-a")] }),
      ).toEqual(["create task-a"]);
    });
  });

  describe("order", () => {
    it("removes first, then changes, then writes, each by date", () => {
      const early = item("task-early", {
        when: { allDay: true, startDate: "2026-06-01", endDate: "2026-06-02" },
      });
      const late = item("task-late", {
        when: { allDay: true, startDate: "2026-09-01", endDate: "2026-09-02" },
      });
      const lateChanged = item("task-late", {
        summary: "changed",
        when: { allDay: true, startDate: "2026-09-01", endDate: "2026-09-02" },
      });
      const lateNew = item("task-newer", {
        when: { allDay: true, startDate: "2026-10-01", endDate: "2026-10-02" },
      });
      const ops = plan({
        desired: [lateNew, early, lateChanged],
        links: [link(late), link(A)],
        remote: [event("task-late"), event("task-a")],
      });
      expect(ops).toEqual([
        "delete task-a uid-task-a (obsolete)",
        "update task-late uid-task-late",
        "create task-early",
        "create task-newer",
      ]);
    });

    it("separates the steps that call the calendar from those that only change what hauswart remembers", () => {
      const ops = reconcile(
        input({ desired: [A], links: [link(A), link(B)] }),
      ).operations;
      expect(
        ops.map((op) => [op.type, isRemote(op)] as [string, boolean]),
      ).toEqual([
        ["create", true],
        ["forget", false],
      ]);
    });
  });

  describe("convergence", () => {
    /** A calendar that does what the steps say, to see that the plan settles. */
    function run(
      start: ReconcileInput,
      options: { reportsIds: boolean },
    ): string[][] {
      let links = [...start.links];
      let remote = start.remote.map((e) => ({ ...e }));
      let next = 0;
      const passes: string[][] = [];
      for (let pass = 0; pass < 5; pass++) {
        const { operations } = reconcile({ ...start, links, remote });
        passes.push(operations.map(named));
        if (operations.length === 0) break;
        const without = (ref: string) => links.filter((l) => l.ref !== ref);
        for (const op of operations) {
          switch (op.type) {
            case "create": {
              const uid = `created-${next++}`;
              remote.push({ ref: op.item.ref, uid });
              links = [
                ...without(op.item.ref),
                link(op.item, {
                  remoteUid: options.reportsIds ? uid : null,
                }),
              ];
              break;
            }
            case "replace": {
              remote = remote.filter((e) => e.uid !== op.uid);
              const uid = `created-${next++}`;
              remote.push({ ref: op.item.ref, uid });
              links = [
                ...without(op.item.ref),
                link(op.item, {
                  remoteUid: options.reportsIds ? uid : null,
                }),
              ];
              break;
            }
            case "update":
            case "acknowledge":
            case "adopt":
              links = [
                ...without(op.item.ref),
                link(op.item, { remoteUid: op.uid }),
              ];
              break;
            case "delete":
              remote = remote.filter((e) => e.uid !== op.uid);
              if (op.link) links = without(op.ref);
              break;
            case "forget":
              links = without(op.link.ref);
              break;
            case "tombstone":
              links = [
                ...without(op.item.ref),
                link(op.item, { status: "forgotten", remoteUid: null }),
              ];
              break;
            case "skip":
              break;
          }
        }
      }
      return passes;
    }

    const scenarios: Array<[string, Partial<ReconcileInput>]> = [
      [
        "a mix of new, changed, obsolete and foreign",
        {
          desired: [EDITED_A, B, item("appointment-1")],
          links: [link(A), link(item("task-gone"))],
          remote: [
            event("task-a"),
            event("task-gone"),
            event(null, "someone-elses"),
            event("task-orphan"),
          ],
        },
      ],
      [
        "an event somebody deleted",
        { desired: [A], links: [link(A)], onRemoteDelete: "forget" },
      ],
      [
        "duplicates",
        {
          desired: [A],
          links: [link(A)],
          remote: [event("task-a"), event("task-a", "other")],
        },
      ],
    ];

    it.each(
      scenarios.flatMap(([name, over]) =>
        [
          ["full", FULL],
          ["create and delete", CREATE_DELETE],
          ["create only", CREATE_ONLY],
        ].flatMap(([label, capabilities]) =>
          [true, false].map(
            (reportsIds) =>
              [
                `${name}, ${label} calendar, ids ${reportsIds ? "reported" : "found again"}`,
                { ...over, capabilities },
                reportsIds,
              ] as const,
          ),
        ),
      ),
    )("%s: settles, and then plans nothing", (_name, over, reportsIds) => {
      const passes = run(input(over as Partial<ReconcileInput>), {
        reportsIds,
      });
      expect(passes.at(-1)).toEqual([]);
      expect(passes.length).toBeLessThanOrEqual(3);
    });
  });
});

describe("hasPendingChanges", () => {
  it("is false when every item has a current link and no link is left over", () => {
    expect(hasPendingChanges([A, B], [link(A), link(B)])).toBe(false);
    expect(hasPendingChanges([], [])).toBe(false);
  });

  it("sees an item without a link, a changed item, an event never found again and a link without an item", () => {
    expect(hasPendingChanges([A, B], [link(A)])).toBe(true);
    expect(hasPendingChanges([EDITED_A], [link(A)])).toBe(true);
    expect(hasPendingChanges([A], [link(A, { remoteUid: null })])).toBe(true);
    expect(hasPendingChanges([A], [link(A), link(B)])).toBe(true);
  });

  it("leaves a note about a deleted event alone, whatever the item looks like", () => {
    const note = link(A, { status: "forgotten", remoteUid: null });
    expect(hasPendingChanges([A], [note])).toBe(false);
    expect(hasPendingChanges([EDITED_A], [note])).toBe(false);
    expect(hasPendingChanges([], [note])).toBe(true);
  });
});
