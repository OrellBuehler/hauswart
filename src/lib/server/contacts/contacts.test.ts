import { describe, expect, it } from "vitest";
import { createAsset, deleteAsset } from "$lib/server/assets/assets";
import {
  createContactRequestSchema,
  updateContactRequestSchema,
} from "$lib/api/schemas/contacts";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";
import {
  createContact,
  deleteContact,
  getContact,
  linkAssetContact,
  listAssetContacts,
  listContacts,
  unlinkAssetContact,
  updateContact,
} from "./contacts";

describe("contacts", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);
  const page = { limit: 50 };
  const make = (over: Record<string, unknown> = {}) =>
    createContact(
      ctx(),
      createContactRequestSchema.parse({ name: "Muster Sanitär AG", ...over }),
    );
  const asset = () =>
    createAsset(ctx(), {
      kind: "device",
      name: "Boiler",
      showOnEmergency: false,
    });

  it("creates with defaults", () => {
    expect(make()).toMatchObject({
      kind: "other",
      company: null,
      emergency: false,
      guestVisible: false,
      sortOrder: 0,
      externalSource: null,
      externalRef: null,
    });
  });

  it("updates, clears fields and answers 404 for unknown ids", () => {
    const c = make({ phone: "044 000 00 00", email: "info@example.org" });
    expect(
      updateContact(ctx(), c.id, {
        phone: null,
        emergency: true,
        kind: "installer",
      }),
    ).toMatchObject({ phone: null, emergency: true, kind: "installer" });
    expect(() => getContact(ctx(), "nope")).toThrow(/not found/i);
    expect(() => updateContact(ctx(), "nope", { name: "x" })).toThrow(
      /not found/i,
    );
    expect(() => deleteContact(ctx(), "nope")).toThrow(/not found/i);
  });

  it("keeps the external reference unique and paired", () => {
    make({ externalSource: "crm", externalRef: "42" });
    expect(() =>
      make({ name: "Zweite", externalSource: "crm", externalRef: "42" }),
    ).toThrow(/already exists/);
    const other = make({ name: "Dritte" });
    expect(() =>
      updateContact(ctx(), other.id, { externalSource: "crm" }),
    ).toThrow(/Invalid request/);
    expect(() =>
      updateContact(ctx(), other.id, {
        externalSource: "crm",
        externalRef: "42",
      }),
    ).toThrow(/already exists/);
    expect(
      updateContact(ctx(), other.id, {
        externalSource: "crm",
        externalRef: "43",
      }).externalRef,
    ).toBe("43");
  });

  it("lists by sort order then name and filters by kind, emergency and search", () => {
    make({ name: "Zeta", sortOrder: 1 });
    make({ name: "alpha", kind: "emergency", emergency: true, phone: "117" });
    make({ name: "Beta", company: "Hauswart GmbH", email: "beta@example.org" });
    const names = (f = {}) =>
      listContacts(ctx(), f, page).items.map((c) => c.name);
    expect(names()).toEqual(["alpha", "Beta", "Zeta"]);
    expect(names({ kind: "emergency" })).toEqual(["alpha"]);
    expect(names({ emergency: true })).toEqual(["alpha"]);
    expect(names({ emergency: false })).toEqual(["Beta", "Zeta"]);
    expect(names({ q: "hauswart" })).toEqual(["Beta"]);
    expect(names({ q: "BETA@" })).toEqual(["Beta"]);
    expect(names({ q: "117" })).toEqual(["alpha"]);
    expect(names({ q: "100%" })).toEqual([]);
  });

  it("paginates", () => {
    for (const n of ["A", "B", "C"]) make({ name: n });
    const first = listContacts(ctx(), {}, { limit: 2 });
    const second = listContacts(
      ctx(),
      {},
      { limit: 2, cursor: first.nextCursor! },
    );
    expect([
      first.items.length,
      second.items.length,
      second.nextCursor,
    ]).toEqual([2, 1, null]);
  });

  describe("asset links", () => {
    it("links a contact once per role and lists the contact with its role", () => {
      const a = asset();
      const c = make();
      const link = linkAssetContact(ctx(), a.id, {
        contactId: c.id,
        role: "installer",
      });
      expect(link).toMatchObject({
        assetId: a.id,
        contactId: c.id,
        role: "installer",
      });
      expect(link.contact.name).toBe("Muster Sanitär AG");
      linkAssetContact(ctx(), a.id, { contactId: c.id, role: "service" });
      expect(() =>
        linkAssetContact(ctx(), a.id, { contactId: c.id, role: "installer" }),
      ).toThrow(/already linked/);
      expect(
        listAssetContacts(ctx(), a.id, page)
          .items.map((l) => l.role)
          .sort(),
      ).toEqual(["installer", "service"]);
    });

    it("unlinks by link id and answers 404 for a link of another asset", () => {
      const a = asset();
      const b = asset();
      const c = make();
      const link = linkAssetContact(ctx(), a.id, {
        contactId: c.id,
        role: "support",
      });
      expect(() => unlinkAssetContact(ctx(), b.id, link.id)).toThrow(
        /not found/i,
      );
      unlinkAssetContact(ctx(), a.id, link.id);
      expect(listAssetContacts(ctx(), a.id, page).items).toEqual([]);
      expect(() => unlinkAssetContact(ctx(), a.id, link.id)).toThrow(
        /not found/i,
      );
    });

    it("answers 404 for unknown assets and contacts", () => {
      const a = asset();
      const c = make();
      expect(() =>
        linkAssetContact(ctx(), "nope", { contactId: c.id, role: "other" }),
      ).toThrow(/Asset not found/);
      expect(() =>
        linkAssetContact(ctx(), a.id, { contactId: "nope", role: "other" }),
      ).toThrow(/Contact not found/);
      expect(() => listAssetContacts(ctx(), "nope", page)).toThrow(
        /not found/i,
      );
    });

    it("deleting the contact or the asset removes the links", () => {
      const a = asset();
      const c = make();
      const d = make({ name: "Zweiter" });
      linkAssetContact(ctx(), a.id, { contactId: c.id, role: "other" });
      linkAssetContact(ctx(), a.id, { contactId: d.id, role: "other" });
      deleteContact(ctx(), c.id);
      expect(
        listAssetContacts(ctx(), a.id, page).items.map((l) => l.contactId),
      ).toEqual([d.id]);
      deleteAsset(ctx(), a.id);
      expect(listContacts(ctx(), {}, page).items).toHaveLength(1);
    });
  });
});

describe("contact schemas", () => {
  it("accepts only http(s) addresses and valid e-mails, empty strings clear", () => {
    const parse = (v: Record<string, unknown>) =>
      createContactRequestSchema.safeParse({ name: "x", ...v });
    expect(parse({ url: "https://example.org/a" }).success).toBe(true);
    expect(parse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(parse({ url: "ftp://example.org" }).success).toBe(false);
    expect(parse({ email: "not-an-email" }).success).toBe(false);
    expect(parse({ email: "a@example.org" }).success).toBe(true);
    const cleared = parse({ url: "", email: "  ", phone: "" });
    expect(
      cleared.success && [
        cleared.data.url,
        cleared.data.email,
        cleared.data.phone,
      ],
    ).toEqual([null, null, null]);
    expect(parse({ kind: "unknown" }).success).toBe(false);
    expect(parse({ unknown: 1 }).success).toBe(false);
    expect(parse({ externalSource: "crm" }).success).toBe(false);
  });

  it("needs a field to update", () => {
    expect(updateContactRequestSchema.safeParse({}).success).toBe(false);
  });
});
