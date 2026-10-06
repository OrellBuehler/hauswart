import { describe, expect, it } from "vitest";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { createTestEvent, outcome } from "$lib/testing/event";
import { load } from "./+page.server";

const run = (url: string, user: unknown = null) =>
  outcome(() => load(createTestEvent({ url, locals: { user } }) as never));

describe("login page load", () => {
  useTestDB();

  it("redirects to setup while no user exists", async () => {
    expect(await run("http://localhost/login")).toEqual({
      type: "redirect",
      status: 303,
      location: "/setup",
    });
  });

  it("returns the safe redirect target once users exist", async () => {
    await createTestUser();
    expect(await run("http://localhost/login?redirectTo=/tasks")).toEqual({
      type: "return",
      value: { redirectTo: "/tasks" },
    });
    expect(
      await run("http://localhost/login?redirectTo=//evil.example"),
    ).toEqual({ type: "return", value: { redirectTo: "/" } });
  });

  it("sends signed-in users on to their target", async () => {
    const user = await createTestUser();
    expect(await run("http://localhost/login?redirectTo=/tasks", user)).toEqual(
      {
        type: "redirect",
        status: 303,
        location: "/tasks",
      },
    );
  });
});
