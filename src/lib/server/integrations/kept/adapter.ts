import { IntegrationError } from "$lib/server/connections/errors";
import type {
  IntegrationAdapter,
  IntegrationOperation,
} from "$lib/server/connections/registry";
import { normalizeBaseUrl } from "./client";
import { parseConfig } from "./config";
import { KIND, clientFor, toIntegrationError } from "./connection";
import { KeptError, describeError, errorCode } from "./errors";
import { missingScopes } from "./schemas";

/** What Kept needs to allow for everything the adapter does. */
export const WANTED_SCOPES = [
  "transactions:read",
  "bills:read",
  "links:write",
  "categories:read",
] as const;

/** Normalises the address and the settings of a connection before it is saved. */
export function validateInput(input: {
  baseUrl: string;
  config: Record<string, unknown>;
}): { baseUrl: string; config: Record<string, unknown> } {
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(input.baseUrl);
  } catch (err) {
    throw toIntegrationError(err);
  }
  return { baseUrl, config: parseConfig(input.config) };
}

const categories: IntegrationOperation = async (connection) => {
  try {
    const list = await clientFor(connection).listCategories();
    return {
      items: list
        .map((c) => ({
          id: c.id,
          name: c.name,
          parentId: c.parentId,
          kind: c.kind,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } catch (err) {
    throw toIntegrationError(err);
  }
};

const accounts: IntegrationOperation = async (connection) => {
  try {
    const list = await clientFor(connection).listAccounts();
    return {
      items: list
        .map((a) => ({
          id: a.id,
          name: a.name,
          currency: a.currency,
          type: a.type,
          archived: a.archived,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } catch (err) {
    throw toIntegrationError(err);
  }
};

export const keptIntegration: IntegrationAdapter = {
  kind: KIND,
  validate: validateInput,
  async test(connection) {
    try {
      const me = await clientFor(connection).me();
      const missing = missingScopes(me, WANTED_SCOPES);
      return {
        ok: true,
        info: {
          defaultCurrency: me.defaultCurrency,
          scopes: me.token.scopes.join(","),
          /** Scopes the adapter would use that this token lacks; empty when all are held. */
          missingScopes: missing.join(","),
          categoryRestricted: me.token.categoryIds !== null,
        },
      };
    } catch (err) {
      if (err instanceof KeptError) {
        return { ok: false, error: { code: err.code, message: err.message } };
      }
      if (err instanceof IntegrationError) {
        return { ok: false, error: { code: err.code, message: err.message } };
      }
      return {
        ok: false,
        error: { code: errorCode(err), message: describeError(err) },
      };
    }
  },
  describe: () => ({ capabilities: ["categories", "accounts"] }),
  operations: { categories, accounts },
};
