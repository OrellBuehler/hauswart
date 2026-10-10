import { describe, expect, it } from "vitest";
import { createApiClient } from "../../src/lib/api/client";
import { endpoints } from "../../src/lib/api/registry";
import { putVehicleRequestSchema } from "../../src/lib/api/schemas/vehicles";
import { addDays } from "../../src/lib/dates";
import { createInProcessFetch } from "../../src/lib/testing/api";
import { putVehicle } from "../../src/lib/server/vehicles/vehicles";
import { useMcp } from "./test-harness";

/** Vehicles next to the tools of insurance policies and asset notes. */
describe("vehicles with notes and insurance", () => {
  const mcp = useMcp();

  async function world() {
    const connected = await mcp.connect();
    const car = (await connected.ok("create_asset", {
      name: "Familienauto",
      kind: "vehicle",
    })) as { id: string };
    putVehicle(
      { db: mcp.db.db, now: Date.now() },
      car.id,
      putVehicleRequestSchema.parse({ plate: "ZH 000000" }),
    );
    await connected.ok("create_asset", { name: "Backofen" });
    return { ...connected, carId: car.id };
  }

  it.each([
    ["the plate", "ZH 000000"],
    ["the plate without a space", "zh000000"],
    ["the plate with a dash", "ZH-000000"],
  ])("notes an issue on a vehicle given by %s", async (_name, ref) => {
    const { ok, carId } = await world();
    const added = await ok("add_asset_note", {
      asset: ref,
      text: "Bremsen quietschen",
    });
    expect(added).toMatchObject({ asset: "Familienauto", status: "open" });
    const notes = await ok("list_asset_notes", { asset: ref });
    expect(notes.notes).toHaveLength(1);
    expect(notes.notes[0].text).toBe("Bremsen quietschen");
    expect((await ok("get_asset", { asset: ref })).id).toBe(carId);
  });

  it("other assets are still found by name, and a plate that fits nothing is not found", async () => {
    const { ok, call } = await world();
    expect((await ok("get_asset", { asset: "Backofen" })).name).toBe(
      "Backofen",
    );
    const reply = await call("get_asset", { asset: "BE 999999" });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("not_found");
  });

  it("the task list and the vehicle show the open notes of the vehicle", async () => {
    const { ok, carId, day } = await world();
    await ok("create_task", {
      title: "MFK",
      asset: "ZH 000000",
      trigger: { type: "one_off", date: day(20) },
    });
    await ok("add_asset_note", { asset: "ZH 000000", text: "Licht flackert" });
    const vehicle = await ok("get_vehicle", { vehicle: "ZH 000000" });
    expect(vehicle.id).toBe(carId);
    expect(vehicle.tasks[0]).toMatchObject({ title: "MFK", openNotes: 1 });
  });

  it("a motor policy covers a vehicle and is found by the vehicle's plate", async () => {
    const { ok, token, carId, today } = await world();
    const api = createApiClient(
      createInProcessFetch({ bearer: token }),
      "http://localhost",
      { token },
    );
    await api.call(endpoints.insurancePoliciesCreate, {
      body: {
        title: "Motorfahrzeughaftpflicht",
        type: "motor_liability",
        premiumMinor: 60_000,
        startDate: addDays(today, -30),
        assetIds: [carId],
      } as never,
    });
    await api.call(endpoints.insurancePoliciesCreate, {
      body: {
        title: "Hausrat",
        type: "household",
        premiumMinor: 30_000,
        startDate: addDays(today, -30),
      } as never,
    });
    const list = await ok("list_insurance_policies", { asset: "zh-000000" });
    expect(list.policies).toMatchObject([
      { title: "Motorfahrzeughaftpflicht", assets: ["Familienauto"] },
    ]);
  });
});
