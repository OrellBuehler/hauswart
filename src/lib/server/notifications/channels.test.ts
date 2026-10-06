import { describe, expect, it, vi } from "vitest";
import {
  deliverToChannels,
  registerNotificationChannel,
  registeredChannels,
} from "./channels";

const notification = {
  id: "n1",
  userId: "u1",
  kind: "due",
  taskId: "t1",
  titleKey: "notification_due",
  params: { title: "x" },
  url: null,
  createdAt: new Date(0),
};

describe("notification channels", () => {
  it("registers, lists and unregisters by name", () => {
    const stop = registerNotificationChannel({
      name: "list-test",
      deliver: () => {},
    });
    expect(registeredChannels()).toContain("list-test");
    stop();
    expect(registeredChannels()).not.toContain("list-test");
  });

  it("an old unregister function does not remove a replacement", () => {
    const first = vi.fn();
    const second = vi.fn();
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

  it("awaits async deliveries and passes recipients through", async () => {
    let finished = false;
    const stop = registerNotificationChannel({
      name: "async",
      deliver: async (_n, recipients) => {
        await Promise.resolve();
        finished = recipients.length === 1;
      },
    });
    await deliverToChannels(notification, [{ id: "u1", locale: "de" }]);
    expect(finished).toBe(true);
    stop();
  });

  it("delivers to nobody when nothing is registered", async () => {
    await expect(deliverToChannels(notification, [])).resolves.toBeUndefined();
  });
});
