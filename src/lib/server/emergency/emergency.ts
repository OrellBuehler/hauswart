import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { InsuranceType } from "$lib/api/enums";
import {
  assetHints,
  assets,
  contacts,
  docPages,
  insurancePolicies,
  rooms,
} from "$lib/server/db";
import { getHousehold } from "$lib/server/household/household";
import type { ServiceContext } from "$lib/server/service";

type Db = Pick<ServiceContext, "db">;

export const EMERGENCY_SECTIONS = ["emergency", "rules"] as const;

export type EmergencyPageRow = typeof docPages.$inferSelect;
export type EmergencyContactRow = typeof contacts.$inferSelect;
export type EmergencyHintRow = typeof assetHints.$inferSelect;

export interface EmergencyAssetRecord {
  id: string;
  name: string;
  roomName: string | null;
  pinnedHints: EmergencyHintRow[];
}

/** An insurance policy marked "show on emergency page": who to call and under which number. */
export interface EmergencyInsuranceRecord {
  id: string;
  title: string;
  type: InsuranceType;
  insurerName: string | null;
  insurerPhone: string | null;
  policyNumber: string | null;
  assistancePhone: string | null;
}

export interface EmergencyRecord {
  householdName: string;
  pages: EmergencyPageRow[];
  contacts: EmergencyContactRow[];
  assets: EmergencyAssetRecord[];
  insurance: EmergencyInsuranceRecord[];
}

/**
 * What a member needs in an emergency, in one read: the emergency and rules pages, the contacts
 * marked as emergency contacts and the devices marked "show on emergency page" with their pinned
 * hints, and the active insurance policies marked for it (insurer, policy number, assistance
 * line). Members see everything, secret blocks included. Guest links never show policies.
 */
export function getEmergency(ctx: Db): EmergencyRecord {
  const pages = ctx.db
    .select()
    .from(docPages)
    .where(
      and(
        isNull(docPages.archivedAt),
        inArray(docPages.section, [...EMERGENCY_SECTIONS]),
      ),
    )
    .orderBy(
      asc(docPages.section),
      desc(docPages.pinned),
      asc(docPages.sortOrder),
      asc(docPages.title),
      asc(docPages.id),
    )
    .all();
  const emergencyContacts = ctx.db
    .select()
    .from(contacts)
    .where(eq(contacts.emergency, true))
    .orderBy(asc(contacts.sortOrder), asc(contacts.name), asc(contacts.id))
    .all();
  const rows = ctx.db
    .select({ asset: assets, roomName: rooms.name })
    .from(assets)
    .leftJoin(rooms, eq(rooms.id, assets.roomId))
    .where(and(isNull(assets.archivedAt), eq(assets.showOnEmergency, true)))
    .orderBy(asc(assets.name), asc(assets.id))
    .all();
  const hints =
    rows.length === 0
      ? []
      : ctx.db
          .select()
          .from(assetHints)
          .where(
            and(
              eq(assetHints.pinned, true),
              inArray(
                assetHints.assetId,
                rows.map((r) => r.asset.id),
              ),
            ),
          )
          .orderBy(
            asc(assetHints.sortOrder),
            asc(assetHints.createdAt),
            asc(assetHints.id),
          )
          .all();
  const policies = ctx.db
    .select({
      id: insurancePolicies.id,
      title: insurancePolicies.title,
      type: insurancePolicies.type,
      insurerName: contacts.name,
      insurerPhone: contacts.phone,
      policyNumber: insurancePolicies.policyNumber,
      assistancePhone: insurancePolicies.assistancePhone,
    })
    .from(insurancePolicies)
    .leftJoin(contacts, eq(contacts.id, insurancePolicies.insurerContactId))
    .where(
      and(
        isNull(insurancePolicies.archivedAt),
        eq(insurancePolicies.showOnEmergency, true),
      ),
    )
    .orderBy(asc(insurancePolicies.title), asc(insurancePolicies.id))
    .all();
  return {
    householdName: getHousehold(ctx).name,
    pages,
    contacts: emergencyContacts,
    assets: rows.map(({ asset, roomName }) => ({
      id: asset.id,
      name: asset.name,
      roomName,
      pinnedHints: hints.filter((h) => h.assetId === asset.id),
    })),
    insurance: policies,
  };
}
