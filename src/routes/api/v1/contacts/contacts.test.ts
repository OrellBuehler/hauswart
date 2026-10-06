import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

type Contact = { id: string; name: string; kind: string; emergency: boolean };
type Link = { id: string; role: string; contactId: string; contact: Contact };

describe("contacts API", () => {
  useTestDB();
  async function member() {
    const user = await createTestUser();
    return createCaller({ session: loginTestUser(user).token });
  }

  it("creates, reads, updates and deletes a contact", async () => {
    const call = await member();
    const created = await call("POST", "/api/v1/contacts", {
      json: {
        name: "Muster Sanitär AG",
        kind: "installer",
        phone: "044 000 00 00",
        url: "https://example.org",
        emergency: true,
      },
    });
    expect(created.res.status).toBe(201);
    const c = created.body as Contact;
    expect(created.body).toMatchObject({
      kind: "installer",
      emergency: true,
      guestVisible: false,
      externalSource: null,
    });
    expect((await call("GET", `/api/v1/contacts/${c.id}`)).body).toEqual({
      ...c,
      assets: [],
    });
    const patched = await call("PATCH", `/api/v1/contacts/${c.id}`, {
      json: { phone: null, notes: "Notfall" },
    });
    expect(patched.body).toMatchObject({ phone: null, notes: "Notfall" });
    expect((await call("DELETE", `/api/v1/contacts/${c.id}`)).res.status).toBe(
      204,
    );
    expect(errorCode(await call("GET", `/api/v1/contacts/${c.id}`))).toBe(
      "not_found",
    );
  });

  it("validates input", async () => {
    const call = await member();
    for (const json of [
      {},
      { name: "" },
      { name: "x", kind: "nope" },
      { name: "x", url: "javascript:alert(1)" },
      { name: "x", email: "kein-mail" },
      { name: "x", surprise: 1 },
      { name: "x", externalSource: "crm" },
    ]) {
      const r = await call("POST", "/api/v1/contacts", { json });
      expect([r.res.status, errorCode(r)], JSON.stringify(json)).toEqual([
        400,
        "invalid_request",
      ]);
    }
    const c = (await call("POST", "/api/v1/contacts", { json: { name: "x" } }))
      .body as Contact;
    expect(
      errorCode(await call("PATCH", `/api/v1/contacts/${c.id}`, { json: {} })),
    ).toBe("invalid_request");
    expect(
      errorCode(
        await call("PATCH", "/api/v1/contacts/nope", { json: { name: "y" } }),
      ),
    ).toBe("not_found");
    expect(errorCode(await call("DELETE", "/api/v1/contacts/nope"))).toBe(
      "not_found",
    );
  });

  it("answers 409 for a duplicate external reference", async () => {
    const call = await member();
    const json = { name: "a", externalSource: "crm", externalRef: "7" };
    expect((await call("POST", "/api/v1/contacts", { json })).res.status).toBe(
      201,
    );
    const r = await call("POST", "/api/v1/contacts", {
      json: { ...json, name: "b" },
    });
    expect([r.res.status, errorCode(r)]).toEqual([409, "conflict"]);
  });

  it("searches and filters the list and pages it", async () => {
    const call = await member();
    for (const json of [
      { name: "Alpha", kind: "emergency", emergency: true },
      { name: "Beta", company: "Hauswart GmbH" },
      { name: "Gamma", kind: "insurance" },
    ])
      await call("POST", "/api/v1/contacts", { json });
    const names = async (qs: string) =>
      (
        (await call("GET", `/api/v1/contacts${qs}`)).body as {
          items: Contact[];
        }
      ).items.map((c) => c.name);
    expect(await names("")).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(await names("?kind=insurance")).toEqual(["Gamma"]);
    expect(await names("?emergency=true")).toEqual(["Alpha"]);
    expect(await names("?emergency=false")).toEqual(["Beta", "Gamma"]);
    expect(await names("?q=hauswart")).toEqual(["Beta"]);
    const page = (await call("GET", "/api/v1/contacts?limit=2")).body as {
      items: Contact[];
      nextCursor: string;
    };
    expect(page.items).toHaveLength(2);
    const next = (
      await call("GET", `/api/v1/contacts?limit=2&cursor=${page.nextCursor}`)
    ).body as { items: Contact[]; nextCursor: null };
    expect([next.items.length, next.nextCursor]).toEqual([1, null]);
    expect(errorCode(await call("GET", "/api/v1/contacts?kind=nope"))).toBe(
      "invalid_request",
    );
    expect(
      errorCode(await call("GET", "/api/v1/contacts?cursor=garbage")),
    ).toBe("invalid_request");
  });

  it("links contacts to assets, lists them and unlinks", async () => {
    const call = await member();
    const asset = (
      await call("POST", "/api/v1/assets", { json: { name: "Boiler" } })
    ).body as { id: string };
    const c = (
      await call("POST", "/api/v1/contacts", { json: { name: "Muster AG" } })
    ).body as Contact;
    const linked = await call("POST", `/api/v1/assets/${asset.id}/contacts`, {
      json: { contactId: c.id, role: "installer" },
    });
    expect(linked.res.status).toBe(201);
    const link = linked.body as Link;
    expect(link).toMatchObject({
      role: "installer",
      contactId: c.id,
      contact: { name: "Muster AG" },
    });
    expect(
      errorCode(
        await call("POST", `/api/v1/assets/${asset.id}/contacts`, {
          json: { contactId: c.id, role: "installer" },
        }),
      ),
    ).toBe("conflict");
    expect(
      (
        await call("POST", `/api/v1/assets/${asset.id}/contacts`, {
          json: { contactId: c.id },
        })
      ).body,
    ).toMatchObject({ role: "other" });
    const list = (await call("GET", `/api/v1/assets/${asset.id}/contacts`))
      .body as { items: Link[] };
    expect(list.items).toHaveLength(2);
    expect(
      (await call("DELETE", `/api/v1/assets/${asset.id}/contacts/${link.id}`))
        .res.status,
    ).toBe(204);
    expect(
      errorCode(
        await call("DELETE", `/api/v1/assets/${asset.id}/contacts/${link.id}`),
      ),
    ).toBe("not_found");
    expect(errorCode(await call("GET", "/api/v1/assets/nope/contacts"))).toBe(
      "not_found",
    );
    expect(
      errorCode(
        await call("POST", "/api/v1/assets/nope/contacts", {
          json: { contactId: c.id },
        }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(
        await call("POST", `/api/v1/assets/${asset.id}/contacts`, {
          json: { contactId: "nope" },
        }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(
        await call("POST", `/api/v1/assets/${asset.id}/contacts`, {
          json: { contactId: c.id, role: "boss" },
        }),
      ),
    ).toBe("invalid_request");
  });

  it("is shared by all users and needs the right scopes", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const callA = createCaller({ session: loginTestUser(a).token });
    const c = (
      await callA("POST", "/api/v1/contacts", { json: { name: "geteilt" } })
    ).body as Contact;
    const callB = createCaller({ session: loginTestUser(b).token });
    expect((await callB("GET", `/api/v1/contacts/${c.id}`)).res.status).toBe(
      200,
    );
    const reader = createCaller({
      bearer: createTestToken(a, { scopes: ["read"] }).token,
    });
    expect((await reader("GET", "/api/v1/contacts")).res.status).toBe(200);
    expect(
      (await reader("POST", "/api/v1/contacts", { json: { name: "x" } })).res
        .status,
    ).toBe(403);
  });
});
