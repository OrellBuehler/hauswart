import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();
vi.mock("$lib/api/browser", () => ({ api: { call } }));

const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

const { odometerAssetOf } = await import("./odometer-task");

const counter = (assetId: string) => ({
  v: 1 as const,
  type: "counter_delta" as const,
  entityId: `odometer:${assetId}`,
  threshold: 15000,
  unit: "km",
});

beforeEach(() => {
  call.mockReset();
  warn.mockClear();
});

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

  it("takes the vehicle the dashboard names without asking the server", async () => {
    await expect(
      odometerAssetOf({ id: "t1", assetId: "a1", odometerAssetId: "a1" }),
    ).resolves.toBe("a1");
    await expect(
      odometerAssetOf({ id: "t1", assetId: "a1", odometerAssetId: null }),
    ).resolves.toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("prefers the vehicle a caller names over the trigger", async () => {
    await expect(
      odometerAssetOf({
        id: "t1",
        assetId: "a1",
        odometerAssetId: null,
        trigger: counter("a2"),
      }),
    ).resolves.toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("reads the task of an asset when neither the vehicle nor the trigger is known", async () => {
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

  it("falls back to a plain completion when the lookup fails, and says so in the log", async () => {
    call.mockRejectedValueOnce(new Error("offline"));
    await expect(
      odometerAssetOf({ id: "t1", assetId: "a1" }),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
