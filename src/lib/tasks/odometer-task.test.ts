import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();
vi.mock("$lib/api/browser", () => ({ api: { call } }));

const { odometerAssetOf } = await import("./odometer-task");

const counter = (assetId: string) => ({
  v: 1 as const,
  type: "counter_delta" as const,
  entityId: `odometer:${assetId}`,
  threshold: 15000,
  unit: "km",
});

beforeEach(() => call.mockReset());

describe("odometerAssetOf", () => {
  it("answers from the trigger at hand without asking the server", async () => {
    await expect(
      odometerAssetOf({ id: "t1", assetId: "a1", trigger: counter("a1") }),
    ).resolves.toBe("a1");
    await expect(
      odometerAssetOf({
        id: "t1",
        assetId: "a1",
        trigger: { v: 1, type: "one_off", date: "2026-10-10" },
      }),
    ).resolves.toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("reads the task of an asset when the dashboard gave no trigger", async () => {
    call.mockResolvedValueOnce({ trigger: counter("a1") });
    await expect(odometerAssetOf({ id: "t1", assetId: "a1" })).resolves.toBe(
      "a1",
    );
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][1]).toEqual({ params: { id: "t1" } });
  });

  it("does not ask about a task without an asset", async () => {
    await expect(
      odometerAssetOf({ id: "t1", assetId: null }),
    ).resolves.toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("passes the server's refusal on", async () => {
    call.mockRejectedValueOnce(new Error("offline"));
    await expect(odometerAssetOf({ id: "t1", assetId: "a1" })).rejects.toThrow(
      "offline",
    );
  });
});
