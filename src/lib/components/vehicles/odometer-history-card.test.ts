import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { OdometerReading } from "$lib/api/schemas/vehicles";
import OdometerHistoryCard from "./odometer-history-card.svelte";

const reading = (
  id: string,
  source: OdometerReading["source"],
  value: number,
): OdometerReading => ({
  id,
  assetId: "a1",
  date: "2026-10-01",
  value,
  source,
  sourceId: source === "manual" ? null : "x",
  note: null,
  createdBy: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
});

function html(readings: OdometerReading[], canWrite = true): string {
  return render(OdometerHistoryCard as never, {
    props: {
      assetId: "a1",
      unit: "km",
      readings,
      nextCursor: null,
      canWrite,
    } as never,
  }).body;
}

describe("OdometerHistoryCard", () => {
  it("offers deleting only the readings a person typed in", () => {
    const body = html([
      reading("1", "manual", 45000),
      reading("2", "completion", 44900),
      reading("3", "service_log", 44800),
      reading("4", "fuel_log", 44700),
      reading("5", "tire_change", 44600),
    ]);
    expect(body.match(/aria-label="Stand [^"]* vom [^"]* löschen"/g)).toEqual([
      expect.stringContaining("45"),
    ]);
  });

  it("offers no delete to a person who may not write", () => {
    const body = html([reading("1", "manual", 45000)], false);
    expect(body).not.toMatch(/löschen"/);
  });

  it("names where a reading came from", () => {
    const body = html([reading("4", "fuel_log", 44700)]);
    expect(body).toContain("Tankbuch");
  });
});
