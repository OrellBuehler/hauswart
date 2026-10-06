import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { GUEST_SECTIONS, type GuestLinkStatus } from "$lib/api/enums";
import {
  MAX_GUEST_LINK_DAYS,
  type CreateGuestLinkRequest,
  type UpdateGuestLinkRequest,
} from "$lib/api/schemas/share";
import { hashPassword } from "$lib/server/auth/password";
import { docPages, guestLinks, users } from "$lib/server/db";
import { parseStored } from "$lib/server/json";
import {
  conflict,
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import {
  generateShareToken,
  hashShareToken,
  SHARE_TOKEN_PATTERN,
  sameHash,
} from "./tokens";

type Db = Pick<ServiceContext, "db">;
type Now = Pick<ServiceContext, "db" | "now">;

export type GuestLinkRow = typeof guestLinks.$inferSelect;

/** Wrong PINs in a row after which the link closes until a member sets the PIN again. */
export const MAX_PIN_FAILURES = 30;
export const VIEW_TOUCH_MS = 10 * 60 * 1000;
const DAY_MS = 86_400_000;

const storedSectionsSchema = z.object({
  sections: z.array(z.enum(GUEST_SECTIONS)),
  pageIds: z.array(z.string()),
});

export interface GuestLinkRecord {
  id: string;
  label: string;
  status: GuestLinkStatus;
  createdBy: string | null;
  createdByName: string | null;
  startsAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  hasPin: boolean;
  pinLocked: boolean;
  includeSecrets: boolean;
  sections: (typeof GUEST_SECTIONS)[number][];
  pageIds: string[];
  locale: GuestLinkRow["locale"];
  lastViewedAt: Date | null;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export function sectionsOf(row: GuestLinkRow) {
  return parseStored(
    storedSectionsSchema,
    row.sectionsJson,
    "guest link sections",
  );
}

export function linkStatus(
  row: Pick<GuestLinkRow, "revokedAt" | "startsAt" | "expiresAt">,
  now: number,
): GuestLinkStatus {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now) return "expired";
  if (row.startsAt && row.startsAt.getTime() > now) return "scheduled";
  return "active";
}

export const isPinLocked = (row: Pick<GuestLinkRow, "pinFailures">) =>
  row.pinFailures >= MAX_PIN_FAILURES;

function toRecord(
  row: GuestLinkRow,
  createdByName: string | null,
  now: number,
): GuestLinkRecord {
  const { sections, pageIds } = sectionsOf(row);
  return {
    id: row.id,
    label: row.label,
    status: linkStatus(row, now),
    createdBy: row.createdBy,
    createdByName,
    startsAt: row.startsAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    hasPin: row.pinHash !== null,
    pinLocked: row.pinHash !== null && isPinLocked(row),
    includeSecrets: row.includeSecrets,
    sections,
    pageIds,
    locale: row.locale,
    lastViewedAt: row.lastViewedAt,
    viewCount: row.viewCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const withCreator = (ctx: Db, row: GuestLinkRow, now: number) => {
  const creator = row.createdBy
    ? ctx.db
        .select({ name: users.displayName, username: users.username })
        .from(users)
        .where(eq(users.id, row.createdBy))
        .get()
    : undefined;
  return toRecord(
    row,
    creator ? (creator.name ?? creator.username) : null,
    now,
  );
};

export function listGuestLinks(ctx: Now): GuestLinkRecord[] {
  const names = new Map(
    ctx.db
      .select({
        id: users.id,
        name: users.displayName,
        username: users.username,
      })
      .from(users)
      .all()
      .map((u) => [u.id, u.name ?? u.username]),
  );
  return ctx.db
    .select()
    .from(guestLinks)
    .orderBy(desc(guestLinks.createdAt), desc(guestLinks.id))
    .all()
    .map((row) =>
      toRecord(
        row,
        row.createdBy ? (names.get(row.createdBy) ?? null) : null,
        ctx.now,
      ),
    );
}

function findRow(ctx: Db, id: string): GuestLinkRow {
  const row = ctx.db
    .select()
    .from(guestLinks)
    .where(eq(guestLinks.id, id))
    .get();
  if (!row) throw notFound("Guest link");
  return row;
}

export function getGuestLink(ctx: Now, id: string): GuestLinkRecord {
  return withCreator(ctx, findRow(ctx, id), ctx.now);
}

function checkWindow(
  startsAt: number | null,
  expiresAt: number,
  now: number,
): void {
  if (expiresAt <= now) {
    throw invalidField("expiresAt", "Must be in the future");
  }
  if (expiresAt > now + MAX_GUEST_LINK_DAYS * DAY_MS) {
    throw invalidField(
      "expiresAt",
      `At most ${MAX_GUEST_LINK_DAYS} days from now`,
    );
  }
  if (startsAt !== null && startsAt >= expiresAt) {
    throw invalidField("startsAt", "Must be before the expiry");
  }
}

function checkPages(ctx: Db, pageIds: readonly string[]): void {
  if (pageIds.length === 0) return;
  const found = new Set(
    ctx.db
      .select({ id: docPages.id })
      .from(docPages)
      .where(inArray(docPages.id, [...pageIds]))
      .all()
      .map((p) => p.id),
  );
  if (pageIds.some((id) => !found.has(id))) {
    throw invalidField("pageIds", "A page does not exist");
  }
}

const dateOrNull = (iso: string | null | undefined) =>
  iso ? new Date(iso) : null;

export async function createGuestLink(
  ctx: Now,
  userId: string,
  userLocale: GuestLinkRow["locale"],
  input: CreateGuestLinkRequest,
): Promise<{ record: GuestLinkRecord; token: string }> {
  const startsAt = dateOrNull(input.startsAt);
  const expiresAt = new Date(input.expiresAt);
  checkWindow(startsAt?.getTime() ?? null, expiresAt.getTime(), ctx.now);
  checkPages(ctx, input.pageIds);
  const pinHash = input.pin ? await hashPassword(input.pin) : null;
  const token = generateShareToken();
  const row = ctx.db
    .insert(guestLinks)
    .values({
      createdBy: userId,
      label: input.label,
      tokenHash: hashShareToken(token),
      startsAt,
      expiresAt,
      pinHash,
      includeSecrets: input.includeSecrets,
      sectionsJson: { sections: input.sections, pageIds: input.pageIds },
      locale: input.locale ?? userLocale,
    })
    .returning()
    .get();
  return { record: withCreator(ctx, row, ctx.now), token };
}

export async function updateGuestLink(
  ctx: Now,
  id: string,
  patch: UpdateGuestLinkRequest,
): Promise<GuestLinkRecord> {
  const row = findRow(ctx, id);
  if (row.revokedAt) throw conflict("The guest link is revoked");
  const startsAt =
    patch.startsAt === undefined ? row.startsAt : dateOrNull(patch.startsAt);
  const expiresAt =
    patch.expiresAt === undefined ? row.expiresAt : new Date(patch.expiresAt);
  if (patch.expiresAt !== undefined || patch.startsAt !== undefined) {
    // An unchanged expiry may be in the past already (an expired link being edited): only a
    // new value is held to the window.
    if (patch.expiresAt !== undefined) {
      checkWindow(startsAt?.getTime() ?? null, expiresAt.getTime(), ctx.now);
    } else if (startsAt && startsAt.getTime() >= expiresAt.getTime()) {
      throw invalidField("startsAt", "Must be before the expiry");
    }
  }
  const current = sectionsOf(row);
  if (patch.pageIds) checkPages(ctx, patch.pageIds);
  const set: Partial<typeof guestLinks.$inferInsert> = {
    startsAt,
    expiresAt,
    sectionsJson: {
      sections: patch.sections ?? current.sections,
      pageIds: patch.pageIds ?? current.pageIds,
    },
  };
  if (patch.label !== undefined) set.label = patch.label;
  if (patch.includeSecrets !== undefined) {
    set.includeSecrets = patch.includeSecrets;
  }
  if (patch.locale !== undefined) set.locale = patch.locale;
  if (patch.pin !== undefined) {
    set.pinHash = patch.pin === null ? null : await hashPassword(patch.pin);
    set.pinFailures = 0;
  }
  const updated = ctx.db
    .update(guestLinks)
    .set(set)
    .where(eq(guestLinks.id, id))
    .returning()
    .get();
  return withCreator(ctx, updated, ctx.now);
}

/** A new address for the same link; the old one stops working at once. */
export function rotateGuestLink(
  ctx: Now,
  id: string,
): { record: GuestLinkRecord; token: string } {
  const row = findRow(ctx, id);
  if (row.revokedAt) throw conflict("The guest link is revoked");
  const token = generateShareToken();
  const updated = ctx.db
    .update(guestLinks)
    .set({ tokenHash: hashShareToken(token) })
    .where(eq(guestLinks.id, id))
    .returning()
    .get();
  return { record: withCreator(ctx, updated, ctx.now), token };
}

export function revokeGuestLink(ctx: Now, id: string): void {
  const row = findRow(ctx, id);
  if (row.revokedAt) return;
  ctx.db
    .update(guestLinks)
    .set({ revokedAt: new Date(ctx.now) })
    .where(eq(guestLinks.id, id))
    .run();
}

/** The row behind a token whatever its state (the caller decides what is open); null if unknown. */
export function findGuestLinkByToken(
  ctx: Db,
  token: string,
): GuestLinkRow | null {
  if (!SHARE_TOKEN_PATTERN.test(token)) return null;
  const hash = hashShareToken(token);
  const row = ctx.db
    .select()
    .from(guestLinks)
    .where(eq(guestLinks.tokenHash, hash))
    .get();
  return row && sameHash(row.tokenHash, hash) ? row : null;
}

export function recordGuestView(ctx: Now, row: GuestLinkRow): void {
  if (
    row.lastViewedAt &&
    ctx.now - row.lastViewedAt.getTime() < VIEW_TOUCH_MS
  ) {
    return;
  }
  ctx.db
    .update(guestLinks)
    .set({
      lastViewedAt: new Date(ctx.now),
      viewCount: sql`${guestLinks.viewCount} + 1`,
      updatedAt: sql`${guestLinks.updatedAt}`,
    })
    .where(eq(guestLinks.id, row.id))
    .run();
}

export function addPinFailure(ctx: Db, id: string): void {
  ctx.db
    .update(guestLinks)
    .set({
      pinFailures: sql`${guestLinks.pinFailures} + 1`,
      updatedAt: sql`${guestLinks.updatedAt}`,
    })
    .where(eq(guestLinks.id, id))
    .run();
}

export function clearPinFailures(ctx: Db, row: GuestLinkRow): void {
  if (row.pinFailures === 0) return;
  ctx.db
    .update(guestLinks)
    .set({ pinFailures: 0, updatedAt: row.updatedAt })
    .where(eq(guestLinks.id, row.id))
    .run();
}
