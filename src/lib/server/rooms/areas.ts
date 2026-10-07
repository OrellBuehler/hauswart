import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "$lib/api/errors";
import type { IntegrationKind } from "$lib/api/enums";
import { providerAreaSchema } from "$lib/api/schemas/integrations";
import { ROOM_NAME_MAX, type RoomImportOutcome } from "$lib/api/schemas/rooms";
import { matchAreaToRoom, roomWithAreaId } from "$lib/connections/areas";
import { ownerFor, runOperation } from "$lib/server/connections/connections";
import { rooms, type DB } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { createRoom, type RoomRecord } from "./rooms";

const areasResultSchema = z.object({ items: z.array(providerAreaSchema) });

type ProviderArea = z.output<typeof providerAreaSchema>;

/** The areas the caller's connection of this kind lists. Throws 404 without a connection or an `areas` operation, 502 when it fails. */
async function fetchAreas(
  ctx: ServiceContext,
  kind: IntegrationKind,
  userId: string,
): Promise<ProviderArea[]> {
  const result = await runOperation(
    ctx,
    kind,
    ownerFor(kind, userId),
    "areas",
    {},
  );
  const parsed = areasResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new ApiError("upstream_error", "The areas could not be read.", {
      details: { code: "invalid_response" },
    });
  }
  return parsed.data.items;
}

function allRooms(ctx: Pick<ServiceContext, "db">): RoomRecord[] {
  return ctx.db
    .select()
    .from(rooms)
    .orderBy(asc(rooms.sortOrder), asc(rooms.name), asc(rooms.id))
    .all();
}

/** Every area of the connected system, each with the room that already stores its id. */
export async function listAreas(
  ctx: ServiceContext,
  kind: IntegrationKind,
  userId: string,
) {
  const areas = await fetchAreas(ctx, kind, userId);
  const existing = allRooms(ctx);
  return areas.map((area) => ({
    ...area,
    roomId: roomWithAreaId(area.id, existing)?.id ?? null,
  }));
}

export interface ImportedArea {
  areaId: string;
  outcome: RoomImportOutcome;
  room: RoomRecord | null;
}

/**
 * Takes the chosen areas over as rooms, in the order given, in one transaction. The names come
 * from the connected system, never from the caller. Repeating it changes nothing.
 */
export async function importAreas(
  ctx: ServiceContext,
  kind: IntegrationKind,
  userId: string,
  areaIds: readonly string[],
): Promise<ImportedArea[]> {
  const areas = await fetchAreas(ctx, kind, userId);
  const byId = new Map(areas.map((a) => [a.id, a]));
  return ctx.db.transaction((tx) => {
    const inner = { ...ctx, db: tx as unknown as DB };
    const existing = allRooms(inner);
    const items: ImportedArea[] = [];
    for (const areaId of new Set(areaIds)) {
      const area = byId.get(areaId);
      if (!area) {
        items.push({ areaId, outcome: "not_found", room: null });
        continue;
      }
      const match = matchAreaToRoom(area, existing, areas);
      if (match?.how === "linked") {
        items.push({ areaId, outcome: "unchanged", room: match.room });
      } else if (match) {
        const linked = inner.db
          .update(rooms)
          .set({ haAreaId: area.id })
          .where(eq(rooms.id, match.room.id))
          .returning()
          .get();
        existing.splice(existing.indexOf(match.room), 1, linked);
        items.push({ areaId, outcome: "linked", room: linked });
      } else {
        const created = createRoom(inner, {
          name: area.name.trim().slice(0, ROOM_NAME_MAX) || area.id,
          haAreaId: area.id,
        });
        existing.push(created);
        items.push({ areaId, outcome: "created", room: created });
      }
    }
    return items;
  });
}
