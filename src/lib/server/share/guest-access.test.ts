import { describe, expect, it } from "vitest";
import { createGuestLinkRequestSchema } from "$lib/api/schemas/share";
import { guestPinRateLimiter } from "$lib/server/auth/rate-limit";
import { guestLinks } from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import {
  attemptPin,
  GUEST_COOKIE_TTL_MS,
  hasPinAccess,
  pinCookie,
  resolveGuestAccess,
} from "./guest-access";
import {
  createGuestLink,
  MAX_PIN_FAILURES,
  revokeGuestLink,
  updateGuestLink,
} from "./guest-links";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("guest access", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  const row = () => test.db.select().from(guestLinks).get()!;

  async function make(over: Record<string, unknown> = {}) {
    const user = await createTestUser();
    return createGuestLink(
      ctx(),
      user.id,
      "de",
      createGuestLinkRequestSchema.parse({
        label: "Gäste",
        expiresAt: iso(NOW + 7 * DAY),
        ...over,
      }),
    );
  }

  describe("what a token opens", () => {
    it("an open link without a PIN", async () => {
      const { token } = await make();
      expect(resolveGuestAccess(ctx(), token, undefined).state).toBe("ok");
    });

    it("nothing for an unknown or malformed token", async () => {
      await make();
      expect(resolveGuestAccess(ctx(), "x".repeat(43), undefined).state).toBe(
        "unknown",
      );
      expect(resolveGuestAccess(ctx(), "nope", undefined).state).toBe(
        "unknown",
      );
    });

    it("gone when revoked, expired or not yet valid", async () => {
      const { record, token } = await make({ startsAt: iso(NOW + DAY) });
      expect(resolveGuestAccess(ctx(), token, undefined).state).toBe("gone");
      expect(resolveGuestAccess(ctx(NOW + DAY), token, undefined).state).toBe(
        "ok",
      );
      expect(
        resolveGuestAccess(ctx(NOW + 7 * DAY), token, undefined).state,
      ).toBe("gone");
      revokeGuestLink(ctx(), record.id);
      expect(resolveGuestAccess(ctx(NOW + DAY), token, undefined).state).toBe(
        "gone",
      );
    });

    it("locked until the PIN cookie is shown, closed after too many wrong PINs", async () => {
      const { record, token } = await make({ pin: "4711" });
      const locked = resolveGuestAccess(ctx(), token, undefined);
      expect(locked.state).toBe("locked");
      const cookie = pinCookie(row(), NOW).value;
      expect(resolveGuestAccess(ctx(), token, cookie).state).toBe("ok");
      test.db.update(guestLinks).set({ pinFailures: MAX_PIN_FAILURES }).run();
      expect(resolveGuestAccess(ctx(), token, cookie).state).toBe("gone");
      expect(resolveGuestAccess(ctx(), token, undefined).state).toBe("gone");
      await updateGuestLink(ctx(), record.id, { pin: "4711" });
      expect(resolveGuestAccess(ctx(), token, undefined).state).toBe("locked");
    });
  });

  describe("pin cookie", () => {
    it("is valid for twelve hours at most and never past the link's expiry", async () => {
      await make({ pin: "4711", expiresAt: iso(NOW + DAY) });
      const { value, expires } = pinCookie(row(), NOW);
      expect(expires.getTime()).toBe(NOW + GUEST_COOKIE_TTL_MS);
      expect(hasPinAccess(row(), value, NOW)).toBe(true);
      expect(hasPinAccess(row(), value, NOW + GUEST_COOKIE_TTL_MS - 1)).toBe(
        true,
      );
      expect(hasPinAccess(row(), value, NOW + GUEST_COOKIE_TTL_MS)).toBe(false);
      const late = pinCookie(row(), NOW + DAY - 1000);
      expect(late.expires.getTime()).toBe(NOW + DAY);
    });

    it("rejects tampering, other links, other PINs and junk", async () => {
      await make({ pin: "4711" });
      const first = row();
      const { value } = pinCookie(first, NOW);
      const [expires, signature] = value.split(".");
      expect(
        hasPinAccess(first, `${Number(expires) + 1}.${signature}`, NOW),
      ).toBe(false);
      expect(
        hasPinAccess(first, `${expires}.${signature.slice(1)}A`, NOW),
      ).toBe(false);
      for (const junk of [
        "",
        ".",
        "abc",
        "1.2.3",
        `x.${signature}`,
        `${expires}.`,
      ]) {
        expect(hasPinAccess(first, junk, NOW), junk).toBe(false);
      }
      expect(hasPinAccess(first, undefined, NOW)).toBe(false);

      const other = await make({ pin: "4711" });
      const otherRow = test.db
        .select()
        .from(guestLinks)
        .all()
        .find((r) => r.id === other.record.id)!;
      expect(hasPinAccess(otherRow, value, NOW)).toBe(false);
    });

    it("stops working when the PIN is changed or removed", async () => {
      const { record } = await make({ pin: "4711" });
      const { value } = pinCookie(row(), NOW);
      await updateGuestLink(ctx(), record.id, { pin: "4711" });
      expect(hasPinAccess(row(), value, NOW)).toBe(false);
    });
  });

  describe("attempts", () => {
    const ip = "203.0.113.7";

    it("accepts the right PIN, hands out the cookie and clears the failure count", async () => {
      await make({ pin: "4711" });
      await attemptPin(ctx(), row(), "0000", ip);
      expect(row().pinFailures).toBe(1);
      const r = await attemptPin(ctx(), row(), "4711", ip);
      expect(r.result).toBe("ok");
      if (r.result !== "ok") return;
      expect(hasPinAccess(row(), r.cookie.value, NOW)).toBe(true);
      expect(row().pinFailures).toBe(0);
    });

    it("counts wrong, malformed and empty PINs as failures", async () => {
      await make({ pin: "4711" });
      for (const pin of ["4712", "47", "abcd", "", "471100000"]) {
        expect((await attemptPin(ctx(), row(), pin, ip)).result, pin).toBe(
          "wrong",
        );
      }
      expect(row().pinFailures).toBe(5);
    });

    it("limits guesses per link and address, then per link", async () => {
      await make({ pin: "4711" });
      for (let i = 0; i < 5; i += 1) {
        expect((await attemptPin(ctx(), row(), "0000", ip)).result).toBe(
          "wrong",
        );
      }
      const blocked = await attemptPin(ctx(), row(), "4711", ip);
      expect(blocked.result).toBe("limited");
      expect(
        blocked.result === "limited" && blocked.retryAfterSeconds,
      ).toBeGreaterThan(0);
      // The correct PIN is refused while blocked, and the block costs no extra failure.
      expect(row().pinFailures).toBe(5);
      // Another address has its own budget, but the link's total is 10 per window.
      for (let i = 0; i < 5; i += 1) {
        await attemptPin(ctx(), row(), "0000", "198.51.100.1");
      }
      expect(
        (await attemptPin(ctx(), row(), "4711", "198.51.100.2")).result,
      ).toBe("limited");
    });

    it("refunds the attempt of a correct PIN", async () => {
      await make({ pin: "4711" });
      for (let i = 0; i < 4; i += 1) await attemptPin(ctx(), row(), "0000", ip);
      expect((await attemptPin(ctx(), row(), "4711", ip)).result).toBe("ok");
      expect((await attemptPin(ctx(), row(), "0000", ip)).result).toBe("wrong");
    });

    it("never verifies against a link without PIN", async () => {
      await make();
      expect((await attemptPin(ctx(), row(), "4711", ip)).result).toBe("wrong");
    });

    it("starts clean for every test (limiters are reset)", () => {
      expect(guestPinRateLimiter.acquire("some-link", ip).allowed).toBe(true);
    });
  });
});
