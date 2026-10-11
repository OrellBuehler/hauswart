import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  assets,
  contacts,
  insurancePolicies,
  insurancePolicyAssets,
} from "$lib/server/db";
import { minor } from "$lib/money";
import { useTestDB } from "$lib/testing/db";

describe("insurance tables", () => {
  const test = useTestDB();

  function fixture() {
    const db = test.db;
    const contact = db
      .insert(contacts)
      .values({ name: "Muster Versicherungen AG", kind: "insurance" })
      .returning()
      .get();
    const asset = db
      .insert(assets)
      .values({ name: "Kombi", slug: "kombi", qrSlug: "qrkombi001" })
      .returning()
      .get();
    const policy = db
      .insert(insurancePolicies)
      .values({
        title: "Hausrat",
        premiumMinor: minor(48_000),
        currency: "CHF",
        startDate: "2026-01-01",
        insurerContactId: contact.id,
      })
      .returning()
      .get();
    db.insert(insurancePolicyAssets)
      .values({ policyId: policy.id, assetId: asset.id })
      .run();
    return { contact, asset, policy };
  }

  it("fills in the defaults", () => {
    const { policy } = fixture();
    expect(policy).toMatchObject({
      type: "other",
      premiumPeriod: "annual",
      renewal: "auto",
      showOnEmergency: false,
      deductibleMinor: null,
      endDate: null,
      cancellationNoticeMonths: null,
      archivedAt: null,
    });
  });

  it("keeps the policy when its insurer contact is deleted", () => {
    const { contact, policy } = fixture();
    test.db.delete(contacts).where(eq(contacts.id, contact.id)).run();
    const row = test.db
      .select()
      .from(insurancePolicies)
      .where(eq(insurancePolicies.id, policy.id))
      .get();
    expect(row?.insurerContactId).toBeNull();
  });

  it("drops the cover link, not the policy, when an asset is deleted", () => {
    const { asset, policy } = fixture();
    test.db.delete(assets).where(eq(assets.id, asset.id)).run();
    expect(test.db.select().from(insurancePolicyAssets).all()).toEqual([]);
    expect(
      test.db
        .select()
        .from(insurancePolicies)
        .where(eq(insurancePolicies.id, policy.id))
        .get(),
    ).toBeDefined();
  });

  it("drops the cover links when a policy is deleted and refuses a link twice", () => {
    const { asset, policy } = fixture();
    expect(() =>
      test.db
        .insert(insurancePolicyAssets)
        .values({ policyId: policy.id, assetId: asset.id })
        .run(),
    ).toThrow(/UNIQUE|PRIMARY/i);
    test.db
      .delete(insurancePolicies)
      .where(eq(insurancePolicies.id, policy.id))
      .run();
    expect(test.db.select().from(insurancePolicyAssets).all()).toEqual([]);
    expect(test.db.select().from(assets).all()).toHaveLength(1);
  });
});
