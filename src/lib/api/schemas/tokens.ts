import { z } from "zod";
import { TOKEN_KINDS } from "../enums";
import { isoTimestampSchema, paginated, scopeSchema } from "./common";

export const TOKEN_NAME_MAX = 64;

export const apiTokenSchema = z
  .object({
    id: z.string(),
    kind: z.enum(TOKEN_KINDS),
    name: z.string(),
    prefix: z.string(),
    scopes: z.array(scopeSchema),
    lastUsedAt: isoTimestampSchema.nullable(),
    expiresAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
  })
  .meta({ id: "ApiToken" });
export type ApiToken = z.infer<typeof apiTokenSchema>;

export const listTokensResponseSchema = paginated(apiTokenSchema);

/** `mobile` tokens are only issued by the device login (`POST /auth/token`). */
export const CREATABLE_TOKEN_KINDS = ["integration", "ha", "mcp"] as const;

export const createTokenRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(TOKEN_NAME_MAX),
  kind: z.enum(CREATABLE_TOKEN_KINDS),
  scopes: z
    .array(scopeSchema)
    .min(1)
    .max(scopeSchema.options.length)
    .transform((scopes) => [...new Set(scopes)]),
  expiresAt: isoTimestampSchema.nullable().optional(),
});

/** The plaintext `token` is returned exactly once, on creation. */
export const createdTokenSchema = apiTokenSchema
  .extend({ token: z.string() })
  .meta({ id: "CreatedApiToken" });
