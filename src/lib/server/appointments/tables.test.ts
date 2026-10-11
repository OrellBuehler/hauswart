import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { appointments, assets, contacts, tasks, users } from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

const START = Date.UTC(2026, 5, 15, 8);

describe("appointments table", () => {
  const test = useTestDB();

  const timed = (over: Partial<typeof appointments.$inferInsert> = {}) =>
    test.db
      .insert(appointments)
      .values({
        title: "Kaminfeger",
        startsAt: new Date(START),
        endsAt: new Date(START + 3_600_000),
        ...over,
      })
      .returning()
      .get();
  const allDay = (over: Partial<typeof appointments.$inferInsert> = {}) =>
    test.db
      .insert(appointments)
      .values({
        title: "Handwerker im Haus",
        allDay: true,
        startDate: "2026-06-15",
        endDate: "2026-06-16",
        ...over,
      })
      .returning()
      .get();

  it("fills in the defaults of a timed appointment", () => {
    const a = timed();
    expect(a).toMatchObject({
      allDay: false,
      status: "planned",
      notes: null,
      location: null,
      startDate: null,
      endDate: null,
      taskId: null,
      occurrenceKey: null,
      assetId: null,
      contactId: null,
      createdByUserId: null,
    });
    expect(a.id).toEqual(expect.any(String));
    expect(a.startsAt?.getTime()).toBe(START);
    expect(a.createdAt.getTime()).toBeGreaterThan(0);
    expect(a.updatedAt.getTime()).toBeGreaterThan(0);
  });

  it("keeps the dates of an all-day appointment as text", () => {
    const a = allDay();
    expect(a).toMatchObject({
      allDay: true,
      startDate: "2026-06-15",
      endDate: "2026-06-16",
      startsAt: null,
      endsAt: null,
    });
  });

  describe("shape of the time", () => {
    it.each<[string, Partial<typeof appointments.$inferInsert>]>([
      ["a timed appointment without an end", { endsAt: null }],
      ["a timed appointment without a start", { startsAt: null }],
      [
        "a timed appointment that ends when it starts",
        { endsAt: new Date(START) },
      ],
      [
        "a timed appointment that ends before it starts",
        { endsAt: new Date(START - 1) },
      ],
      [
        "a timed appointment that also has dates",
        { startDate: "2026-06-15", endDate: "2026-06-15" },
      ],
    ])("refuses %s", (_name, over) => {
      expect(() => timed(over)).toThrow(/CHECK/i);
    });

    it.each<[string, Partial<typeof appointments.$inferInsert>]>([
      ["an all-day appointment without a start date", { startDate: null }],
      ["an all-day appointment without an end date", { endDate: null }],
      [
        "an all-day appointment that ends before it starts",
        { endDate: "2026-06-14" },
      ],
      [
        "an all-day appointment that also has instants",
        { startsAt: new Date(START), endsAt: new Date(START + 1) },
      ],
    ])("refuses %s", (_name, over) => {
      expect(() => allDay(over)).toThrow(/CHECK/i);
    });

    it("accepts an all-day appointment of one day", () => {
      expect(allDay({ endDate: "2026-06-15" }).endDate).toBe("2026-06-15");
    });
  });

  describe("links", () => {
    async function linked() {
      const user = await createTestUser();
      const task = test.db
        .insert(tasks)
        .values({
          title: "Heizung warten",
          trigger: { v: 1, type: "one_off", date: "2026-07-01" },
        })
        .returning()
        .get();
      const asset = test.db
        .insert(assets)
        .values({ name: "Heizung", slug: "heizung", qrSlug: "qrheizung1" })
        .returning()
        .get();
      const contact = test.db
        .insert(contacts)
        .values({ name: "Muster Haustechnik AG" })
        .returning()
        .get();
      const a = timed({
        taskId: task.id,
        occurrenceKey: "2026-07-01",
        assetId: asset.id,
        contactId: contact.id,
        createdByUserId: user.id,
      });
      return { user, task, asset, contact, a };
    }
    const reload = (id: string) =>
      test.db.select().from(appointments).where(eq(appointments.id, id)).get()!;

    it("unlinks the task when it is deleted and keeps the appointment", async () => {
      const { task, a } = await linked();
      test.db.delete(tasks).where(eq(tasks.id, task.id)).run();
      expect(reload(a.id)).toMatchObject({
        taskId: null,
        assetId: a.assetId,
        contactId: a.contactId,
      });
    });

    it("unlinks the device when it is deleted", async () => {
      const { asset, a } = await linked();
      test.db.delete(assets).where(eq(assets.id, asset.id)).run();
      expect(reload(a.id)).toMatchObject({ assetId: null, taskId: a.taskId });
    });

    it("unlinks the contact when it is deleted", async () => {
      const { contact, a } = await linked();
      test.db.delete(contacts).where(eq(contacts.id, contact.id)).run();
      expect(reload(a.id)).toMatchObject({ contactId: null });
    });

    it("forgets the creator when the user is deleted", async () => {
      const { user, a } = await linked();
      test.db.delete(users).where(eq(users.id, user.id)).run();
      expect(reload(a.id)).toMatchObject({ createdByUserId: null });
    });

    it("refuses a link to something that does not exist", () => {
      expect(() => timed({ taskId: "nope" })).toThrow(/FOREIGN KEY/i);
      expect(() => timed({ assetId: "nope" })).toThrow(/FOREIGN KEY/i);
      expect(() => timed({ contactId: "nope" })).toThrow(/FOREIGN KEY/i);
    });
  });
});
