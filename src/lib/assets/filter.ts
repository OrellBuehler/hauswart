import type { AssetKind } from "$lib/api/enums";
import type { Asset } from "$lib/api/schemas/assets";
import { warrantyStatus, type WarrantyStatus } from "./warranty";

export type AssetFilter = {
  q: string;
  roomId: string | null;
  kind: AssetKind | null;
  warranty: WarrantyStatus | null;
  archived: boolean;
};

export const emptyFilter: AssetFilter = {
  q: "",
  roomId: null,
  kind: null,
  warranty: null,
  archived: false,
};

function haystack(asset: Asset): string {
  return [
    asset.name,
    asset.roomName,
    asset.category,
    asset.manufacturer,
    asset.model,
    asset.serialNumber,
    asset.species,
    asset.vehicle?.plate,
    asset.vehicle?.plate?.replace(/\s+/g, ""),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function filterAssets(
  assets: Asset[],
  filter: AssetFilter,
  today: string,
): Asset[] {
  const terms = filter.q.toLowerCase().split(/\s+/).filter(Boolean);
  return assets.filter((asset) => {
    if (!filter.archived && asset.archivedAt) return false;
    if (filter.roomId && asset.roomId !== filter.roomId) return false;
    if (filter.kind && asset.kind !== filter.kind) return false;
    if (
      filter.warranty &&
      warrantyStatus(asset, today).status !== filter.warranty
    ) {
      return false;
    }
    if (terms.length === 0) return true;
    const text = haystack(asset);
    return terms.every((term) => text.includes(term));
  });
}

export function isFiltered(filter: AssetFilter): boolean {
  return (
    filter.q.trim() !== "" ||
    filter.roomId !== null ||
    filter.kind !== null ||
    filter.warranty !== null ||
    filter.archived
  );
}
