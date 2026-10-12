import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import { createTestUser, loginTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

type FuelLog = {
  id: string;
  bookId: string | null;
  bookName: string | null;
  costEntryId: string | null;
};
type Cost = { bookId: string; bookName: string; splitMode: string };

describe("the cost book of fuel log entries through the API", () => {
  useTestDB();

  async function setup() {
    const user = await createTestUser();
    await createTestUser();
    const call = createCaller({ session: loginTestUser(user).token });
    const car = (
      await call("POST", "/api/v1/assets", {
        json: { name: "Familienauto", kind: "vehicle" },
      })
    ).body as { id: string };
    const books = (
      (await call("GET", "/api/v1/cost-books")).body as {
        items: { id: string; name: string }[];
      }
    ).items;
    const bookId = (name: string) => books.find((b) => b.name === name)!.id;
    const fill = (json: object = {}) =>
      call("POST", `/api/v1/assets/${car.id}/fuel-logs`, {
        json: { odometer: 80_000, quantity: 40, amountMinor: 7_200, ...json },
      });
    const remember = (costBookId: string | null) =>
      call("PUT", `/api/v1/assets/${car.id}/vehicle`, {
        json: { plate: "ZH 000000", costBookId },
      });
    const cost = async (log: FuelLog) =>
      (await call("GET", `/api/v1/costs/${log.costEntryId}`)).body as Cost;
    return { call, car, bookId, fill, remember, cost };
  }

  it("books into the default book, the vehicle's book or the one named, with the book's split", async () => {
    const { fill, remember, bookId, cost } = await setup();
    const plain = (await fill()).body as FuelLog;
    expect(plain).toMatchObject({
      bookId: bookId("Wohnung"),
      bookName: "Wohnung",
    });
    expect(await cost(plain)).toMatchObject({ splitMode: "ownership" });

    const saved = await remember(bookId("Auto"));
    expect(saved.res.status).toBe(200);
    expect(saved.body).toMatchObject({ costBookId: bookId("Auto") });
    const remembered = (await fill({ odometer: 80_100 })).body as FuelLog;
    expect(remembered).toMatchObject({ bookName: "Auto" });
    expect(await cost(remembered)).toMatchObject({ splitMode: "equal" });

    const named = (await fill({ odometer: 80_200, bookId: bookId("Haushalt") }))
      .body as FuelLog;
    expect(named.bookName).toBe("Haushalt");
  });

  it("answers 400 on bookId for an unknown or archived book", async () => {
    const { call, fill, bookId } = await setup();
    const missing = await fill({ bookId: "nope" });
    expect(missing.res.status).toBe(400);
    expect(errorCode(missing)).toBe("invalid_request");
    await call("PATCH", `/api/v1/cost-books/${bookId("Auto")}`, {
      json: { archived: true },
    });
    expect((await fill({ bookId: bookId("Auto") })).res.status).toBe(400);
  });

  it("moves the cost entry with PATCH and keeps it the fill's own", async () => {
    const { call, fill, bookId, cost } = await setup();
    const log = (await fill()).body as FuelLog;
    const moved = await call("PATCH", `/api/v1/fuel-logs/${log.id}`, {
      json: { bookId: bookId("Haushalt") },
    });
    expect(moved.res.status).toBe(200);
    expect(moved.body).toMatchObject({ bookName: "Haushalt" });
    expect(await cost(log)).toMatchObject({ bookName: "Haushalt" });
    const locked = await call("PATCH", `/api/v1/costs/${log.costEntryId}`, {
      json: { amountMinor: 1 },
    });
    expect(locked.res.status).toBe(409);
  });

  it("clears the remembered book when a save leaves it out, and refuses one that is not open", async () => {
    const { call, car, bookId, remember } = await setup();
    await remember(bookId("Auto"));
    const cleared = await call("PUT", `/api/v1/assets/${car.id}/vehicle`, {
      json: { plate: "ZH 000000" },
    });
    expect(cleared.body).toMatchObject({ costBookId: null });
    const missing = await remember("nope");
    expect(missing.res.status).toBe(400);
    expect(
      (
        missing.body as {
          error: { details: { body: { fieldErrors: object } } };
        }
      ).error.details.body.fieldErrors,
    ).toHaveProperty("costBookId");
  });
});
