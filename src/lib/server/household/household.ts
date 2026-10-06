import { eq } from "drizzle-orm";
import {
  householdSettingsSchema,
  type HouseholdSettings,
  type UpdateHouseholdRequest,
} from "$lib/api/schemas/household";
import { normalizeHostEntry } from "$lib/hosts";
import { householdTimeZone } from "$lib/server/config";
import { HOUSEHOLD_ID, household } from "$lib/server/db";
import { parseStored } from "$lib/server/json";
import type { ServiceContext } from "$lib/server/service";

export interface HouseholdRecord {
  name: string;
  timezone: string;
  currency: string;
  handoverDate: string | null;
  settings: HouseholdSettings;
  updatedAt: Date;
}

type Row = typeof household.$inferSelect;

function toRecord(row: Row): HouseholdRecord {
  return {
    name: row.name,
    timezone: row.timezone,
    currency: row.currency,
    handoverDate: row.handoverDate,
    settings: parseStored(
      householdSettingsSchema,
      row.settings ?? {},
      "household settings",
    ),
    updatedAt: row.updatedAt,
  };
}

/**
 * The singleton household, created on first use. The time zone always follows
 * `HAUSWART_TZ`, so the stored value only records what the configuration said
 * last; changing the environment variable changes it on the next read.
 */
export function getHousehold(ctx: Pick<ServiceContext, "db">): HouseholdRecord {
  const { db } = ctx;
  const timezone = householdTimeZone();
  db.insert(household)
    .values({ id: HOUSEHOLD_ID, timezone, settings: {} })
    .onConflictDoNothing()
    .run();
  let row = db
    .select()
    .from(household)
    .where(eq(household.id, HOUSEHOLD_ID))
    .get() as Row;
  if (row.timezone !== timezone) {
    row = db
      .update(household)
      .set({ timezone })
      .where(eq(household.id, HOUSEHOLD_ID))
      .returning()
      .get();
  }
  return toRecord(row);
}

export function updateHousehold(
  ctx: Pick<ServiceContext, "db">,
  patch: UpdateHouseholdRequest,
): HouseholdRecord {
  const current = getHousehold(ctx);
  const allowlist = patch.settings?.integrationHostAllowlist;
  const settings = householdSettingsSchema.parse({
    ...current.settings,
    ...patch.settings,
    ...(allowlist === undefined
      ? {}
      : {
          integrationHostAllowlist: [
            ...new Set(
              allowlist.flatMap((entry) => normalizeHostEntry(entry) ?? []),
            ),
          ],
        }),
  });
  const row = ctx.db
    .update(household)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.currency === undefined ? {} : { currency: patch.currency }),
      ...(patch.handoverDate === undefined
        ? {}
        : { handoverDate: patch.handoverDate }),
      settings,
    })
    .where(eq(household.id, HOUSEHOLD_ID))
    .returning()
    .get();
  return toRecord(row);
}
