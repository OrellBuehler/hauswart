import { describe, expect, it, vi } from "vitest";
import {
  allChannels,
  getChannel,
  registerNotificationChannel,
  registeredChannels,
  type NotificationChannel,
} from "./channels";

describe("notification channels", () => {
  it("registers, lists and unregisters by name", () => {
    const stop = registerNotificationChannel({
      name: "list-test",
      deliver: () => [],
    });
    expect(registeredChannels()).toContain("list-test");
    stop();
    expect(registeredChannels()).not.toContain("list-test");
  });

  it("an old unregister function does not remove a replacement", () => {
    const first = vi.fn<NotificationChannel["deliver"]>(() => []);
    const second = vi.fn<NotificationChannel["deliver"]>(() => []);
    const stopFirst = registerNotificationChannel({
      name: "swap",
      deliver: first,
    });
    const stopSecond = registerNotificationChannel({
      name: "swap",
      deliver: second,
    });
    stopFirst();
    expect(registeredChannels()).toContain("swap");
    stopSecond();
    expect(registeredChannels()).not.toContain("swap");
  });

  it("finds a channel by name and lists them all", () => {
    const stop = registerNotificationChannel({
      name: "lookup",
      deliver: () => [],
    });
    expect(getChannel("lookup")?.name).toBe("lookup");
    expect(allChannels().map((c) => c.name)).toContain("lookup");
    stop();
    expect(getChannel("lookup")).toBeUndefined();
  });
});
