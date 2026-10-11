import { z } from "zod";
import { TIRE_SEASONS, type TireSeason } from "../../../src/lib/api/enums";
import { endpoints } from "../../../src/lib/api/registry";
import type { Asset } from "../../../src/lib/api/schemas/assets";
import {
  treadDepthSchema,
  type TireSet,
} from "../../../src/lib/api/schemas/tire-sets";
import { odometerValueSchema } from "../../../src/lib/api/schemas/vehicles";
import {
  TREAD_WARNING_MM,
  treadWarning,
} from "../../../src/lib/vehicles/tires";
import type { ToolContext } from "../context";
import { ToolError } from "../errors";
import { plural } from "../format";
import { defineTool } from "../tool";
import { resolveVehicle, vehicleLabel, vehicleRef } from "./vehicles";

const date = z.iso.date();

const SEASON_WORDS: Record<TireSeason, string> = {
  summer: "summer",
  winter: "winter",
  all_season: "all-season",
};

/** `winter tires (Musterreifen Frost 205/55 R16)`. */
export function tireLabel(set: TireSet): string {
  const detail = [set.brand, set.model, set.size].filter(Boolean).join(" ");
  return `${SEASON_WORDS[set.season]} tires${detail ? ` (${detail})` : ""}`;
}

const describeSet = (set: TireSet) =>
  `${tireLabel(set)}${set.dot ? `, DOT ${set.dot}` : ""} (${set.id})`;

export const tireRow = (s: TireSet) => ({
  id: s.id,
  season: s.season,
  brand: s.brand,
  model: s.model,
  size: s.size,
  dot: s.dot,
  ageYears: s.ageYears,
  treadMm: s.treadDepthMm,
  treadMeasuredOn: s.treadMeasuredOn,
  treadWarning: s.treadWarning ? true : null,
  mounted: s.mounted ? true : null,
  mountedOn: s.mountedOn,
  distance: s.distance,
  distanceUnit: s.distance === null ? null : s.odometerUnit,
  storage: s.storageLocation,
  storageContact: s.storageContactName,
  purchasedOn: s.purchasedOn,
  retired: s.retiredAt ? true : null,
  notes: s.notes,
});

/** Words that say what the thing is, not which one. */
const NOISE = new Set(["tire", "tires", "tyre", "tyres", "set"]);

const haystack = (s: TireSet) =>
  [SEASON_WORDS[s.season], s.season, s.brand, s.model, s.size, s.dot]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

/**
 * The sets a reference names: an id, else the active sets whose season, brand, model, size or DOT
 * contain every word of it ("winter", "winter michelin", "205/55 r16").
 */
export function findTireSets(sets: readonly TireSet[], ref: string): TireSet[] {
  const byId = sets.filter((s) => s.id === ref.trim());
  if (byId.length > 0) return byId;
  const words = ref
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== "" && !NOISE.has(w));
  if (words.length === 0) return [];
  return sets.filter(
    (s) => !s.retiredAt && words.every((w) => haystack(s).includes(w)),
  );
}

async function tireSetsOf(
  ctx: ToolContext,
  vehicleId: string,
): Promise<TireSet[]> {
  const sets: TireSet[] = [];
  let cursor: string | undefined;
  do {
    const page = await ctx.api.call(endpoints.tireSetsList, {
      params: { id: vehicleId },
      query: { includeRetired: "true", cursor, limit: 200 },
    });
    sets.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return sets;
}

function pickTireSet(
  sets: readonly TireSet[],
  vehicle: Asset,
  ref: string,
): TireSet {
  const hits = findTireSets(sets, ref);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw new ToolError(
      "invalid_request",
      `Tire set "${ref}" is ambiguous; use the id. Candidates: ${hits.map(describeSet).join("; ")}`,
    );
  }
  const active = sets.filter((s) => !s.retiredAt);
  throw new ToolError(
    "not_found",
    `${vehicleLabel(vehicle)} has no tire set matching "${ref}". Tire sets: ${active.map(describeSet).join("; ") || "none"}.`,
  );
}

const tireSetRef = z
  .string()
  .min(1)
  .max(120)
  .describe(
    "Tire set: its id, or words from its season, brand, model or size, e.g. 'winter'",
  );

export const listTireSets = defineTool({
  name: "list_tire_sets",
  title: "List the tire sets of a vehicle",
  description:
    "The tire sets of a vehicle (id, name or plate): season, brand, model, size, DOT code and age in years, the latest tread depth in mm with a warning below the limit of the season (3 mm summer, 4 mm winter and all-season), where it is stored, the distance driven on it and which one is mounted now. Retired sets only with includeRetired: true. Add one with add_tire_set, swap with mount_tire_set, measure with record_tire_tread.",
  mode: "read",
  input: { vehicle: vehicleRef, includeRetired: z.boolean().default(false) },
  async handler({ vehicle: ref, includeRetired }, ctx) {
    const asset = await resolveVehicle(ctx, ref);
    const all = await tireSetsOf(ctx, asset.id);
    const sets = includeRetired ? all : all.filter((s) => !s.retiredAt);
    const mounted = sets.find((s) => s.mounted);
    return {
      summary: `${plural(sets.length, "tire set")} on ${vehicleLabel(asset)}; ${mounted ? `${tireLabel(mounted)} mounted` : "none mounted"}.`,
      data: {
        vehicle: asset.name,
        vehicleId: asset.id,
        tireSets: sets.map(tireRow),
      },
    };
  },
});

export const addTireSet = defineTool({
  name: "add_tire_set",
  title: "Add a tire set to a vehicle",
  description:
    "Adds a set of tires to a vehicle (id, name or plate): season (summer, winter, all_season) and, as far as known, brand, model, size ('205/55 R16 91V'), the DOT code (week and year as four digits: '2423' is week 24 of 2023), the tread depth in mm measured on measuredOn (default today), where the set is stored and when it was bought. The set is not mounted; mount it with mount_tire_set.",
  mode: "create",
  input: {
    vehicle: vehicleRef,
    season: z.enum(TIRE_SEASONS),
    brand: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(80).optional(),
    size: z.string().trim().min(1).max(40).optional(),
    dot: z.string().trim().min(1).max(10).optional(),
    treadDepthMm: treadDepthSchema.optional(),
    measuredOn: date.optional(),
    storageLocation: z.string().trim().min(1).max(200).optional(),
    purchasedOn: date.optional(),
    notes: z.string().trim().min(1).max(5000).optional(),
  },
  async handler({ vehicle: ref, measuredOn, ...rest }, ctx) {
    const asset = await resolveVehicle(ctx, ref);
    const set = await ctx.api.call(endpoints.tireSetsCreate, {
      params: { id: asset.id },
      body: { ...rest, treadMeasuredOn: measuredOn },
    });
    return {
      summary: `Added ${tireLabel(set)} to ${vehicleLabel(asset)}; it is not mounted yet.`,
      data: { vehicle: asset.name, vehicleId: asset.id, ...tireRow(set) },
    };
  },
});

export const mountTireSet = defineTool({
  name: "mount_tire_set",
  title: "Mount a tire set",
  description:
    "Mounts a tire set on a vehicle (id, name or plate) and takes the set that was mounted off, on date (default today). Give the set by id or by words from it ('winter'); an ambiguous reference is reported with the candidates. odometer, in the vehicle's unit, is optional but worth giving: it is recorded as a reading and lets hauswart count the distance driven on each set (a value lower than the reading before is refused as a typo). Mounting the set that is already mounted changes nothing. A retired set cannot be mounted. Completing a tire-change task does not mount anything: do both.",
  mode: "update",
  input: {
    vehicle: vehicleRef,
    tireSet: tireSetRef,
    date: date.optional(),
    odometer: odometerValueSchema.optional(),
  },
  async handler({ vehicle: ref, tireSet: setRef, date: on, odometer }, ctx) {
    const asset = await resolveVehicle(ctx, ref);
    const sets = await tireSetsOf(ctx, asset.id);
    const set = pickTireSet(sets, asset, setRef);
    if (set.mounted) {
      return {
        summary: `${vehicleLabel(asset)} already runs on ${tireLabel(set)}${set.mountedOn ? ` (since ${set.mountedOn})` : ""}; nothing changed.`,
        data: { vehicle: asset.name, vehicleId: asset.id, ...tireRow(set) },
      };
    }
    const previous = sets.find((s) => s.mounted);
    const mounted = await ctx.api.call(endpoints.tireSetsMount, {
      params: { id: asset.id, setId: set.id },
      body: { date: on, odometer },
    });
    const when = [
      mounted.mountedOn,
      odometer === undefined ? null : `${odometer} ${mounted.odometerUnit}`,
    ].filter(Boolean);
    return {
      summary: `Mounted ${tireLabel(mounted)} on ${vehicleLabel(asset)}${when.length > 0 ? ` (${when.join(", ")})` : ""}${previous ? `; took off ${tireLabel(previous)}` : ""}.`,
      data: {
        vehicle: asset.name,
        vehicleId: asset.id,
        ...tireRow(mounted),
        tookOff: previous ? tireLabel(previous) : null,
      },
    };
  },
});

export const recordTireTread = defineTool({
  name: "record_tire_tread",
  title: "Record a tread depth",
  description:
    "Records a tread depth measurement in mm for a tire set of a vehicle (id, name or plate) on date (default today): the newest measurement is the set's current depth. Without tireSet the mounted set is measured. The answer says when the depth is below the limit of the season (3 mm summer, 4 mm winter and all-season). odometer, in the vehicle's unit, is optional and recorded as a reading.",
  mode: "create",
  input: {
    vehicle: vehicleRef,
    tireSet: tireSetRef.optional(),
    treadDepthMm: treadDepthSchema.describe("Tread depth in millimetres"),
    date: date.optional(),
    odometer: odometerValueSchema.optional(),
  },
  async handler(
    { vehicle: ref, tireSet: setRef, treadDepthMm, date: on, odometer },
    ctx,
  ) {
    const asset = await resolveVehicle(ctx, ref);
    const sets = await tireSetsOf(ctx, asset.id);
    let set: TireSet;
    if (setRef !== undefined) set = pickTireSet(sets, asset, setRef);
    else {
      const mounted = sets.find((s) => s.mounted);
      if (!mounted) {
        throw new ToolError(
          "invalid_request",
          `No tire set is mounted on ${vehicleLabel(asset)}; say which one to measure with tireSet. Tire sets: ${
            sets
              .filter((s) => !s.retiredAt)
              .map(describeSet)
              .join("; ") || "none"
          }.`,
        );
      }
      set = mounted;
    }
    const measured = await ctx.api.call(endpoints.tireSetsTread, {
      params: { id: set.id },
      body: { treadDepthMm, date: on, odometer },
    });
    const limit = TREAD_WARNING_MM[measured.season];
    return {
      summary: `Measured ${treadDepthMm} mm on ${tireLabel(measured)} of ${vehicleLabel(asset)}.${treadWarning(measured.season, treadDepthMm) ? ` That is below ${limit} mm: time to plan new tires.` : ""}`,
      data: { vehicle: asset.name, vehicleId: asset.id, ...tireRow(measured) },
    };
  },
});

export const tireTools = [
  listTireSets,
  addTireSet,
  mountTireSet,
  recordTireTread,
];
