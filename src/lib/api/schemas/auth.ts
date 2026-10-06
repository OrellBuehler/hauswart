import { z } from "zod";
import { USER_LOCALES, USER_ROLES } from "../enums";
import { isoTimestampSchema, scopeSchema } from "./common";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;
export const DISPLAY_NAME_MAX = 64;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9._-]+$/, {
    error:
      "Username may only contain letters, digits, dots, underscores and hyphens.",
  });

export const passwordSchema = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);

export const displayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX);

export const roleSchema = z.enum(USER_ROLES);
export const localeSchema = z.enum(USER_LOCALES);

export const userSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    displayName: z.string().nullable(),
    role: roleSchema,
    locale: localeSchema,
  })
  .meta({ id: "User" });
export type User = z.infer<typeof userSchema>;

export const userEnvelopeSchema = z.object({ user: userSchema });

export const setupStatusSchema = z.object({ needsSetup: z.boolean() });

export const setupRequestSchema = z.strictObject({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
  locale: localeSchema,
});

/** Login accepts any non-empty input so malformed usernames are just "invalid credentials". */
export const loginRequestSchema = z.strictObject({
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(PASSWORD_MAX),
});

export const AUTH_KINDS = ["session", "token"] as const;

export const meResponseSchema = z.object({
  user: userSchema,
  auth: z.enum(AUTH_KINDS),
  scopes: z.array(scopeSchema),
});

export const updateMeRequestSchema = z
  .strictObject({
    displayName: displayNameSchema.optional(),
    locale: localeSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    error: "Provide at least one field to update.",
  });

export const PLATFORM_MAX = 32;

export const tokenRequestSchema = z.strictObject({
  username: loginRequestSchema.shape.username,
  password: loginRequestSchema.shape.password,
  deviceName: z.string().trim().min(1).max(64),
  platform: z.string().trim().min(1).max(PLATFORM_MAX).optional(),
});

export const tokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: isoTimestampSchema,
  user: userSchema,
});
