import { and, eq, isNull, or, isNotNull, type SQL } from "drizzle-orm";
import { diffDays, maxDate } from "$lib/dates";
import type { WarrantyStatus } from "$lib/api/enums";
import {
  WARRANTY_EXPIRED_GRACE_DAYS,
  WARRANTY_EXPIRING_DAYS,
} from "$lib/api/schemas/warranties";
import { assets, rooms } from "$lib/server/db";
import { paginateArray } from "$lib/server/pagination";
import type { ServiceContext } from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";

export interface WarrantyRecord {
  assetId: string;
  assetName: string;
  roomName: string | null;
  manufacturer: string | null;
  model: string | null;
  purchaseDate: string | null;
  warrantyUntil: string | null;
  warrantyExtendedUntil: string | null;
  effectiveUntil: string;
  status: WarrantyStatus;
  daysLeft: number;
}

/** The warranty holds through its last day: on that day it is `expiring`, the day after `expired`. */
export function warrantyStatus(
  effectiveUntil: string,
  today: string,
): { status: WarrantyStatus; daysLeft: number } {
  const daysLeft = diffDays(effectiveUntil, today);
  if (daysLeft < 0) return { status: "expired", daysLeft };
  if (daysLeft <= WARRANTY_EXPIRING_DAYS)
    return { status: "expiring", daysLeft };
  return { status: "valid", daysLeft };
}

export function allWarranties(
  ctx: Pick<ServiceContext, "db" | "now">,
): WarrantyRecord[] {
  const { today } = clockAt(ctx.now);
  const where: SQL[] = [
    isNull(assets.archivedAt),
    or(
      isNotNull(assets.warrantyUntil),
      isNotNull(assets.warrantyExtendedUntil),
    ) as SQL,
  ];
  return ctx.db
    .select({ asset: assets, roomName: rooms.name })
    .from(assets)
    .leftJoin(rooms, eq(rooms.id, assets.roomId))
    .where(and(...where))
    .all()
    .map(({ asset, roomName }): WarrantyRecord => {
      const effectiveUntil = (
        asset.warrantyUntil && asset.warrantyExtendedUntil
          ? maxDate(asset.warrantyUntil, asset.warrantyExtendedUntil)
          : (asset.warrantyUntil ?? asset.warrantyExtendedUntil)
      ) as string;
      return {
        assetId: asset.id,
        assetName: asset.name,
        roomName,
        manufacturer: asset.manufacturer,
        model: asset.model,
        purchaseDate: asset.purchaseDate,
        warrantyUntil: asset.warrantyUntil,
        warrantyExtendedUntil: asset.warrantyExtendedUntil,
        effectiveUntil,
        ...warrantyStatus(effectiveUntil, today),
      };
    })
    .sort(
      (a, b) =>
        a.effectiveUntil.localeCompare(b.effectiveUntil) ||
        a.assetName.localeCompare(b.assetName, "de") ||
        a.assetId.localeCompare(b.assetId),
    );
}

export function listWarranties(
  ctx: Pick<ServiceContext, "db" | "now">,
  filter: { status?: WarrantyStatus },
  page: { cursor?: string; limit: number },
) {
  const rows = allWarranties(ctx).filter(
    (w) => !filter.status || w.status === filter.status,
  );
  return paginateArray(rows, page.cursor, page.limit);
}

/** Expiring within 90 days, or expired no more than 30 days ago. */
export function dashboardWarranties(
  ctx: Pick<ServiceContext, "db" | "now">,
): WarrantyRecord[] {
  return allWarranties(ctx).filter(
    (w) =>
      w.status === "expiring" ||
      (w.status === "expired" && -w.daysLeft <= WARRANTY_EXPIRED_GRACE_DAYS),
  );
}
