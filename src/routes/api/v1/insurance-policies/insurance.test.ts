import { describe, expect, it } from "vitest";
import { cancellationDeadline } from "$lib/insurance/policy";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";
import { samplePdf, useTestFilesDir } from "$lib/testing/files";

type Policy = {
  id: string;
  title: string;
  type: string;
  insurerName: string | null;
  premiumMinor: number;
  currency: string;
  premiumPeriod: string;
  annualPremiumMinor: number;
  deductibleMinor: number | null;
  startDate: string;
  endDate: string | null;
  renewal: string;
  cancellationNoticeMonths: number | null;
  cancellationDeadline: string | null;
  assets: { id: string; name: string; kind: string }[];
  reminderTaskId: string | null;
  commentCount: number;
  archivedAt: string | null;
};
type List = { items: Policy[]; nextCursor: string | null };

describe("insurance policies API", () => {
  useTestDB();
  useTestFilesDir();

  async function setup() {
    const user = await createTestUser({ displayName: "Anna" });
    const call = createCaller({ session: loginTestUser(user).token });
    const policy = async (json: object = {}) =>
      (
        await call("POST", "/api/v1/insurance-policies", {
          json: {
            title: "Hausrat Muster",
            premiumMinor: 48_000,
            startDate: "2026-01-01",
            ...json,
          },
        })
      ).body as Policy;
    const asset = async (name = "Kombi") =>
      (await call("POST", "/api/v1/assets", { json: { name } })).body as {
        id: string;
      };
    return { user, call, policy, asset };
  }

  it("creates, reads, updates and deletes a policy", async () => {
    const { call, asset } = await setup();
    const kombi = await asset();
    const insurer = (
      await call("POST", "/api/v1/contacts", {
        json: { name: "Muster Versicherungen", kind: "insurance" },
      })
    ).body as { id: string };
    const created = await call("POST", "/api/v1/insurance-policies", {
      json: {
        title: "Kasko Kombi",
        type: "motor_full_casco",
        insurerContactId: insurer.id,
        policyNumber: "POL-2026-0042",
        premiumMinor: 12_500,
        premiumPeriod: "quarterly",
        deductibleMinor: 100_000,
        startDate: today(-60),
        endDate: today(300),
        renewal: "auto",
        cancellationNoticeMonths: 3,
        assistancePhone: "0800 555 000",
        showOnEmergency: true,
        notes: "Europaweit",
        assetIds: [kombi.id],
      },
    });
    expect(created.res.status).toBe(201);
    const p = created.body as Policy;
    expect(p).toMatchObject({
      title: "Kasko Kombi",
      type: "motor_full_casco",
      insurerName: "Muster Versicherungen",
      premiumMinor: 12_500,
      currency: "CHF",
      annualPremiumMinor: 50_000,
      deductibleMinor: 100_000,
      cancellationDeadline: cancellationDeadline({
        renewal: "auto",
        endDate: today(300),
        cancellationNoticeMonths: 3,
      }),
      assets: [{ id: kombi.id, name: "Kombi", kind: "device" }],
      commentCount: 0,
      archivedAt: null,
    });
    expect(p.reminderTaskId).toEqual(expect.any(String));
    expect(
      (await call("GET", `/api/v1/insurance-policies/${p.id}`)).body,
    ).toEqual(p);

    const patched = await call("PATCH", `/api/v1/insurance-policies/${p.id}`, {
      json: {
        premiumMinor: 4_000,
        premiumPeriod: "monthly",
        endDate: null,
        assistancePhone: null,
        assetIds: [],
      },
    });
    expect(patched.body).toMatchObject({
      annualPremiumMinor: 48_000,
      endDate: null,
      cancellationDeadline: null,
      assistancePhone: null,
      assets: [],
      reminderTaskId: null,
    });

    expect(
      (await call("DELETE", `/api/v1/insurance-policies/${p.id}`)).res.status,
    ).toBe(204);
    expect(
      errorCode(await call("GET", `/api/v1/insurance-policies/${p.id}`)),
    ).toBe("not_found");
    expect(
      (
        (await call("GET", "/api/v1/tasks?externalSource=insurance")).body as {
          items: { archivedAt: string | null }[];
        }
      ).items,
    ).toEqual([]);
  });

  it("validates input and answers 404", async () => {
    const { call, policy } = await setup();
    for (const json of [
      {},
      { title: "x" },
      { title: "x", premiumMinor: 1 },
      { title: "", premiumMinor: 1, startDate: "2026-01-01" },
      { title: "x", premiumMinor: -1, startDate: "2026-01-01" },
      { title: "x", premiumMinor: 1.5, startDate: "2026-01-01" },
      { title: "x", premiumMinor: 1, startDate: "2026-01-01", type: "pet" },
      {
        title: "x",
        premiumMinor: 1,
        startDate: "2026-01-01",
        endDate: "2025-01-01",
      },
      {
        title: "x",
        premiumMinor: 1,
        startDate: "2026-01-01",
        cancellationNoticeMonths: -1,
      },
      { title: "x", premiumMinor: 1, startDate: "2026-01-01", currency: "chf" },
      {
        title: "x",
        premiumMinor: 1,
        startDate: "2026-01-01",
        insurerContactId: "nope",
      },
      {
        title: "x",
        premiumMinor: 1,
        startDate: "2026-01-01",
        assetIds: ["nope"],
      },
      {
        title: "x",
        premiumMinor: 1,
        startDate: "2026-01-01",
        cancellationDeadline: "2026-09-30",
      },
    ]) {
      const r = await call("POST", "/api/v1/insurance-policies", { json });
      expect([r.res.status, errorCode(r)], JSON.stringify(json)).toEqual([
        400,
        "invalid_request",
      ]);
    }
    const p = await policy({ startDate: today(-60), endDate: today(300) });
    for (const json of [
      {},
      { type: "pet" },
      { endDate: today(-61) },
      { startDate: today(301) },
      { archived: "yes" },
      { assetIds: ["nope"] },
    ]) {
      expect(
        errorCode(
          await call("PATCH", `/api/v1/insurance-policies/${p.id}`, { json }),
        ),
        JSON.stringify(json),
      ).toBe("invalid_request");
    }
    expect(
      errorCode(
        await call("PATCH", "/api/v1/insurance-policies/nope", {
          json: { title: "x" },
        }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(await call("GET", "/api/v1/insurance-policies/nope")),
    ).toBe("not_found");
    expect(
      errorCode(await call("DELETE", "/api/v1/insurance-policies/nope")),
    ).toBe("not_found");
    expect(
      errorCode(await call("GET", "/api/v1/insurance-policies?type=pet")),
    ).toBe("invalid_request");
  });

  it("lists with filters for the covered asset, the type and archived", async () => {
    const { call, policy, asset } = await setup();
    const kombi = await asset("Kombi");
    const boiler = await asset("Boiler");
    await policy({
      title: "Kasko",
      type: "motor_full_casco",
      assetIds: [kombi.id],
    });
    await policy({ title: "Hausrat", type: "household" });
    const old = await policy({ title: "Alt", assetIds: [boiler.id] });
    await call("PATCH", `/api/v1/insurance-policies/${old.id}`, {
      json: { archived: true },
    });
    const titles = async (query: string) =>
      (
        (await call("GET", `/api/v1/insurance-policies${query}`)).body as List
      ).items.map((p) => p.title);
    expect(await titles("")).toEqual(["Hausrat", "Kasko"]);
    expect(await titles(`?assetId=${kombi.id}`)).toEqual(["Kasko"]);
    expect(await titles("?type=household")).toEqual(["Hausrat"]);
    expect(await titles("?q=kas")).toEqual(["Kasko"]);
    expect(await titles("?q=kas&type=household")).toEqual([]);
    expect(await titles("?archived=true")).toEqual(["Alt"]);
    expect(await titles("?archived=false")).toEqual(["Hausrat", "Kasko"]);
    expect(await titles(`?archived=true&assetId=${boiler.id}`)).toEqual([
      "Alt",
    ]);
    expect(await titles(`?assetId=${boiler.id}`)).toEqual([]);
    const all = (await call("GET", "/api/v1/insurance-policies")).body as List;
    const page = (await call("GET", "/api/v1/insurance-policies?limit=1"))
      .body as List;
    expect(page.items.map((p) => p.id)).toEqual([all.items[0].id]);
    expect(page.nextCursor).toEqual(expect.any(String));
    const next = (
      await call(
        "GET",
        `/api/v1/insurance-policies?limit=1&cursor=${page.nextCursor}`,
      )
    ).body as List;
    expect(next.items.map((p) => p.id)).toEqual([all.items[1].id]);
    expect(next.nextCursor).toBeNull();
  });

  it("lists the policies that cover an asset on the asset's own path", async () => {
    const { call, policy, asset } = await setup();
    const kombi = await asset("Kombi");
    await policy({ title: "Kasko", assetIds: [kombi.id] });
    await policy({ title: "Hausrat" });
    const archived = await policy({ title: "Alt", assetIds: [kombi.id] });
    await call("PATCH", `/api/v1/insurance-policies/${archived.id}`, {
      json: { archived: true },
    });
    const titles = async (query = "") =>
      (
        (
          await call(
            "GET",
            `/api/v1/assets/${kombi.id}/insurance-policies${query}`,
          )
        ).body as List
      ).items.map((p) => p.title);
    expect(await titles()).toEqual(["Kasko"]);
    expect(await titles("?archived=true")).toEqual(["Alt"]);
    expect(
      errorCode(await call("GET", "/api/v1/assets/nope/insurance-policies")),
    ).toBe("not_found");
  });

  it("keeps a deleted insurer or asset out of the policy without deleting the policy", async () => {
    const { call, policy, asset } = await setup();
    const kombi = await asset();
    const insurer = (
      await call("POST", "/api/v1/contacts", { json: { name: "Muster AG" } })
    ).body as { id: string };
    const p = await policy({
      insurerContactId: insurer.id,
      assetIds: [kombi.id],
    });
    await call("DELETE", `/api/v1/contacts/${insurer.id}`);
    await call("DELETE", `/api/v1/assets/${kombi.id}`);
    expect(
      (await call("GET", `/api/v1/insurance-policies/${p.id}`)).body,
    ).toMatchObject({ insurerContactId: null, insurerName: null, assets: [] });
  });

  it("is a kind of thing with comments, attachments and a search hit", async () => {
    const { call, policy } = await setup();
    const p = await policy({ policyNumber: "POL-2026-0042" });
    const comment = await call("POST", "/api/v1/comments", {
      json: {
        entityType: "insurance_policy",
        entityId: p.id,
        bodyMd: "Prämie prüfen",
      },
    });
    expect(comment.res.status).toBe(201);
    expect(
      (
        (
          await call(
            "GET",
            `/api/v1/comments?entityType=insurance_policy&entityId=${p.id}`,
          )
        ).body as { items: unknown[] }
      ).items,
    ).toHaveLength(1);
    expect(
      (await call("GET", `/api/v1/insurance-policies/${p.id}`)).body,
    ).toMatchObject({ commentCount: 1 });

    const upload = await call("POST", "/api/v1/attachments", {
      form: {
        file: new File([samplePdf() as BlobPart], "police.pdf", {
          type: "application/pdf",
        }),
        ownerType: "insurance_policy",
        ownerId: p.id,
      },
    });
    expect(upload.res.status).toBe(201);
    expect(
      (
        (
          await call(
            "GET",
            `/api/v1/attachments?ownerType=insurance_policy&ownerId=${p.id}`,
          )
        ).body as { items: unknown[] }
      ).items,
    ).toHaveLength(1);

    const hits = (await call("GET", "/api/v1/search?q=POL-2026-0042")).body as {
      items: { type: string; id: string; url: string }[];
    };
    expect(hits.items).toEqual([
      expect.objectContaining({
        type: "insurance_policy",
        id: p.id,
        url: `/insurance/${p.id}`,
      }),
    ]);

    await call("DELETE", `/api/v1/insurance-policies/${p.id}`);
    expect(
      errorCode(
        await call(
          "GET",
          `/api/v1/comments?entityType=insurance_policy&entityId=${p.id}`,
        ),
      ),
    ).toBe("not_found");
    expect(
      (
        (
          await call(
            "GET",
            `/api/v1/attachments?ownerType=insurance_policy&ownerId=${p.id}`,
          )
        ).body as { items: unknown[] }
      ).items,
    ).toEqual([]);
    expect(
      (
        (await call("GET", "/api/v1/search?q=POL-2026-0042")).body as {
          items: unknown[];
        }
      ).items,
    ).toEqual([]);
  });

  it("is shared by every member, and tokens need the read scope to look and the write scope to change", async () => {
    const { user, call, policy } = await setup();
    const p = await policy();
    const other = await createTestUser({ username: "ben" });
    const asBen = createCaller({ session: loginTestUser(other).token });
    expect(
      (await asBen("GET", `/api/v1/insurance-policies/${p.id}`)).res.status,
    ).toBe(200);
    expect(
      (
        await asBen("PATCH", `/api/v1/insurance-policies/${p.id}`, {
          json: { title: "Von Ben" },
        })
      ).res.status,
    ).toBe(200);
    expect(
      ((await call("GET", `/api/v1/insurance-policies/${p.id}`)).body as Policy)
        .title,
    ).toBe("Von Ben");

    const reader = createCaller({
      bearer: createTestToken(user, { scopes: ["read"] }).token,
    });
    expect(
      (await reader("GET", `/api/v1/insurance-policies/${p.id}`)).res.status,
    ).toBe(200);
    const denied = await reader("PATCH", `/api/v1/insurance-policies/${p.id}`, {
      json: { title: "Nein" },
    });
    expect([denied.res.status, errorCode(denied)]).toEqual([403, "forbidden"]);
    const writer = createCaller({
      bearer: createTestToken(user, { scopes: ["write"] }).token,
    });
    expect(
      errorCode(await writer("GET", `/api/v1/insurance-policies/${p.id}`)),
    ).toBe("forbidden");
  });
});
