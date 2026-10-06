import { describe, expect, it } from "vitest";
import { sessions, users } from "$lib/server/db";
import { useTestDB } from "./db";

describe("useTestDB", () => {
  const ctx = useTestDB();

  it("applies migrations and column defaults", () => {
    const [user] = ctx.db
      .insert(users)
      .values({ username: "alice", passwordHash: "x" })
      .returning()
      .all();
    expect(user.locale).toBe("de");
    expect(user.ownershipBps).toBe(5000);
    expect(user.role).toBe("member");
  });

  it("cascades sessions when a user is deleted", () => {
    const [user] = ctx.db
      .insert(users)
      .values({ username: "bob", passwordHash: "x" })
      .returning()
      .all();
    ctx.db
      .insert(sessions)
      .values({ id: "s1", userId: user.id, expiresAt: new Date() })
      .run();
    ctx.db.delete(users).run();
    expect(ctx.db.select().from(sessions).all()).toEqual([]);
  });

  it("gives every test a fresh database", () => {
    expect(ctx.db.select().from(users).all()).toEqual([]);
  });
});
