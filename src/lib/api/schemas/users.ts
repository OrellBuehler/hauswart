import { z } from "zod";
import { isoTimestampSchema, paginated } from "./common";
import {
  displayNameSchema,
  localeSchema,
  passwordSchema,
  roleSchema,
  userSchema,
  usernameSchema,
} from "./auth";

export const OWNERSHIP_BPS_TOTAL = 10_000;

export const ownershipBpsSchema = z
  .number()
  .int()
  .min(0)
  .max(OWNERSHIP_BPS_TOTAL);

export const adminUserSchema = userSchema
  .extend({
    ownershipBps: ownershipBpsSchema,
    createdAt: isoTimestampSchema,
  })
  .meta({ id: "AdminUser" });
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUserEnvelopeSchema = z.object({ user: adminUserSchema });

export const listUsersResponseSchema = paginated(adminUserSchema);

export const createUserRequestSchema = z.strictObject({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
  role: roleSchema.default("member"),
  locale: localeSchema.default("de"),
  ownershipBps: ownershipBpsSchema.optional(),
});

export const updateUserRequestSchema = z
  .strictObject({
    role: roleSchema.optional(),
    displayName: displayNameSchema.optional(),
    ownershipBps: ownershipBpsSchema.optional(),
    password: passwordSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    error: "Provide at least one field to update.",
  });

/** Just enough to render a person: names for assignee pickers and activity lines. */
export const directoryUserSchema = z
  .object({ id: z.string(), displayName: z.string() })
  .meta({ id: "DirectoryUser" });
export type DirectoryUser = z.infer<typeof directoryUserSchema>;

export const listDirectoryResponseSchema = paginated(directoryUserSchema);
