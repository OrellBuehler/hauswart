import { and, asc, count, eq, isNull, ne } from "drizzle-orm";
import type { UserLocale, UserRole } from "$lib/api/enums";
import { usernameSchema } from "$lib/api/schemas/auth";
import { getDB, apiTokens, sessions, users } from "$lib/server/db";
import { hashPassword } from "$lib/server/auth/password";
import { AuthError, type SessionUser } from "$lib/server/auth/types";

export interface NewUser {
  username: string;
  password: string;
  role: UserRole;
  displayName?: string | null;
  locale?: UserLocale;
  ownershipBps?: number;
}

export interface UserRecord extends SessionUser {
  ownershipBps: number;
  createdAt: Date;
}

export interface UserPatch {
  role?: UserRole;
  displayName?: string;
  ownershipBps?: number;
  password?: string;
}

type Tx = Pick<
  ReturnType<typeof getDB>,
  "select" | "insert" | "update" | "delete"
>;

const userColumns = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  role: users.role,
  locale: users.locale,
  ownershipBps: users.ownershipBps,
  createdAt: users.createdAt,
};

export function toSessionUser(row: SessionUser): SessionUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    locale: row.locale,
  };
}

export function normalizeUsername(username: string): string {
  return usernameSchema.parse(username);
}

export function countUsers(): number {
  return getDB().select({ n: count() }).from(users).get()?.n ?? 0;
}

function insertUser(tx: Tx, input: NewUser, passwordHash: string): UserRecord {
  const username = normalizeUsername(input.username);
  const existing = tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .get();
  if (existing) {
    throw new AuthError("username_taken", "Username is already taken.");
  }
  return tx
    .insert(users)
    .values({
      username,
      passwordHash,
      role: input.role,
      displayName: input.displayName ?? null,
      ...(input.locale ? { locale: input.locale } : {}),
      ...(input.ownershipBps === undefined
        ? {}
        : { ownershipBps: input.ownershipBps }),
    })
    .returning(userColumns)
    .get();
}

export async function createUser(input: NewUser): Promise<UserRecord> {
  const passwordHash = await hashPassword(input.password);
  return getDB().transaction((tx) => insertUser(tx, input, passwordHash), {
    behavior: "immediate",
  });
}

/**
 * First-run setup: creates an admin only if no user exists. A cheap check runs before
 * the expensive password hash; the authoritative check and the insert share one immediate
 * transaction, so concurrent attempts cannot both win.
 */
export async function createFirstAdmin(
  input: Omit<NewUser, "role">,
): Promise<UserRecord> {
  if (countUsers() > 0) {
    throw new AuthError("setup_closed", "Setup has already been completed.");
  }
  const passwordHash = await hashPassword(input.password);
  return getDB().transaction(
    (tx) => {
      const n = tx.select({ n: count() }).from(users).get()?.n ?? 0;
      if (n > 0) {
        throw new AuthError(
          "setup_closed",
          "Setup has already been completed.",
        );
      }
      return insertUser(tx, { ...input, role: "admin" }, passwordHash);
    },
    { behavior: "immediate" },
  );
}

export function listUsers(): UserRecord[] {
  return getDB()
    .select(userColumns)
    .from(users)
    .orderBy(asc(users.username))
    .all();
}

export interface UpdateResult {
  user: UserRecord;
  roleChanged: boolean;
  passwordReset: boolean;
}

/**
 * Administrator edit of another (or their own) account. The last administrator
 * cannot be demoted. A password reset ends the account's sessions (except the
 * caller's own, `keepSessionId`) and revokes all of its live API tokens, since
 * they were issued against the old password. Demoting an administrator revokes
 * the tokens that hold the `admin` scope.
 */
export async function updateUser(
  targetId: string,
  patch: UserPatch,
  keepSessionId?: string,
): Promise<UpdateResult> {
  const passwordHash = patch.password
    ? await hashPassword(patch.password)
    : undefined;
  return getDB().transaction(
    (tx) => {
      const target = tx
        .select(userColumns)
        .from(users)
        .where(eq(users.id, targetId))
        .get();
      if (!target) throw new AuthError("user_not_found", "User not found.");

      const roleChanged =
        patch.role !== undefined && patch.role !== target.role;
      if (roleChanged && target.role === "admin") {
        const admins =
          tx
            .select({ n: count() })
            .from(users)
            .where(eq(users.role, "admin"))
            .get()?.n ?? 0;
        if (admins <= 1) {
          throw new AuthError(
            "cannot_demote_last_admin",
            "The last administrator cannot be demoted.",
          );
        }
      }

      const set = {
        ...(patch.role === undefined ? {} : { role: patch.role }),
        ...(patch.displayName === undefined
          ? {}
          : { displayName: patch.displayName }),
        ...(patch.ownershipBps === undefined
          ? {}
          : { ownershipBps: patch.ownershipBps }),
        ...(passwordHash === undefined ? {} : { passwordHash }),
      };
      const user =
        Object.keys(set).length === 0
          ? target
          : tx
              .update(users)
              .set(set)
              .where(eq(users.id, targetId))
              .returning(userColumns)
              .get();

      if (passwordHash !== undefined) {
        tx.delete(sessions)
          .where(
            keepSessionId
              ? and(
                  eq(sessions.userId, targetId),
                  ne(sessions.id, keepSessionId),
                )
              : eq(sessions.userId, targetId),
          )
          .run();
        tx.update(apiTokens)
          .set({ revokedAt: new Date() })
          .where(
            and(eq(apiTokens.userId, targetId), isNull(apiTokens.revokedAt)),
          )
          .run();
      } else if (
        roleChanged &&
        target.role === "admin" &&
        patch.role !== "admin"
      ) {
        const adminTokens = tx
          .select({ id: apiTokens.id, scopes: apiTokens.scopes })
          .from(apiTokens)
          .where(
            and(eq(apiTokens.userId, targetId), isNull(apiTokens.revokedAt)),
          )
          .all()
          .filter((t) => t.scopes.includes("admin"));
        for (const t of adminTokens) {
          tx.update(apiTokens)
            .set({ revokedAt: new Date() })
            .where(eq(apiTokens.id, t.id))
            .run();
        }
      }
      return { user, roleChanged, passwordReset: passwordHash !== undefined };
    },
    { behavior: "immediate" },
  );
}

/** A user changing their own display name or language. */
export function updateProfile(
  userId: string,
  patch: { displayName?: string; locale?: UserLocale },
): SessionUser {
  const row = getDB()
    .update(users)
    .set(patch)
    .where(eq(users.id, userId))
    .returning(userColumns)
    .get();
  if (!row) throw new AuthError("user_not_found", "User not found.");
  return toSessionUser(row);
}

export function findUserByUsername(username: string) {
  return getDB().select().from(users).where(eq(users.username, username)).get();
}

export function findUserById(id: string) {
  return getDB().select().from(users).where(eq(users.id, id)).get();
}
