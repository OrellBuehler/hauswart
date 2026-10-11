import { api } from "$lib/api/browser";
import { endpoints } from "$lib/api/registry";
import type { Trigger } from "$lib/tasks/engine/types";
import {
  knownOdometerAsset,
  odometerAssetOfTrigger,
} from "$lib/vehicles/odometer";

/**
 * The vehicle whose odometer a task counts on, else null. A dashboard entry names it
 * (`odometerAssetId`) and a listed task carries its trigger, so the server is asked only for a task
 * that came with neither; when that lookup fails the task is treated as one without an odometer,
 * so a completion goes ahead plainly instead of being stopped by a lookup.
 */
export async function odometerAssetOf(task: {
  id: string;
  assetId?: string | null | undefined;
  odometerAssetId?: string | null | undefined;
  trigger?: Trigger | undefined;
}): Promise<string | null> {
  const known = knownOdometerAsset(task);
  if (known !== undefined) return known;
  if (!task.assetId) return null;
  try {
    const full = await api.call(endpoints.tasksGet, {
      params: { id: task.id },
    });
    return odometerAssetOfTrigger(full.trigger);
  } catch (err) {
    console.warn("odometer lookup failed, completing without a reading", err);
    return null;
  }
}
