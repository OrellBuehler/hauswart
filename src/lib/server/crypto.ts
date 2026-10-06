import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
// The version prefix is authenticated, so it cannot be altered without detection.
const AAD = Buffer.from(VERSION);

// Publicly known key, used only outside production so dev and tests work
// without configuration. Never valid for real data.
const INSECURE_DEV_KEY = Buffer.alloc(KEY_BYTES, "hauswart-insecure-dev-key");

let warned = false;

const HELP =
  "HAUSWART_SECRET_KEY must be 32 random bytes encoded as base64. Generate one with: openssl rand -base64 32";

function parseKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  const key = Buffer.from(trimmed, "base64");
  return key.length === KEY_BYTES ? key : null;
}

function getKey(): Buffer {
  const raw = process.env.HAUSWART_SECRET_KEY;
  // Bun.env, not process.env: the bundler statically folds
  // `process.env.NODE_ENV` at build time, which would disable this check.
  const production = Bun.env.NODE_ENV === "production";
  if (raw === undefined || raw.trim() === "") {
    if (production) throw new Error(`HAUSWART_SECRET_KEY is not set. ${HELP}`);
    if (!warned) {
      warned = true;
      console.warn(
        "HAUSWART_SECRET_KEY is not set: using an INSECURE development key. Never do this in production.",
      );
    }
    return INSECURE_DEV_KEY;
  }
  const key = parseKey(raw);
  if (!key) throw new Error(`HAUSWART_SECRET_KEY is invalid. ${HELP}`);
  return key;
}

export function assertSecretKeyConfigured(): void {
  getKey();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(AAD);
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${VERSION}.${iv.toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const malformed = () =>
    new Error("Cannot decrypt secret: unsupported or malformed format");
  const parts = payload.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) throw malformed();
  const iv = Buffer.from(parts[1], "base64url");
  const body = Buffer.from(parts[2], "base64url");
  if (iv.length !== IV_BYTES || body.length < TAG_BYTES) throw malformed();
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(AAD);
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
  try {
    return Buffer.concat([
      decipher.update(body.subarray(0, body.length - TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch (cause) {
    throw new Error(
      "Cannot decrypt secret: data was tampered with or HAUSWART_SECRET_KEY is wrong",
      { cause },
    );
  }
}

function mac(purpose: string, message: string): Buffer {
  const key = createHmac("sha256", getKey())
    .update(`purpose:${purpose}`)
    .digest();
  return createHmac("sha256", key).update(message).digest();
}

/** HMAC-SHA256 (base64url) of `message`, keyed per `purpose` from `HAUSWART_SECRET_KEY`. */
export function signValue(purpose: string, message: string): string {
  return mac(purpose, message).toString("base64url");
}

/** Constant-time check of a `signValue` signature. */
export function verifySignature(
  purpose: string,
  message: string,
  signature: string,
): boolean {
  const given = Buffer.from(signature, "base64url");
  const expected = mac(purpose, message);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Test hook: re-arm the one-time dev-key warning. */
export function resetCryptoWarningForTests(): void {
  warned = false;
}
