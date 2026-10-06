import { describe, expect, it } from "vitest";
import { GET } from "./+server";

describe("GET /api/health", () => {
  it("reports ok without touching the database", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
