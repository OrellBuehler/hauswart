import { describe, expect, it } from "vitest";
import { endpoints } from "$lib/api/registry";
import { createCaller, errorCode } from "$lib/testing/api";
import { createTestUser, loginTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

type Method = "GET" | "POST" | "PUT";

interface Case {
  /** The registry entry, so a renamed or removed endpoint breaks this table. */
  endpoint: keyof typeof endpoints;
  method: Method;
  /** `{id}` is the asset; `{setId}` a tire set id that exists for no asset. */
  path: string;
  json?: unknown;
  /** What a vehicle answers, for the same request. */
  vehicle: number;
}

/**
 * Everything under `/assets/{id}` that only a vehicle has. The rule: an asset that is no vehicle is a
 * 404 for a read and a 400 `invalid_request` for a write; an asset that does not exist is a 404 for both.
 */
const reads: Case[] = [
  {
    endpoint: "vehiclesGet",
    method: "GET",
    path: "/api/v1/assets/{id}/vehicle",
    vehicle: 200,
  },
  {
    endpoint: "vehicleStats",
    method: "GET",
    path: "/api/v1/assets/{id}/vehicle/stats",
    vehicle: 200,
  },
  {
    endpoint: "odometerList",
    method: "GET",
    path: "/api/v1/assets/{id}/odometer",
    vehicle: 200,
  },
  {
    endpoint: "fuelLogsList",
    method: "GET",
    path: "/api/v1/assets/{id}/fuel-logs",
    vehicle: 200,
  },
  {
    endpoint: "tireSetsList",
    method: "GET",
    path: "/api/v1/assets/{id}/tire-sets",
    vehicle: 200,
  },
];

const writes: Case[] = [
  {
    endpoint: "vehiclesPut",
    method: "PUT",
    path: "/api/v1/assets/{id}/vehicle",
    json: {},
    vehicle: 200,
  },
  {
    endpoint: "odometerCreate",
    method: "POST",
    path: "/api/v1/assets/{id}/odometer",
    json: { value: 1000 },
    vehicle: 201,
  },
  {
    endpoint: "fuelLogsCreate",
    method: "POST",
    path: "/api/v1/assets/{id}/fuel-logs",
    json: { odometer: 1000, quantity: 40, amountMinor: 7200 },
    vehicle: 201,
  },
  {
    endpoint: "tireSetsCreate",
    method: "POST",
    path: "/api/v1/assets/{id}/tire-sets",
    json: { season: "winter" },
    vehicle: 201,
  },
  {
    endpoint: "tireSetsMount",
    method: "POST",
    path: "/api/v1/assets/{id}/tire-sets/{setId}/mount",
    json: {},
    // A tire set that is none of this vehicle's: the vehicle gets as far as looking for it.
    vehicle: 404,
  },
];

describe("endpoints only a vehicle has", () => {
  useTestDB();

  async function world() {
    const user = await createTestUser();
    const call = createCaller({ session: loginTestUser(user).token });
    const create = async (name: string, kind: string) =>
      (await call("POST", "/api/v1/assets", { json: { name, kind } })).body as {
        id: string;
      };
    return {
      call,
      car: await create("Auto", "vehicle"),
      device: await create("Backofen", "device"),
      plant: await create("Monstera", "plant"),
    };
  }

  const url = (path: string, id: string) =>
    path.replace("{id}", id).replace("{setId}", "nope");

  it("covers every endpoint that the registry marks as a vehicle's", () => {
    const covered = new Set([...reads, ...writes].map((c) => c.endpoint));
    for (const c of [...reads, ...writes]) {
      expect(endpoints[c.endpoint].method, c.endpoint).toBe(c.method);
    }
    const vehicleOnly = Object.values(endpoints)
      .filter(
        (e) =>
          e.path.startsWith("/api/v1/assets/{id}/") &&
          /\/(vehicle|odometer|fuel-logs|tire-sets)(\/|$)/.test(e.path),
      )
      .map((e) => e.id);
    expect(vehicleOnly.sort()).toEqual([...covered].sort());
  });

  describe.each([
    { what: "read", cases: reads, status: 404, code: "not_found" },
    { what: "write", cases: writes, status: 400, code: "invalid_request" },
  ])(
    "a $what on an asset that is no vehicle is a $status $code",
    ({ cases, status, code }) => {
      it.each(cases)(
        "$method $path is refused for a device and a plant",
        async (c) => {
          const { call, device, plant } = await world();
          for (const asset of [device, plant]) {
            const r = await call(c.method, url(c.path, asset.id), {
              json: c.json,
            });
            expect([r.res.status, errorCode(r)], c.endpoint).toEqual([
              status,
              code,
            ]);
          }
        },
      );

      it.each(cases)(
        "$method $path is a 404 for a missing asset",
        async (c) => {
          const { call } = await world();
          const r = await call(c.method, url(c.path, "nope"), { json: c.json });
          expect([r.res.status, errorCode(r)], c.endpoint).toEqual([
            404,
            "not_found",
          ]);
        },
      );

      it.each(cases)("$method $path works for a vehicle", async (c) => {
        const { call, car } = await world();
        const r = await call(c.method, url(c.path, car.id), { json: c.json });
        expect(r.res.status, c.endpoint).toBe(c.vehicle);
      });
    },
  );

  it("changes nothing on the asset that was refused", async () => {
    const { call, device } = await world();
    for (const c of writes) {
      await call(c.method, url(c.path, device.id), { json: c.json });
    }
    const asset = (await call("GET", `/api/v1/assets/${device.id}`)).body as {
      vehicle?: unknown;
    };
    expect(asset.vehicle).toBeUndefined();
  });
});
