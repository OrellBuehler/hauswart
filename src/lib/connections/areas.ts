import type { Room } from "$lib/api/schemas/rooms";

const normal = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Compares ids without case, accents and punctuation (`Living_Room` and `living-room` are one). */
export const areaKey = normal;

const UMLAUTS: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
};

/** Like `areaKey`, and `Küche`, `Kueche` and `küche` are one: how people spell a room name. */
const nameKey = (value: string): string =>
  normal(value.toLowerCase().replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c));

export interface AreaRef {
  id: string;
  name: string;
}

export interface RoomRef {
  id: string;
  name: string;
  haAreaId: string | null;
}

/**
 * The room that stands for an area of the connected system: its stored area id, or (for a
 * device whose area is only known by name) its name, matches the area.
 */
export function roomForArea(
  area: string | null,
  rooms: readonly Room[],
  areaId?: string | null,
): Room | undefined {
  const byId = areaId ? roomWithAreaId(areaId, rooms) : undefined;
  if (byId) return byId;
  if (!area) return undefined;
  const wanted = normal(area);
  if (wanted === "") return undefined;
  const byName = nameKey(area);
  return (
    rooms.find((r) => r.haAreaId && normal(r.haAreaId) === wanted) ??
    rooms.find((r) => nameKey(r.name) === byName)
  );
}

/** The room that stores this area id, ignoring case and punctuation. */
export function roomWithAreaId<R extends RoomRef>(
  areaId: string,
  rooms: readonly R[],
): R | undefined {
  const wanted = normal(areaId);
  if (wanted === "") return undefined;
  return rooms.find((r) => r.haAreaId && normal(r.haAreaId) === wanted);
}

export type AreaMatch<R extends RoomRef> =
  { how: "linked"; room: R } | { how: "name"; room: R };

/**
 * What an import does with an area, given every area the system lists: a room that already stores
 * its id is `linked`; else a room of the same name that stores no id of a listed area is taken
 * over (`name`) instead of being duplicated; else nothing matches and a room would be created.
 * A stored id that no listed area has (typed by hand, or an area that was deleted) counts as no link.
 */
export function matchAreaToRoom<R extends RoomRef>(
  area: AreaRef,
  rooms: readonly R[],
  areas: readonly AreaRef[],
): AreaMatch<R> | undefined {
  const linked = roomWithAreaId(area.id, rooms);
  if (linked) return { how: "linked", room: linked };
  const known = new Set(areas.map((a) => normal(a.id)).filter(Boolean));
  const wanted = nameKey(area.name);
  if (wanted === "") return undefined;
  const room = rooms.find(
    (r) =>
      nameKey(r.name) === wanted &&
      !(r.haAreaId && known.has(normal(r.haAreaId))),
  );
  return room ? { how: "name", room } : undefined;
}
