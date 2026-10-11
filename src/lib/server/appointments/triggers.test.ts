import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { appointments, comments } from "$lib/server/db";
import { commentableOf } from "$lib/server/comments/registry";
import { search } from "$lib/server/search/search";
import { isOwnerTypeSupported } from "$lib/server/attachments/owners";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";

const SECRET = "tresor-code-4711";
const START = Date.UTC(2026, 5, 15, 8);

describe("appointment triggers", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);

  const appointment = (over: Partial<typeof appointments.$inferInsert> = {}) =>
    test.db
      .insert(appointments)
      .values({
        title: "Kaminfeger Muster",
        location: "Keller, Tür hinten",
        startsAt: new Date(START),
        endsAt: new Date(START + 3_600_000),
        ...over,
      })
      .returning()
      .get();

  const find = (q: string) => search(ctx(), { q, limit: 20 });

  describe("search", () => {
    it("finds an appointment by title or place and links to its page", () => {
      const a = appointment();
      for (const q of ["kaminfeger", "Keller", "tür hinten"]) {
        expect(find(q), q).toEqual([
          {
            type: "appointment",
            id: a.id,
            title: "Kaminfeger Muster",
            snippet: expect.any(String),
            url: `/appointments/${a.id}`,
          },
        ]);
      }
      expect(
        search(ctx(), { q: "kaminfeger", type: "appointment", limit: 5 }),
      ).toHaveLength(1);
      expect(
        search(ctx(), { q: "kaminfeger", type: "task", limit: 5 }),
      ).toEqual([]);
    });

    it("finds an appointment by its notes", () => {
      const a = appointment({ notes: "Bitte Leiter bereitstellen" });
      expect(find("leiter").map((h) => h.id)).toEqual([a.id]);
    });

    it("follows title, place and notes of an update", () => {
      const a = appointment();
      test.db
        .update(appointments)
        .set({
          title: "Schornsteinkontrolle",
          location: "Dachboden",
          notes: "Zugang über die Luke",
        })
        .where(eq(appointments.id, a.id))
        .run();
      expect(find("kaminfeger")).toEqual([]);
      expect(find("keller")).toEqual([]);
      expect(find("schornstein").map((h) => h.id)).toEqual([a.id]);
      expect(find("dachboden").map((h) => h.id)).toEqual([a.id]);
      expect(find("luke").map((h) => h.id)).toEqual([a.id]);
    });

    it("keeps the entry, once, when only the status changes", () => {
      const a = appointment();
      for (const status of ["done", "cancelled", "planned"] as const) {
        test.db
          .update(appointments)
          .set({ status })
          .where(eq(appointments.id, a.id))
          .run();
        expect(find("kaminfeger"), status).toHaveLength(1);
      }
    });

    it("cuts notes and place at the first block when they mention a secret", () => {
      appointment({
        location: `Hintereingang\n:::secret\nSafe ${SECRET}\n:::`,
        notes: `Einlass klären\n\n:::secret\nHaustürcode ${SECRET}\n:::\n\nDanach`,
      });
      expect(find("Hintereingang")).toHaveLength(1);
      expect(find("Einlass")).toHaveLength(1);
      expect(find(SECRET)).toEqual([]);
      expect(find("haustürcode")).toEqual([]);
      expect(find("danach")).toEqual([]);
    });

    it("indexes a text with a block that is not secret", () => {
      appointment({ notes: "Vorher\n:::tip\nKlingeln\n:::" });
      expect(find("klingeln")).toHaveLength(1);
    });

    it("removes the entry with the appointment", () => {
      const a = appointment();
      test.db.delete(appointments).where(eq(appointments.id, a.id)).run();
      expect(find("kaminfeger")).toEqual([]);
    });
  });

  describe("comments", () => {
    it("are possible on an appointment, with its title and page", () => {
      const a = appointment();
      const commentable = commentableOf("appointment")!;
      expect(commentable.exists(test.db, a.id)).toBe(true);
      expect(commentable.exists(test.db, "nope")).toBe(false);
      expect(commentable.title(test.db, a.id)).toBe("Kaminfeger Muster");
      expect(commentable.url(test.db, a.id)).toBe(`/appointments/${a.id}`);
    });

    it("go with the appointment when it is deleted, other comments stay", () => {
      const a = appointment();
      const other = appointment({ title: "Lieferung" });
      for (const id of [a.id, other.id]) {
        test.db
          .insert(comments)
          .values({
            entityType: "appointment",
            entityId: id,
            bodyMd: "Schlüssel hinterlegt",
          })
          .run();
      }
      test.db.delete(appointments).where(eq(appointments.id, a.id)).run();
      expect(test.db.select().from(comments).all()).toMatchObject([
        { entityId: other.id },
      ]);
    });
  });

  it("registers the appointment as an owner of attachments", () => {
    expect(isOwnerTypeSupported("appointment")).toBe(true);
  });
});
