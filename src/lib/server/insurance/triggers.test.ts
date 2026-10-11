import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { comments, insurancePolicies } from "$lib/server/db";
import { commentableOf } from "$lib/server/comments/registry";
import { search } from "$lib/server/search/search";
import { minor } from "$lib/money";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";

const SECRET = "tresor-code-4711";

describe("insurance policy triggers", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);

  const policy = (over: Partial<typeof insurancePolicies.$inferInsert> = {}) =>
    test.db
      .insert(insurancePolicies)
      .values({
        title: "Hausrat Muster",
        policyNumber: "POL-2026-0042",
        premiumMinor: minor(48_000),
        currency: "CHF",
        startDate: "2026-01-01",
        assistancePhone: "000 000 00 00",
        ...over,
      })
      .returning()
      .get();

  const find = (q: string) => search(ctx(), { q, limit: 20 });

  describe("search", () => {
    it("finds a policy by title or policy number and links to its page", () => {
      const p = policy();
      for (const q of ["hausrat", "POL-2026-0042", "0042"]) {
        expect(find(q), q).toEqual([
          {
            type: "insurance_policy",
            id: p.id,
            title: "Hausrat Muster",
            snippet: expect.any(String),
            url: `/insurance/${p.id}`,
          },
        ]);
      }
      expect(
        search(ctx(), { q: "hausrat", type: "insurance_policy", limit: 5 }),
      ).toHaveLength(1);
    });

    it("never indexes the assistance phone", () => {
      policy();
      expect(find("000 000")).toEqual([]);
    });

    it("follows title, number and notes of an update", () => {
      const p = policy();
      test.db
        .update(insurancePolicies)
        .set({ title: "Privathaftpflicht", policyNumber: "HP-77" })
        .where(eq(insurancePolicies.id, p.id))
        .run();
      expect(find("hausrat")).toEqual([]);
      expect(find("privathaft").map((h) => h.id)).toEqual([p.id]);
      expect(find("HP-77").map((h) => h.id)).toEqual([p.id]);
    });

    it("drops archived policies and brings them back when restored", () => {
      const p = policy();
      test.db
        .update(insurancePolicies)
        .set({ archivedAt: new Date() })
        .where(eq(insurancePolicies.id, p.id))
        .run();
      expect(find("hausrat")).toEqual([]);
      test.db
        .update(insurancePolicies)
        .set({ archivedAt: null })
        .where(eq(insurancePolicies.id, p.id))
        .run();
      expect(find("hausrat")).toHaveLength(1);
      expect(
        find("hausrat"),
        "restoring does not duplicate the entry",
      ).toHaveLength(1);
    });

    it("does not index a policy that is created archived", () => {
      policy({ archivedAt: new Date() });
      expect(find("hausrat")).toEqual([]);
    });

    it("cuts notes at the first block when they mention a secret", () => {
      policy({
        notes: `Selbstbehalt gilt pro Fall\n\n:::secret\nOnline-Code ${SECRET}\n:::\n\nDanach`,
      });
      expect(find("Selbstbehalt")).toHaveLength(1);
      expect(find(SECRET)).toEqual([]);
      expect(find("online")).toEqual([]);
      expect(find("danach")).toEqual([]);
    });

    it("indexes notes that mention no secret", () => {
      const p = policy({ notes: "Kasko mit Teilkasko-Zusatz" });
      expect(find("teilkasko").map((h) => h.id)).toEqual([p.id]);
    });

    it("removes the entry with the policy", () => {
      const p = policy();
      test.db
        .delete(insurancePolicies)
        .where(eq(insurancePolicies.id, p.id))
        .run();
      expect(find("hausrat")).toEqual([]);
    });
  });

  describe("comments", () => {
    it("are possible on a policy, with its title and page", () => {
      const p = policy();
      const commentable = commentableOf("insurance_policy")!;
      expect(commentable.exists(test.db, p.id)).toBe(true);
      expect(commentable.exists(test.db, "nope")).toBe(false);
      expect(commentable.title(test.db, p.id)).toBe("Hausrat Muster");
      expect(commentable.url(test.db, p.id)).toBe(`/insurance/${p.id}`);
    });

    it("go with the policy when it is deleted, other comments stay", () => {
      const p = policy();
      const other = policy({ title: "Haftpflicht" });
      for (const id of [p.id, other.id]) {
        test.db
          .insert(comments)
          .values({
            entityType: "insurance_policy",
            entityId: id,
            bodyMd: "Prämie prüfen",
          })
          .run();
      }
      test.db
        .delete(insurancePolicies)
        .where(eq(insurancePolicies.id, p.id))
        .run();
      expect(test.db.select().from(comments).all()).toMatchObject([
        { entityId: other.id },
      ]);
    });
  });
});
