export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_LOCALES = ["de", "en"] as const;
export type UserLocale = (typeof USER_LOCALES)[number];

export const TOKEN_KINDS = ["mobile", "integration", "ha", "mcp"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];
