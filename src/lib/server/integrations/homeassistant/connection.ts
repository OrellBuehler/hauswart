import { getDB, type DB } from "$lib/server/db";
import {
  getConnectionRow,
  type ConnectionRow,
} from "$lib/server/connections/connections";
import { IntegrationError } from "$lib/server/connections/errors";
import type { ResolvedConnection } from "$lib/server/connections/registry";
import { HomeAssistantClient } from "./client";
import { HomeAssistantError, describeError, errorCode } from "./errors";

/** The kind name under which this adapter's connection and external references are stored. */
export const KIND = "homeassistant";
/** `assets.externalSource` of assets created from a device. */
export const EXTERNAL_SOURCE = "homeassistant";
/** `signals.source` of the readings this adapter stores. */
export const SIGNAL_SOURCE = "ha";

export function clientFor(connection: ResolvedConnection): HomeAssistantClient {
  return new HomeAssistantClient({
    baseUrl: connection.baseUrl,
    token: connection.token,
    allowInsecureTls: connection.allowInsecureTls,
    allowLoopback: connection.allowLoopback,
  });
}

/** The household's connection when it exists and is switched on. */
export function householdConnection(
  db: DB = getDB(),
): ConnectionRow | undefined {
  const row = getConnectionRow({ db }, KIND, null);
  return row?.enabled ? row : undefined;
}

/** What the core shows for an adapter failure: a stable code and a safe message, never a response body. */
export function toIntegrationError(err: unknown): IntegrationError {
  if (err instanceof IntegrationError) return err;
  if (err instanceof HomeAssistantError) {
    return new IntegrationError(err.code, err.message, { cause: err });
  }
  return new IntegrationError(errorCode(err), describeError(err), {
    cause: err,
  });
}
