import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

describe("GET /api/v1/costs/recent-categories", () => {
  useTestDB();

  it("answers with the counts per book, for every member, and is not the entry called recent-categories", async () => {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const asAnna = createCaller({ session: loginTestUser(anna).token });
    const book = (
      (await asAnna("GET", "/api/v1/cost-books")).body as {
        items: { id: string; name: string }[];
      }
    ).items.find((b) => b.name === "Haushalt")!;
    for (const category of ["dining", "dining", "groceries"]) {
      await asAnna("POST", "/api/v1/costs", {
        json: {
          title: "Eintrag",
          amountMinor: 1000,
          category,
          bookId: book.id,
        },
      });
    }
    const expected = {
      entriesPerBook: 100,
      items: [
        { bookId: book.id, category: "dining", count: 2 },
        { bookId: book.id, category: "groceries", count: 1 },
      ],
    };
    const r = await asAnna("GET", "/api/v1/costs/recent-categories");
    expect(r.res.status).toBe(200);
    expect(r.body).toEqual(expected);
    const forBook = await createCaller({
      bearer: createTestToken(ben, { scopes: ["read"] }).token,
    })("GET", `/api/v1/costs/recent-categories?bookId=${book.id}`);
    expect(forBook.body).toEqual(expected);
  });

  it("is a 404 for an unknown book", async () => {
    const anna = await createTestUser();
    const r = await createCaller({ session: loginTestUser(anna).token })(
      "GET",
      "/api/v1/costs/recent-categories?bookId=nope",
    );
    expect([r.res.status, errorCode(r)]).toEqual([404, "not_found"]);
  });
});
