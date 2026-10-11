import { describe, expect, it } from "vitest";
import { createApiClient } from "../../src/lib/api/client";
import { endpoints } from "../../src/lib/api/registry";
import { createInProcessFetch } from "../../src/lib/testing/api";
import { addDays } from "../../src/lib/dates";
import { useMcp } from "./test-harness";

/** A client for setting up records that have no MCP tool (policies, contacts). */
const setup = (token: string) =>
  createApiClient(createInProcessFetch({ bearer: token }), "http://localhost", {
    token,
  });

describe("insurance policy tools", () => {
  const mcp = useMcp();

  async function world(scopes: ("read" | "write")[] = ["read", "write"]) {
    const connected = await mcp.connect({ scopes });
    const api = setup(connected.token);
    const policy = (body: object) =>
      api.call(endpoints.insurancePoliciesCreate, {
        body: {
          title: "Hausrat",
          premiumMinor: 48_000,
          startDate: addDays(connected.today, -100),
          ...body,
        } as never,
      });
    return { ...connected, api, policy };
  }

  it("lists policies by cancellation deadline with the premium of a year", async () => {
    const { ok, policy, today } = await world();
    await policy({ title: "Reise", type: "travel" });
    await policy({
      title: "Kasko",
      type: "motor_full_casco",
      premiumMinor: 12_500,
      premiumPeriod: "quarterly",
      endDate: addDays(today, 400),
      cancellationNoticeMonths: 3,
    });
    const list = await ok("list_insurance_policies");
    expect(list.policies.map((p: { title: string }) => p.title)).toEqual([
      "Kasko",
      "Reise",
    ]);
    expect(list.policies[0]).toMatchObject({
      type: "motor_full_casco",
      premiumMinor: 12_500,
      premiumPeriod: "quarterly",
      annualPremiumMinor: 50_000,
      currency: "CHF",
      renewal: "auto",
      noticeMonths: 3,
      cancellationDeadline: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(list.policies[1].cancellationDeadline).toBeUndefined();
  });

  it("filters by the asset it covers (given by name), the type, a text and archived", async () => {
    const { ok, api, policy } = await world();
    await ok("create_asset", { name: "Kombi" });
    const asset = await ok("get_asset", { asset: "Kombi" });
    await policy({
      title: "Kasko",
      type: "motor_full_casco",
      assetIds: [asset.id],
    });
    await policy({ title: "Hausrat", policyNumber: "HR-77" });
    const old = await policy({ title: "Alt" });
    await api.call(endpoints.insurancePoliciesUpdate, {
      params: { id: old.id },
      body: { archived: true },
    });
    const titles = async (args: Record<string, unknown>) =>
      (await ok("list_insurance_policies", args)).policies.map(
        (p: { title: string }) => p.title,
      );
    expect(await titles({ asset: "kombi" })).toEqual(["Kasko"]);
    expect(await titles({ type: "motor_full_casco" })).toEqual(["Kasko"]);
    expect(await titles({ q: "hr-77" })).toEqual(["Hausrat"]);
    expect(await titles({ archived: true })).toEqual(["Alt"]);
    expect(await titles({})).toEqual(["Hausrat", "Kasko"]);
  });

  it("reads one policy by id, title or policy number, with what it covers and its notes", async () => {
    const { ok, call, policy } = await world();
    await ok("create_asset", { name: "Kombi" });
    const asset = await ok("get_asset", { asset: "Kombi" });
    const created = await policy({
      title: "Kasko Kombi",
      policyNumber: "POL-2026-0042",
      assistancePhone: "000 000 00 00",
      deductibleMinor: 100_000,
      notes: "Europaweit gültig",
      showOnEmergency: true,
      assetIds: [asset.id],
    });
    await policy({ title: "Kasko Anhänger" });
    for (const ref of [created.id, "Kasko Kombi", "pol-2026-0042"]) {
      const one = await ok("get_insurance_policy", { policy: ref });
      expect(one, ref).toMatchObject({
        id: created.id,
        title: "Kasko Kombi",
        policyNumber: "POL-2026-0042",
        assistancePhone: "000 000 00 00",
        deductibleMinor: 100_000,
        notes: "Europaweit gültig",
        showOnEmergency: true,
        assets: ["Kombi"],
      });
    }
    const ambiguous = await call("get_insurance_policy", { policy: "Kasko" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain("ambiguous");
    expect(ambiguous.text).toContain("Kasko Anhänger");
    const missing = await call("get_insurance_policy", { policy: "Nope" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("[not_found]");
  });

  it("finds an archived policy by its title", async () => {
    const { ok, api, policy } = await world();
    const old = await policy({ title: "Alte Haftpflicht" });
    await api.call(endpoints.insurancePoliciesUpdate, {
      params: { id: old.id },
      body: { archived: true },
    });
    expect(
      await ok("get_insurance_policy", { policy: "Alte Haftpflicht" }),
    ).toMatchObject({ id: old.id, archived: true });
  });

  it("is available with a read-only token", async () => {
    const { client } = await mcp.connect({ scopes: ["read"] });
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_insurance_policies");
    expect(names).toContain("get_insurance_policy");
  });
});
