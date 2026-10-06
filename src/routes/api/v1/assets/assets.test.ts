import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import { createTestUser, loginTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

describe("assets API", () => {
  useTestDB();
  async function member() {
    const user = await createTestUser();
    return createCaller({ session: loginTestUser(user).token });
  }
  type Asset = { id: string; qrSlug: string; slug: string; name: string };

  it("creates a device with defaults and a QR slug", async () => {
    const call = await member();
    const r = await call("POST", "/api/v1/assets", {
      json: { name: "Waschmaschine" },
    });
    expect(r.res.status).toBe(201);
    expect(r.body).toMatchObject({
      kind: "device",
      name: "Waschmaschine",
      slug: "waschmaschine",
      roomId: null,
      roomName: null,
      showOnEmergency: false,
      archivedAt: null,
    });
    expect((r.body as Asset).qrSlug).toMatch(/^[a-z2-7]{10}$/);
  });

  it("creates a plant in a room with all fields", async () => {
    const call = await member();
    const room = (
      await call("POST", "/api/v1/rooms", { json: { name: "Wohnzimmer" } })
    ).body as { id: string };
    const r = await call("POST", "/api/v1/assets", {
      json: {
        kind: "plant",
        name: "Monstera",
        roomId: room.id,
        species: "Monstera deliciosa",
        light: "hell, indirekt",
        waterNotes: "alle 7 Tage",
        purchaseDate: "2026-04-10",
        warrantyUntil: "2028-04-10",
        showOnEmergency: true,
        notes: "# Pflege\n\nNicht in die Sonne.",
      },
    });
    expect(r.body).toMatchObject({
      kind: "plant",
      roomName: "Wohnzimmer",
      species: "Monstera deliciosa",
      purchaseDate: "2026-04-10",
      showOnEmergency: true,
    });
  });

  it("reads by id and by QR slug, updates, archives and deletes", async () => {
    const call = await member();
    const a = (
      await call("POST", "/api/v1/assets", { json: { name: "Backofen" } })
    ).body as Asset;
    expect((await call("GET", `/api/v1/assets/${a.id}`)).body).toEqual(a);
    expect(
      (await call("GET", `/api/v1/assets/by-qr/${a.qrSlug}`)).body,
    ).toEqual(a);
    expect(
      (
        await call("PATCH", `/api/v1/assets/${a.id}`, {
          json: { manufacturer: "Muster AG", model: null },
        })
      ).body,
    ).toMatchObject({ manufacturer: "Muster AG", model: null });

    const archived = await call("PATCH", `/api/v1/assets/${a.id}`, {
      json: { archived: true },
    });
    expect((archived.body as { archivedAt: string }).archivedAt).toMatch(/Z$/);
    expect(
      ((await call("GET", "/api/v1/assets")).body as { items: unknown[] })
        .items,
    ).toHaveLength(0);
    expect(
      (
        (await call("GET", "/api/v1/assets?includeArchived=true")).body as {
          items: unknown[];
        }
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await call("PATCH", `/api/v1/assets/${a.id}`, {
          json: { archived: false },
        })
      ).body,
    ).toMatchObject({ archivedAt: null });

    expect((await call("DELETE", `/api/v1/assets/${a.id}`)).res.status).toBe(
      204,
    );
    expect(errorCode(await call("GET", `/api/v1/assets/${a.id}`))).toBe(
      "not_found",
    );
  });

  it("filters and pages the list", async () => {
    const call = await member();
    const room = (
      await call("POST", "/api/v1/rooms", { json: { name: "Keller" } })
    ).body as { id: string };
    await call("POST", "/api/v1/assets", {
      json: { name: "Heizung", roomId: room.id, manufacturer: "Muster" },
    });
    await call("POST", "/api/v1/assets", {
      json: { name: "Ficus", kind: "plant" },
    });
    await call("POST", "/api/v1/assets", {
      json: { name: "Tiefkühler", roomId: room.id },
    });
    const names = async (q: string) =>
      (
        (await call("GET", `/api/v1/assets${q}`)).body as { items: Asset[] }
      ).items.map((a) => a.name);
    expect(await names("")).toEqual(["Ficus", "Heizung", "Tiefkühler"]);
    expect(await names("?kind=plant")).toEqual(["Ficus"]);
    expect(await names(`?roomId=${room.id}`)).toEqual([
      "Heizung",
      "Tiefkühler",
    ]);
    expect(await names("?q=muster")).toEqual(["Heizung"]);
    const page = (await call("GET", "/api/v1/assets?limit=2")).body as {
      items: Asset[];
      nextCursor: string;
    };
    expect(page.items).toHaveLength(2);
    const rest = (
      await call("GET", `/api/v1/assets?limit=2&cursor=${page.nextCursor}`)
    ).body as { items: Asset[]; nextCursor: null };
    expect(rest.items.map((a) => a.name)).toEqual(["Tiefkühler"]);
    expect(rest.nextCursor).toBeNull();
  });

  it("validates input", async () => {
    const call = await member();
    for (const json of [
      {},
      { name: "x", kind: "spaceship" },
      { name: "x", purchaseDate: "10.04.2026" },
      { name: "x", extra: true },
      { name: "x", showOnEmergency: "yes" },
    ]) {
      const r = await call("POST", "/api/v1/assets", { json });
      expect([r.res.status, errorCode(r)]).toEqual([400, "invalid_request"]);
    }
    expect((await call("GET", "/api/v1/assets?kind=nope")).res.status).toBe(
      400,
    );
    expect(
      (await call("GET", "/api/v1/assets?includeArchived=maybe")).res.status,
    ).toBe(400);
    expect(
      (await call("GET", "/api/v1/assets/by-qr/NOT-VALID")).res.status,
    ).toBe(400);
    const a = (await call("POST", "/api/v1/assets", { json: { name: "x" } }))
      .body as Asset;
    expect(
      (await call("PATCH", `/api/v1/assets/${a.id}`, { json: {} })).res.status,
    ).toBe(400);
    const unknownRoom = await call("POST", "/api/v1/assets", {
      json: { name: "y", roomId: "nope" },
    });
    expect([unknownRoom.res.status, errorCode(unknownRoom)]).toEqual([
      400,
      "invalid_request",
    ]);
  });

  it("answers 404 for unknown ids and QR slugs", async () => {
    const call = await member();
    for (const [method, path, json] of [
      ["GET", "/api/v1/assets/nope", undefined],
      ["PATCH", "/api/v1/assets/nope", { name: "x" }],
      ["DELETE", "/api/v1/assets/nope", undefined],
      ["GET", "/api/v1/assets/by-qr/aaaaaaaaaa", undefined],
    ] as const) {
      const r = await call(method, path, { json });
      expect([r.res.status, errorCode(r)], `${method} ${path}`).toEqual([
        404,
        "not_found",
      ]);
    }
  });

  it("answers 409 for a taken slug", async () => {
    const call = await member();
    await call("POST", "/api/v1/assets", {
      json: { name: "A", slug: "gleich" },
    });
    const r = await call("POST", "/api/v1/assets", {
      json: { name: "B", slug: "gleich" },
    });
    expect([r.res.status, errorCode(r)]).toEqual([409, "conflict"]);
  });
});
