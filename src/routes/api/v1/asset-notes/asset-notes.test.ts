import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { samplePdf, useTestFilesDir } from "$lib/testing/files";

type Note = {
  id: string;
  assetId: string;
  assetName: string;
  body: string;
  status: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  serviceLogId: string | null;
  defectId: string | null;
  createdBy: string | null;
  createdByName: string | null;
};
type List = { items: Note[]; nextCursor: string | null };

describe("asset notes API", () => {
  useTestDB();
  useTestFilesDir();

  async function setup() {
    const user = await createTestUser({ displayName: "Anna" });
    const call = createCaller({ session: loginTestUser(user).token });
    const asset = (
      await call("POST", "/api/v1/assets", { json: { name: "Kombi" } })
    ).body as { id: string };
    const note = async (body = "Bremsen quietschen", assetId = asset.id) =>
      (
        await call("POST", `/api/v1/assets/${assetId}/notes`, {
          json: { body },
        })
      ).body as Note;
    return { user, call, asset, note };
  }

  it("adds, lists, changes and deletes a note", async () => {
    const { user, call, asset } = await setup();
    const created = await call("POST", `/api/v1/assets/${asset.id}/notes`, {
      json: { body: "  Bremsen quietschen  " },
    });
    expect(created.res.status).toBe(201);
    const n = created.body as Note;
    expect(n).toMatchObject({
      assetId: asset.id,
      assetName: "Kombi",
      body: "Bremsen quietschen",
      status: "open",
      resolvedAt: null,
      serviceLogId: null,
      defectId: null,
      createdBy: user.id,
      createdByName: "Anna",
    });
    expect(
      ((await call("GET", `/api/v1/assets/${asset.id}/notes`)).body as List)
        .items,
    ).toEqual([n]);

    const patched = await call("PATCH", `/api/v1/asset-notes/${n.id}`, {
      json: { body: "Bremsen quietschen hinten" },
    });
    expect(patched.body).toMatchObject({ body: "Bremsen quietschen hinten" });

    expect(
      (await call("DELETE", `/api/v1/asset-notes/${n.id}`)).res.status,
    ).toBe(204);
    expect(
      (
        (await call("GET", `/api/v1/assets/${asset.id}/notes?status=all`))
          .body as List
      ).items,
    ).toEqual([]);
    expect(errorCode(await call("DELETE", `/api/v1/asset-notes/${n.id}`))).toBe(
      "not_found",
    );
  });

  it("filters by status, open by default, and resolves and reopens through a patch", async () => {
    const { user, call, asset, note } = await setup();
    const a = await note("Erste");
    await note("Zweite");
    const resolved = await call("PATCH", `/api/v1/asset-notes/${a.id}`, {
      json: { status: "resolved" },
    });
    expect(resolved.body).toMatchObject({
      status: "resolved",
      resolvedBy: user.id,
      resolvedByName: "Anna",
      resolvedAt: expect.any(String),
    });
    const bodies = async (query: string) =>
      (
        (await call("GET", `/api/v1/assets/${asset.id}/notes${query}`))
          .body as List
      ).items.map((n) => n.body);
    expect(await bodies("")).toEqual(["Zweite"]);
    expect(await bodies("?status=open")).toEqual(["Zweite"]);
    expect(await bodies("?status=resolved")).toEqual(["Erste"]);
    expect(await bodies("?status=all")).toEqual(["Zweite", "Erste"]);
    const reopened = await call("PATCH", `/api/v1/asset-notes/${a.id}`, {
      json: { status: "open" },
    });
    expect(reopened.body).toMatchObject({
      status: "open",
      resolvedAt: null,
      resolvedBy: null,
    });
    expect(await bodies("")).toEqual(["Zweite", "Erste"]);
  });

  it("pages the list", async () => {
    const { call, asset, note } = await setup();
    for (const body of ["A", "B", "C"]) await note(body);
    const first = (
      await call("GET", `/api/v1/assets/${asset.id}/notes?limit=2`)
    ).body as List;
    expect(first.items.map((n) => n.body)).toEqual(["C", "B"]);
    const second = (await call(
      "GET",
      `/api/v1/assets/${asset.id}/notes?limit=2&cursor=${first.nextCursor}`,
    ).then((r) => r.body)) as List;
    expect(second.items.map((n) => n.body)).toEqual(["A"]);
    expect(second.nextCursor).toBeNull();
  });

  it("validates input and answers 404", async () => {
    const { call, asset, note } = await setup();
    for (const json of [
      {},
      { body: "" },
      { body: "   " },
      { body: "x".repeat(2001) },
      { body: "x", status: "resolved" },
      { body: 5 },
    ]) {
      const r = await call("POST", `/api/v1/assets/${asset.id}/notes`, {
        json,
      });
      expect([r.res.status, errorCode(r)], JSON.stringify(json)).toEqual([
        400,
        "invalid_request",
      ]);
    }
    const n = await note();
    for (const json of [
      {},
      { status: "later" },
      { body: "" },
      { assetId: "x" },
    ]) {
      expect(
        errorCode(await call("PATCH", `/api/v1/asset-notes/${n.id}`, { json })),
        JSON.stringify(json),
      ).toBe("invalid_request");
    }
    expect(
      errorCode(
        await call("POST", "/api/v1/assets/nope/notes", {
          json: { body: "x" },
        }),
      ),
    ).toBe("not_found");
    expect(errorCode(await call("GET", "/api/v1/assets/nope/notes"))).toBe(
      "not_found",
    );
    expect(
      errorCode(
        await call("PATCH", "/api/v1/asset-notes/nope", {
          json: { body: "x" },
        }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(
        await call("GET", `/api/v1/assets/${asset.id}/notes?status=later`),
      ),
    ).toBe("invalid_request");
  });

  it("takes a photo of the issue as an attachment, which goes with the note", async () => {
    const { call, note } = await setup();
    const n = await note();
    const upload = await call("POST", "/api/v1/attachments", {
      form: {
        file: new File([samplePdf() as BlobPart], "foto.pdf", {
          type: "application/pdf",
        }),
        ownerType: "asset_note",
        ownerId: n.id,
      },
    });
    expect(upload.res.status).toBe(201);
    const list = async () =>
      (
        (
          await call(
            "GET",
            `/api/v1/attachments?ownerType=asset_note&ownerId=${n.id}`,
          )
        ).body as { items: unknown[] }
      ).items;
    expect(await list()).toHaveLength(1);
    await call("DELETE", `/api/v1/asset-notes/${n.id}`);
    expect(await list()).toEqual([]);
  });

  describe("turning a note into a defect", () => {
    it("answers with the note and the defect", async () => {
      const { user, call, asset, note } = await setup();
      const n = await note("Bremsen quietschen\nvor allem bei Nässe");
      const r = await call("POST", `/api/v1/asset-notes/${n.id}/to-defect`);
      expect(r.res.status).toBe(201);
      const { note: after, defect } = r.body as {
        note: Note;
        defect: {
          id: string;
          number: number;
          title: string;
          descriptionMd: string;
          assetId: string | null;
          assetName: string | null;
          status: string;
          deadlineDate: string | null;
          createdBy: string | null;
        };
      };
      expect(defect).toMatchObject({
        number: 1,
        title: "Bremsen quietschen",
        descriptionMd: "Bremsen quietschen\nvor allem bei Nässe",
        assetId: asset.id,
        assetName: "Kombi",
        status: "open",
        deadlineDate: null,
        createdBy: user.id,
      });
      expect(after).toMatchObject({
        id: n.id,
        status: "resolved",
        defectId: defect.id,
        resolvedBy: user.id,
      });
      expect(
        (await call("GET", `/api/v1/defects?assetId=${asset.id}`)).body,
      ).toMatchObject({ items: [{ id: defect.id }] });
      expect(
        ((await call("GET", `/api/v1/assets/${asset.id}/notes`)).body as List)
          .items,
      ).toEqual([]);
    });

    it("is a conflict the second time and a 404 for an unknown note", async () => {
      const { call, note } = await setup();
      const n = await note();
      await call("POST", `/api/v1/asset-notes/${n.id}/to-defect`);
      expect(
        errorCode(await call("POST", `/api/v1/asset-notes/${n.id}/to-defect`)),
      ).toBe("conflict");
      expect(
        errorCode(await call("POST", "/api/v1/asset-notes/nope/to-defect")),
      ).toBe("not_found");
      const defects = (await call("GET", "/api/v1/defects")).body as {
        items: unknown[];
      };
      expect(defects.items).toHaveLength(1);
    });
  });

  it("is shared by every member, and tokens need read to look and write to change", async () => {
    const { user, asset, note } = await setup();
    const n = await note();
    const ben = await createTestUser({ username: "ben" });
    const asBen = createCaller({ session: loginTestUser(ben).token });
    expect(
      ((await asBen("GET", `/api/v1/assets/${asset.id}/notes`)).body as List)
        .items,
    ).toHaveLength(1);
    expect(
      (
        await asBen("PATCH", `/api/v1/asset-notes/${n.id}`, {
          json: { status: "resolved" },
        })
      ).body,
    ).toMatchObject({ resolvedBy: ben.id });

    const reader = createCaller({
      bearer: createTestToken(user, { scopes: ["read"] }).token,
    });
    expect(
      (await reader("GET", `/api/v1/assets/${asset.id}/notes`)).res.status,
    ).toBe(200);
    for (const [method, path, json] of [
      ["POST", `/api/v1/assets/${asset.id}/notes`, { body: "x" }],
      ["PATCH", `/api/v1/asset-notes/${n.id}`, { body: "x" }],
      ["DELETE", `/api/v1/asset-notes/${n.id}`, undefined],
      ["POST", `/api/v1/asset-notes/${n.id}/to-defect`, undefined],
    ] as const) {
      const r = await reader(method, path, json ? { json } : {});
      expect([method, path, r.res.status, errorCode(r)]).toEqual([
        method,
        path,
        403,
        "forbidden",
      ]);
    }
    const writer = createCaller({
      bearer: createTestToken(user, { scopes: ["write"] }).token,
    });
    expect(
      errorCode(await writer("GET", `/api/v1/assets/${asset.id}/notes`)),
    ).toBe("forbidden");
  });
});
