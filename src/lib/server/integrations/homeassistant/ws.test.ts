import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeAssistantClient, HomeAssistantError, haWsCommand } from "./index";
import { startFakeHomeAssistant } from "./fake-server";

const fake = startFakeHomeAssistant();
afterAll(() => fake.stop());
beforeEach(async () => {
  await fake.waitIdle();
  fake.reset();
  fake.areas = [
    { area_id: "kitchen", name: "Kitchen", floor_id: null, aliases: [] },
    { area_id: "cellar", name: "Cellar", floor_id: "ground", picture: null },
  ];
  fake.devices = [
    {
      id: "dev1",
      name: "Washer",
      name_by_user: null,
      manufacturer: "Example Corp",
      model: "WX-1",
      area_id: "cellar",
      disabled_by: null,
      identifiers: [["example", "secret-serial"]],
    },
    { id: "dev2", name: null, disabled_by: "user" },
  ];
  fake.entityRegistry = [
    {
      entity_id: "sensor.example_washer_cycles",
      name: null,
      original_name: "Cycles",
      platform: "example",
      device_id: "dev1",
      area_id: null,
      disabled_by: null,
      hidden_by: "user",
    },
  ];
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HomeAssistantError) return err.code;
    throw err;
  }
  return "none";
}

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("haWsCommand", () => {
  it("authenticates, sends the command with an id and returns the typed list", async () => {
    const areas = await haWsCommand(fake.baseUrl, "test-token", {
      type: "config/area_registry/list",
    });
    expect(areas).toEqual([
      { areaId: "kitchen", name: "Kitchen", floorId: null },
      { areaId: "cellar", name: "Cellar", floorId: "ground" },
    ]);
    expect(fake.wsMessages).toEqual([
      { type: "auth", access_token: "test-token" },
      { id: 1, type: "config/area_registry/list" },
    ]);
  });

  it("reads devices and entity registry entries without leaking identifiers", async () => {
    const devices = await haWsCommand(fake.baseUrl, "test-token", {
      type: "config/device_registry/list",
    });
    expect(devices).toEqual([
      {
        id: "dev1",
        name: "Washer",
        nameByUser: null,
        manufacturer: "Example Corp",
        model: "WX-1",
        areaId: "cellar",
        disabled: false,
      },
      {
        id: "dev2",
        name: null,
        nameByUser: null,
        manufacturer: null,
        model: null,
        areaId: null,
        disabled: true,
      },
    ]);
    expect(JSON.stringify(devices)).not.toContain("secret-serial");
    expect(
      await haWsCommand(fake.baseUrl, "test-token", {
        type: "config/entity_registry/list",
      }),
    ).toEqual([
      {
        entityId: "sensor.example_washer_cycles",
        name: null,
        originalName: "Cycles",
        platform: "example",
        deviceId: "dev1",
        areaId: null,
        disabled: false,
        hidden: true,
      },
    ]);
  });

  it("is available on the client", async () => {
    const c = new HomeAssistantClient({
      baseUrl: fake.baseUrl,
      token: "test-token",
    });
    expect(await c.registry("config/area_registry/list")).toHaveLength(2);
  });

  it("closes the socket after a result", async () => {
    await haWsCommand(fake.baseUrl, "test-token", {
      type: "config/area_registry/list",
    });
    await waitFor(() => fake.wsClosed === 1);
    expect(fake.wsConnections).toBe(1);
    expect(fake.wsClosed).toBe(1);
  });

  it("maps a rejected token to unauthorized and never sends a command", async () => {
    expect(
      await codeOf(
        haWsCommand(fake.baseUrl, "wrong", {
          type: "config/area_registry/list",
        }),
      ),
    ).toBe("unauthorized");
    expect(fake.wsMessages).toEqual([{ type: "auth", access_token: "wrong" }]);
    await waitFor(() => fake.wsClosed === 1);
    expect(fake.wsClosed).toBe(1);
  });

  it("times out when the server never offers authentication", async () => {
    fake.wsMode = "silent";
    expect(
      await codeOf(
        haWsCommand(
          fake.baseUrl,
          "test-token",
          { type: "config/area_registry/list" },
          { timeoutMs: 150 },
        ),
      ),
    ).toBe("timeout");
    await waitFor(() => fake.wsClosed === 1);
    expect(fake.wsClosed).toBe(1);
  });

  it("times out when the command is never answered, and closes", async () => {
    fake.wsMode = "no-reply";
    expect(
      await codeOf(
        haWsCommand(
          fake.baseUrl,
          "test-token",
          { type: "config/device_registry/list" },
          { timeoutMs: 150 },
        ),
      ),
    ).toBe("timeout");
    await waitFor(() => fake.wsClosed === 1);
    expect(fake.wsClosed).toBe(1);
  });

  it("fails when the server drops the connection after authentication", async () => {
    fake.wsMode = "drop";
    expect(
      await codeOf(
        haWsCommand(fake.baseUrl, "test-token", {
          type: "config/area_registry/list",
        }),
      ),
    ).toBe("network");
  });

  it("maps a failed command", async () => {
    fake.wsMode = "command-error";
    expect(
      await codeOf(
        haWsCommand(fake.baseUrl, "test-token", {
          type: "config/area_registry/list",
        }),
      ),
    ).toBe("bad_request");
  });

  it("rejects results of the wrong shape and oversized messages", async () => {
    fake.wsMode = "bad-result";
    expect(
      await codeOf(
        haWsCommand(fake.baseUrl, "test-token", {
          type: "config/area_registry/list",
        }),
      ),
    ).toBe("invalid_response");
    fake.wsMode = "huge-result";
    expect(
      await codeOf(
        haWsCommand(
          fake.baseUrl,
          "test-token",
          { type: "config/area_registry/list" },
          { maxMessageBytes: 1000 },
        ),
      ),
    ).toBe("too_large");
  });

  it("maps an unreachable server to network and an https error cleanly", async () => {
    const probe = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("x"),
    });
    const closedPort = probe.port;
    await probe.stop(true);
    expect(
      await codeOf(
        haWsCommand(
          `http://127.0.0.1:${closedPort}`,
          "t",
          { type: "config/area_registry/list" },
          { timeoutMs: 2000 },
        ),
      ),
    ).toBe("network");
  });

  it("is not fooled by a server without a websocket endpoint", async () => {
    const plain = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("nope", { status: 404 }),
    });
    try {
      expect(
        await codeOf(
          haWsCommand(
            `http://127.0.0.1:${plain.port}`,
            "t",
            { type: "config/area_registry/list" },
            { timeoutMs: 2000 },
          ),
        ),
      ).toBe("network");
    } finally {
      await plain.stop(true);
    }
  });

  it("never disables certificate verification unless the connection allows it", async () => {
    const seen: Array<unknown> = [];
    const Real = WebSocket;
    class Spy extends Real {
      constructor(url: string | URL, options?: unknown) {
        super(url, options as never);
        seen.push((options as { tls?: unknown } | undefined)?.tls);
      }
    }
    vi.stubGlobal("WebSocket", Spy);
    try {
      const run = (allowInsecureTls?: boolean) =>
        haWsCommand(
          fake.baseUrl,
          "test-token",
          { type: "config/area_registry/list" },
          { allowInsecureTls },
        );
      await run();
      await run(false);
      expect(seen).toEqual([undefined, undefined]);
      await run(true);
      expect(seen[2]).toEqual({ rejectUnauthorized: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("validates url, token and command before connecting", async () => {
    expect(
      await codeOf(
        haWsCommand("ftp://x.example.org", "t", {
          type: "config/area_registry/list",
        }),
      ),
    ).toBe("invalid_url");
    expect(
      await codeOf(
        haWsCommand(fake.baseUrl, "bad token", {
          type: "config/area_registry/list",
        }),
      ),
    ).toBe("unauthorized");
    expect(
      await codeOf(
        haWsCommand(fake.baseUrl, "test-token", {
          type: "config/core/restart",
        } as never),
      ),
    ).toBe("invalid_input");
    expect(fake.wsConnections).toBe(0);
  });
});
