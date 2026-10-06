import { describe, expect, it } from "vitest";
import { DEFAULT_PUSH_STAGES } from "$lib/api/enums";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import {
  enabledTargets,
  getPrefs,
  getSettings,
  saveSettings,
} from "./settings";

describe("notification settings", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db, NOW);
  const input = (over = {}) => ({
    pushEnabled: true,
    quietStart: null,
    quietEnd: null,
    pushStages: ["due"] as ("due" | "overdue")[],
    targets: [] as { channel: "ha_notify"; target: string; enabled: boolean }[],
    ...over,
  });

  it("starts with the defaults and no targets", async () => {
    const user = await createTestUser();
    expect(getSettings(ctx(), user.id)).toEqual({
      pushEnabled: true,
      quietStart: null,
      quietEnd: null,
      pushStages: [...DEFAULT_PUSH_STAGES],
      targets: [],
    });
  });

  it("saves and replaces preferences and targets", async () => {
    const user = await createTestUser();
    saveSettings(
      ctx(),
      user.id,
      input({
        quietStart: "22:00",
        quietEnd: "07:00",
        targets: [
          {
            channel: "ha_notify",
            target: "mobile_app_example_phone",
            enabled: true,
          },
          {
            channel: "ha_notify",
            target: "mobile_app_example_tablet",
            enabled: false,
          },
        ],
      }),
    );
    expect(getPrefs(ctx(), user.id)).toMatchObject({
      quietStart: "22:00",
      pushStages: ["due"],
    });
    expect(enabledTargets(ctx(), user.id, "ha_notify")).toEqual([
      "mobile_app_example_phone",
    ]);
    const replaced = saveSettings(
      ctx(),
      user.id,
      input({
        pushEnabled: false,
        targets: [
          { channel: "ha_notify", target: "mobile_app_other", enabled: true },
        ],
      }),
    );
    expect(replaced.pushEnabled).toBe(false);
    expect(replaced.targets.map((t) => t.target)).toEqual(["mobile_app_other"]);
    expect(enabledTargets(ctx(), user.id, "ha_notify")).toEqual([
      "mobile_app_other",
    ]);
  });

  it("keeps people apart", async () => {
    const [a, b] = [await createTestUser(), await createTestUser()];
    saveSettings(
      ctx(),
      a.id,
      input({
        targets: [
          { channel: "ha_notify", target: "mobile_app_a", enabled: true },
        ],
      }),
    );
    expect(getSettings(ctx(), b.id).targets).toEqual([]);
    expect(enabledTargets(ctx(), b.id, "ha_notify")).toEqual([]);
  });
});
