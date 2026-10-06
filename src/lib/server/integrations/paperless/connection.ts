import { getDB, type DB } from "$lib/server/db";
import {
  getConnectionRow,
  type ConnectionRow,
} from "$lib/server/connections/connections";
import { IntegrationError } from "$lib/server/connections/errors";
import type { ResolvedConnection } from "$lib/server/connections/registry";
import { PaperlessClient } from "./client";
import { PaperlessError, describeError, errorCode } from "./errors";

/** The kind name under which this adapter's connections and document references are stored. */
export const KIND = "paperless";

export function clientFor(connection: ResolvedConnection): PaperlessClient {
  return new PaperlessClient({
    baseUrl: connection.baseUrl,
    token: connection.token,
    allowInsecureTls: connection.allowInsecureTls,
    allowLoopback: connection.allowLoopback,
  });
}

/** A person's own connection when it exists and is switched on. */
export function userConnection(
  userId: string,
  db: DB = getDB(),
): ConnectionRow | undefined {
  const row = getConnectionRow({ db }, KIND, userId);
  return row?.enabled ? row : undefined;
}

/** What the core shows for an adapter failure: a stable code and a safe message, never a response body. */
export function toIntegrationError(err: unknown): IntegrationError {
  if (err instanceof IntegrationError) return err;
  if (err instanceof PaperlessError) {
    return new IntegrationError(err.code, err.message, { cause: err });
  }
  return new IntegrationError(errorCode(err), describeError(err), {
    cause: err,
  });
}

/** Runs a client call and reports its failure as an `IntegrationError`. */
export async function guarded<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    throw toIntegrationError(err);
  }
}
