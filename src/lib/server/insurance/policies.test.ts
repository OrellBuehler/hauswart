import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createInsurancePolicyRequestSchema } from "$lib/api/schemas/insurance";
import { createAsset, deleteAsset } from "$lib/server/assets/assets";
import { createAttachment } from "$lib/server/attachments/attachments";
import { createComment } from "$lib/server/comments/comments";
import { createContact, deleteContact } from "$lib/server/contacts/contacts";
import { createContactRequestSchema } from "$lib/api/schemas/contacts";
import {
  attachments,
  comments,
  insurancePolicies,
  tasks,
} from "$lib/server/db";
import { updateHousehold } from "$lib/server/household/household";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";
import { samplePdf, useTestFilesDir } from "$lib/testing/files";
import {
  createPolicy,
  deletePolicy,
  getPolicy,
  listAssetPolicies,
  listPolicies,
  updatePolicy,
} from "./policies";

describe("insurance policies", () => {
  const test = useTestDB();
  useTestFilesDir();
  const ctx = (now?: number) => ctxAt(test.db, now);
  const page = { limit: 50 };
  const make = (over: Record<string, unknown> = {}) =>
    createPolicy(
      ctx(),
      createInsurancePolicyRequestSchema.parse({
        title: "Hausrat Muster",
        premiumMinor: 48_000,
        startDate: "2026-01-01",
        ...over,
      }),
    );
  const asset = (name = "Kombi", kind: "device" | "other" = "other") =>
    createAsset(ctx(), { kind, name, showOnEmergency: false });
  const titles = (items: { title: string }[]) => items.map((p) => p.title);

  describe("creating", () => {
    it("fills in the defaults and the household currency", async () => {
      const p = await make();
      expect(p).toMatchObject({
        title: "Hausrat Muster",
        type: "other",
        insurerContactId: null,
        insurerName: null,
        policyNumber: null,
        premiumMinor: 48_000,
        currency: "CHF",
        premiumPeriod: "annual",
        annualPremiumMinor: 48_000,
        deductibleMinor: null,
        startDate: "2026-01-01",
        endDate: null,
        renewal: "auto",
        cancellationNoticeMonths: null,
        cancellationDeadline: null,
        assistancePhone: null,
        showOnEmergency: false,
        notes: null,
        assets: [],
        reminderTaskId: null,
        commentCount: 0,
        archivedAt: null,
      });
    });

    it("takes the currency of the household when it is changed, or the one given", async () => {
      updateHousehold(ctx(), { currency: "EUR" });
      expect((await make()).currency).toBe("EUR");
      expect((await make({ currency: "USD" })).currency).toBe("USD");
    });

    it("keeps everything that is given and derives the annual premium and the deadline", async () => {
      const insurer = createContact(
        ctx(),
        createContactRequestSchema.parse({
          name: "Muster Versicherungen",
          kind: "insurance",
        }),
      );
      const kombi = await asset("Kombi");
      const p = await make({
        title: "Kasko Kombi",
        type: "motor_full_casco",
        insurerContactId: insurer.id,
        policyNumber: "POL-2026-0042",
        premiumMinor: 12_500,
        premiumPeriod: "quarterly",
        deductibleMinor: 100_000,
        endDate: "2026-12-31",
        renewal: "auto",
        cancellationNoticeMonths: 3,
        assistancePhone: "000 000 00 00",
        showOnEmergency: true,
        notes: "Gilt in ganz Europa",
        assetIds: [kombi.id],
      });
      expect(p).toMatchObject({
        type: "motor_full_casco",
        insurerContactId: insurer.id,
        insurerName: "Muster Versicherungen",
        policyNumber: "POL-2026-0042",
        premiumMinor: 12_500,
        premiumPeriod: "quarterly",
        annualPremiumMinor: 50_000,
        deductibleMinor: 100_000,
        endDate: "2026-12-31",
        cancellationNoticeMonths: 3,
        cancellationDeadline: "2026-09-30",
        assistancePhone: "000 000 00 00",
        showOnEmergency: true,
        notes: "Gilt in ganz Europa",
        assets: [{ id: kombi.id, name: "Kombi", kind: "other" }],
      });
    });

    it("covers several assets (by name) once each, and an asset by several policies", async () => {
      const b = await asset("Boiler", "device");
      const a = await asset("Anhänger");
      const p = await make({ assetIds: [b.id, a.id, b.id] });
      expect(p.assets.map((x) => x.name)).toEqual(["Anhänger", "Boiler"]);
      const q = await make({ title: "Zweite", assetIds: [b.id] });
      expect(q.assets.map((x) => x.id)).toEqual([b.id]);
    });

    it("refuses an unknown insurer contact or asset and creates nothing", async () => {
      await expect(make({ insurerContactId: "nope" })).rejects.toMatchObject({
        code: "invalid_request",
        details: {
          body: { fieldErrors: { insurerContactId: expect.any(Array) } },
        },
      });
      await expect(make({ assetIds: ["nope"] })).rejects.toMatchObject({
        code: "invalid_request",
        details: { body: { fieldErrors: { assetIds: expect.any(Array) } } },
      });
      expect(test.db.select().from(insurancePolicies).all()).toEqual([]);
    });

    it("answers 404 for an unknown policy", () => {
      expect(() => getPolicy(ctx(), "nope")).toThrow(/not found/i);
    });
  });

  describe("schema", () => {
    const parse = (over: Record<string, unknown>) =>
      createInsurancePolicyRequestSchema.safeParse({
        title: "Hausrat",
        premiumMinor: 1000,
        startDate: "2026-01-01",
        ...over,
      });

    it.each([
      ["no title", { title: "" }],
      ["a negative premium", { premiumMinor: -1 }],
      ["a fractional premium", { premiumMinor: 10.5 }],
      ["an unknown type", { type: "pet" }],
      ["an unknown period", { premiumPeriod: "weekly" }],
      ["an unknown renewal", { renewal: "sometimes" }],
      ["a bad date", { startDate: "01.01.2026" }],
      ["an end date before the start", { endDate: "2025-12-31" }],
      ["a negative notice period", { cancellationNoticeMonths: -1 }],
      ["a fractional notice period", { cancellationNoticeMonths: 1.5 }],
      ["an absurd notice period", { cancellationNoticeMonths: 121 }],
      ["a lower case currency", { currency: "chf" }],
      ["unknown fields", { cancellationDeadline: "2026-09-30" }],
      [
        "too many assets",
        { assetIds: Array.from({ length: 51 }, (_, i) => `a${i}`) },
      ],
    ])("refuses %s", (_name, over) => {
      expect(parse(over).success).toBe(false);
    });

    it("accepts the end date on the start date and empty optional text as null", () => {
      const parsed = parse({
        endDate: "2026-01-01",
        policyNumber: "  ",
        notes: "",
      });
      expect(parsed.success && parsed.data).toMatchObject({
        endDate: "2026-01-01",
        policyNumber: null,
        notes: null,
      });
    });
  });

  describe("listing", () => {
    it("lists active policies by cancellation deadline, those without one last, then by title", async () => {
      await make({ title: "Zeta" });
      await make({ title: "Alpha" });
      await make({
        title: "Spät",
        endDate: "2027-12-31",
        cancellationNoticeMonths: 3,
      });
      await make({
        title: "Früh",
        endDate: "2026-12-31",
        cancellationNoticeMonths: 3,
      });
      await make({
        title: "Fest",
        renewal: "fixed",
        endDate: "2026-07-01",
        cancellationNoticeMonths: 3,
      });
      expect(titles(listPolicies(ctx(), {}, page).items)).toEqual([
        "Früh",
        "Spät",
        "Alpha",
        "Fest",
        "Zeta",
      ]);
    });

    it("filters by type and by covered asset", async () => {
      const kombi = await asset("Kombi");
      const boiler = await asset("Boiler", "device");
      await make({ title: "Haftpflicht", type: "personal_liability" });
      await make({
        title: "Kasko",
        type: "motor_full_casco",
        assetIds: [kombi.id],
      });
      await make({
        title: "Haftpflicht Auto",
        type: "motor_liability",
        assetIds: [kombi.id, boiler.id],
      });
      expect(
        titles(listPolicies(ctx(), { type: "motor_full_casco" }, page).items),
      ).toEqual(["Kasko"]);
      expect(
        titles(listPolicies(ctx(), { assetId: kombi.id }, page).items),
      ).toEqual(["Haftpflicht Auto", "Kasko"]);
      expect(
        titles(listPolicies(ctx(), { assetId: boiler.id }, page).items),
      ).toEqual(["Haftpflicht Auto"]);
      expect(listPolicies(ctx(), { assetId: "nope" }, page).items).toEqual([]);
      // Every policy lists everything it covers, not only the asset filtered on.
      expect(
        listPolicies(ctx(), { assetId: boiler.id }, page).items[0].assets,
      ).toHaveLength(2);
    });

    it("searches title, policy number and the insurer's name, ignoring case and taking % and _ literally", async () => {
      const insurer = createContact(
        ctx(),
        createContactRequestSchema.parse({ name: "Alpina Versicherungen" }),
      );
      await make({ title: "Hausrat", insurerContactId: insurer.id });
      await make({ title: "Kasko", policyNumber: "KA-2026_7" });
      await make({ title: "Reise 100%" });
      const find = (q: string) =>
        titles(listPolicies(ctx(), { q }, page).items);
      expect(find("HAUS")).toEqual(["Hausrat"]);
      expect(find("alpina")).toEqual(["Hausrat"]);
      expect(find("ka-2026")).toEqual(["Kasko"]);
      expect(find("2026_7")).toEqual(["Kasko"]);
      expect(find("2026x7")).toEqual([]);
      expect(find("100%")).toEqual(["Reise 100%"]);
      expect(find("%")).toEqual(["Reise 100%"]);
      expect(find("nichts")).toEqual([]);
    });

    it("keeps archived policies out unless asked for, and then lists only those", async () => {
      const p = await make({ title: "Alt" });
      await make({ title: "Neu" });
      await updatePolicy(ctx(), p.id, { archived: true });
      expect(titles(listPolicies(ctx(), {}, page).items)).toEqual(["Neu"]);
      expect(
        titles(listPolicies(ctx(), { archived: true }, page).items),
      ).toEqual(["Alt"]);
      expect(
        titles(listPolicies(ctx(), { archived: false }, page).items),
      ).toEqual(["Neu"]);
    });

    it("pages", async () => {
      for (const title of ["A", "B", "C"]) await make({ title });
      const first = listPolicies(ctx(), {}, { limit: 2 });
      expect(titles(first.items)).toEqual(["A", "B"]);
      expect(first.nextCursor).toEqual(expect.any(String));
      const second = listPolicies(
        ctx(),
        {},
        { limit: 2, cursor: first.nextCursor! },
      );
      expect(titles(second.items)).toEqual(["C"]);
      expect(second.nextCursor).toBeNull();
    });

    it("lists the policies of one asset and answers 404 for an unknown asset", async () => {
      const kombi = await asset("Kombi");
      await make({ title: "Kasko", assetIds: [kombi.id] });
      await make({ title: "Hausrat" });
      expect(
        titles(listAssetPolicies(ctx(), kombi.id, {}, page).items),
      ).toEqual(["Kasko"]);
      expect(() => listAssetPolicies(ctx(), "nope", {}, page)).toThrow(
        /asset not found/i,
      );
    });
  });

  describe("updating", () => {
    it("changes fields, clears optional ones and replaces the covered assets", async () => {
      const a = await asset("Kombi");
      const b = await asset("Anhänger");
      const p = await make({
        policyNumber: "X-1",
        assistancePhone: "000 000 00 00",
        deductibleMinor: 50_000,
        assetIds: [a.id],
      });
      const updated = await updatePolicy(ctx(), p.id, {
        title: "Neu",
        policyNumber: null,
        assistancePhone: null,
        deductibleMinor: null,
        premiumMinor: 500,
        premiumPeriod: "monthly",
        assetIds: [b.id],
        showOnEmergency: true,
      });
      expect(updated).toMatchObject({
        title: "Neu",
        policyNumber: null,
        assistancePhone: null,
        deductibleMinor: null,
        premiumMinor: 500,
        annualPremiumMinor: 6000,
        showOnEmergency: true,
        assets: [{ id: b.id }],
      });
      expect(
        (await updatePolicy(ctx(), p.id, { assetIds: [] })).assets,
      ).toEqual([]);
    });

    it("leaves the covered assets alone when assetIds is not sent", async () => {
      const a = await asset("Kombi");
      const p = await make({ assetIds: [a.id] });
      expect(
        (await updatePolicy(ctx(), p.id, { title: "X" })).assets,
      ).toHaveLength(1);
    });

    it("checks the end date against the start date that is stored, and against the one sent", async () => {
      const p = await make({ endDate: "2026-12-31" });
      await expect(
        updatePolicy(ctx(), p.id, { endDate: "2025-12-31" }),
      ).rejects.toMatchObject({ code: "invalid_request" });
      await expect(
        updatePolicy(ctx(), p.id, { startDate: "2027-01-01" }),
      ).rejects.toMatchObject({ code: "invalid_request" });
      expect(
        await updatePolicy(ctx(), p.id, {
          startDate: "2027-01-01",
          endDate: "2027-12-31",
        }),
      ).toMatchObject({ startDate: "2027-01-01", endDate: "2027-12-31" });
      expect(await updatePolicy(ctx(), p.id, { endDate: null })).toMatchObject({
        endDate: null,
      });
    });

    it("refuses unknown references and changes nothing", async () => {
      const p = await make({ title: "Bleibt" });
      await expect(
        updatePolicy(ctx(), p.id, { title: "Neu", assetIds: ["nope"] }),
      ).rejects.toMatchObject({ code: "invalid_request" });
      await expect(
        updatePolicy(ctx(), p.id, { insurerContactId: "nope" }),
      ).rejects.toMatchObject({ code: "invalid_request" });
      expect(getPolicy(ctx(), p.id).title).toBe("Bleibt");
    });

    it("answers 404 for an unknown policy", async () => {
      await expect(
        updatePolicy(ctx(), "nope", { title: "x" }),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("archives and restores, keeping the first archive date while archived", async () => {
      const p = await make();
      const archived = await updatePolicy(ctx(1_000_000_000_000), p.id, {
        archived: true,
      });
      expect(archived.archivedAt?.getTime()).toBe(1_000_000_000_000);
      const again = await updatePolicy(ctx(2_000_000_000_000), p.id, {
        archived: true,
      });
      expect(again.archivedAt?.getTime()).toBe(1_000_000_000_000);
      expect(
        (await updatePolicy(ctx(), p.id, { archived: false })).archivedAt,
      ).toBeNull();
    });
  });

  describe("the insurer and the assets it refers to", () => {
    it("keeps the policy when the contact is deleted, without the insurer's name", async () => {
      const insurer = createContact(
        ctx(),
        createContactRequestSchema.parse({ name: "Muster Versicherungen" }),
      );
      const p = await make({ insurerContactId: insurer.id });
      deleteContact(ctx(), insurer.id);
      expect(getPolicy(ctx(), p.id)).toMatchObject({
        insurerContactId: null,
        insurerName: null,
      });
    });

    it("keeps the policy when an asset is deleted, without that asset", async () => {
      const a = await asset("Kombi");
      const b = await asset("Anhänger");
      const p = await make({ assetIds: [a.id, b.id] });
      deleteAsset(ctx(), a.id);
      expect(getPolicy(ctx(), p.id).assets.map((x) => x.name)).toEqual([
        "Anhänger",
      ]);
    });
  });

  describe("comments and attachments", () => {
    it("counts comments", async () => {
      const user = await createTestUser();
      const p = await make();
      await createComment(
        ctx(),
        { id: user.id, role: user.role },
        { entityType: "insurance_policy", entityId: p.id, bodyMd: "Prämie?" },
      );
      expect(getPolicy(ctx(), p.id).commentCount).toBe(1);
    });

    it("takes files as attachments", async () => {
      const p = await make();
      const row = await createAttachment(ctx(), {
        bytes: samplePdf(),
        filename: "police.pdf",
        ownerType: "insurance_policy",
        ownerId: p.id,
        uploadedBy: null,
      });
      expect(row).toMatchObject({
        ownerType: "insurance_policy",
        ownerId: p.id,
      });
      await expect(
        createAttachment(ctx(), {
          bytes: samplePdf(),
          filename: "police.pdf",
          ownerType: "insurance_policy",
          ownerId: "nope",
          uploadedBy: null,
        }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    });
  });

  describe("deleting", () => {
    it("removes the policy with its covered-asset links, comments, attachments and reminder tasks", async () => {
      const user = await createTestUser();
      const a = await asset("Kombi");
      const p = await make({
        assetIds: [a.id],
        endDate: "2026-12-31",
        cancellationNoticeMonths: 3,
      });
      const other = await make({ title: "Bleibt" });
      await createComment(
        ctx(),
        { id: user.id, role: user.role },
        { entityType: "insurance_policy", entityId: p.id, bodyMd: "Hallo" },
      );
      await createAttachment(ctx(), {
        bytes: samplePdf(),
        filename: "police.pdf",
        ownerType: "insurance_policy",
        ownerId: p.id,
        uploadedBy: null,
      });
      expect(p.reminderTaskId).not.toBeNull();
      deletePolicy(ctx(), p.id);
      expect(() => getPolicy(ctx(), p.id)).toThrow(/not found/i);
      expect(test.db.select().from(comments).all()).toEqual([]);
      expect(test.db.select().from(attachments).all()).toEqual([]);
      expect(
        test.db
          .select()
          .from(tasks)
          .where(eq(tasks.externalSource, "insurance"))
          .all(),
      ).toEqual([]);
      expect(getPolicy(ctx(), other.id).title).toBe("Bleibt");
      expect(() => deletePolicy(ctx(), p.id)).toThrow(/not found/i);
      expect(test.db.select().from(insurancePolicies).all()).toHaveLength(1);
    });
  });
});
