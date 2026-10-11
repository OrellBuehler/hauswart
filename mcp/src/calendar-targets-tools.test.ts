import { describe, expect, it } from "vitest";
import {
  addTarget,
  connectCalendarSystem,
  useFakeCalendars,
} from "../../src/lib/server/calendar-sync/testing";
import { syncTarget } from "../../src/lib/server/calendar-sync/sync";
import { createAppointment } from "../../src/lib/server/appointments/appointments";
import { useMcp } from "./test-harness";

describe("calendar target tools", () => {
  const mcp = useMcp();
  const fake = useFakeCalendars();

  it("lists the calendars hauswart pushes into, with their health and what they allow", async () => {
    const { ok, db } = await mcp.connect({ scopes: ["read"] });
    const ctx = { db: db.db, now: Date.now() };
    connectCalendarSystem(ctx);
    const target = await addTarget(ctx, fake, {
      kinds: ["appointments", "warranty_ends"],
      capabilities: {
        create: true,
        update: false,
        delete: true,
        alarms: false,
      },
    });
    const starts = Date.now() + 2 * 86_400_000;
    createAppointment(
      ctx,
      { title: "Kaminfeger", startsAt: starts, endsAt: starts + 3_600_000 },
      null,
    );
    await syncTarget(ctx, target.id);

    const reply = await ok("list_calendar_targets");
    expect(reply.targets).toEqual([
      {
        id: target.id,
        name: "Name of calendar.example_household",
        provider: "homeassistant",
        level: "household",
        calendar: "calendar.example_household",
        enabled: true,
        kinds: ["appointments", "warranty_ends"],
        status: "ok",
        lastOkAt: expect.any(String),
        events: 1,
        canCreate: true,
        canUpdate: false,
        canDelete: true,
      },
    ]);
  });

  it("says so when there are none", async () => {
    const { call } = await mcp.connect({ scopes: ["read"] });
    const reply = await call("list_calendar_targets");
    expect(reply.summary).toBe("0 calendar targets.");
    expect(reply.json).toEqual({ targets: [] });
  });
});
