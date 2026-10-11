import { describe, expect, it } from "vitest";
import {
  assetIdOfOdometerKey,
  odometerAssetOfTrigger,
  odometerSignalKey,
} from "./odometer";

describe("odometerAssetOfTrigger", () => {
  it("names the vehicle whose odometer a counter trigger reads", () => {
    expect(
      odometerAssetOfTrigger({
        type: "counter_delta",
        entityId: odometerSignalKey("a1"),
      }),
    ).toBe("a1");
  });

  it("is null for a counter of anything else", () => {
    expect(
      odometerAssetOfTrigger({
        type: "counter_delta",
        entityId: "sensor.example_counter",
      }),
    ).toBeNull();
    expect(
      odometerAssetOfTrigger({ type: "counter_delta", entityId: "odometer:" }),
    ).toBeNull();
  });

  it("is null for other triggers and for none", () => {
    expect(odometerAssetOfTrigger({ type: "interval" })).toBeNull();
    expect(odometerAssetOfTrigger({ type: "one_off" })).toBeNull();
    expect(odometerAssetOfTrigger(null)).toBeNull();
    expect(odometerAssetOfTrigger(undefined)).toBeNull();
  });

  it("agrees with the key it is read from", () => {
    expect(assetIdOfOdometerKey(odometerSignalKey("a2"))).toBe("a2");
  });
});
