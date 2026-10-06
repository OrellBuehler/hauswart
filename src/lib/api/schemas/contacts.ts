import { z } from "zod";
import { ASSET_CONTACT_ROLES, CONTACT_KINDS } from "../enums";
import {
  atLeastOne,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
  queryBooleanSchema,
} from "./common";
import { nullableEmail, nullableHttpUrl } from "./fields";

export const contactKindSchema = z.enum(CONTACT_KINDS);
export const assetContactRoleSchema = z.enum(ASSET_CONTACT_ROLES);

export const contactSchema = z
  .object({
    id: z.string(),
    kind: contactKindSchema,
    name: z.string(),
    company: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    url: z.string().nullable(),
    address: z.string().nullable(),
    notes: z.string().nullable(),
    emergency: z.boolean(),
    guestVisible: z.boolean(),
    sortOrder: z.number().int(),
    /** Opaque link to a record in an external system (set by adapters). */
    externalSource: z.string().nullable(),
    externalRef: z.string().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "Contact" });
export type Contact = z.infer<typeof contactSchema>;

/** A contact with the assets it is linked to, one entry per link (a role each). */
export const contactDetailSchema = contactSchema
  .extend({
    assets: z.array(
      z.object({
        linkId: z.string(),
        assetId: z.string(),
        assetName: z.string(),
        role: assetContactRoleSchema,
      }),
    ),
  })
  .meta({ id: "ContactDetail" });
export type ContactDetail = z.infer<typeof contactDetailSchema>;

export const listContactsQuerySchema = paginationQuerySchema.extend({
  kind: contactKindSchema.optional(),
  emergency: queryBooleanSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export const listContactsResponseSchema = paginated(contactSchema);

const contactFields = {
  kind: contactKindSchema,
  name: z.string().trim().min(1).max(160),
  company: nullableText(160),
  phone: nullableText(60),
  email: nullableEmail(),
  url: nullableHttpUrl(),
  address: nullableText(500),
  notes: nullableText(10_000),
  emergency: z.boolean(),
  guestVisible: z.boolean(),
  sortOrder: z.number().int().min(0).max(100_000),
  externalSource: z.string().trim().min(1).max(64).nullable(),
  externalRef: z.string().trim().min(1).max(255).nullable(),
};

const externalPair = (v: {
  externalSource?: string | null;
  externalRef?: string | null;
}) =>
  ((v.externalSource ?? null) === null) === ((v.externalRef ?? null) === null);

export const createContactRequestSchema = z
  .strictObject({
    kind: contactFields.kind.default("other"),
    name: contactFields.name,
    company: contactFields.company.optional(),
    phone: contactFields.phone.optional(),
    email: contactFields.email.optional(),
    url: contactFields.url.optional(),
    address: contactFields.address.optional(),
    notes: contactFields.notes.optional(),
    emergency: contactFields.emergency.default(false),
    guestVisible: contactFields.guestVisible.default(false),
    sortOrder: contactFields.sortOrder.optional(),
    externalSource: contactFields.externalSource.optional(),
    externalRef: contactFields.externalRef.optional(),
  })
  .refine(externalPair, {
    error: "externalSource and externalRef go together.",
    path: ["externalRef"],
  });
export type CreateContactRequest = z.output<typeof createContactRequestSchema>;

export const updateContactRequestSchema = atLeastOne(
  z.strictObject({
    kind: contactFields.kind.optional(),
    name: contactFields.name.optional(),
    company: contactFields.company.optional(),
    phone: contactFields.phone.optional(),
    email: contactFields.email.optional(),
    url: contactFields.url.optional(),
    address: contactFields.address.optional(),
    notes: contactFields.notes.optional(),
    emergency: contactFields.emergency.optional(),
    guestVisible: contactFields.guestVisible.optional(),
    sortOrder: contactFields.sortOrder.optional(),
    externalSource: contactFields.externalSource.optional(),
    externalRef: contactFields.externalRef.optional(),
  }),
);
export type UpdateContactRequest = z.output<typeof updateContactRequestSchema>;

export const assetContactSchema = z
  .object({
    id: z.string(),
    assetId: z.string(),
    contactId: z.string(),
    role: assetContactRoleSchema,
    contact: contactSchema,
  })
  .meta({ id: "AssetContact" });
export type AssetContact = z.infer<typeof assetContactSchema>;

export const listAssetContactsResponseSchema = paginated(assetContactSchema);

export const linkAssetContactRequestSchema = z.strictObject({
  contactId: idSchema,
  role: assetContactRoleSchema.default("other"),
});
export type LinkAssetContactRequest = z.output<
  typeof linkAssetContactRequestSchema
>;

export const assetContactParamsSchema = z.object({
  id: idSchema,
  linkId: idSchema,
});
