import { describe, expect, it } from "vitest";
import { createAsset } from "$lib/server/assets/assets";
import { createHint } from "$lib/server/hints/hints";
import { createPreparation } from "$lib/server/tasks/preparations";
import { updateTask } from "$lib/server/tasks/tasks";
import { onEvent } from "$lib/server/events";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
import { createHintRequestSchema } from "$lib/api/schemas/hints";
import { createPreparationRequestSchema } from "$lib/api/schemas/tasks";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { tasksReading, watchedEntities } from "./watch";

describe("watchedEntities", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db, NOW);

  it("is empty without signal-based tasks", async () => {
    await makeTask(ctx(), { trigger: everyDays(30, "2026-06-20") });
    expect(watchedEntities(ctx())).toEqual({ entityIds: [], calendars: [] });
  });

  it("collects counters, conditions with their estimate, calendars and auto-complete entities", async () => {
    await makeTask(ctx(), {
      trigger: {
        v: 1,
        type: "counter_delta",
        entityId: "sensor.example_counter",
        threshold: 50,
        autoComplete: [
          {
            type: "counter_reset",
            entityId: "sensor.example_reset",
            minDrop: 10,
          },
        ],
      },
    });
    await makeTask(ctx(), {
      trigger: {
        v: 1,
        type: "state_condition",
        entityId: "binary_sensor.example_door",
        op: "eq",
        value: "on",
        estimateFrom: {
          entityId: "sensor.example_level",
          target: 10,
          direction: "down",
        },
      },
    });
    await makeTask(ctx(), {
      trigger: {
        v: 1,
        type: "ha_calendar",
        entityId: "calendar.example_waste",
        summaryMatch: "paper",
        offsetDays: -1,
      },
    });
    await makeTask(ctx(), {
      trigger: {
        ...everyDays(30, "2026-06-20"),
        autoComplete: [
          {
            type: "state_change",
            entityId: "sensor.example_program",
            to: "descale",
          },
        ],
      },
    });
    expect(watchedEntities(ctx())).toEqual({
      entityIds: [
        "binary_sensor.example_door",
        "sensor.example_counter",
        "sensor.example_level",
        "sensor.example_program",
        "sensor.example_reset",
      ],
      calendars: [
        {
          key: "calendar.example_waste#paper",
          entityId: "calendar.example_waste",
          summaryMatch: "paper",
        },
      ],
    });
  });

  it("includes the shorthand counter reset, preparation leads and hint reactions, but not archived things", async () => {
    const task = await makeTask(ctx(), {
      trigger: {
        v: 1,
        type: "counter_delta",
        entityId: "sensor.example_counter",
        threshold: 50,
        autoCompleteOnReset: { minDrop: 5 },
      },
    });
    await createPreparation(
      ctx(),
      task.id,
      createPreparationRequestSchema.parse({
        title: "Order",
        leadValue: { entityId: "sensor.example_prep", op: "lt", value: 10 },
      }),
    );
    const asset = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Boiler" }),
    );
    createHint(
      ctx(),
      asset.id,
      createHintRequestSchema.parse({
        title: "Door",
        reaction: {
          type: "signal_change",
          entityId: "binary_sensor.example_hint",
          toState: "on",
          notify: "all",
        },
      }),
    );
    const archived = await makeTask(ctx(), {
      trigger: {
        v: 1,
        type: "counter_delta",
        entityId: "sensor.example_archived",
        threshold: 5,
      },
    });
    await updateTask(ctx(), archived.id, { archived: true });
    expect(watchedEntities(ctx()).entityIds).toEqual([
      "binary_sensor.example_hint",
      "sensor.example_counter",
      "sensor.example_prep",
    ]);
  });

  it("finds the tasks that read an entity or a calendar key", async () => {
    const counter = await makeTask(ctx(), {
      trigger: {
        v: 1,
        type: "counter_delta",
        entityId: "sensor.example_counter",
        threshold: 5,
      },
    });
    const calendar = await makeTask(ctx(), {
      trigger: {
        v: 1,
        type: "ha_calendar",
        entityId: "calendar.example",
        offsetDays: 0,
      },
    });
    await makeTask(ctx(), { trigger: everyDays(30, "2026-06-20") });
    expect(tasksReading(ctx(), ["sensor.example_counter"])).toEqual([
      counter.id,
    ]);
    expect(tasksReading(ctx(), [], ["calendar.example#"])).toEqual([
      calendar.id,
    ]);
    expect(tasksReading(ctx(), ["sensor.example_none"])).toEqual([]);
  });

  it("tells interested adapters when tasks, preparations or hint reactions change", async () => {
    let calls = 0;
    const off = onEvent("signalNeedsChanged", () => {
      calls += 1;
    });
    const task = await makeTask(ctx(), {
      trigger: everyDays(30, "2026-06-20"),
    });
    expect(calls).toBe(1);
    await updateTask(ctx(), task.id, { title: "x" });
    expect(calls).toBe(2);
    off();
  });
});
