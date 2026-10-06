import { IntegrationError } from "$lib/server/connections/errors";
import type { ResolvedConnection } from "$lib/server/connections/registry";
import { KeptClient } from "./client";
import { KeptError, describeError, errorCode } from "./errors";

/** The kind name under which the connections of this adapter are stored. */
export const KIND = "kept";

/** The `source` of the back-links written to Kept: part of a link's identity there. */
export const LINK_SOURCE = "hauswart";

export function clientFor(connection: ResolvedConnection): KeptClient {
  return new KeptClient({
    baseUrl: connection.baseUrl,
    token: connection.token,
    allowInsecureTls: connection.allowInsecureTls,
  });
}

/** What the core shows for an adapter failure: a stable code and a safe message, never a response body. */
export function toIntegrationError(err: unknown): IntegrationError {
  if (err instanceof IntegrationError) return err;
  if (err instanceof KeptError) {
    return new IntegrationError(err.code, err.message, { cause: err });
  }
  return new IntegrationError(errorCode(err), describeError(err), {
    cause: err,
  });
}
