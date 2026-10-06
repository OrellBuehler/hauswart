import { and, asc, eq, like, or, sql, type SQL } from "drizzle-orm";
import type { ContactKind } from "$lib/api/enums";
import type {
  CreateContactRequest,
  LinkAssetContactRequest,
  UpdateContactRequest,
} from "$lib/api/schemas/contacts";
import { assetContacts, assets, contacts } from "$lib/server/db";
import { paginateArray } from "$lib/server/pagination";
import {
  conflict,
  invalidField,
  isUniqueViolation,
  notFound,
  type ServiceContext,
} from "$lib/server/service";

type Db = Pick<ServiceContext, "db">;

export type ContactRow = typeof contacts.$inferSelect;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface ContactFilter {
  kind?: ContactKind;
  emergency?: boolean;
  q?: string;
}

export function listContacts(
  ctx: Db,
  filter: ContactFilter,
  page: { cursor?: string; limit: number },
) {
  const where: SQL[] = [];
  if (filter.kind) where.push(eq(contacts.kind, filter.kind));
  if (filter.emergency !== undefined) {
    where.push(eq(contacts.emergency, filter.emergency));
  }
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q.toLowerCase())}%`;
    const match = (column: Parameters<typeof like>[0]) =>
      sql`lower(${column}) like ${pattern} escape '\\'`;
    where.push(
      or(
        match(contacts.name),
        match(contacts.company),
        match(contacts.email),
        match(contacts.phone),
      ) as SQL,
    );
  }
  const rows = ctx.db
    .select()
    .from(contacts)
    .where(and(...where))
    .orderBy(
      asc(contacts.sortOrder),
      asc(sql`lower(${contacts.name})`),
      asc(contacts.id),
    )
    .all();
  return paginateArray(rows, page.cursor, page.limit);
}

export function findContact(ctx: Db, id: string): ContactRow | undefined {
  return ctx.db.select().from(contacts).where(eq(contacts.id, id)).get();
}

export function getContact(ctx: Db, id: string): ContactRow {
  const contact = findContact(ctx, id);
  if (!contact) throw notFound("Contact");
  return contact;
}

const EXTERNAL_TAKEN = "A contact with this external reference already exists";

export function createContact(
  ctx: Db,
  input: CreateContactRequest,
): ContactRow {
  try {
    return ctx.db
      .insert(contacts)
      .values({
        kind: input.kind,
        name: input.name,
        company: input.company ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        url: input.url ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        emergency: input.emergency,
        guestVisible: input.guestVisible,
        sortOrder: input.sortOrder ?? 0,
        externalSource: input.externalSource ?? null,
        externalRef: input.externalRef ?? null,
      })
      .returning()
      .get();
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(EXTERNAL_TAKEN);
    throw err;
  }
}

export function updateContact(
  ctx: Db,
  id: string,
  patch: UpdateContactRequest,
): ContactRow {
  const current = getContact(ctx, id);
  const source =
    patch.externalSource !== undefined
      ? patch.externalSource
      : current.externalSource;
  const ref =
    patch.externalRef !== undefined ? patch.externalRef : current.externalRef;
  if ((source === null) !== (ref === null)) {
    throw invalidField(
      "externalRef",
      "externalSource and externalRef go together",
    );
  }
  try {
    return ctx.db
      .update(contacts)
      .set(patch)
      .where(eq(contacts.id, id))
      .returning()
      .get();
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(EXTERNAL_TAKEN);
    throw err;
  }
}

/** Links go with the contact; service log entries and defects keep their text and lose the link. */
export function deleteContact(ctx: Db, id: string): void {
  const removed = ctx.db
    .delete(contacts)
    .where(eq(contacts.id, id))
    .returning({ id: contacts.id })
    .all();
  if (removed.length === 0) throw notFound("Contact");
}

export interface AssetContactRecord {
  id: string;
  assetId: string;
  contactId: string;
  role: ContactRowRole;
  contact: ContactRow;
}
type ContactRowRole = typeof assetContacts.$inferSelect.role;

function assertAsset(ctx: Db, assetId: string) {
  const hit = ctx.db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  if (!hit) throw notFound("Asset");
}

const selectLinks = (db: Db["db"]) =>
  db
    .select({ link: assetContacts, contact: contacts })
    .from(assetContacts)
    .innerJoin(contacts, eq(contacts.id, assetContacts.contactId));

const toLink = ({
  link,
  contact,
}: {
  link: typeof assetContacts.$inferSelect;
  contact: ContactRow;
}): AssetContactRecord => ({
  id: link.id,
  assetId: link.assetId,
  contactId: link.contactId,
  role: link.role,
  contact,
});

/** By the contact's sort order and name. */
export function listAssetContacts(
  ctx: Db,
  assetId: string,
  page: { cursor?: string; limit: number },
) {
  assertAsset(ctx, assetId);
  const rows = selectLinks(ctx.db)
    .where(eq(assetContacts.assetId, assetId))
    .orderBy(
      asc(contacts.sortOrder),
      asc(sql`lower(${contacts.name})`),
      asc(assetContacts.role),
      asc(assetContacts.id),
    )
    .all()
    .map(toLink);
  return paginateArray(rows, page.cursor, page.limit);
}

export function linkAssetContact(
  ctx: Db,
  assetId: string,
  input: LinkAssetContactRequest,
): AssetContactRecord {
  assertAsset(ctx, assetId);
  getContact(ctx, input.contactId);
  try {
    const row = ctx.db
      .insert(assetContacts)
      .values({ assetId, contactId: input.contactId, role: input.role })
      .returning({ id: assetContacts.id })
      .get();
    return toLink(
      selectLinks(ctx.db).where(eq(assetContacts.id, row.id)).get()!,
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(
        "This contact is already linked to the asset in this role",
      );
    }
    throw err;
  }
}

export function unlinkAssetContact(
  ctx: Db,
  assetId: string,
  linkId: string,
): void {
  const removed = ctx.db
    .delete(assetContacts)
    .where(
      and(eq(assetContacts.id, linkId), eq(assetContacts.assetId, assetId)),
    )
    .returning({ id: assetContacts.id })
    .all();
  if (removed.length === 0) throw notFound("Link");
}
