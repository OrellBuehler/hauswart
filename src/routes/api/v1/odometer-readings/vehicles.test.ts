import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import { today } from "$lib/testing/dates";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

type Reading = {
  id: string;
  assetId: string;
  date: string;
  value: number;
  source: string;
  sourceId: string | null;
  note: string | null;
  createdBy: string | null;
};
type Asset = { id: string; kind: string; vehicle?: unknown };
type Page<T> = { items: T[]; nextCursor: string | null };

function fieldError(body: unknown, field: string): string[] {
  const details = (
    body as { error: { details?: { body?: { fieldErrors?: object } } } }
  ).error.details?.body?.fieldErrors as Record<string, string[]> | undefined;
  return details?.[field] ?? [];
}

describe("vehicles API", () => {
  useTestDB();
  async function setup() {
    const user = await createTestUser();
    const call = createCaller({ session: loginTestUser(user).token });
    const create = async (name = "Familienauto", kind = "vehicle") =>
      (await call("POST", "/api/v1/assets", { json: { name, kind } })).body as {
        id: string;
        kind: string;
        vehicle?: unknown;
      };
    return { user, call, create };
  }

  describe("details", () => {
    it("an asset of kind vehicle has empty details at first, then the ones saved", async () => {
      const { call, create } = await setup();
      const car = await create();
      expect(car.vehicle).toEqual({ plate: null, odometer: null });

      const empty = await call("GET", `/api/v1/assets/${car.id}/vehicle`);
      expect(empty.res.status).toBe(200);
      expect(empty.body).toEqual({
        assetId: car.id,
        plate: null,
        vin: null,
        registrationNumber: null,
        firstRegistration: null,
        fuelType: null,
        tireSizeSummer: null,
        tireSizeWinter: null,
        location: null,
        odometerUnit: "km",
        notes: null,
        odometer: null,
        updatedAt: null,
      });

      const saved = await call("PUT", `/api/v1/assets/${car.id}/vehicle`, {
        json: {
          plate: "ZH 000000",
          firstRegistration: "2022-03-10",
          fuelType: "electric",
          location: "Garage",
        },
      });
      expect(saved.res.status).toBe(200);
      expect(saved.body).toMatchObject({
        assetId: car.id,
        plate: "ZH 000000",
        firstRegistration: "2022-03-10",
        fuelType: "electric",
        location: "Garage",
        odometerUnit: "km",
        odometer: null,
      });
      expect((saved.body as { updatedAt: string }).updatedAt).toMatch(/Z$/);
      expect(
        (await call("GET", `/api/v1/assets/${car.id}/vehicle`)).body,
      ).toEqual(saved.body);
    });

    it("PUT replaces: a field left out is cleared", async () => {
      const { call, create } = await setup();
      const car = await create();
      await call("PUT", `/api/v1/assets/${car.id}/vehicle`, {
        json: { plate: "ZH 000000", odometerUnit: "mi", notes: "x" },
      });
      const second = await call("PUT", `/api/v1/assets/${car.id}/vehicle`, {
        json: { vin: "XXXEXAMPLE0000000" },
      });
      expect(second.body).toMatchObject({
        plate: null,
        notes: null,
        odometerUnit: "km",
        vin: "XXXEXAMPLE0000000",
      });
    });

    it("trims text and treats blanks as empty", async () => {
      const { call, create } = await setup();
      const car = await create();
      const r = await call("PUT", `/api/v1/assets/${car.id}/vehicle`, {
        json: { plate: "  ZH 000000 ", location: "   " },
      });
      expect(r.body).toMatchObject({ plate: "ZH 000000", location: null });
    });

    it("shows up on the asset, in lists and in a search for the plate", async () => {
      const { call, create } = await setup();
      const car = await create();
      await create("Backofen", "device");
      await call("PUT", `/api/v1/assets/${car.id}/vehicle`, {
        json: { plate: "ZH 000000" },
      });
      await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 82_300, date: today(-3) },
      });
      const summary = {
        plate: "ZH 000000",
        odometer: { value: 82_300, date: today(-3), unit: "km" },
      };
      expect(
        (
          (await call("GET", `/api/v1/assets/${car.id}`)).body as {
            vehicle: unknown;
          }
        ).vehicle,
      ).toEqual(summary);

      const vehicles = (await call("GET", "/api/v1/assets?kind=vehicle"))
        .body as Page<{ id: string; kind: string; vehicle?: unknown }>;
      expect(vehicles.items).toHaveLength(1);
      expect(vehicles.items[0]).toMatchObject({ id: car.id, kind: "vehicle" });
      expect(vehicles.items[0].vehicle).toEqual(summary);

      const all = (await call("GET", "/api/v1/assets")).body as Page<{
        kind: string;
        vehicle?: unknown;
      }>;
      expect(
        all.items.find((a) => a.kind === "device")?.vehicle,
      ).toBeUndefined();

      const byPlate = (await call("GET", "/api/v1/assets?q=zh000000"))
        .body as Page<{
        id: string;
      }>;
      expect(byPlate.items.map((a) => a.id)).toEqual([car.id]);

      const hits = (await call("GET", "/api/v1/search?q=ZH%20000000")).body as {
        items: { type: string; id: string; url: string }[];
      };
      expect(hits.items).toMatchObject([
        { type: "asset", id: car.id, url: `/assets/${car.id}` },
      ]);
    });

    it.each([
      ["an unknown field", { color: "red" }],
      ["a fuel that does not exist", { fuelType: "steam" }],
      ["an odometer unit that does not exist", { odometerUnit: "furlong" }],
      ["a date that is none", { firstRegistration: "2022-02-30" }],
      ["a plate that is far too long", { plate: "X".repeat(33) }],
      ["a number as plate", { plate: 12 }],
    ])("refuses %s", async (_name, json) => {
      const { call, create } = await setup();
      const car = await create();
      const r = await call("PUT", `/api/v1/assets/${car.id}/vehicle`, { json });
      expect(errorCode(r)).toBe("invalid_request");
      expect(r.res.status).toBe(400);
    });

    it("only a vehicle has details; a missing asset is a 404", async () => {
      const { call, create } = await setup();
      const device = await create("Backofen", "device");
      const put = await call("PUT", `/api/v1/assets/${device.id}/vehicle`, {
        json: { plate: "ZH 1" },
      });
      expect(put.res.status).toBe(400);
      expect(errorCode(put)).toBe("invalid_request");
      expect(
        errorCode(await call("GET", `/api/v1/assets/${device.id}/vehicle`)),
      ).toBe("not_found");
      expect(errorCode(await call("GET", "/api/v1/assets/nope/vehicle"))).toBe(
        "not_found",
      );
      expect(
        errorCode(
          await call("PUT", "/api/v1/assets/nope/vehicle", { json: {} }),
        ),
      ).toBe("not_found");
    });

    it("a vehicle with details or readings keeps its kind (400 on kind); once they are gone it may change", async () => {
      const { call, create } = await setup();
      const car = await create();
      await call("PUT", `/api/v1/assets/${car.id}/vehicle`, {
        json: { plate: "ZH 000000" },
      });
      const refused = await call("PATCH", `/api/v1/assets/${car.id}`, {
        json: { kind: "device" },
      });
      expect(refused.res.status).toBe(400);
      expect(errorCode(refused)).toBe("invalid_request");
      expect(fieldError(refused.body, "kind")).toHaveLength(1);
      expect(
        ((await call("GET", `/api/v1/assets/${car.id}`)).body as Asset).kind,
      ).toBe("vehicle");

      const reading = (
        await call("POST", `/api/v1/assets/${car.id}/odometer`, {
          json: { value: 1000 },
        })
      ).body as Reading;
      await call("PUT", `/api/v1/assets/${car.id}/vehicle`, { json: {} });
      expect(
        (
          await call("PATCH", `/api/v1/assets/${car.id}`, {
            json: { kind: "device" },
          })
        ).res.status,
      ).toBe(400);

      await call("DELETE", `/api/v1/odometer-readings/${reading.id}`);
      const changed = await call("PATCH", `/api/v1/assets/${car.id}`, {
        json: { kind: "device" },
      });
      expect(changed.res.status).toBe(200);
      expect((changed.body as Asset).kind).toBe("device");
      expect((changed.body as Asset).vehicle).toBeUndefined();
    });

    it("tokens need read to see and write to save", async () => {
      const { user, call, create } = await setup();
      const car = await create();
      const reader = createCaller({
        bearer: createTestToken(user, { scopes: ["read"] }).token,
      });
      expect(
        (await reader("GET", `/api/v1/assets/${car.id}/vehicle`)).res.status,
      ).toBe(200);
      expect(
        (
          await reader("PUT", `/api/v1/assets/${car.id}/vehicle`, {
            json: { plate: "ZH 1" },
          })
        ).res.status,
      ).toBe(403);
      expect(
        (
          await reader("POST", `/api/v1/assets/${car.id}/odometer`, {
            json: { value: 1 },
          })
        ).res.status,
      ).toBe(403);
      expect(
        (await call("GET", `/api/v1/assets/${car.id}/vehicle`)).res.status,
      ).toBe(200);
    });
  });

  describe("odometer", () => {
    it("records a reading dated today by default and lists newest first", async () => {
      const { user, call, create } = await setup();
      const car = await create();
      const first = await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 80_000, date: today(-40), note: "Tankstelle" },
      });
      expect(first.res.status).toBe(201);
      expect(first.body).toMatchObject({
        assetId: car.id,
        date: today(-40),
        value: 80_000,
        source: "manual",
        sourceId: null,
        note: "Tankstelle",
        createdBy: user.id,
      });
      const second = await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 81_250.5 },
      });
      expect((second.body as Reading).date).toBe(today());

      const list = (await call("GET", `/api/v1/assets/${car.id}/odometer`))
        .body as Page<Reading>;
      expect(list.items.map((r) => r.value)).toEqual([81_250.5, 80_000]);
      expect(list.nextCursor).toBeNull();
      expect(
        (await call("GET", `/api/v1/assets/${car.id}/vehicle`)).body,
      ).toMatchObject({
        odometer: { value: 81_250.5, date: today(), unit: "km" },
      });
    });

    it("pages with a cursor", async () => {
      const { call, create } = await setup();
      const car = await create();
      for (const [i, offset] of [-30, -20, -10].entries()) {
        await call("POST", `/api/v1/assets/${car.id}/odometer`, {
          json: { value: 1_000 + i, date: today(offset) },
        });
      }
      const first = (
        await call("GET", `/api/v1/assets/${car.id}/odometer?limit=2`)
      ).body as Page<Reading>;
      expect(first.items.map((r) => r.value)).toEqual([1_002, 1_001]);
      const second = (
        await call(
          "GET",
          `/api/v1/assets/${car.id}/odometer?limit=2&cursor=${first.nextCursor}`,
        )
      ).body as Page<Reading>;
      expect(second.items.map((r) => r.value)).toEqual([1_000]);
      expect(second.nextCursor).toBeNull();
      expect(
        errorCode(
          await call("GET", `/api/v1/assets/${car.id}/odometer?cursor=garbage`),
        ),
      ).toBe("invalid_request");
    });

    it("a value lower than the reading before is a 400 on value, unless forced", async () => {
      const { call, create } = await setup();
      const car = await create();
      await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 120_000, date: today(-10) },
      });
      const refused = await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 500, date: today(-5) },
      });
      expect(refused.res.status).toBe(400);
      expect(errorCode(refused)).toBe("invalid_request");
      expect(fieldError(refused.body, "value")[0]).toContain("120000");
      const forced = await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 500, date: today(-5), force: true },
      });
      expect(forced.res.status).toBe(201);
      expect(
        (
          (await call("GET", `/api/v1/assets/${car.id}/odometer`))
            .body as Page<Reading>
        ).items.map((r) => r.value),
      ).toEqual([500, 120_000]);
    });

    it.each([
      ["no value", {}, "value"],
      ["a negative value", { value: -1 }, "value"],
      ["a value beyond any odometer", { value: 10_000_001 }, "value"],
      ["a value that is text", { value: "80000" }, "value"],
      ["a date in the future", { value: 1, date: "2999-01-01" }, "date"],
      ["a date that is none", { value: 1, date: "2026-13-01" }, "date"],
    ])("refuses %s", async (_name, json, field) => {
      const { call, create } = await setup();
      const car = await create();
      const r = await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json,
      });
      expect(r.res.status).toBe(400);
      expect(fieldError(r.body, field)).not.toEqual([]);
    });

    it("refuses an unknown field", async () => {
      const { call, create } = await setup();
      const car = await create();
      const r = await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 1, source: "fuel_log" },
      });
      expect(r.res.status).toBe(400);
    });

    it("only a vehicle has an odometer; a missing asset is a 404", async () => {
      const { call, create } = await setup();
      const device = await create("Backofen", "device");
      expect(
        (
          await call("POST", `/api/v1/assets/${device.id}/odometer`, {
            json: { value: 1 },
          })
        ).res.status,
      ).toBe(400);
      expect(
        errorCode(
          await call("POST", "/api/v1/assets/nope/odometer", {
            json: { value: 1 },
          }),
        ),
      ).toBe("not_found");
      expect(errorCode(await call("GET", "/api/v1/assets/nope/odometer"))).toBe(
        "not_found",
      );
    });

    it("deletes a reading, and the one before becomes the current one", async () => {
      const { call, create } = await setup();
      const car = await create();
      await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 80_000, date: today(-10) },
      });
      const wrong = (
        await call("POST", `/api/v1/assets/${car.id}/odometer`, {
          json: { value: 800_000 },
        })
      ).body as Reading;
      const gone = await call(
        "DELETE",
        `/api/v1/odometer-readings/${wrong.id}`,
      );
      expect(gone.res.status).toBe(204);
      expect(
        (await call("GET", `/api/v1/assets/${car.id}/vehicle`)).body,
      ).toMatchObject({ odometer: { value: 80_000 } });
      expect(
        errorCode(
          await call("DELETE", `/api/v1/odometer-readings/${wrong.id}`),
        ),
      ).toBe("not_found");
    });

    it("a reading that a service log entry wrote is a 409 that names the entry; a free one deletes", async () => {
      const { call, create } = await setup();
      const car = await create();
      const entry = (
        await call("POST", `/api/v1/assets/${car.id}/service-log`, {
          json: { title: "Ölwechsel", odometer: 84_200, date: today(-2) },
        })
      ).body as { id: string };
      const free = (
        await call("POST", `/api/v1/assets/${car.id}/odometer`, {
          json: { value: 90_000, date: today(-1) },
        })
      ).body as Reading;
      const readings = async () =>
        (
          (await call("GET", `/api/v1/assets/${car.id}/odometer`))
            .body as Page<Reading>
        ).items;
      const owned = (await readings()).find((r) => r.source === "service_log")!;

      const refused = await call(
        "DELETE",
        `/api/v1/odometer-readings/${owned.id}`,
      );
      expect(refused.res.status).toBe(409);
      expect(errorCode(refused)).toBe("conflict");
      expect(
        (refused.body as { error: { message: string } }).error.message,
      ).toMatch(/service log entry/);
      expect(
        (refused.body as { error: { details: unknown } }).error.details,
      ).toEqual({ source: "service_log", sourceId: entry.id });
      expect(await readings()).toHaveLength(2);

      expect(
        (await call("DELETE", `/api/v1/odometer-readings/${free.id}`)).res
          .status,
      ).toBe(204);
      await call("DELETE", `/api/v1/assets/${car.id}/service-log/${entry.id}`);
      expect(await readings()).toEqual([]);
    });

    it("a reading can be taken from every household member's token with write", async () => {
      const { user, create } = await setup();
      const car = await create();
      const writer = createCaller({
        bearer: createTestToken(user, { scopes: ["read", "write"] }).token,
      });
      const r = await writer("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 10 },
      });
      expect(r.res.status).toBe(201);
      expect(
        (
          await writer(
            "DELETE",
            `/api/v1/odometer-readings/${(r.body as Reading).id}`,
          )
        ).res.status,
      ).toBe(204);
    });
  });

  describe("tasks that count on the odometer", () => {
    const trigger = (assetId: string, extra = {}) => ({
      v: 1,
      type: "counter_delta",
      entityId: `odometer:${assetId}`,
      threshold: 15_000,
      unit: "km",
      ...extra,
    });

    it("previews a service every 15,000 km or 12 months from the time half", async () => {
      const { call, create } = await setup();
      const car = await create();
      const r = await call("POST", "/api/v1/tasks/preview", {
        json: {
          trigger: trigger(car.id, { orEvery: { every: 12, unit: "month" } }),
        },
      });
      expect(r.res.status).toBe(200);
      expect(r.body).toMatchObject({
        status: "ok",
        dueKind: "exact",
        reasons: ["signal_missing"],
      });
      expect((r.body as { dueDate: string }).dueDate).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
    });

    it("refuses a time limit that is none", async () => {
      const { call, create } = await setup();
      const car = await create();
      const r = await call("POST", "/api/v1/tasks/preview", {
        json: {
          trigger: trigger(car.id, { orEvery: { every: 0, unit: "month" } }),
        },
      });
      expect(r.res.status).toBe(400);
    });

    it("the odometer drives the task; a completion with a reading records it and an undo takes it back", async () => {
      const { call, create } = await setup();
      const car = await create();
      const task = (
        await call("POST", "/api/v1/tasks", {
          json: {
            title: "Service",
            assetId: car.id,
            trigger: trigger(car.id, { orEvery: { every: 12, unit: "month" } }),
          },
        })
      ).body as { id: string; state: { status: string } };
      expect(task.state.status).toBe("ok");

      await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 80_000, date: today(-30) },
      });
      await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 96_000 },
      });
      const due = (await call("GET", `/api/v1/tasks/${task.id}`)).body as {
        state: {
          status: string;
          dueKind: string;
          progress: { current: number };
        };
      };
      expect(due.state).toMatchObject({
        status: "due",
        dueKind: "condition",
        progress: { current: 16_000 },
      });

      const tooLow = await call("POST", `/api/v1/tasks/${task.id}/complete`, {
        json: { counterValue: 70_000 },
      });
      expect(tooLow.res.status).toBe(400);
      expect(fieldError(tooLow.body, "counterValue")).not.toEqual([]);

      const done = await call("POST", `/api/v1/tasks/${task.id}/complete`, {
        json: { counterValue: 96_500 },
      });
      expect(done.res.status).toBe(201);
      const completion = (done.body as { completion: { id: string } })
        .completion;
      const readings = (await call("GET", `/api/v1/assets/${car.id}/odometer`))
        .body as Page<Reading>;
      expect(readings.items[0]).toMatchObject({
        value: 96_500,
        source: "completion",
        sourceId: completion.id,
      });
      expect(
        (
          (await call("GET", `/api/v1/tasks/${task.id}`)).body as {
            state: { status: string };
          }
        ).state.status,
      ).toBe("ok");

      expect(
        (await call("DELETE", `/api/v1/completions/${completion.id}`)).res
          .status,
      ).toBe(204);
      const after = (await call("GET", `/api/v1/assets/${car.id}/odometer`))
        .body as Page<Reading>;
      expect(after.items.map((r) => r.value)).toEqual([96_000, 80_000]);
    });
  });

  describe("other tasks on the same odometer", () => {
    it("follow a completion with a reading and its undo at once, not at the next tick", async () => {
      const { call, create } = await setup();
      const car = await create();
      const make = async (title: string, threshold: number) =>
        (
          await call("POST", "/api/v1/tasks", {
            json: {
              title,
              assetId: car.id,
              trigger: {
                v: 1,
                type: "counter_delta",
                entityId: `odometer:${car.id}`,
                threshold,
                unit: "km",
              },
            },
          })
        ).body as { id: string };
      const service = await make("Service", 15_000);
      const tires = await make("Reifen prüfen", 5_000);
      await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 80_000, date: today(-30) },
      });
      await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 82_000, date: today(-5) },
      });
      const stateOf = async (id: string) =>
        (
          (await call("GET", `/api/v1/tasks/${id}`)).body as {
            state: { status: string; progress: { current: number } };
          }
        ).state;
      const notified = async () =>
        (
          (await call("GET", "/api/v1/notifications")).body as {
            items: { taskId: string | null; kind: string }[];
          }
        ).items.filter((n) => n.taskId === tires.id && n.kind === "due");
      expect(await stateOf(tires.id)).toMatchObject({
        status: "ok",
        progress: { current: 2_000 },
      });

      const done = await call("POST", `/api/v1/tasks/${service.id}/complete`, {
        json: { counterValue: 90_000 },
      });
      expect(done.res.status).toBe(201);
      expect(await stateOf(tires.id)).toMatchObject({
        status: "due",
        progress: { current: 10_000 },
      });
      expect(await notified()).toHaveLength(1);

      const completion = (done.body as { completion: { id: string } })
        .completion;
      await call("DELETE", `/api/v1/completions/${completion.id}`);
      expect(await stateOf(tires.id)).toMatchObject({
        status: "ok",
        progress: { current: 2_000 },
      });
    });
  });

  describe("service log", () => {
    it("an entry with an odometer value is a reading, and follows the entry", async () => {
      const { call, create } = await setup();
      const car = await create();
      const created = await call(
        "POST",
        `/api/v1/assets/${car.id}/service-log`,
        {
          json: { title: "Ölwechsel", odometer: 84_200, date: today(-2) },
        },
      );
      expect(created.res.status).toBe(201);
      const entry = created.body as { id: string; odometer: number };
      expect(entry.odometer).toBe(84_200);
      const readings = () =>
        call("GET", `/api/v1/assets/${car.id}/odometer`).then(
          (r) => (r.body as Page<Reading>).items,
        );
      expect(await readings()).toMatchObject([
        {
          value: 84_200,
          date: today(-2),
          source: "service_log",
          sourceId: entry.id,
        },
      ]);

      const patched = await call(
        "PATCH",
        `/api/v1/assets/${car.id}/service-log/${entry.id}`,
        { json: { odometer: 84_300 } },
      );
      expect((patched.body as { odometer: number }).odometer).toBe(84_300);
      expect(await readings()).toMatchObject([{ value: 84_300 }]);

      await call("DELETE", `/api/v1/assets/${car.id}/service-log/${entry.id}`);
      expect(await readings()).toEqual([]);
    });

    it("a value lower than the reading before is a 400 on odometer", async () => {
      const { call, create } = await setup();
      const car = await create();
      await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 90_000, date: today(-5) },
      });
      const r = await call("POST", `/api/v1/assets/${car.id}/service-log`, {
        json: { title: "Ölwechsel", odometer: 80_000 },
      });
      expect(r.res.status).toBe(400);
      expect(fieldError(r.body, "odometer")).not.toEqual([]);
    });

    it("entries of other assets have no odometer, and say so when given one", async () => {
      const { call, create } = await setup();
      const device = await create("Backofen", "device");
      const plain = await call(
        "POST",
        `/api/v1/assets/${device.id}/service-log`,
        {
          json: { title: "Entkalkt" },
        },
      );
      expect((plain.body as { odometer: unknown }).odometer).toBeNull();
      const r = await call("POST", `/api/v1/assets/${device.id}/service-log`, {
        json: { title: "Entkalkt", odometer: 10 },
      });
      expect(r.res.status).toBe(400);
      expect(fieldError(r.body, "odometer")).not.toEqual([]);
    });

    it("tasks that count on the odometer follow a reading written by an entry at once", async () => {
      const { call, create } = await setup();
      const car = await create();
      await call("POST", `/api/v1/assets/${car.id}/odometer`, {
        json: { value: 80_000, date: today(-20) },
      });
      const task = (
        await call("POST", "/api/v1/tasks", {
          json: {
            title: "Service",
            trigger: {
              v: 1,
              type: "counter_delta",
              entityId: `odometer:${car.id}`,
              threshold: 15_000,
            },
          },
        })
      ).body as { id: string };
      await call("POST", `/api/v1/assets/${car.id}/service-log`, {
        json: { title: "Tankfüllung", odometer: 96_000 },
      });
      expect(
        (
          (await call("GET", `/api/v1/tasks/${task.id}`)).body as {
            state: { status: string };
          }
        ).state.status,
      ).toBe("due");
    });
  });
});
