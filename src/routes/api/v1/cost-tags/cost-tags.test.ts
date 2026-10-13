import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

interface Tag {
  id: string;
  name: string;
  color: string;
  entryCount: number;
}
interface Cost {
  id: string;
  title: string;
  tags: { id: string; name: string; color: string }[];
}

describe("cost tags API", () => {
  useTestDB();

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const call = createCaller({ session: loginTestUser(anna).token });
    const tag = async (name: string, color?: string) =>
      (await call("POST", "/api/v1/cost-tags", { json: { name, color } }))
        .body as Tag;
    const cost = async (json: object = {}) =>
      (
        await call("POST", "/api/v1/costs", {
          json: {
            title: "Einkauf",
            amountMinor: 1000,
            category: "groceries",
            date: "2026-03-10",
            splitMode: "none",
            ...json,
          },
        })
      ).body as Cost;
    return { anna, call, tag, cost };
  }

  it("creates, lists, reads, changes and deletes a tag", async () => {
    const { call } = await setup();
    const created = await call("POST", "/api/v1/cost-tags", {
      json: { name: "  Ferien  ", color: "blue" },
    });
    expect(created.res.status).toBe(201);
    const tag = created.body as Tag;
    expect(tag).toMatchObject({
      name: "Ferien",
      color: "blue",
      entryCount: 0,
    });
    expect(
      (await call("POST", "/api/v1/cost-tags", { json: { name: "Alt" } })).body,
    ).toMatchObject({ color: "gray" });

    const list = await call("GET", "/api/v1/cost-tags");
    expect(list.res.status).toBe(200);
    expect((list.body as { items: Tag[] }).items.map((t) => t.name)).toEqual([
      "Alt",
      "Ferien",
    ]);
    expect(
      ((await call("GET", `/api/v1/cost-tags/${tag.id}`)).body as Tag).name,
    ).toBe("Ferien");

    const patched = await call("PATCH", `/api/v1/cost-tags/${tag.id}`, {
      json: { name: "Sommerferien", color: "teal" },
    });
    expect(patched.body).toMatchObject({
      name: "Sommerferien",
      color: "teal",
    });

    expect(
      (await call("DELETE", `/api/v1/cost-tags/${tag.id}`)).res.status,
    ).toBe(204);
    expect((await call("GET", `/api/v1/cost-tags/${tag.id}`)).res.status).toBe(
      404,
    );
    expect(
      (await call("DELETE", `/api/v1/cost-tags/${tag.id}`)).res.status,
    ).toBe(404);
    expect(
      (
        await call("PATCH", `/api/v1/cost-tags/${tag.id}`, {
          json: { name: "x" },
        })
      ).res.status,
    ).toBe(404);
  });

  it("refuses a name that is taken, whatever the case, and bad input", async () => {
    const { call, tag } = await setup();
    const a = await tag("Ferien");
    const dup = await call("POST", "/api/v1/cost-tags", {
      json: { name: "FERIEN" },
    });
    expect(dup.res.status).toBe(409);
    expect(errorCode(dup)).toBe("conflict");
    const other = await tag("Steuern");
    const rename = await call("PATCH", `/api/v1/cost-tags/${other.id}`, {
      json: { name: "ferien" },
    });
    expect(rename.res.status).toBe(409);
    for (const json of [
      { name: "" },
      { name: "   " },
      { name: "x".repeat(41) },
      { name: "A", color: "chartreuse" },
      { name: "A", extra: true },
    ]) {
      const r = await call("POST", "/api/v1/cost-tags", { json });
      expect(r.res.status, JSON.stringify(json)).toBe(400);
    }
    expect(
      (await call("PATCH", `/api/v1/cost-tags/${a.id}`, { json: {} })).res
        .status,
    ).toBe(400);
  });

  it("puts tags on entries, shows them, and counts them", async () => {
    const { call, tag, cost } = await setup();
    const ferien = await tag("Ferien", "blue");
    const steuern = await tag("Steuern");
    const e = await cost({ tagIds: [steuern.id, ferien.id] });
    expect(e.tags).toEqual([
      { id: ferien.id, name: "Ferien", color: "blue" },
      { id: steuern.id, name: "Steuern", color: "gray" },
    ]);
    expect(
      ((await call("GET", `/api/v1/costs/${e.id}`)).body as Cost).tags,
    ).toHaveLength(2);

    const only = await call("PATCH", `/api/v1/costs/${e.id}`, {
      json: { tagIds: [ferien.id] },
    });
    expect((only.body as Cost).tags.map((t) => t.name)).toEqual(["Ferien"]);
    expect(
      ((await call("GET", `/api/v1/cost-tags/${ferien.id}`)).body as Tag)
        .entryCount,
    ).toBe(1);
    expect(
      ((await call("GET", `/api/v1/cost-tags/${steuern.id}`)).body as Tag)
        .entryCount,
    ).toBe(0);

    const cleared = await call("PATCH", `/api/v1/costs/${e.id}`, {
      json: { tagIds: [] },
    });
    expect((cleared.body as Cost).tags).toEqual([]);
  });

  it("refuses an unknown tag or too many on an entry", async () => {
    const { call, tag, cost } = await setup();
    const a = await tag("A");
    const e = await cost({ tagIds: [a.id] });
    const unknown = await call("POST", "/api/v1/costs", {
      json: {
        title: "x",
        amountMinor: 1,
        category: "other",
        tagIds: ["nope"],
      },
    });
    expect(unknown.res.status).toBe(400);
    expect(JSON.stringify(unknown.body)).toContain("tagIds");
    const patch = await call("PATCH", `/api/v1/costs/${e.id}`, {
      json: { tagIds: ["nope"] },
    });
    expect(patch.res.status).toBe(400);
    const many = await call("PATCH", `/api/v1/costs/${e.id}`, {
      json: { tagIds: Array.from({ length: 11 }, (_, i) => `t${i}`) },
    });
    expect(many.res.status).toBe(400);
  });

  it("filters the list, the summary and the CSV by tag", async () => {
    const { call, tag, cost } = await setup();
    const a = await tag("A");
    const withTag = await cost({
      title: "Mit",
      tagIds: [a.id],
      amountMinor: 700,
    });
    await cost({ title: "Ohne", amountMinor: 300 });

    const list = await call("GET", `/api/v1/costs?tagId=${a.id}`);
    expect((list.body as { items: Cost[] }).items.map((c) => c.id)).toEqual([
      withTag.id,
    ]);
    const missing = await call("GET", "/api/v1/costs?tagId=nope");
    expect(missing.res.status).toBe(404);

    const summary = await call(
      "GET",
      `/api/v1/costs/summary?year=2026&tagId=${a.id}`,
    );
    expect(summary.body).toMatchObject({ expenseTotalMinor: 700 });
    expect(
      (await call("GET", "/api/v1/costs/summary?year=2026&tagId=nope")).res
        .status,
    ).toBe(404);

    const csv = await call(
      "GET",
      `/api/v1/costs/export.csv?year=2026&tagId=${a.id}`,
    );
    expect(csv.res.status).toBe(200);
    const text = csv.body as string;
    expect(text).toContain("Mit");
    expect(text).not.toContain("Ohne");
    expect(text.split("\r\n")[0]).toMatch(/;book;tags$/);
    expect(
      (await call("GET", "/api/v1/costs/export.csv?year=2026&tagId=nope")).res
        .status,
    ).toBe(404);
  });

  it("needs costs:write to change tags and read to see them", async () => {
    const { anna, call } = await setup();
    const readOnly = createCaller({
      bearer: createTestToken(anna, { scopes: ["read"] }).token,
    });
    expect(
      (await readOnly("POST", "/api/v1/cost-tags", { json: { name: "A" } })).res
        .status,
    ).toBe(403);
    const made = await call("POST", "/api/v1/cost-tags", {
      json: { name: "A" },
    });
    expect((await readOnly("GET", "/api/v1/cost-tags")).res.status).toBe(200);
    expect(
      (await readOnly("DELETE", `/api/v1/cost-tags/${(made.body as Tag).id}`))
        .res.status,
    ).toBe(403);
  });
});
