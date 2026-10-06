import { describe, expect, it } from "vitest";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
import { setSignalProvider } from "./signals";
import { afterEach } from "vitest";
import { completeTask } from "./completions";
import {
  completePreparation,
  createPreparation,
  deletePreparation,
  listPreparations,
  updatePreparation,
} from "./preparations";
import { evaluateAll } from "./evaluator";

describe("preparations", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  afterEach(() => setSignalProvider(null));
  const prep = (
    taskId: string,
    input: Partial<Parameters<typeof createPreparation>[2]> = {},
    now = NOW,
  ) =>
    createPreparation(ctx(now), taskId, {
      title: "Filter bestellen",
      kind: "generic",
      qty: 1,
      ...input,
    });

  it("is not yet relevant before its lead time and relevant from then on", async () => {
    const task = await makeTask(ctx(), {
      trigger: everyDays(30, "2026-06-30"),
    });
    const p = await prep(task.id, { leadDays: 7 });
    expect(p.state).toBe("not_yet");
    await evaluateAll(ctx(at("2026-06-22")));
    expect(
      (await listPreparations(ctx(at("2026-06-22")), task.id))[0].state,
    ).toBe("not_yet");
    expect(
      (await listPreparations(ctx(at("2026-06-23")), task.id))[0].state,
    ).toBe("now");
    expect(
      (await listPreparations(ctx(at("2026-07-05")), task.id))[0].state,
    ).toBe("now");
  });

  it("without a lead it is relevant when the task is due", async () => {
    const task = await makeTask(ctx(), {
      trigger: everyDays(30, "2026-06-20"),
    });
    const p = await prep(task.id);
    expect(p.state).toBe("not_yet");
    expect(
      (await listPreparations(ctx(at("2026-06-20")), task.id))[0].state,
    ).toBe("now");
  });

  it("completing marks it done for this occurrence and resets for the next", async () => {
    const task = await makeTask(ctx(), {
      trigger: everyDays(30, "2026-06-18"),
    });
    const p = await prep(task.id, { leadDays: 10 });
    expect(p.state).toBe("now");
    const user = await createTestUser();
    const done = await completePreparation(ctx(), task.id, p.id, {
      userId: user.id,
    });
    expect(done.state).toBe("done");
    await completeTask(ctx(), task.id, {
      kind: "done",
      source: "manual",
      userId: user.id,
    });
    const after = await listPreparations(ctx(), task.id);
    expect(after[0].state).toBe("not_yet");
  });

  it("ticking twice is harmless", async () => {
    const task = await makeTask(ctx(), {
      trigger: everyDays(30, "2026-06-18"),
    });
    const p = await prep(task.id, { leadDays: 10 });
    await completePreparation(ctx(), task.id, p.id, { userId: null });
    const again = await completePreparation(ctx(NOW + 5000), task.id, p.id, {
      userId: null,
    });
    expect(again.state).toBe("done");
  });

  it("an explicit occurrence ticks that occurrence only", async () => {
    const task = await makeTask(ctx(), {
      trigger: everyDays(30, "2026-06-18"),
    });
    const p = await prep(task.id, { leadDays: 10 });
    const other = await completePreparation(ctx(), task.id, p.id, {
      userId: null,
      occurrenceKey: "2026-05-01",
    });
    expect(other.state).toBe("now");
  });

  it("orders by sort order and lists only the task's own", async () => {
    const [a, b] = [await makeTask(ctx()), await makeTask(ctx())];
    await prep(a.id, { title: "Zweite", sortOrder: 2 });
    await prep(a.id, { title: "Erste", sortOrder: 1 });
    await prep(b.id, { title: "Fremde" });
    expect((await listPreparations(ctx(), a.id)).map((p) => p.title)).toEqual([
      "Erste",
      "Zweite",
    ]);
  });

  it("updates fields and clears lead values with null", async () => {
    const task = await makeTask(ctx());
    const p = await prep(task.id, { leadDays: 14, qty: 2 });
    const updated = await updatePreparation(ctx(), task.id, p.id, {
      title: "Neu",
      leadDays: null,
      qty: 3,
    });
    expect(updated).toMatchObject({ title: "Neu", leadDays: null, qty: 3 });
  });

  it("works on its own task only: other tasks' preparations are 404", async () => {
    const [a, b] = [await makeTask(ctx()), await makeTask(ctx())];
    const p = await prep(a.id);
    await expect(
      updatePreparation(ctx(), b.id, p.id, { title: "x" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      completePreparation(ctx(), b.id, p.id, { userId: null }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(() => deletePreparation(ctx(), b.id, p.id)).toThrow(
      "Preparation not found",
    );
    await expect(prep("nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(listPreparations(ctx(), "nope")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("deletes", async () => {
    const task = await makeTask(ctx());
    const p = await prep(task.id);
    deletePreparation(ctx(), task.id, p.id);
    expect(await listPreparations(ctx(), task.id)).toEqual([]);
  });

  it("a signal-based lead makes it relevant while the reading matches", async () => {
    const task = await makeTask(ctx(), {
      trigger: everyDays(30, "2026-08-30"),
    });
    const p = await prep(task.id, {
      leadValue: { entityId: "sensor.filter_rest", op: "lt", value: 20 },
    });
    expect(p.leadValue).toEqual({
      entityId: "sensor.filter_rest",
      op: "lt",
      value: 20,
    });
    expect(p.state).toBe("not_yet");
    setSignalProvider({
      load: (needs) => {
        expect(needs.entityIds).toEqual(["sensor.filter_rest"]);
        return {
          signals: {
            "sensor.filter_rest": { numeric: 15, changedAt: NOW, seenAt: NOW },
          },
        };
      },
    });
    expect((await listPreparations(ctx(), task.id))[0].state).toBe("now");
  });
});
