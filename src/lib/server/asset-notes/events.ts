import { eq } from "drizzle-orm";
import { serviceLog } from "$lib/server/db";
import { onEvent } from "$lib/server/events";
import { reopenNotesOf } from "./resolve";

/**
 * Undoing a completion that wrote a service log entry reopens the notes that entry resolved: the
 * work they were waiting for is no longer on record as done. The entry itself stays in the log.
 */
export function onCompletionRevoked(
  payload: Parameters<Parameters<typeof onEvent<"completionRevoked">>[1]>[0],
): void {
  const { ctx, completion } = payload;
  const entries = ctx.db
    .select({ id: serviceLog.id })
    .from(serviceLog)
    .where(eq(serviceLog.completionId, completion.id))
    .all();
  reopenNotesOf(
    ctx,
    entries.map((entry) => entry.id),
  );
}

export function registerAssetNoteEvents(): void {
  onEvent("completionRevoked", onCompletionRevoked);
}
