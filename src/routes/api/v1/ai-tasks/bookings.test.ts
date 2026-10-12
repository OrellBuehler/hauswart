import { describe, expect, it } from "vitest";
import type { AiTask } from "$lib/api/schemas/ai-tasks";
import { plainPng } from "$lib/server/files/test-images";
import { createCaller, errorCode } from "$lib/testing/api";
import { createTestUser, loginTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { useTestFilesDir } from "$lib/testing/files";

interface CostBody {
  id: string;
  reviewNeeded: boolean;
  receiptTaskId: string | null;
}

describe("entries booked for a receipt task, through the API", () => {
  useTestDB();
  useTestFilesDir();

  async function world() {
    const anna = await createTestUser({ displayName: "Anna", role: "admin" });
    const call = createCaller({ session: loginTestUser(anna).token });
    const upload = async () =>
      (
        await call("POST", "/api/v1/ai-tasks", {
          form: {
            file: new File([plainPng(64, 48) as BlobPart], "beleg.png", {
              type: "image/png",
            }),
          },
        })
      ).body as AiTask;
    const book = (json: Record<string, unknown> = {}) =>
      call("POST", "/api/v1/costs", {
        json: {
          title: "Einkauf",
          amountMinor: 2340,
          category: "groceries",
          date: "2026-06-10",
          ...json,
        },
      });
    const task = async (id: string) =>
      (await call("GET", `/api/v1/ai-tasks/${id}`)).body as AiTask;
    return { anna, call, upload, book, task };
  }

  it("flags the entry, shows the task on it and lists the entry on the task", async () => {
    const { upload, book, task } = await world();
    const open = await upload();
    expect(open.bookedSoFar).toEqual([]);
    const r = await book({ receiptTaskId: open.id });
    expect(r.res.status).toBe(201);
    const entry = r.body as CostBody;
    expect(entry).toMatchObject({
      receiptTaskId: open.id,
      reviewNeeded: true,
    });
    expect((await task(open.id)).bookedSoFar).toEqual([
      expect.objectContaining({
        id: entry.id,
        title: "Einkauf",
        amountMinor: 2340,
        currency: "CHF",
        reviewNeeded: true,
        fuelLogId: null,
      }),
    ]);
    // an ordinary entry knows no task
    expect((await book()).body).toMatchObject({
      receiptTaskId: null,
      reviewNeeded: false,
    });
  });

  it("answers 400 on the field for a task that does not exist and 409 for one that is closed", async () => {
    const { call, upload, book } = await world();
    const missing = await book({ receiptTaskId: "missing" });
    expect(missing.res.status).toBe(400);
    expect(
      (
        missing.body as {
          error: { details: { body: { fieldErrors: object } } };
        }
      ).error.details.body.fieldErrors,
    ).toHaveProperty("receiptTaskId");
    const closed = await upload();
    await call("POST", `/api/v1/ai-tasks/${closed.id}/dismiss`, { json: {} });
    const late = await book({ receiptTaskId: closed.id });
    expect([late.res.status, errorCode(late)]).toEqual([409, "conflict"]);
  });

  it("books a fill for the task through the fuel log", async () => {
    const { call, upload, task } = await world();
    const car = (
      await call("POST", "/api/v1/assets", {
        json: { name: "Auto", kind: "vehicle" },
      })
    ).body as { id: string };
    const open = await upload();
    const fill = await call("POST", `/api/v1/assets/${car.id}/fuel-logs`, {
      json: {
        date: "2026-06-01",
        odometer: 80_000,
        quantity: 40,
        amountMinor: 7_200,
        receiptTaskId: open.id,
      },
    });
    expect(fill.res.status).toBe(201);
    const booked = (await task(open.id)).bookedSoFar;
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({
      fuelLogId: (fill.body as { id: string }).id,
      reviewNeeded: true,
    });
    const free = await call("POST", `/api/v1/assets/${car.id}/fuel-logs`, {
      json: {
        date: "2026-06-02",
        odometer: 80_500,
        quantity: 10,
        amountMinor: 0,
        receiptTaskId: open.id,
      },
    });
    expect(free.res.status).toBe(400);
  });

  it("completes with what was booked for it, and refuses what existed before the task or belongs to another", async () => {
    const { call, upload, book, task } = await world();
    const before = (await book()).body as CostBody;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const open = await upload();
    const other = await upload();
    const mine = (await book({ receiptTaskId: open.id })).body as CostBody;
    const theirs = (await book({ receiptTaskId: other.id })).body as CostBody;

    for (const wrong of [before.id, theirs.id]) {
      const r = await call("POST", `/api/v1/ai-tasks/${open.id}/complete`, {
        json: { createdCostIds: [wrong] },
      });
      expect([wrong, r.res.status, errorCode(r)]).toEqual([
        wrong,
        400,
        "invalid_request",
      ]);
      expect(JSON.stringify(r.body)).toContain(wrong);
    }
    expect((await task(open.id)).status).toBe("pending");

    const done = await call("POST", `/api/v1/ai-tasks/${open.id}/complete`, {
      json: { createdCostIds: [mine.id] },
    });
    expect(done.res.status).toBe(200);
    expect(done.body).toMatchObject({
      status: "done",
      bookedSoFar: [{ id: mine.id }],
      result: { costs: [{ id: mine.id }] },
    });
  });
});
