import { describe, expect, it } from "vitest";
import { createInProcessFetch } from "../../src/lib/testing/api";
import { createTestToken, createTestUser } from "../../src/lib/testing/auth";
import { useTestDB } from "../../src/lib/testing/db";
import { createHauswartServer } from "./server";
import { tools as allTools } from "./tools";
import { useMcp } from "./test-harness";

const READ_TOOLS = [
  "whoami",
  "list_upcoming",
  "list_tasks",
  "get_task",
  "preview_trigger",
  "list_rooms",
  "list_assets",
  "get_asset",
  "get_stats",
  "list_notifications",
  "search",
  "list_pages",
  "get_page",
  "list_defects",
  "get_defect",
  "list_parts",
  "list_contacts",
  "get_contact",
  "list_comments",
  "list_hints",
  "list_warranties",
  "list_costs",
  "cost_summary",
  "list_finance_suggestions",
];
const WRITE_TOOLS = [
  "create_task",
  "update_task",
  "complete_task",
  "skip_task",
  "snooze_task",
  "undo_completion",
  "create_asset",
  "update_asset",
  "create_defect",
  "set_defect_status",
  "adjust_stock",
  "add_comment",
  "add_service_log",
];
const DOCS_WRITE_TOOLS = ["create_page", "update_page"];
const COSTS_WRITE_TOOLS = [
  "create_cost",
  "accept_finance_suggestion",
  "dismiss_finance_suggestion",
  "sync_finance",
];

describe("tool registration", () => {
  const mcp = useMcp();

  it("offers every tool to a token with read and write", async () => {
    const { client } = await mcp.connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...READ_TOOLS, ...WRITE_TOOLS].sort(),
    );
    expect(allTools.map((t) => t.name).sort()).toEqual(
      [
        ...READ_TOOLS,
        ...WRITE_TOOLS,
        ...DOCS_WRITE_TOOLS,
        ...COSTS_WRITE_TOOLS,
      ].sort(),
    );
  });

  it("offers the page writers to a token with docs:write", async () => {
    const { client } = await mcp.connect({
      scopes: ["read", "write", "docs:write"],
    });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...READ_TOOLS, ...WRITE_TOOLS, ...DOCS_WRITE_TOOLS].sort(),
    );
  });

  it("offers cost booking only to a token with costs:write", async () => {
    const { client } = await mcp.connect({
      scopes: ["read", "write", "costs:write"],
    });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...READ_TOOLS, ...WRITE_TOOLS, ...COSTS_WRITE_TOOLS].sort(),
    );
  });

  it("hides the write tools from a read-only token", async () => {
    const { client, call } = await mcp.connect({ scopes: ["read"] });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS].sort());
    const reply = await call("complete_task", { id: "x" }).catch((e) => e);
    expect(reply instanceof Error || reply.isError).toBe(true);
    expect(client.getInstructions()).toContain("read-only");
  });

  it("annotates every tool and describes it", async () => {
    const { client } = await mcp.connect({
      scopes: ["read", "write", "docs:write", "costs:write"],
    });
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(tool.description?.length ?? 0).toBeGreaterThan(40);
      expect(tool.annotations?.title).toBeTruthy();
      expect(typeof tool.annotations?.readOnlyHint).toBe("boolean");
      expect(tool.annotations?.readOnlyHint).toBe(
        READ_TOOLS.includes(tool.name),
      );
      expect(tool.inputSchema.type).toBe("object");
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.undo_completion.annotations).toMatchObject({
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(byName.complete_task.annotations).toMatchObject({
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(byName.snooze_task.annotations?.idempotentHint).toBe(true);
  });

  it("states the trigger types in the tools that take one", async () => {
    const { client } = await mcp.connect();
    const { tools } = await client.listTools();
    for (const name of ["create_task", "update_task", "preview_trigger"]) {
      const description = tools.find((t) => t.name === name)?.description;
      for (const type of [
        "interval",
        "calendar",
        "min_per_period",
        "one_off",
      ]) {
        expect(description, `${name} ${type}`).toContain(type);
      }
    }
  });

  it("registers a tool that needs a scope the token lacks only with that scope", async () => {
    const { defineTool } = await import("./tool");
    const costs = defineTool({
      name: "add_cost",
      title: "Add a cost",
      description:
        "Needs the costs:write scope; shows the extension mechanism.",
      mode: "create",
      scopes: ["write", "costs:write"],
      input: {},
      handler: async () => ({ summary: "ok", data: {} }),
    });
    const without = await mcp.connect({ tools: [costs] });
    expect(without.server.tools).toEqual([]);
    const withScope = await mcp.connect({
      tools: [costs],
      scopes: ["read", "write", "costs:write"],
    });
    expect(withScope.server.tools).toEqual(["add_cost"]);
    expect((await withScope.call("add_cost")).summary).toBe("ok");
  });
});

describe("connecting", () => {
  const test = useTestDB();

  it("explains a rejected token", async () => {
    await createTestUser();
    const fetch = createInProcessFetch();
    await expect(
      createHauswartServer({
        url: "http://localhost",
        token: "hw_not-a-real-token",
        fetch,
      }),
    ).rejects.toThrow(/rejected the token \(401\)/);
    expect(test.db).toBeTruthy();
  });

  it("says when hauswart has no users yet", async () => {
    await expect(
      createHauswartServer({
        url: "http://localhost",
        token: "hw_x",
        fetch: createInProcessFetch(),
      }),
    ).rejects.toThrow(/not been set up/);
  });

  it("explains an unreachable server without leaking the token", async () => {
    const error = await createHauswartServer({
      url: "http://hauswart.example.org",
      token: "hw_secret-value",
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    }).catch((e: Error) => e);
    expect((error as Error).message).toMatch(
      /Could not reach http:\/\/hauswart\.example\.org: fetch failed/,
    );
    expect((error as Error).message).not.toContain("hw_secret-value");
  });

  it("refuses a token without the read scope", async () => {
    const user = await createTestUser();
    const { token } = createTestToken(user, { kind: "mcp", scopes: ["write"] });
    await expect(
      createHauswartServer({
        url: "http://localhost",
        token,
        fetch: createInProcessFetch(),
      }),
    ).rejects.toThrow(/read scope|rejected|forbidden/i);
  });
});
