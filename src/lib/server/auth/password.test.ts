import { describe, expect, it, vi } from "vitest";
import {
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
  warmDummyHash,
} from "./password";

describe("password", () => {
  it("hashes with argon2id and verifies", async () => {
    const hash = await hashPassword("a-long-enough-password");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("a-long-enough-password");
    expect(await verifyPassword("a-long-enough-password", hash)).toBe(true);
    expect(await verifyPassword("another-password", hash)).toBe(false);
  });

  it("salts: the same password hashes differently", async () => {
    expect(await hashPassword("same-password-1")).not.toBe(
      await hashPassword("same-password-1"),
    );
  });

  it("treats a malformed stored hash as a mismatch without leaking details", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await verifyPassword("whatever-password", "not-a-hash")).toBe(
        false,
      );
      expect(error).toHaveBeenCalledOnce();
      expect(JSON.stringify(error.mock.calls)).not.toContain(
        "whatever-password",
      );
    } finally {
      error.mockRestore();
    }
  });

  it("verifies against a cached dummy hash so unknown users cost the same", async () => {
    const first = await warmDummyHash();
    expect(await warmDummyHash()).toBe(first);
    expect(first).toMatch(/^\$argon2id\$/);
    await expect(verifyAgainstDummy("anything")).resolves.toBeUndefined();
  });
});
