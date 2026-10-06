import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import { createGuestLinkRequestSchema } from "$lib/api/schemas/share";
import { verifyPassword } from "$lib/server/auth/password";
import { guestLinks } from "$lib/server/db";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import {
  addPinFailure,
  createGuestLink,
  findGuestLinkByToken,
  getGuestLink,
  isPinLocked,
  linkStatus,
  listGuestLinks,
  MAX_PIN_FAILURES,
  recordGuestView,
  revokeGuestLink,
  rotateGuestLink,
  updateGuestLink,
  VIEW_TOUCH_MS,
} from "./guest-links";
import { SHARE_TOKEN_PATTERN } from "./tokens";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const input = (over: Record<string, unknown> = {}) =>
  createGuestLinkRequestSchema.parse({
    label: "Wochenende",
    expiresAt: iso(NOW + 7 * DAY),
    ...over,
  });

describe("guest links", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  async function make(over: Record<string, unknown> = {}) {
    const user = await createTestUser({ displayName: "Anna" });
    const created = await createGuestLink(ctx(), user.id, "de", input(over));
    return { user, ...created };
  }
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (err) {
      return err instanceof ApiError ? err.code : (err as Error).name;
    }
    return null;
  };
  const fieldOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (err) {
      const body = (err as ApiError).details as {
        body: { fieldErrors: Record<string, string[]> };
      };
      return Object.keys(body?.body?.fieldErrors ?? {});
    }
    return [];
  };

  it("creates a link with a random token of which only the hash is stored", async () => {
    const { record, token, user } = await make();
    expect(token).toMatch(SHARE_TOKEN_PATTERN);
    expect(record).toMatchObject({
      label: "Wochenende",
      status: "active",
      createdBy: user.id,
      createdByName: "Anna",
      startsAt: null,
      revokedAt: null,
      hasPin: false,
      pinLocked: false,
      includeSecrets: false,
      sections: ["emergency", "rules", "contacts", "devices", "howto"],
      pageIds: [],
      locale: "de",
      lastViewedAt: null,
      viewCount: 0,
    });
    const [row] = test.db.select().from(guestLinks).all();
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(findGuestLinkByToken(ctx(), token)?.id).toBe(record.id);
  });

  it("takes the creator's language unless told otherwise", async () => {
    const user = await createTestUser();
    const en = await createGuestLink(ctx(), user.id, "en", input());
    expect(en.record.locale).toBe("en");
    const de = await createGuestLink(
      ctx(),
      user.id,
      "en",
      input({ locale: "de" }),
    );
    expect(de.record.locale).toBe("de");
  });

  describe("window", () => {
    it("requires an expiry in the future and within 90 days", async () => {
      const user = await createTestUser();
      const create = (over: Record<string, unknown>) =>
        createGuestLink(ctx(), user.id, "de", input(over));
      expect(await fieldOf(create({ expiresAt: iso(NOW) }))).toEqual([
        "expiresAt",
      ]);
      expect(await fieldOf(create({ expiresAt: iso(NOW - DAY) }))).toEqual([
        "expiresAt",
      ]);
      expect(
        await fieldOf(create({ expiresAt: iso(NOW + 90 * DAY + 1) })),
      ).toEqual(["expiresAt"]);
      expect(await codeOf(create({ expiresAt: iso(NOW + 90 * DAY) }))).toBe(
        null,
      );
      expect(await codeOf(create({ expiresAt: iso(NOW + 1000) }))).toBe(null);
    });

    it("needs the start before the expiry", async () => {
      const user = await createTestUser();
      const create = (over: Record<string, unknown>) =>
        createGuestLink(ctx(), user.id, "de", input(over));
      expect(
        await fieldOf(
          create({
            startsAt: iso(NOW + 8 * DAY),
            expiresAt: iso(NOW + 7 * DAY),
          }),
        ),
      ).toEqual(["startsAt"]);
      expect(
        await fieldOf(
          create({
            startsAt: iso(NOW + 7 * DAY),
            expiresAt: iso(NOW + 7 * DAY),
          }),
        ),
      ).toEqual(["startsAt"]);
    });

    it("is scheduled before the start, active inside, expired after, revoked when revoked", async () => {
      const { record } = await make({
        startsAt: iso(NOW + DAY),
        expiresAt: iso(NOW + 3 * DAY),
      });
      const row = test.db.select().from(guestLinks).get()!;
      expect(record.status).toBe("scheduled");
      expect(linkStatus(row, NOW + DAY - 1)).toBe("scheduled");
      expect(linkStatus(row, NOW + DAY)).toBe("active");
      expect(linkStatus(row, NOW + 3 * DAY - 1)).toBe("active");
      expect(linkStatus(row, NOW + 3 * DAY)).toBe("expired");
      revokeGuestLink(ctx(), record.id);
      expect(
        linkStatus(test.db.select().from(guestLinks).get()!, NOW + 2 * DAY),
      ).toBe("revoked");
    });
  });

  describe("pin", () => {
    it("is stored as an argon2 hash", async () => {
      const { record } = await make({ pin: "4711" });
      expect(record.hasPin).toBe(true);
      const row = test.db.select().from(guestLinks).get()!;
      expect(row.pinHash).toMatch(/^\$argon2id\$/);
      expect(row.pinHash).not.toContain("4711");
      expect(await verifyPassword("4711", row.pinHash!)).toBe(true);
      expect(await verifyPassword("4712", row.pinHash!)).toBe(false);
    });

    it("must be 4 to 8 digits", () => {
      for (const pin of ["123", "123456789", "12a4", "", " 1234", "１２３４"]) {
        expect(
          createGuestLinkRequestSchema.safeParse({
            label: "x",
            expiresAt: iso(NOW + DAY),
            pin,
          }).success,
          pin,
        ).toBe(false);
      }
      for (const pin of ["1234", "12345678", "0000"]) {
        expect(
          createGuestLinkRequestSchema.safeParse({
            label: "x",
            expiresAt: iso(NOW + DAY),
            pin,
          }).success,
          pin,
        ).toBe(true);
      }
    });

    it("can be changed and removed, and a new PIN reopens a link closed by wrong guesses", async () => {
      const { record } = await make({ pin: "4711" });
      for (let i = 0; i < MAX_PIN_FAILURES; i += 1) {
        addPinFailure(ctx(), record.id);
      }
      expect(getGuestLink(ctx(), record.id).pinLocked).toBe(true);
      const reset = await updateGuestLink(ctx(), record.id, { pin: "9999" });
      expect(reset).toMatchObject({ hasPin: true, pinLocked: false });
      expect(isPinLocked(test.db.select().from(guestLinks).get()!)).toBe(false);
      const removed = await updateGuestLink(ctx(), record.id, { pin: null });
      expect(removed.hasPin).toBe(false);
      expect(test.db.select().from(guestLinks).get()!.pinHash).toBeNull();
    });
  });

  describe("sections and pages", () => {
    it("deduplicates sections and page ids", async () => {
      const { record } = await make({
        sections: ["rules", "rules", "emergency"],
      });
      expect(record.sections).toEqual(["rules", "emergency"]);
    });

    it("refuses page ids that do not exist", async () => {
      const user = await createTestUser();
      expect(
        await fieldOf(
          createGuestLink(ctx(), user.id, "de", input({ pageIds: ["nope"] })),
        ),
      ).toEqual(["pageIds"]);
    });

    it("rejects unknown sections", () => {
      expect(
        createGuestLinkRequestSchema.safeParse({
          label: "x",
          expiresAt: iso(NOW + DAY),
          sections: ["everything"],
        }).success,
      ).toBe(false);
    });
  });

  describe("update", () => {
    it("changes only what is given", async () => {
      const { record } = await make({ pin: "4711", sections: ["rules"] });
      const updated = await updateGuestLink(ctx(), record.id, {
        label: "Neu",
        includeSecrets: true,
        locale: "en",
      });
      expect(updated).toMatchObject({
        label: "Neu",
        includeSecrets: true,
        locale: "en",
        hasPin: true,
        sections: ["rules"],
      });
      expect(updated.expiresAt).toEqual(record.expiresAt);
    });

    it("holds a new expiry to the 90 day window, but lets an expired link be edited", async () => {
      const { record } = await make({ expiresAt: iso(NOW + DAY) });
      expect(
        await fieldOf(
          updateGuestLink(ctx(), record.id, {
            expiresAt: iso(NOW + 91 * DAY),
          }),
        ),
      ).toEqual(["expiresAt"]);
      const later = ctx(NOW + 5 * DAY);
      expect(getGuestLink(later, record.id).status).toBe("expired");
      const renamed = await updateGuestLink(later, record.id, { label: "x" });
      expect(renamed.status).toBe("expired");
      const extended = await updateGuestLink(later, record.id, {
        expiresAt: iso(NOW + 10 * DAY),
      });
      expect(extended.status).toBe("active");
    });

    it("keeps start and expiry in order", async () => {
      const { record } = await make({ expiresAt: iso(NOW + 2 * DAY) });
      expect(
        await fieldOf(
          updateGuestLink(ctx(), record.id, { startsAt: iso(NOW + 3 * DAY) }),
        ),
      ).toEqual(["startsAt"]);
      const set = await updateGuestLink(ctx(), record.id, {
        startsAt: iso(NOW + DAY),
      });
      expect(set.startsAt).toEqual(new Date(NOW + DAY));
      const cleared = await updateGuestLink(ctx(), record.id, {
        startsAt: null,
      });
      expect(cleared.startsAt).toBeNull();
    });

    it("refuses to change a revoked link and an unknown one", async () => {
      const { record } = await make();
      revokeGuestLink(ctx(), record.id);
      expect(
        await codeOf(updateGuestLink(ctx(), record.id, { label: "x" })),
      ).toBe("conflict");
      expect(await codeOf(updateGuestLink(ctx(), "nope", { label: "x" }))).toBe(
        "not_found",
      );
    });
  });

  describe("rotate and revoke", () => {
    it("rotation gives a new token and kills the old one", async () => {
      const { record, token } = await make({ pin: "4711" });
      const rotated = rotateGuestLink(ctx(), record.id);
      expect(rotated.token).not.toBe(token);
      expect(rotated.record).toMatchObject({ id: record.id, hasPin: true });
      expect(findGuestLinkByToken(ctx(), token)).toBeNull();
      expect(findGuestLinkByToken(ctx(), rotated.token)?.id).toBe(record.id);
    });

    it("revoking is idempotent and keeps the row", async () => {
      const { record, token } = await make();
      revokeGuestLink(ctx(), record.id);
      const first = getGuestLink(ctx(), record.id).revokedAt;
      revokeGuestLink(ctx(NOW + DAY), record.id);
      expect(getGuestLink(ctx(), record.id).revokedAt).toEqual(first);
      expect(first).toEqual(new Date(NOW));
      expect(findGuestLinkByToken(ctx(), token)?.revokedAt).not.toBeNull();
      expect(() => rotateGuestLink(ctx(), record.id)).toThrow(ApiError);
      expect(() => revokeGuestLink(ctx(), "nope")).toThrow(ApiError);
    });
  });

  it("finds links by token only for well-formed, known tokens", async () => {
    const { token } = await make();
    expect(findGuestLinkByToken(ctx(), "x".repeat(43))).toBeNull();
    expect(findGuestLinkByToken(ctx(), token.slice(1))).toBeNull();
    expect(findGuestLinkByToken(ctx(), `${token}x`)).toBeNull();
    expect(findGuestLinkByToken(ctx(), "")).toBeNull();
  });

  it("lists every link, newest first, with its creator", async () => {
    const user = await createTestUser({ displayName: "Anna" });
    const a = await createGuestLink(ctx(NOW), user.id, "de", input());
    test.db
      .update(guestLinks)
      .set({ createdAt: new Date(NOW - DAY) })
      .where(eq(guestLinks.id, a.record.id))
      .run();
    const b = await createGuestLink(
      ctx(NOW),
      user.id,
      "de",
      input({ label: "B" }),
    );
    const list = listGuestLinks(ctx());
    expect(list.map((l) => l.id)).toEqual([b.record.id, a.record.id]);
    expect(list[0].createdByName).toBe("Anna");
  });

  it("keeps the link when its creator is deleted", async () => {
    const { record, user } = await make();
    test.db.$client.exec(`delete from users where id = '${user.id}'`);
    expect(getGuestLink(ctx(), record.id)).toMatchObject({
      createdBy: null,
      createdByName: null,
    });
  });

  it("counts views at most once per ten minutes", async () => {
    const { record } = await make();
    const row = () => test.db.select().from(guestLinks).get()!;
    recordGuestView(ctx(NOW), row());
    expect(row()).toMatchObject({ viewCount: 1 });
    expect(row().lastViewedAt).toEqual(new Date(NOW));
    recordGuestView(ctx(NOW + VIEW_TOUCH_MS - 1), row());
    expect(row().viewCount).toBe(1);
    recordGuestView(ctx(NOW + VIEW_TOUCH_MS), row());
    expect(row().viewCount).toBe(2);
    expect(getGuestLink(ctx(), record.id).updatedAt).toEqual(record.updatedAt);
  });
});
