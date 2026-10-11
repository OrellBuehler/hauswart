import { describe, expect, it } from "vitest";
import { createApiClient } from "../../src/lib/api/client";
import { endpoints } from "../../src/lib/api/registry";
import { createInProcessFetch } from "../../src/lib/testing/api";
import { MAX_SEARCH_LENGTH, searchText } from "./search-text";
import { useMcp } from "./test-harness";

describe("searchText", () => {
  it("trims, and cuts what the API would refuse", () => {
    expect(searchText("give x", "  Kasko ")).toEqual({
      text: "Kasko",
      q: "Kasko",
      cut: false,
    });
    const exactly = "a".repeat(MAX_SEARCH_LENGTH);
    expect(searchText("give x", exactly)).toMatchObject({
      q: exactly,
      cut: false,
    });
    const longer = `${exactly}b`;
    expect(searchText("give x", ` ${longer} `)).toEqual({
      text: longer,
      q: exactly,
      cut: true,
    });
  });

  it.each(["", " ", "\t", " \n "])(
    "refuses %j and says what to give",
    (ref) => {
      expect(() => searchText("give the vehicle's id", ref)).toThrow(
        "Nothing to look for: give the vehicle's id.",
      );
    },
  );
});

describe("references to records", () => {
  const mcp = useMcp();

  async function world() {
    const connected = await mcp.connect();
    const api = createApiClient(
      createInProcessFetch({ bearer: connected.token }),
      "http://localhost",
      { token: connected.token },
    );
    return { ...connected, api };
  }

  const tools = [
    ["get_insurance_policy", "policy"],
    ["get_contact", "contact"],
    ["get_asset", "asset"],
    ["get_vehicle", "vehicle"],
    ["adjust_stock", "part"],
  ] as const;
  const extra = (tool: string) => (tool === "adjust_stock" ? { delta: 1 } : {});

  it.each(tools)(
    "%s refuses a blank reference and says what to give",
    async (tool, param) => {
      const { call, ok } = await world();
      // Something exists that a blank text could be mistaken for.
      await ok("create_asset", { name: "Familienauto", kind: "vehicle" });
      for (const blank of ["   ", "\t", " \n "]) {
        const reply = await call(tool, { [param]: blank, ...extra(tool) });
        expect(reply.isError, `${tool} ${JSON.stringify(blank)}`).toBe(true);
        expect(reply.text).toContain("[invalid_request]");
        expect(reply.text).toContain("Nothing to look for: give the");
      }
    },
  );

  it.each(tools)(
    "%s answers not_found for a reference longer than the search takes",
    async (tool, param) => {
      const { call } = await world();
      const reply = await call(tool, {
        [param]: "x".repeat(MAX_SEARCH_LENGTH + 10),
        ...extra(tool),
      });
      expect(reply.isError).toBe(true);
      expect(reply.text).toContain("[not_found]");
    },
  );

  it("finds an asset by a name longer than the search takes, and not by its first part", async () => {
    const { ok, call } = await world();
    const name = `Heizungsanlage ${"x".repeat(MAX_SEARCH_LENGTH)}`;
    const created = await ok("create_asset", { name });
    expect((await ok("get_asset", { asset: name })).id).toBe(created.id);
    const nearMiss = `${name.slice(0, MAX_SEARCH_LENGTH + 5)}y`;
    const reply = await call("get_asset", { asset: nearMiss });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("[not_found]");
  });

  it("finds a contact by a name longer than the search takes, and not by one that only starts the same", async () => {
    const { ok, call, api } = await world();
    const name = `Sanitaer ${"y".repeat(MAX_SEARCH_LENGTH + 20)}`;
    const created = await api.call(endpoints.contactsCreate, {
      body: { name },
    });
    expect((await ok("get_contact", { contact: name })).id).toBe(created.id);
    const nearMiss = `${name.slice(0, MAX_SEARCH_LENGTH + 5)}z`;
    const reply = await call("get_contact", { contact: nearMiss });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("[not_found]");
  });

  it("finds a part by a name longer than the search takes", async () => {
    const { ok, api } = await world();
    const name = `Dichtung ${"z".repeat(MAX_SEARCH_LENGTH + 20)}`;
    const created = await api.call(endpoints.partsCreate, {
      body: { name, stockCount: 3 },
    });
    const moved = await ok("adjust_stock", { part: name, delta: 2 });
    expect(moved.id).toBe(created.id);
    expect(moved.stock).toBe(5);
  });
});
