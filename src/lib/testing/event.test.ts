import { error, redirect } from "@sveltejs/kit";
import { describe, expect, it } from "vitest";
import { FakeCookies, createTestEvent, outcome } from "./event";

describe("createTestEvent", () => {
  it("defaults to a GET request with empty locals", () => {
    const event = createTestEvent({ url: "http://localhost/api/v1/things" });
    expect(event.request.method).toBe("GET");
    expect(event.locals).toEqual({});
    expect(event.url.pathname).toBe("/api/v1/things");
  });

  it("builds a POST with a JSON body and locals", async () => {
    const event = createTestEvent({
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json" },
      locals: { user: { id: "u1" } },
    });
    expect(event.request.method).toBe("POST");
    expect(await event.request.json()).toEqual({ a: 1 });
    expect(event.locals.user).toEqual({ id: "u1" });
  });

  it("builds a form body", async () => {
    const event = createTestEvent({ form: { name: "x" } });
    expect((await event.request.formData()).get("name")).toBe("x");
  });
});

describe("FakeCookies", () => {
  it("stores, reads and deletes cookies", () => {
    const cookies = new FakeCookies({ a: "1" });
    cookies.set("b", "2", { path: "/" });
    expect(cookies.get("b")).toBe("2");
    expect(cookies.options("b")).toEqual({ path: "/" });
    cookies.delete("a");
    expect(cookies.get("a")).toBeUndefined();
    expect(cookies.deleted).toEqual(["a"]);
    expect(cookies.getAll()).toEqual([{ name: "b", value: "2" }]);
  });
});

describe("outcome", () => {
  it("classifies returns, redirects and http errors", async () => {
    expect(await outcome(() => 5)).toEqual({ type: "return", value: 5 });
    expect(
      await outcome(() => {
        redirect(303, "/login");
      }),
    ).toEqual({ type: "redirect", status: 303, location: "/login" });
    expect(
      await outcome(() => {
        error(404, "nope");
      }),
    ).toEqual({ type: "error", status: 404 });
  });

  it("rethrows unexpected errors", async () => {
    await expect(
      outcome(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
