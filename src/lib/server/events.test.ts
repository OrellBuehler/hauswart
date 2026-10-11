import { afterEach, describe, expect, it } from "vitest";
import { emitEvent, onEvent } from "./events";
import type { ServiceContext } from "./service";

const payload = {
  ctx: {} as ServiceContext,
  completion: {
    id: "c1",
    taskId: "t1",
    kind: "done" as const,
    userId: null,
    completedAt: new Date(0),
    completedDate: "1970-01-01",
    counterValue: null,
  },
};

describe("domain events", () => {
  const unsubscribe: (() => void)[] = [];
  afterEach(() => {
    unsubscribe.splice(0).forEach((off) => off());
  });

  it("calls listeners in subscription order", () => {
    const calls: string[] = [];
    unsubscribe.push(
      onEvent("completionRecorded", () => calls.push("a")),
      onEvent("completionRecorded", () => calls.push("b")),
    );
    emitEvent("completionRecorded", payload);
    expect(calls).toEqual(["a", "b"]);
  });

  it("subscribing the same function twice calls it once", () => {
    let n = 0;
    const listener = () => {
      n += 1;
    };
    unsubscribe.push(
      onEvent("completionRecorded", listener),
      onEvent("completionRecorded", listener),
    );
    emitEvent("completionRecorded", payload);
    expect(n).toBe(1);
  });

  it("stops calling an unsubscribed listener and keeps events apart", () => {
    let recorded = 0;
    let revoked = 0;
    const off = onEvent("completionRecorded", () => {
      recorded += 1;
    });
    unsubscribe.push(
      onEvent("completionRevoked", () => {
        revoked += 1;
      }),
    );
    emitEvent("completionRecorded", payload);
    off();
    emitEvent("completionRecorded", payload);
    expect([recorded, revoked]).toEqual([1, 0]);
  });

  it("lets a listener's error reach the emitter and skips the rest", () => {
    let later = false;
    unsubscribe.push(
      onEvent("completionRecorded", () => {
        throw new Error("boom");
      }),
      onEvent("completionRecorded", () => {
        later = true;
      }),
    );
    expect(() => emitEvent("completionRecorded", payload)).toThrow("boom");
    expect(later).toBe(false);
  });
});
