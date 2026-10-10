import type { ApiClient } from "$lib/api/client";
import { ApiError } from "$lib/api/errors";
import { endpoints } from "$lib/api/registry";
import type { Seed, SeedTask } from "$lib/api/schemas/seed";
import type { PutVehicleRequest } from "$lib/api/schemas/vehicles";

export const SEED_SOURCE = "seed";

export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedError";
  }
}

export interface Counts {
  created: number;
  updated: number;
  unchanged: number;
}

export interface SeedReport {
  /** `skipped`: the token lacks the admin scope the household settings need. */
  household: "updated" | "unchanged" | "skipped" | "absent";
  rooms: Counts;
  assets: Counts;
  /** The details of vehicles (`vehicle` in the file). */
  vehicles: Counts;
  tasks: Counts;
  preparations: Counts;
}

export interface ImportOptions {
  /** Also overwrite entries that already exist (default: leave them as they are). */
  update?: boolean;
  /** One line per created or updated entry, by key only. */
  log?: (line: string) => void;
}

const counts = (): Counts => ({ created: 0, updated: 0, unchanged: 0 });

async function listAll<T>(
  page: (cursor: string | undefined) => Promise<{
    items: T[];
    nextCursor: string | null;
  }>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const result = await page(cursor);
    all.push(...result.items);
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  return all;
}

/** Fields of `desired` that differ from `existing`; undefined means "not specified". */
function changes<T extends Record<string, unknown>>(
  existing: Record<string, unknown>,
  desired: T,
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(desired)) {
    if (value === undefined) continue;
    if (JSON.stringify(existing[key] ?? null) !== JSON.stringify(value)) {
      out[key] = value;
    }
  }
  return out as Partial<T>;
}

/**
 * Creates what the seed describes through the REST API and finds it again by
 * key, so running it twice changes nothing. Rooms and assets are matched by
 * slug (= key), tasks by `externalSource: "seed"` and `externalRef: key`,
 * preparations by title within their task. Existing entries are left alone
 * unless `update` is set; nothing is ever deleted.
 */
export async function importSeed(
  api: ApiClient,
  seed: Seed,
  options: ImportOptions = {},
): Promise<SeedReport> {
  const log = options.log ?? (() => {});
  const report: SeedReport = {
    household: "absent",
    rooms: counts(),
    assets: counts(),
    vehicles: counts(),
    tasks: counts(),
    preparations: counts(),
  };

  if (seed.household) {
    const current = await api.call(endpoints.householdGet);
    const patch = changes(current, {
      name: seed.household.name,
      handoverDate: seed.household.handoverDate,
    });
    if (Object.keys(patch).length > 0) {
      try {
        await api.call(endpoints.householdUpdate, { body: patch });
        report.household = "updated";
        log("household updated");
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== "forbidden") throw err;
        report.household = "skipped";
        log(
          "household skipped: changing it needs a token with the admin scope",
        );
      }
    } else {
      report.household = "unchanged";
    }
  }

  const rooms = new Map(
    (
      await listAll((cursor) =>
        api.call(endpoints.roomsList, { query: { cursor, limit: 200 } }),
      )
    ).map((r) => [r.slug, r]),
  );
  for (const room of seed.rooms) {
    const desired = {
      name: room.name,
      haAreaId: room.haAreaId,
      icon: room.icon,
      sortOrder: room.sortOrder,
      notes: room.notes,
    };
    const existing = rooms.get(room.key);
    if (!existing) {
      const created = await api.call(endpoints.roomsCreate, {
        body: { ...desired, slug: room.key },
      });
      rooms.set(room.key, created);
      report.rooms.created += 1;
      log(`room ${room.key} created`);
    } else if (options.update) {
      const patch = changes(existing, desired);
      if (Object.keys(patch).length === 0) report.rooms.unchanged += 1;
      else {
        rooms.set(
          room.key,
          await api.call(endpoints.roomsUpdate, {
            params: { id: existing.id },
            body: patch,
          }),
        );
        report.rooms.updated += 1;
        log(`room ${room.key} updated`);
      }
    } else {
      report.rooms.unchanged += 1;
    }
  }

  const assets = new Map(
    (
      await listAll((cursor) =>
        api.call(endpoints.assetsList, {
          query: { cursor, limit: 200, includeArchived: "true" },
        }),
      )
    ).map((a) => [a.slug, a]),
  );
  for (const asset of seed.assets) {
    const { key, room, vehicle, ...fields } = asset;
    const roomId = room ? (rooms.get(room)?.id ?? null) : undefined;
    const existing = assets.get(key);
    if (!existing) {
      const created = await api.call(endpoints.assetsCreate, {
        body: { ...fields, slug: key, roomId },
      });
      assets.set(key, created);
      report.assets.created += 1;
      log(`asset ${key} created`);
    } else if (options.update) {
      const patch = changes(existing, { ...fields, roomId });
      if (Object.keys(patch).length === 0) report.assets.unchanged += 1;
      else {
        assets.set(
          key,
          await api.call(endpoints.assetsUpdate, {
            params: { id: existing.id },
            body: patch,
          }),
        );
        report.assets.updated += 1;
        log(`asset ${key} updated`);
      }
    } else {
      report.assets.unchanged += 1;
    }
    const current = assets.get(key);
    if (vehicle && current?.kind === "vehicle") {
      await syncVehicle(api, current.id, key, vehicle, report, options);
    }
  }

  const needsPeople = seed.tasks.some((t) => t.assign.mode !== "none");
  const directory = needsPeople
    ? (await api.call(endpoints.usersDirectory)).items
    : [];
  const person = (name: string): string => {
    const hit = directory.find(
      (u) => u.displayName.toLowerCase() === name.toLowerCase(),
    );
    if (!hit) throw new SeedError(`No user named "${name}" in this household`);
    return hit.id;
  };

  const tasks = new Map(
    (
      await listAll((cursor) =>
        api.call(endpoints.tasksList, {
          query: {
            cursor,
            limit: 200,
            includeArchived: "true",
            externalSource: SEED_SOURCE,
          },
        }),
      )
    ).flatMap((t) => (t.externalRef ? [[t.externalRef, t] as const] : [])),
  );

  for (const task of seed.tasks) {
    const body = taskBody(task, {
      assetId: task.asset ? (assets.get(task.asset)?.id ?? null) : null,
      roomId: task.room ? (rooms.get(task.room)?.id ?? null) : null,
      person,
      everyone: directory.map((u) => u.id),
    });
    let existing = tasks.get(task.key);
    if (!existing) {
      existing = await api.call(endpoints.tasksCreate, {
        body: {
          ...body,
          source: SEED_SOURCE,
          externalSource: SEED_SOURCE,
          externalRef: task.key,
        },
      });
      report.tasks.created += 1;
      log(`task ${task.key} created`);
    } else if (options.update) {
      await api.call(endpoints.tasksUpdate, {
        params: { id: existing.id },
        body,
      });
      report.tasks.updated += 1;
      log(`task ${task.key} updated`);
    } else {
      report.tasks.unchanged += 1;
    }
    await syncPreparations(api, existing.id, task, report, options);
  }
  return report;
}

/**
 * The details of a vehicle: saved when there are none yet (so a run that stopped half way is
 * completed by the next one), overwritten only with `update`. `PUT` replaces the details, so what
 * the file leaves out is cleared then.
 */
async function syncVehicle(
  api: ApiClient,
  assetId: string,
  key: string,
  vehicle: PutVehicleRequest,
  report: SeedReport,
  options: ImportOptions,
): Promise<void> {
  const current = await api.call(endpoints.vehiclesGet, {
    params: { id: assetId },
  });
  const desired = {
    plate: vehicle.plate ?? null,
    vin: vehicle.vin ?? null,
    registrationNumber: vehicle.registrationNumber ?? null,
    firstRegistration: vehicle.firstRegistration ?? null,
    fuelType: vehicle.fuelType ?? null,
    tireSizeSummer: vehicle.tireSizeSummer ?? null,
    tireSizeWinter: vehicle.tireSizeWinter ?? null,
    location: vehicle.location ?? null,
    odometerUnit: vehicle.odometerUnit ?? ("km" as const),
    notes: vehicle.notes ?? null,
  };
  const never = current.updatedAt === null;
  if (!never && !options.update) {
    report.vehicles.unchanged += 1;
    return;
  }
  if (!never && Object.keys(changes(current, desired)).length === 0) {
    report.vehicles.unchanged += 1;
    return;
  }
  await api.call(endpoints.vehiclesPut, {
    params: { id: assetId },
    body: desired,
  });
  if (never) report.vehicles.created += 1;
  else report.vehicles.updated += 1;
  log(options, `vehicle ${key} ${never ? "saved" : "updated"}`);
}

function taskBody(
  task: SeedTask,
  resolved: {
    assetId: string | null;
    roomId: string | null;
    person: (name: string) => string;
    everyone: string[];
  },
) {
  const assignment =
    task.assign.mode === "fixed"
      ? {
          assignMode: "fixed" as const,
          assigneeUserId: resolved.person(task.assign.user),
        }
      : task.assign.mode === "rotate"
        ? {
            assignMode: "rotate" as const,
            rotationStrategy: task.assign.strategy,
            rotationOrder:
              task.assign.users === "all"
                ? resolved.everyone
                : task.assign.users.map(resolved.person),
          }
        : { assignMode: "none" as const };
  return {
    title: task.title,
    descriptionMd: task.descriptionMd,
    category: task.category,
    priority: task.priority,
    effortMinutes: task.effortMinutes,
    assetId: resolved.assetId,
    roomId: resolved.roomId,
    trigger: task.trigger,
    notifyMode: task.notifyMode,
    graceDays: task.graceDays,
    dueSoonDays: task.dueSoonDays,
    ...assignment,
  };
}

async function syncPreparations(
  api: ApiClient,
  taskId: string,
  task: SeedTask,
  report: SeedReport,
  options: ImportOptions,
): Promise<void> {
  if (task.preparations.length === 0) return;
  const existing = (
    await api.call(endpoints.preparationsList, { params: { id: taskId } })
  ).items;
  for (const [index, prep] of task.preparations.entries()) {
    const found = existing.find(
      (p) => p.title.trim().toLowerCase() === prep.title.trim().toLowerCase(),
    );
    const desired = {
      title: prep.title,
      kind: prep.kind,
      leadDays: prep.leadDays,
      leadValue: prep.leadValue,
      qty: prep.qty,
      sortOrder: index,
    };
    if (!found) {
      await api.call(endpoints.preparationsCreate, {
        params: { id: taskId },
        body: desired,
      });
      report.preparations.created += 1;
      log(options, `preparation "${prep.title}" of ${task.key} created`);
    } else if (options.update) {
      const patch = changes(found, desired);
      if (Object.keys(patch).length === 0) report.preparations.unchanged += 1;
      else {
        await api.call(endpoints.preparationsUpdate, {
          params: { id: taskId, prepId: found.id },
          body: patch,
        });
        report.preparations.updated += 1;
        log(options, `preparation "${prep.title}" of ${task.key} updated`);
      }
    } else {
      report.preparations.unchanged += 1;
    }
  }
}

function log(options: ImportOptions, line: string): void {
  options.log?.(line);
}
