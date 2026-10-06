import type { Room } from "$lib/api/schemas/rooms";

const normal = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** The room that stands for a Home Assistant area: its stored area id, or its name, matches the area's name. */
export function roomForArea(
  area: string | null,
  rooms: readonly Room[],
): Room | undefined {
  if (!area) return undefined;
  const wanted = normal(area);
  if (wanted === "") return undefined;
  return (
    rooms.find((r) => r.haAreaId && normal(r.haAreaId) === wanted) ??
    rooms.find((r) => normal(r.name) === wanted)
  );
}
