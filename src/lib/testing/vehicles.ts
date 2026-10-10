import { ApiError } from "$lib/api/errors";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createAsset } from "$lib/server/assets/assets";
import type { ServiceContext } from "$lib/server/service";

/** A vehicle asset for tests. */
export function makeVehicle(
  ctx: Pick<ServiceContext, "db">,
  name = "Testauto",
  over: Record<string, unknown> = {},
) {
  return createAsset(
    ctx,
    createAssetRequestSchema.parse({ kind: "vehicle", name, ...over }),
  );
}

/** The `ApiError` a call fails with (sync or async). */
export async function failure(fn: () => unknown): Promise<ApiError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error("expected the call to fail");
}

/** The messages a 400 carries for one field. */
export function fieldErrors(err: ApiError, field: string): string[] {
  const details = err.details as
    { body?: { fieldErrors?: Record<string, string[]> } } | undefined;
  return details?.body?.fieldErrors?.[field] ?? [];
}
