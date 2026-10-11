import { describe, expect, it } from "vitest";
import type { Integration } from "$lib/api/schemas/integrations";
import { m } from "$lib/paraglide/messages";
import { creatableProviders, providerName, providerUsable } from "./providers";

function integration(over: Partial<Integration> = {}): Integration {
  return {
    kind: "homeassistant",
    level: "household",
    available: true,
    capabilities: ["calendars"],
    configured: true,
    enabled: true,
    baseUrl: null,
    allowInsecureTls: false,
    config: {},
    status: "ok",
    lastError: null,
    lastOkAt: null,
    lastCheckedAt: null,
    consecutiveFailures: 0,
    ...over,
  };
}

describe("creatableProviders", () => {
  it("offers a working household connection to administrators only", () => {
    expect(creatableProviders([integration()], true)).toEqual([
      "homeassistant",
    ]);
    expect(creatableProviders([integration()], false)).toEqual([]);
  });

  it.each([
    ["not connected", { configured: false }],
    ["switched off", { enabled: false }],
    ["without an adapter", { available: false }],
  ])("offers nothing for a connection that is %s", (_name, over) => {
    expect(creatableProviders([integration(over)], true)).toEqual([]);
  });

  it("offers nothing without the connection in the list", () => {
    expect(creatableProviders([], true)).toEqual([]);
    expect(
      creatableProviders([integration({ kind: "kept", level: "user" })], true),
    ).toEqual([]);
  });

  it("still offers a connection that currently reports an error", () => {
    expect(
      creatableProviders([integration({ status: "error" })], true),
    ).toEqual(["homeassistant"]);
  });
});

describe("providerUsable", () => {
  it("follows the saved, switched-on connection of that system", () => {
    expect(providerUsable([integration()], "homeassistant")).toBe(true);
    expect(
      providerUsable([integration({ enabled: false })], "homeassistant"),
    ).toBe(false);
    expect(providerUsable([], "homeassistant")).toBe(false);
  });
});

describe("providerName", () => {
  it("names the system as people know it", () => {
    expect(providerName("homeassistant")).toBe(m.integration_ha_name());
  });
});
