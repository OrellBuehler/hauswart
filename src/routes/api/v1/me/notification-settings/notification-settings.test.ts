import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

const URL = "/api/v1/me/notification-settings";

const valid = (over = {}) => ({
  pushEnabled: true,
  quietStart: "22:00",
  quietEnd: "07:00",
  pushStages: ["due", "overdue"],
  targets: [
    { channel: "ha_notify", target: "mobile_app_example_phone", enabled: true },
  ],
  ...over,
});

describe("notification settings API", () => {
  useTestDB();
  const as = async () => {
    const user = await createTestUser();
    return { user, call: createCaller({ session: loginTestUser(user).token }) };
  };

  it("starts with the defaults", async () => {
    const { call } = await as();
    const r = await call("GET", URL);
    expect(r.res.status).toBe(200);
    expect(r.body).toEqual({
      pushEnabled: true,
      quietStart: null,
      quietEnd: null,
      pushStages: ["prep", "due_soon", "due", "overdue", "hint", "comment"],
      targets: [],
    });
  });

  it("saves, replaces and returns the settings with target ids", async () => {
    const { call } = await as();
    const saved = await call("PUT", URL, { json: valid() });
    expect(saved.res.status).toBe(200);
    expect(saved.body).toMatchObject({
      pushEnabled: true,
      quietStart: "22:00",
      quietEnd: "07:00",
      pushStages: ["due", "overdue"],
      targets: [
        {
          channel: "ha_notify",
          target: "mobile_app_example_phone",
          enabled: true,
        },
      ],
    });
    expect(
      (saved.body as { targets: { id: string }[] }).targets[0].id,
    ).toBeTruthy();
    const replaced = await call("PUT", URL, {
      json: valid({
        targets: [],
        pushEnabled: false,
        quietStart: null,
        quietEnd: null,
      }),
    });
    expect(replaced.body).toMatchObject({
      pushEnabled: false,
      quietStart: null,
      targets: [],
    });
    expect((await call("GET", URL)).body).toEqual(replaced.body);
  });

  it("removes duplicate stages", async () => {
    const { call } = await as();
    const r = await call("PUT", URL, {
      json: valid({ pushStages: ["due", "due", "hint"] }),
    });
    expect((r.body as { pushStages: string[] }).pushStages).toEqual([
      "due",
      "hint",
    ]);
  });

  it.each([
    [
      "an uppercase target",
      {
        targets: [
          { channel: "ha_notify", target: "Mobile_App", enabled: true },
        ],
      },
    ],
    [
      "a target with a dot",
      {
        targets: [
          { channel: "ha_notify", target: "notify.mobile", enabled: true },
        ],
      },
    ],
    [
      "a target with a space",
      {
        targets: [{ channel: "ha_notify", target: "my phone", enabled: true }],
      },
    ],
    [
      "an empty target",
      { targets: [{ channel: "ha_notify", target: "", enabled: true }] },
    ],
    [
      "an unknown channel",
      { targets: [{ channel: "email", target: "a", enabled: true }] },
    ],
    [
      "a target listed twice",
      {
        targets: [
          { channel: "ha_notify", target: "mobile_app_a", enabled: true },
          { channel: "ha_notify", target: "mobile_app_a", enabled: false },
        ],
      },
    ],
    [
      "more than ten targets",
      {
        targets: Array.from({ length: 11 }, (_, i) => ({
          channel: "ha_notify",
          target: `mobile_app_${i}`,
          enabled: true,
        })),
      },
    ],
    [
      "only one end of the quiet hours",
      { quietStart: "22:00", quietEnd: null },
    ],
    ["a malformed time", { quietStart: "25:00", quietEnd: "07:00" }],
    ["an unknown stage", { pushStages: ["digest", "nonsense"] }],
    ["an unknown field", { surprise: true }],
  ])("refuses %s", async (_name, over) => {
    const { call } = await as();
    const r = await call("PUT", URL, { json: valid(over) });
    expect([r.res.status, errorCode(r)]).toEqual([400, "invalid_request"]);
  });

  it("keeps people apart: A's settings and targets are invisible to B and untouched by B", async () => {
    const [a, b] = [await as(), await as()];
    await a.call("PUT", URL, { json: valid() });
    expect((await b.call("GET", URL)).body).toMatchObject({ targets: [] });
    await b.call("PUT", URL, {
      json: valid({
        pushEnabled: false,
        targets: [
          { channel: "ha_notify", target: "mobile_app_b", enabled: true },
        ],
      }),
    });
    expect((await a.call("GET", URL)).body).toMatchObject({
      pushEnabled: true,
      targets: [{ target: "mobile_app_example_phone" }],
    });
  });

  it("reading needs read, saving needs write", async () => {
    const user = await createTestUser();
    const reader = createCaller({
      bearer: createTestToken(user, { scopes: ["read"] }).token,
    });
    const writer = createCaller({
      bearer: createTestToken(user, { scopes: ["write"] }).token,
    });
    expect((await reader("GET", URL)).res.status).toBe(200);
    expect((await reader("PUT", URL, { json: valid() })).res.status).toBe(403);
    expect((await writer("PUT", URL, { json: valid() })).res.status).toBe(200);
    expect((await writer("GET", URL)).res.status).toBe(403);
  });
});
