import { eq } from "drizzle-orm";
import type { SQLiteTable, AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { AttachmentOwnerType } from "$lib/api/enums";
import {
  assetHints,
  assetNotes,
  contacts,
  costEntries,
  defects,
  insurancePolicies,
  parts,
  serviceLog,
  tireSets,
} from "$lib/server/db";
import { registerAttachmentOwner, type OwnerExists } from "./owners";

const existsIn =
  (table: SQLiteTable & { id: AnySQLiteColumn }): OwnerExists =>
  (ctx, id) =>
    ctx.db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, id))
      .get() !== undefined;

const DOMAIN_OWNERS: [AttachmentOwnerType, OwnerExists][] = [
  ["defect", existsIn(defects)],
  ["service_log", existsIn(serviceLog)],
  ["part", existsIn(parts)],
  ["asset_hint", existsIn(assetHints)],
  ["contact", existsIn(contacts)],
  ["cost", existsIn(costEntries)],
  ["insurance_policy", existsIn(insurancePolicies)],
  ["asset_note", existsIn(assetNotes)],
  ["tire_set", existsIn(tireSets)],
];

/** Makes the owner types of the domains on top of the core valid for uploads. Safe to call more than once. */
export function registerDomainAttachmentOwners(): void {
  for (const [type, exists] of DOMAIN_OWNERS) {
    registerAttachmentOwner(type, exists);
  }
}
