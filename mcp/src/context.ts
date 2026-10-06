import type { ApiClient } from "../../src/lib/api/client";
import { isApiError } from "../../src/lib/api/errors";
import { endpoints } from "../../src/lib/api/registry";
import type { Scope } from "../../src/lib/api/scopes";
import type { Asset } from "../../src/lib/api/schemas/assets";
import type { Household } from "../../src/lib/api/schemas/household";
import type { Room } from "../../src/lib/api/schemas/rooms";
import { todayIn } from "../../src/lib/dates";
import { ToolError } from "./errors";

export interface Me {
  id: string;
  username: string;
  displayName: string | null;
  role: "admin" | "member";
}

export interface ToolContext {
  api: ApiClient;
  me: Me;
  scopes: readonly Scope[];
  household: Household;
  /** Today in the household time zone, `YYYY-MM-DD`. */
  today(): string;
  now(): number;
  newKey(): string;
  /** Household members by id. Looked up on demand: people are added rarely, calls are cheap. */
  users(): Promise<Map<string, string>>;
  /** A room by id, slug or name. */
  resolveRoom(ref: string): Promise<Room>;
  /** An asset by id or name (the API searches names, models and manufacturers, not slugs). */
  resolveAsset(ref: string): Promise<Asset>;
  /** A household member by `me`, id, display name or username. */
  resolveUser(ref: string): Promise<string>;
}

export interface ContextOptions {
  api: ApiClient;
  me: Me;
  scopes: readonly Scope[];
  household: Household;
  now?: () => number;
  newKey?: () => string;
}

const same = (a: string | null | undefined, b: string) =>
  a?.trim().toLowerCase() === b.trim().toLowerCase();

function ambiguous(kind: string, ref: string, names: string[]): ToolError {
  return new ToolError(
    "invalid_request",
    `${kind} "${ref}" is ambiguous; use the id. Candidates: ${names.join(", ")}`,
  );
}

export function createContext(options: ContextOptions): ToolContext {
  const { api, me, scopes, household } = options;
  const now = options.now ?? (() => Date.now());

  const ctx: ToolContext = {
    api,
    me,
    scopes,
    household,
    now,
    today: () => todayIn(household.timezone, now()),
    newKey: options.newKey ?? (() => crypto.randomUUID()),

    async users() {
      const { items } = await api.call(endpoints.usersDirectory);
      return new Map(items.map((u) => [u.id, u.displayName]));
    },

    async resolveRoom(ref) {
      const rooms: Room[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.call(endpoints.roomsList, {
          query: { cursor, limit: 200 },
        });
        rooms.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      const hits = rooms.filter(
        (r) => r.id === ref || same(r.slug, ref) || same(r.name, ref),
      );
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) {
        throw ambiguous(
          "Room",
          ref,
          hits.map((r) => `${r.name} (${r.id})`),
        );
      }
      throw new ToolError(
        "not_found",
        `No room "${ref}". Known rooms: ${rooms.map((r) => r.name).join(", ") || "none"}.`,
      );
    },

    async resolveAsset(ref) {
      if (ref.length <= 64) {
        try {
          return await api.call(endpoints.assetsGet, { params: { id: ref } });
        } catch (err) {
          if (!isApiError(err) || err.code !== "not_found") throw err;
        }
      }
      const { items } = await api.call(endpoints.assetsList, {
        query: { q: ref, limit: 50 },
      });
      const exact = items.filter((a) => same(a.name, ref) || same(a.slug, ref));
      const hits = exact.length > 0 ? exact : items;
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) {
        throw ambiguous(
          "Asset",
          ref,
          hits.map((a) => `${a.name} (${a.id})`),
        );
      }
      throw new ToolError("not_found", `No asset matches "${ref}".`);
    },

    async resolveUser(ref) {
      if (same("me", ref)) return me.id;
      const users = await ctx.users();
      if (users.has(ref)) return ref;
      const hits = [...users].filter(([, name]) => same(name, ref));
      if (hits.length === 1) return hits[0][0];
      if (hits.length > 1) {
        throw ambiguous(
          "User",
          ref,
          hits.map(([id, name]) => `${name} (${id})`),
        );
      }
      throw new ToolError(
        "not_found",
        `No household member "${ref}". Members: ${[...users.values()].join(", ")}.`,
      );
    },
  };
  return ctx;
}
