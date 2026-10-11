import { z } from "zod";
import { isApiError } from "../../../src/lib/api/errors";
import { endpoints } from "../../../src/lib/api/registry";
import type { Asset } from "../../../src/lib/api/schemas/assets";
import type { Task } from "../../../src/lib/api/schemas/tasks";
import type { OdometerSummary } from "../../../src/lib/api/schemas/vehicles";
import { plateKey } from "../../../src/lib/vehicles/plate";
import type { ToolContext } from "../context";
import { ToolError } from "../errors";
import { plural, taskRow } from "../format";
import { searchText } from "../search-text";
import { defineTool } from "../tool";

const date = z.iso.date();
export const vehicleRef = z
  .string()
  .min(1)
  .max(120)
  .describe("Vehicle: its id, its name or its plate (spaces do not matter)");

export const vehicleLabel = (v: Asset) =>
  v.vehicle?.plate ? `${v.name}, ${v.vehicle.plate}` : v.name;

async function allVehicles(ctx: ToolContext): Promise<Asset[]> {
  const vehicles: Asset[] = [];
  let cursor: string | undefined;
  do {
    const page = await ctx.api.call(endpoints.assetsList, {
      query: { kind: "vehicle", cursor, limit: 200 },
    });
    vehicles.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return vehicles;
}

/** A vehicle by id, exact name or plate; a part of a name or plate works when it is unambiguous. */
export async function resolveVehicle(
  ctx: ToolContext,
  ref: string,
): Promise<Asset> {
  const search = searchText("give the vehicle's id, name or plate", ref);
  if (search.text.length <= 64) {
    try {
      const asset = await ctx.api.call(endpoints.assetsGet, {
        params: { id: search.text },
      });
      if (asset.kind === "vehicle") return asset;
      throw new ToolError(
        "invalid_request",
        `"${asset.name}" is a ${asset.kind}, not a vehicle.`,
      );
    } catch (err) {
      if (!isApiError(err) || err.code !== "not_found") throw err;
    }
  }
  const vehicles = await allVehicles(ctx);
  const wanted = search.text.toLowerCase();
  const plate = plateKey(search.text);
  const platesOf = (v: Asset) =>
    v.vehicle?.plate ? plateKey(v.vehicle.plate) : "";
  const exact = vehicles.filter(
    (v) =>
      v.name.trim().toLowerCase() === wanted ||
      (plate !== "" && platesOf(v) === plate),
  );
  const hits =
    exact.length > 0
      ? exact
      : vehicles.filter(
          (v) =>
            v.name.toLowerCase().includes(wanted) ||
            (plate !== "" && platesOf(v).includes(plate)),
        );
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw new ToolError(
      "invalid_request",
      `Vehicle "${ref}" is ambiguous; use the id. Candidates: ${hits.map((v) => `${vehicleLabel(v)} (${v.id})`).join(", ")}`,
    );
  }
  const other = (
    await ctx.api.call(endpoints.assetsList, {
      query: { q: search.q, limit: 10 },
    })
  ).items.find((a) => a.name.trim().toLowerCase() === wanted);
  if (other) {
    throw new ToolError(
      "invalid_request",
      `"${other.name}" is a ${other.kind}, not a vehicle.`,
    );
  }
  throw new ToolError(
    "not_found",
    `No vehicle matches "${ref}". Known vehicles: ${vehicles.map(vehicleLabel).join("; ") || "none"}.`,
  );
}

const odometerText = (o: OdometerSummary | null | undefined) =>
  o ? `${o.value} ${o.unit} on ${o.date}` : "no odometer reading yet";

const needsAttention = (t: Task) =>
  t.state?.status === "overdue" ||
  t.state?.status === "due" ||
  t.state?.status === "open";

export const getVehicle = defineTool({
  name: "get_vehicle",
  title: "Get a vehicle",
  description:
    "A vehicle (an asset of kind vehicle) with its details - plate, VIN, registration number, first registration, fuel, tire sizes, where it is kept - the latest odometer reading and its date, and its open tasks with their due state (service, tire change, inspection, ...). The vehicle is given by id, name or plate.",
  mode: "read",
  input: { vehicle: vehicleRef },
  async handler({ vehicle: ref }, ctx) {
    const asset = await resolveVehicle(ctx, ref);
    const [details, tasks, users] = await Promise.all([
      ctx.api.call(endpoints.vehiclesGet, { params: { id: asset.id } }),
      ctx.api.call(endpoints.tasksList, {
        query: { assetId: asset.id, limit: 100 },
      }),
      ctx.users(),
    ]);
    const attention = tasks.items.filter(needsAttention).length;
    return {
      summary: `${vehicleLabel(asset)}: ${odometerText(details.odometer)}; ${plural(tasks.items.length, "open task")}${attention > 0 ? `, ${attention} need attention` : ""}.`,
      data: {
        id: asset.id,
        name: asset.name,
        manufacturer: asset.manufacturer,
        model: asset.model,
        plate: details.plate,
        vin: details.vin,
        registrationNumber: details.registrationNumber,
        firstRegistration: details.firstRegistration,
        fuel: details.fuelType,
        tireSizeSummer: details.tireSizeSummer,
        tireSizeWinter: details.tireSizeWinter,
        location: details.location,
        notes: details.notes,
        odometerUnit: details.odometerUnit,
        odometer: details.odometer,
        archived: asset.archivedAt ? true : null,
        tasks: tasks.items.map((t) => taskRow(t, users)),
        tasksTruncated: tasks.nextCursor ? true : null,
      },
    };
  },
});

export const recordOdometer = defineTool({
  name: "record_odometer",
  title: "Record an odometer reading",
  description:
    "Records the odometer of a vehicle (id, name or plate) in its own unit (km or mi): value is what the display shows, date defaults to today and cannot be in the future. A value lower than the reading before it is refused as a typo; pass force: true only when the instrument cluster was replaced. Tasks that count on the odometer (a service every 15000 km) move at once; the result lists the vehicle's tasks that need attention.",
  mode: "create",
  input: {
    vehicle: vehicleRef,
    value: z.number().finite().min(0).max(10_000_000),
    date: date.optional(),
    note: z.string().trim().max(500).optional(),
    force: z.boolean().optional(),
  },
  async handler({ vehicle: ref, ...rest }, ctx) {
    const asset = await resolveVehicle(ctx, ref);
    const reading = await ctx.api.call(endpoints.odometerCreate, {
      params: { id: asset.id },
      body: rest,
    });
    const [details, tasks, users] = await Promise.all([
      ctx.api.call(endpoints.vehiclesGet, { params: { id: asset.id } }),
      ctx.api.call(endpoints.tasksList, {
        query: { assetId: asset.id, limit: 100 },
      }),
      ctx.users(),
    ]);
    const unit = details.odometerUnit;
    return {
      summary: `Recorded ${reading.value} ${unit} for ${vehicleLabel(asset)} on ${reading.date}.`,
      data: {
        id: reading.id,
        vehicle: asset.name,
        vehicleId: asset.id,
        date: reading.date,
        value: reading.value,
        unit,
        note: reading.note,
        current: details.odometer,
        tasksNeedingAttention: tasks.items
          .filter(needsAttention)
          .map((t) => taskRow(t, users)),
      },
    };
  },
});

export const vehicleTools = [getVehicle, recordOdometer];
