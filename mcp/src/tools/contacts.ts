import { z } from "zod";
import { CONTACT_KINDS } from "../../../src/lib/api/enums";
import { endpoints } from "../../../src/lib/api/registry";
import type { Contact } from "../../../src/lib/api/schemas/contacts";
import { moreHint, plural } from "../format";
import { defineTool } from "../tool";
import { attachmentRows } from "./attachments";
import { resolveContact } from "./resolve";

const contactRow = (c: Contact) => ({
  id: c.id,
  name: c.name,
  kind: c.kind,
  company: c.company,
  phone: c.phone,
  email: c.email,
  emergency: c.emergency ? true : null,
});

export const listContacts = defineTool({
  name: "list_contacts",
  title: "List contacts",
  description:
    "Tradespeople, service lines, property management, emergency numbers and neighbours with phone and e-mail. Filter by kind (installer, property_mgmt, manufacturer_support, emergency, utility, insurance, neighbor, seller, other), emergency: true, or q (name, company, e-mail, phone). Read one with get_contact.",
  mode: "read",
  input: {
    kind: z.enum(CONTACT_KINDS).optional(),
    emergency: z.boolean().optional(),
    q: z.string().trim().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    const page = await ctx.api.call(endpoints.contactsList, {
      query: {
        kind: args.kind,
        emergency:
          args.emergency === undefined
            ? undefined
            : args.emergency
              ? "true"
              : "false",
        q: args.q,
        cursor: args.cursor,
        limit: args.limit,
      },
    });
    return {
      summary: `${plural(page.items.length, "contact")}.${moreHint(page.nextCursor)}`,
      data: {
        contacts: page.items.map(contactRow),
        nextCursor: page.nextCursor,
      },
    };
  },
});

export const getContact = defineTool({
  name: "get_contact",
  title: "Get a contact",
  description:
    "One contact in full: phone, e-mail, website, address, notes, whether it is an emergency contact, and the names of attached files. contact is the id or the name.",
  mode: "read",
  input: {
    contact: z.string().min(1).max(160).describe("Contact id or name"),
  },
  async handler({ contact: ref }, ctx) {
    const contact = await resolveContact(ctx, ref);
    const attachments = await attachmentRows(ctx, "contact", contact.id);
    return {
      summary: `${contact.name}${contact.company ? `, ${contact.company}` : ""} (${contact.kind}).`,
      data: {
        ...contactRow(contact),
        url: contact.url,
        address: contact.address,
        notes: contact.notes,
        attachments,
      },
    };
  },
});

export const contactTools = [listContacts, getContact];
