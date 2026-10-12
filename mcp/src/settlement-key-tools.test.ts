import { describe, expect, it } from "vitest";
import { useMcp } from "./test-harness";

describe("record_settlement and the idempotency key", () => {
  const mcp = useMcp();

  it("sends a fresh key with each payment", async () => {
    const keys: string[] = [];
    let n = 0;
    const { ok, ben, anna } = await mcp.connect({
      scopes: ["read", "write", "costs:write"],
      newKey: () => `key-number-${++n}`,
      fetch: (inner) => async (input, init) => {
        if (typeof init?.body === "string" && input.endsWith("/settlements")) {
          keys.push(JSON.parse(init.body).idempotencyKey);
        }
        return inner(input, init);
      },
    });
    await ok("record_settlement", { to: anna.id, from: ben.id, amount: "10" });
    await ok("record_settlement", { to: anna.id, from: ben.id, amount: "10" });
    expect(keys).toEqual(["key-number-1", "key-number-2"]);
    // two calls are two payments: the key only protects a retry of the same request
    const balances = await ok("get_balances");
    expect(
      balances.people.find((p: { person: string }) => p.person === "Ben")
        .paymentsMade,
    ).toBe("20.00 CHF");
  });
});
