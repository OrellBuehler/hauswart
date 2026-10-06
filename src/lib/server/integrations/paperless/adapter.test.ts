import { describe, expect, it } from "vitest";
import { getConnectionRow } from "$lib/server/connections/connections";
import {
  runOperation,
  testConnection,
} from "$lib/server/connections/connections";
import { IntegrationError } from "$lib/server/connections/errors";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { validateInput } from "./adapter";
import { useFakePaperless } from "./testing";

describe("Paperless adapter", () => {
  const test = useTestDB();
  const { fake, connect } = useFakePaperless();
  const ctx = () => ({ db: test.db, now: Date.now() });

  describe("settings", () => {
    const base = "https://docs.example.org/";

    it("normalises the address and fills the defaults", () => {
      expect(validateInput({ baseUrl: base, config: {} })).toEqual({
        baseUrl: "https://docs.example.org",
        config: {
          sharedTagIds: [],
          uploadTagIds: [],
          shareGroupIds: [],
          receiptTagIds: [],
          manualTagIds: [],
          writeBackNotes: false,
        },
      });
    });

    it("keeps the known settings and drops unknown keys", () => {
      const { config } = validateInput({
        baseUrl: base,
        config: {
          sharedTagIds: [3, 4],
          warrantyFieldId: 7,
          warrantyExtendedFieldId: 8,
          uploadTagIds: [5],
          uploadStoragePathId: 2,
          uploadCorrespondentId: 9,
          shareGroupIds: [1],
          receiptTagIds: [6],
          manualTagIds: [10],
          writeBackNotes: true,
          appUrl: "https://hauswart.example.org/",
          somethingElse: "x",
        },
      });
      expect(config).toEqual({
        sharedTagIds: [3, 4],
        warrantyFieldId: 7,
        warrantyExtendedFieldId: 8,
        uploadTagIds: [5],
        uploadStoragePathId: 2,
        uploadCorrespondentId: 9,
        shareGroupIds: [1],
        receiptTagIds: [6],
        manualTagIds: [10],
        writeBackNotes: true,
        appUrl: "https://hauswart.example.org",
      });
    });

    it.each([
      ["a tag id that is not a number", { sharedTagIds: ["a"] }],
      ["a negative id", { warrantyFieldId: -1 }],
      [
        "too many ids",
        { shareGroupIds: Array.from({ length: 51 }, (_, i) => i + 1) },
      ],
      [
        "the same field twice",
        { warrantyFieldId: 3, warrantyExtendedFieldId: 3 },
      ],
      ["an app address that is not an address", { appUrl: "hauswart" }],
      [
        "an app address with credentials",
        { appUrl: "https://a:b@example.org" },
      ],
      ["a flag that is not a boolean", { writeBackNotes: "yes" }],
    ])("refuses %s", (_name, config) => {
      expect(() => validateInput({ baseUrl: base, config })).toThrow(
        IntegrationError,
      );
    });

    it("refuses an address that is not http(s)", () => {
      expect(() =>
        validateInput({ baseUrl: "ftp://docs.example.org", config: {} }),
      ).toThrow(IntegrationError);
    });
  });

  describe("connection test", () => {
    it("reports the release and the account of a working connection", async () => {
      const user = await createTestUser();
      connect(user.id);
      const { result, view } = await testConnection(
        ctx(),
        "paperless",
        user.id,
        { showAddress: true },
      );
      expect(result).toEqual({
        ok: true,
        info: { version: "2.20.3", apiVersion: 9, user: "admin" },
      });
      expect(view.status).toBe("ok");
      expect(fake.requests[0].headers.get("authorization")).toBe(
        `Token ${fake.token}`,
      );
    });

    it("says why a wrong token is refused and records it on the connection", async () => {
      const user = await createTestUser();
      connect(user.id, { token: "wrong-token" });
      const { result, view } = await testConnection(
        ctx(),
        "paperless",
        user.id,
        { showAddress: true },
      );
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("unauthorized");
      expect(view).toMatchObject({
        status: "error",
        lastError: "unauthorized",
      });
    });

    it("does not throw for an unreachable server", async () => {
      const user = await createTestUser();
      connect(user.id);
      fake.stop();
      try {
        const { result } = await testConnection(ctx(), "paperless", user.id, {
          showAddress: true,
        });
        expect(result.ok).toBe(false);
        expect(["network", "timeout"]).toContain(result.error?.code);
      } finally {
        fake.start();
      }
    });
  });

  describe("pickers", () => {
    const run = (userId: string, operation: string, query = {}) =>
      runOperation(ctx(), "paperless", userId, operation, query);

    it("lists tags, correspondents, custom fields, groups and storage paths sorted by name", async () => {
      const user = await createTestUser();
      connect(user.id);
      fake.tags = [
        { id: 2, name: "Zebra", color: "#ff0000", document_count: 4 },
        { id: 1, name: "Apartment" },
      ];
      fake.correspondents = [
        { id: 5, name: "Example Utility", document_count: 3 },
      ];
      fake.customFields = [
        { id: 7, name: "Warranty until", data_type: "date" },
      ];
      fake.groups = [{ id: 3, name: "Household" }];
      fake.storagePaths = [{ id: 4, name: "Apartment", path: "apt/{title}" }];
      expect(await run(user.id, "tags")).toEqual({
        items: [
          { id: 1, name: "Apartment", color: null, documentCount: null },
          { id: 2, name: "Zebra", color: "#ff0000", documentCount: 4 },
        ],
      });
      expect(await run(user.id, "correspondents")).toEqual({
        items: [{ id: 5, name: "Example Utility", documentCount: 3 }],
      });
      expect(await run(user.id, "custom-fields")).toEqual({
        items: [{ id: 7, name: "Warranty until", dataType: "date" }],
      });
      expect(await run(user.id, "groups")).toEqual({
        items: [{ id: 3, name: "Household" }],
      });
      expect(await run(user.id, "storage-paths")).toEqual({
        items: [{ id: 4, name: "Apartment", path: "apt/{title}" }],
      });
    });

    it("narrows a list by name, case-insensitively", async () => {
      const user = await createTestUser();
      connect(user.id);
      fake.tags = [
        { id: 1, name: "Receipt" },
        { id: 2, name: "Manual" },
      ];
      expect(
        (await run(user.id, "tags", { q: "RECE" })) as { items: unknown[] },
      ).toEqual({
        items: [{ id: 1, name: "Receipt", color: null, documentCount: null }],
      });
    });

    it("answers a refused request with the code, so the settings can say what is missing", async () => {
      const user = await createTestUser();
      connect(user.id);
      fake.failNext("/api/groups/", 403);
      await expect(run(user.id, "groups")).rejects.toMatchObject({
        code: "upstream_error",
        details: { code: "forbidden" },
      });
    });

    it("reads with the caller's own account and never another person's", async () => {
      const [a, b] = [await createTestUser(), await createTestUser()];
      fake.addAccount("token-b", { id: 2, username: "second" });
      connect(a.id);
      connect(b.id, { token: "token-b" });
      fake.tags = [{ id: 1, name: "Apartment" }];
      await run(a.id, "tags");
      await run(b.id, "tags");
      expect(
        fake
          .requestsTo("/api/tags/")
          .map((r) => r.headers.get("authorization")),
      ).toEqual([`Token ${fake.token}`, "Token token-b"]);
      expect(getConnectionRow(ctx(), "paperless", a.id)?.id).not.toBe(
        getConnectionRow(ctx(), "paperless", b.id)?.id,
      );
    });

    it("is not available without a connection of the caller", async () => {
      const [a, b] = [await createTestUser(), await createTestUser()];
      connect(a.id);
      await expect(run(b.id, "tags")).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });
});
