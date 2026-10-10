import { resolve } from "$app/paths";

export function newTaskHref(assetId: string): string {
  return `${resolve("/tasks")}/new?assetId=${encodeURIComponent(assetId)}`;
}

/** The task editor with a title (and text) prefilled, e.g. from a care hint. */
export function planTaskHref(
  assetId: string,
  title: string,
  description?: string,
): string {
  const query = new URLSearchParams({ assetId, title });
  if (description) query.set("description", description);
  return `${resolve("/tasks")}/new?${query}`;
}

export function roomTasksHref(roomId: string): string {
  return `${resolve("/tasks")}?roomId=${encodeURIComponent(roomId)}`;
}

export function newAssetHref(
  kind: "device" | "plant" | "vehicle",
  roomId?: string,
): string {
  const query = new URLSearchParams({ kind });
  if (roomId) query.set("roomId", roomId);
  return `${resolve("/assets/new")}?${query}`;
}

/** A vehicle's page with the dialog for its recurring tasks open (a vehicle that was just created). */
export function vehicleSetupHref(assetId: string): string {
  return `${resolve(`/assets/${encodeURIComponent(assetId)}` as "/")}?termine=1`;
}

/** The deep link a printed QR code carries. */
export function qrLink(origin: string, qrSlug: string): string {
  return `${origin}/d/${qrSlug}`;
}
