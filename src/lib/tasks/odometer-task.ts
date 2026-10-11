import { api } from "$lib/api/browser";
import { endpoints } from "$lib/api/registry";
import type { Trigger } from "$lib/tasks/engine/types";
import { odometerAssetOfTrigger } from "$lib/vehicles/odometer";

export async function odometerAssetOf(task: {
  id: string;
  assetId?: string | null | undefined;
  trigger?: Trigger | undefined;
}): Promise<string | null> {
  if (task.trigger) return odometerAssetOfTrigger(task.trigger);
  if (!task.assetId) return null;
  const full = await api.call(endpoints.tasksGet, { params: { id: task.id } });
  return odometerAssetOfTrigger(full.trigger);
}
