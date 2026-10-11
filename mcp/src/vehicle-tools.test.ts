import { describe, expect, it } from "vitest";
import { putVehicleRequestSchema } from "../../src/lib/api/schemas/vehicles";
import { putVehicle } from "../../src/lib/server/vehicles/vehicles";
import { useMcp } from "./test-harness";

describe("vehicle tools", () => {
  const mcp = useMcp();

  async function connect(scopes: ("read" | "write")[] = ["read", "write"]) {
    const session = await mcp.connect({ scopes });
    const vehicle = async (
      name: string,
      plate: string | null,
      extra: Record<string, unknown> = {},
    ) => {
      const asset = await session.ok("create_asset", { name, kind: "vehicle" });
      if (plate !== null || Object.keys(extra).length > 0) {
        putVehicle(
          { db: mcp.db.db, now: Date.now() },
          asset.id,
          putVehicleRequestSchema.parse({ plate, ...extra }),
        );
      }
      return asset.id as string;
    };
    return { ...session, vehicle };
  }

  it("offers get_vehicle to a reader and record_odometer to a writer only", async () => {
    const reader = await connect(["read"]);
    const names = (await reader.client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("get_vehicle");
    expect(names).not.toContain("record_odometer");
    const writer = await connect();
    expect((await writer.client.listTools()).tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["get_vehicle", "record_odometer"]),
    );
  });

  it("records a reading for a vehicle given by name and shows it", async () => {
    const { ok, vehicle, today } = await connect();
    const id = await vehicle("Familienauto", "ZH 000000", {
      odometerUnit: "km",
    });
    const recorded = await ok("record_odometer", {
      vehicle: "Familienauto",
      value: 82_300,
    });
    expect(recorded).toMatchObject({
      vehicle: "Familienauto",
      vehicleId: id,
      date: today,
      value: 82_300,
      unit: "km",
      current: { value: 82_300, date: today, unit: "km" },
    });
    const got = await ok("get_vehicle", { vehicle: "familienauto" });
    expect(got).toMatchObject({
      id,
      name: "Familienauto",
      plate: "ZH 000000",
      odometer: { value: 82_300, date: today, unit: "km" },
    });
  });

  it.each([
    ["the plate", "ZH 000000"],
    ["the plate in lower case without a space", "zh000000"],
    ["the plate with a dash", "zh-000000"],
    ["part of the plate", "0000"],
    ["part of the name", "familie"],
  ])("finds the vehicle by %s", async (_name, ref) => {
    const { ok, vehicle } = await connect();
    const id = await vehicle("Familienauto", "ZH 000000");
    await vehicle("Roller", "BE 111111");
    expect((await ok("get_vehicle", { vehicle: ref })).id).toBe(id);
  });

  it.each(["   ", "\t", " \n "])(
    "refuses a blank vehicle %j instead of taking the only one",
    async (blank) => {
      const { call, vehicle } = await connect();
      await vehicle("Familienauto", "ZH 000000");
      for (const tool of ["get_vehicle", "record_odometer"]) {
        const reply = await call(tool, { vehicle: blank, value: 1 });
        expect(reply.isError, tool).toBe(true);
        expect(reply.text).toContain("[invalid_request]");
        expect(reply.text).toContain("id, name or plate");
      }
      const readings = await call("get_vehicle", { vehicle: "familienauto" });
      expect(readings.json.odometer).toBeUndefined();
    },
  );

  it("says not_found for a reference longer than the search takes", async () => {
    const { call, vehicle } = await connect();
    await vehicle("Familienauto", "ZH 000000");
    const reply = await call("get_vehicle", { vehicle: "x".repeat(110) });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("[not_found]");
    expect(reply.text).toContain("No vehicle matches");
  });

  it("finds it by id", async () => {
    const { ok, vehicle } = await connect();
    const id = await vehicle("Familienauto", null);
    expect((await ok("get_vehicle", { vehicle: id })).name).toBe(
      "Familienauto",
    );
  });

  it("says which vehicles it knows when none matches", async () => {
    const { call, vehicle } = await connect();
    await vehicle("Familienauto", "ZH 000000");
    const reply = await call("get_vehicle", { vehicle: "Traktor" });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("Error [not_found]");
    expect(reply.text).toContain("Familienauto, ZH 000000");
  });

  it("asks for the id when a name fits several vehicles", async () => {
    const { call, vehicle } = await connect();
    await vehicle("Auto Anna", "ZH 111111");
    await vehicle("Auto Ben", "ZH 222222");
    const reply = await call("record_odometer", { vehicle: "auto", value: 1 });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("ambiguous");
    expect(reply.text).toContain("Auto Anna");
    expect(reply.text).toContain("Auto Ben");
  });

  it("does not take a device for a vehicle", async () => {
    const { call, ok } = await connect();
    await ok("create_asset", { name: "Backofen" });
    const reply = await call("record_odometer", {
      vehicle: "Backofen",
      value: 1,
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("not a vehicle");
  });

  it("refuses a value lower than the reading before, and takes it with force", async () => {
    const { call, ok, vehicle } = await connect();
    await vehicle("Familienauto", null);
    await ok("record_odometer", {
      vehicle: "Familienauto",
      value: 120_000,
      date: "2020-01-01",
    });
    const refused = await call("record_odometer", {
      vehicle: "Familienauto",
      value: 500,
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("body.value");
    expect(refused.text).toContain("120000");
    const forced = await ok("record_odometer", {
      vehicle: "Familienauto",
      value: 500,
      force: true,
    });
    expect(forced.current.value).toBe(500);
  });

  it("refuses a date in the future", async () => {
    const { call, vehicle, day } = await connect();
    await vehicle("Familienauto", null);
    const reply = await call("record_odometer", {
      vehicle: "Familienauto",
      value: 1,
      date: day(3),
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("body.date");
  });

  it("tells which tasks of the vehicle need attention after a reading", async () => {
    const { ok, vehicle } = await connect();
    const id = await vehicle("Familienauto", "ZH 000000");
    await ok("create_task", {
      title: "Service",
      asset: "Familienauto",
      trigger: {
        type: "counter_delta",
        entityId: `odometer:${id}`,
        threshold: 15_000,
        unit: "km",
        orEvery: { every: 12, unit: "month" },
      },
    });
    const first = await ok("record_odometer", {
      vehicle: "ZH 000000",
      value: 80_000,
    });
    expect(first.tasksNeedingAttention).toEqual([]);
    const second = await ok("record_odometer", {
      vehicle: "ZH 000000",
      value: 95_200,
    });
    expect(second.tasksNeedingAttention).toMatchObject([
      { title: "Service", status: "due", asset: "Familienauto" },
    ]);
    const got = await ok("get_vehicle", { vehicle: "ZH 000000" });
    expect(got.tasks).toMatchObject([
      {
        title: "Service",
        status: "due",
        schedule:
          "every 15000 km on the odometer, or every 12 months, whichever comes first",
        progress: { current: 15_200, target: 15_000 },
      },
    ]);
  });

  it("get_vehicle lists the open tasks of the vehicle only", async () => {
    const { ok, vehicle, day } = await connect();
    await vehicle("Familienauto", null);
    await vehicle("Roller", null);
    await ok("create_task", {
      title: "MFK",
      asset: "Familienauto",
      trigger: { type: "one_off", date: day(20) },
    });
    await ok("create_task", {
      title: "Reifen",
      asset: "Roller",
      trigger: { type: "one_off", date: day(20) },
    });
    const got = await ok("get_vehicle", { vehicle: "Familienauto" });
    expect(got.tasks.map((t: { title: string }) => t.title)).toEqual(["MFK"]);
  });

  it("a vehicle without details or readings still answers", async () => {
    const { ok, vehicle } = await connect();
    await vehicle("Familienauto", null);
    const reply = await ok("get_vehicle", { vehicle: "Familienauto" });
    expect(reply).toMatchObject({ name: "Familienauto", odometerUnit: "km" });
    expect(reply.odometer).toBeUndefined();
    expect(reply.plate).toBeUndefined();
  });
});
