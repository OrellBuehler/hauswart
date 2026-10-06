import { timingSafeEqual } from "node:crypto";
import { hashToken } from "$lib/server/auth/sessions";

/** 32 random bytes as base64url: 43 characters. */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateShareToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}

/** sha256 hex: all that is stored of a token that must not be shown again. */
export const hashShareToken = hashToken;

/** Constant-time comparison of two hex digests. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
