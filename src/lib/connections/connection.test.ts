import { describe, expect, it, vi } from "vitest";
import { forgetIntegrations, onIntegrationsForgotten } from "./connection";

describe("forgetting the integrations", () => {
  it("tells whoever depends on them, until they stop listening", () => {
    const listener = vi.fn();
    const stop = onIntegrationsForgotten(listener);
    forgetIntegrations();
    forgetIntegrations();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    forgetIntegrations();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
