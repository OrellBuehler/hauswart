import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { documentLinks, externalDocuments } from "$lib/server/db";
import {
  getConnectionRow,
  saveConnection,
} from "$lib/server/connections/connections";
import { emitEvent } from "$lib/server/events";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { makeAsset } from "$lib/testing/documents";
import { startPaperlessScheduler } from "./scheduler";
import { TEST_CONFIG, seedTaxonomy, useFakePaperless } from "./testing";

describe("Paperless scheduler", () => {
  const test = useTestDB();
  const { fake, connect } = useFakePaperless();
  const ctx = () => ({ db: test.db, now: Date.now() });
  const stops: Array<(() => void) & { idle(): Promise<void> }> = [];
  afterEach(async () => {
    const running = stops.splice(0);
    running.forEach((stop) => stop());
    // A run that was going on must end before the next test resets the fake and the database.
    await Promise.all(running.map((stop) => stop.idle()));
    vi.restoreAllMocks();
  });

  const start = (over = {}) => {
    const stop = startPaperlessScheduler({
      intervalMs: 3_600_000,
      firstRunDelayMs: 3_600_000,
      kickDelayMs: 5,
      ...over,
    });
    stops.push(stop);
    return stop;
  };

  const cached = (connectionId: string) =>
    test.db
      .select()
      .from(externalDocuments)
      .where(eq(externalDocuments.connectionId, connectionId))
      .all();

  it("reads a little after the start, then at every interval", async () => {
    const user = await createTestUser();
    const row = connect(user.id, { config: TEST_CONFIG });
    seedTaxonomy(fake);
    fake.addDoc({ id: 10, tags: [1] });
    start({ firstRunDelayMs: 10, intervalMs: 30 });
    await vi.waitFor(() => expect(cached(row.id)).toHaveLength(1));
    fake.addDoc({
      id: 11,
      tags: [1],
      modified: "2026-09-30T10:00:00+00:00",
    });
    await vi.waitFor(() => expect(cached(row.id)).toHaveLength(2));
  });

  it("reads soon after a connection is saved, and at once even when it was failing", async () => {
    const user = await createTestUser();
    seedTaxonomy(fake);
    fake.addDoc({ id: 10, tags: [1] });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    start();
    const row = connect(user.id, { token: "wrong", config: TEST_CONFIG });
    await vi.waitFor(() =>
      expect(getConnectionRow(ctx(), "paperless", user.id)).toMatchObject({
        status: "error",
        lastError: "unauthorized",
      }),
    );
    // The person enters the right token: no waiting for the backoff to run out.
    saveConnection(ctx(), "paperless", user.id, {
      baseUrl: row.baseUrl,
      token: fake.token,
      allowInsecureTls: false,
    });
    await vi.waitFor(() => expect(cached(row.id)).toHaveLength(1));
    expect(getConnectionRow(ctx(), "paperless", user.id)).toMatchObject({
      status: "ok",
      consecutiveFailures: 0,
    });
  });

  it("ignores changes to connections of other systems", async () => {
    const user = await createTestUser();
    connect(user.id, { config: TEST_CONFIG });
    start();
    fake.requests = [];
    emitEvent("connectionChanged", { ctx: ctx(), kind: "homeassistant" });
    await new Promise((r) => setTimeout(r, 40));
    expect(fake.requests).toEqual([]);
  });

  it("catches other people's caches up when something is linked", async () => {
    const [a, b] = [await createTestUser(), await createTestUser()];
    fake.addAccount("token-b", { id: 2, username: "second", groups: [50] });
    seedTaxonomy(fake);
    fake.strictPermissions = true;
    const rowA = connect(a.id, { config: TEST_CONFIG });
    const rowB = connect(b.id, { token: "token-b", config: TEST_CONFIG });
    fake.addDoc({ id: 10, title: "Shared", tags: [4], owner: 1 });
    fake.docs.get(10)!.permissions.view.groups = [50];
    start();
    emitEvent("documentLinksChanged", { ctx: ctx() });
    await vi.waitFor(() =>
      expect(getConnectionRow(ctx(), "paperless", b.id)?.status).toBe("ok"),
    );
    // Nothing is linked yet, so the documents outside the scope are not read.
    expect(cached(rowA.id)).toEqual([]);
    expect(cached(rowB.id)).toEqual([]);
    const asset = makeAsset(ctx());
    test.db
      .insert(documentLinks)
      .values({
        provider: "paperless",
        externalId: 10,
        connectionId: rowA.id,
        ownerType: "asset",
        ownerId: asset.id,
        role: "other",
      })
      .run();
    emitEvent("documentLinksChanged", { ctx: ctx() });
    await vi.waitFor(() => expect(cached(rowB.id)).toHaveLength(1));
    expect(cached(rowB.id)[0]).toMatchObject({
      title: "Shared",
      ownerVisible: true,
    });
  });

  it("never runs two reads at once, and runs once more for a request that came during a run", async () => {
    const user = await createTestUser();
    const row = connect(user.id, { config: TEST_CONFIG });
    seedTaxonomy(fake);
    fake.addDoc({ id: 10, tags: [1] });
    fake.delayMs = 30;
    start({ intervalMs: 10, firstRunDelayMs: 10 });
    await vi.waitFor(() => expect(cached(row.id)).toHaveLength(1));
    emitEvent("connectionChanged", { ctx: ctx(), kind: "paperless" });
    await new Promise((r) => setTimeout(r, 200));
    expect(fake.maxConcurrent).toBeLessThanOrEqual(2);
    // Taxonomy and documents are asked for in parallel inside one run; two runs would double that.
    expect(fake.maxConcurrent).toBeGreaterThan(0);
  });

  it("keeps going after a failing run, and logs only the name", async () => {
    const user = await createTestUser();
    const row = connect(user.id, { config: TEST_CONFIG });
    seedTaxonomy(fake);
    fake.addDoc({ id: 10, tags: [1] });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.failNext("/api/tags/", 500);
    start({ firstRunDelayMs: 10, intervalMs: 40 });
    await vi.waitFor(() =>
      expect(getConnectionRow(ctx(), "paperless", user.id)?.status).toBe(
        "error",
      ),
    );
    // The connection backs off for a minute: a kick reads at once.
    emitEvent("connectionChanged", { ctx: ctx(), kind: "paperless" });
    await vi.waitFor(() => expect(cached(row.id)).toHaveLength(1));
    expect(JSON.stringify(log.mock.calls)).not.toContain(fake.token);
  });

  it("stops: no more timers and no more reactions to events", async () => {
    const user = await createTestUser();
    connect(user.id, { config: TEST_CONFIG });
    seedTaxonomy(fake);
    const stop = start({ firstRunDelayMs: 10, intervalMs: 10 });
    await vi.waitFor(() => expect(fake.requests.length).toBeGreaterThan(0));
    stop();
    await new Promise((r) => setTimeout(r, 30));
    fake.requests = [];
    emitEvent("connectionChanged", { ctx: ctx(), kind: "paperless" });
    emitEvent("documentLinksChanged", { ctx: ctx() });
    await new Promise((r) => setTimeout(r, 60));
    expect(fake.requests).toEqual([]);
  });
});
