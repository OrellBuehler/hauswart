import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConnectionRow } from "$lib/server/connections/connections";
import { getIntegration } from "$lib/server/connections/registry";
import { emitEvent } from "$lib/server/events";
import { financeProviders } from "$lib/server/finance/providers";
import {
  acceptSuggestion,
  listSuggestions,
} from "$lib/server/finance/suggestions";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt, NOW } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { registerKept } from "./index";
import { fakeTransaction } from "./fake-server";
import { startKeptScheduler } from "./scheduler";
import { useFakeKept } from "./testing";

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Kept scheduler", () => {
  const test = useTestDB();
  const { fake, connect } = useFakeKept();
  const ctx = () => ctxAt(test.db, NOW);
  const CONFIG = { categoryMap: { "cat-repair": "repair" } };
  const stops: Array<() => void> = [];
  let previousOrigin: string | undefined;
  beforeEach(() => {
    previousOrigin = process.env.ORIGIN;
    process.env.ORIGIN = "https://hauswart.example.org";
  });
  afterEach(() => {
    while (stops.length) stops.pop()!();
    if (previousOrigin === undefined) delete process.env.ORIGIN;
    else process.env.ORIGIN = previousOrigin;
    vi.restoreAllMocks();
  });
  const start = (options = {}) => {
    const stop = startKeptScheduler({
      firstRunDelayMs: 5,
      intervalMs: 1_000_000,
      kickDelayMs: 5,
      clock: () => NOW,
      ...options,
    });
    stops.push(stop);
    return stop;
  };
  const tx = (id: string) =>
    fakeTransaction({ id, categoryId: "cat-repair", amount: -5000 });
  const suggestionsOf = (userId: string) =>
    listSuggestions(ctx(), userId, { status: "pending" }, { limit: 50 }).items;

  it("syncs every enabled connection of every person, and none that is switched off", async () => {
    const anna = await createTestUser();
    const ben = await createTestUser();
    const off = await createTestUser();
    connect(anna.id, { config: CONFIG });
    connect(ben.id, { config: CONFIG });
    connect(off.id, { config: CONFIG, enabled: false });
    fake.transactions = [tx("t1")];
    start();
    await waitFor(
      () =>
        suggestionsOf(anna.id).length === 1 &&
        suggestionsOf(ben.id).length === 1,
    );
    expect(suggestionsOf(off.id)).toEqual([]);
    expect(getConnectionRow(ctx(), "kept", anna.id)).toMatchObject({
      status: "ok",
    });
  });

  it("syncs again at every interval", async () => {
    const user = await createTestUser();
    connect(user.id, { config: CONFIG });
    fake.transactions = [tx("t1")];
    start({ intervalMs: 20 });
    await waitFor(() => suggestionsOf(user.id).length === 1);
    fake.transactions = [tx("t1"), tx("t2")];
    await waitFor(() => suggestionsOf(user.id).length === 2);
  });

  it("backs off after a failure: 1 minute, then 2, until the connection works again", async () => {
    const user = await createTestUser();
    connect(user.id, { config: CONFIG, token: "kept_wrong-token" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    let now = NOW;
    start({ intervalMs: 15, clock: () => now });
    await waitFor(
      () => getConnectionRow(ctx(), "kept", user.id)?.consecutiveFailures === 1,
    );
    const calls = fake.requests.length;
    await pause(100);
    // many ticks passed, none was due
    expect(fake.requests.length).toBe(calls);
    now += 61_000;
    await waitFor(
      () => getConnectionRow(ctx(), "kept", user.id)?.consecutiveFailures === 2,
    );
    const second = fake.requests.length;
    expect(second).toBeGreaterThan(calls);
    await pause(60);
    now += 30_000;
    await pause(60);
    // 2 failures: 2 minutes: still backing off
    expect(fake.requests.length).toBe(second);
  });

  it("syncs a connection at once when it is saved", async () => {
    const user = await createTestUser();
    fake.transactions = [tx("t1")];
    start({ firstRunDelayMs: 1_000_000 });
    connect(user.id, { config: CONFIG });
    // saving emits the event the scheduler listens to
    await waitFor(() => suggestionsOf(user.id).length === 1);
  });

  it("never runs two syncs at the same time, and a request during a run runs once more", async () => {
    const user = await createTestUser();
    connect(user.id, { config: CONFIG });
    fake.transactions = [tx("t1")];
    fake.delayMs = 60;
    start({ firstRunDelayMs: 1 });
    await pause(20);
    // while the first run is busy, ask three more times
    for (let i = 0; i < 3; i++) {
      connect(user.id, { config: CONFIG });
      await pause(10);
    }
    await waitFor(() => fake.requestsTo("/transactions").length >= 2);
    await pause(400);
    // one run at the start and one more for all the requests together
    expect(fake.requestsTo("/transactions")).toHaveLength(2);
  });

  it("writes the back-link of a booked cost soon, without a full sync", async () => {
    const user = await createTestUser();
    fake.transactions = [tx("t1")];
    start({ firstRunDelayMs: 1_000_000 });
    // saving the connection is what makes the first sync happen
    connect(user.id, { config: CONFIG });
    await waitFor(() => suggestionsOf(user.id).length === 1);
    await pause(30);
    fake.requests = [];
    await acceptSuggestion(ctx(), user.id, suggestionsOf(user.id)[0].id, {});
    await waitFor(() => fake.links.length === 1);
    expect(fake.requestsTo("/transactions", "GET")).toEqual([]);
  });

  it("stops everything when asked", async () => {
    const user = await createTestUser();
    connect(user.id, { config: CONFIG });
    fake.transactions = [tx("t1")];
    const stop = start({ firstRunDelayMs: 50, intervalMs: 20 });
    stop();
    await pause(150);
    expect(fake.requests).toEqual([]);
  });

  it("survives an unexpected failure of one connection and carries on with the next", async () => {
    const broken = await createTestUser();
    const fine = await createTestUser();
    const brokenRow = connect(broken.id, { config: CONFIG });
    connect(fine.id, { config: CONFIG });
    const { connections } = await import("$lib/server/db");
    const { eq } = await import("drizzle-orm");
    test.db
      .update(connections)
      .set({ tokenEnc: "garbage" })
      .where(eq(connections.id, brokenRow.id))
      .run();
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake.transactions = [tx("t1")];
    start();
    await waitFor(() => suggestionsOf(fine.id).length === 1);
    expect(getConnectionRow(ctx(), "kept", broken.id)).toMatchObject({
      status: "error",
      lastError: "token_unreadable",
    });
  });

  it("is wired by registerKept: settings, finance provider and scheduler, all removable", async () => {
    expect(getIntegration("kept")).toBeUndefined();
    const stop = registerKept({
      scheduler: { firstRunDelayMs: 1_000_000, intervalMs: 1_000_000 },
    });
    try {
      expect(getIntegration("kept")?.describe().capabilities).toEqual([
        "categories",
        "accounts",
      ]);
      expect(financeProviders().map((p) => p.kind)).toEqual(["kept"]);
    } finally {
      stop();
    }
    expect(getIntegration("kept")).toBeUndefined();
    expect(financeProviders()).toEqual([]);
    // emitting events afterwards does nothing
    emitEvent("connectionChanged", { ctx: ctx(), kind: "kept" });
  });
});
