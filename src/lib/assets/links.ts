import { resolve } from "$app/paths";

export function newTaskHref(assetId: string): string {
  return `${resolve("/tasks")}/new?assetId=${encodeURIComponent(assetId)}`;
}

export function roomTasksHref(roomId: string): string {
  return `${resolve("/tasks")}?roomId=${encodeURIComponent(roomId)}`;
}

export function newAssetHref(
  kind: "device" | "plant",
  roomId?: string,
): string {
  const query = new URLSearchParams({ kind });
  if (roomId) query.set("roomId", roomId);
  return `${resolve("/assets/new")}?${query}`;
}

/** The deep link a printed QR code carries. */
export function qrLink(origin: string, qrSlug: string): string {
  return `${origin}/d/${qrSlug}`;
}
