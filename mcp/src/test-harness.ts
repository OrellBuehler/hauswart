import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach } from "vitest";
import type { FetchLike } from "../../src/lib/api/client";
import type { Scope } from "../../src/lib/api/scopes";
import { putVehicleRequestSchema } from "../../src/lib/api/schemas/vehicles";
import { addDays } from "../../src/lib/dates";
import { createInProcessFetch } from "../../src/lib/testing/api";
import { createTestToken, createTestUser } from "../../src/lib/testing/auth";
import { useTestDB } from "../../src/lib/testing/db";
import type { ServiceContext } from "../../src/lib/server/service";
import { putVehicle } from "../../src/lib/server/vehicles/vehicles";
import { createHauswartServer, type ConnectOptions } from "./server";

export interface Reply {
  isError: boolean;
  text: string;
  /** The JSON part of a result (after the summary line). */
  json: Record<string, unknown>;
  summary: string;
}

/** Calls and replies are plain data; arrays of results are typed by the caller. */
export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function parseReply(result: {
  isError?: boolean;
  content: unknown;
}): Reply {
  const content = result.content as { type: string; text: string }[];
  const text = content.map((c) => c.text).join("\n");
  const [summary, ...rest] = text.split("\n\n");
  let json: Record<string, unknown> = {};
  if (!result.isError && rest.length > 0) {
    json = JSON.parse(rest.join("\n\n"));
  }
  return { isError: result.isError === true, text, json, summary };
}

/**
 * An MCP server connected to an in-process hauswart (real routes, real hook,
 * in-memory database) through the SDK's in-memory transport. Call once per
 * describe block; every test gets a fresh database and its own `connect()`.
 */
export function useMcp() {
  const db = useTestDB();
  const clients: Client[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
  });

  async function connect(
    opts: {
      scopes?: Scope[];
      tools?: ConnectOptions["tools"];
      fetch?: (inner: FetchLike) => FetchLike;
      newKey?: () => string;
    } = {},
  ) {
    const anna = await createTestUser({ displayName: "Anna", role: "admin" });
    const ben = await createTestUser({ displayName: "Ben" });
    const { token, record } = createTestToken(anna, {
      kind: "mcp",
      scopes: opts.scopes ?? ["read", "write"],
    });
    const inner = createInProcessFetch();
    const server = await createHauswartServer({
      url: "http://localhost",
      token,
      fetch: opts.fetch ? opts.fetch(inner) : inner,
      newKey: opts.newKey,
      tools: opts.tools,
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.server.connect(serverSide);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientSide);
    clients.push(client);

    async function call(name: string, args: Record<string, unknown> = {}) {
      return parseReply(
        (await client.callTool({ name, arguments: args })) as never,
      );
    }
    /** `call` that fails the test on an error result and returns the JSON. */
    async function ok(name: string, args: Record<string, unknown> = {}) {
      const reply = await call(name, args);
      if (reply.isError) throw new Error(`${name} failed: ${reply.text}`);
      return reply.json as Json;
    }
    const today = server.context.today();
    return {
      db,
      client,
      server,
      call,
      ok,
      anna,
      ben,
      token,
      tokenId: record.id,
      today,
      day: (offset: number) => addDays(today, offset),
    };
  }

  return { connect, db };
}

export const everyDays = (every: number, startDate: string) => ({
  type: "interval",
  every,
  unit: "day",
  anchor: "completion",
  startDate,
});

export const oneOff = (date: string) => ({ type: "one_off", date });

/**
 * A vehicle (an asset of kind `vehicle`) with the given plate and details, for the tools that need
 * one. Returns its id.
 */
export async function createVehicle(
  session: {
    ok: (name: string, args?: Record<string, unknown>) => Promise<Json>;
    db: { db: ServiceContext["db"] };
  },
  name: string,
  plate: string | null = null,
  details: Record<string, unknown> = {},
): Promise<string> {
  const asset = await session.ok("create_asset", { name, kind: "vehicle" });
  if (plate !== null || Object.keys(details).length > 0) {
    putVehicle(
      { db: session.db.db, now: Date.now() },
      asset.id,
      putVehicleRequestSchema.parse({ plate, ...details }),
    );
  }
  return asset.id as string;
}
