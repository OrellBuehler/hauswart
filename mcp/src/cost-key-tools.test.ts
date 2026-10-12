import { describe, expect, it } from "vitest";
import { useMcp } from "./test-harness";

describe("create_cost and the idempotency key", () => {
  const mcp = useMcp();

  it("sends a fresh key with each entry, so a retried request cannot book it twice", async () => {
    const keys: string[] = [];
    let n = 0;
    const { ok } = await mcp.connect({
      scopes: ["read", "write", "costs:write"],
      newKey: () => `key-number-${++n}`,
      fetch: (inner) => async (input, init) => {
        if (
          typeof init?.body === "string" &&
          init.method === "POST" &&
          input.endsWith("/costs")
        ) {
          keys.push(JSON.parse(init.body).idempotencyKey);
        }
        return inner(input, init);
      },
    });
    const args = { title: "Einkauf", amount: "23.40", category: "groceries" };
    await ok("create_cost", args);
    await ok("create_cost", args);
    expect(keys).toEqual(["key-number-1", "key-number-2"]);
    // two calls are two entries: the key only protects a retry of the same request
    const costs = await ok("list_costs");
    expect(costs.costs).toHaveLength(2);
  });
});
