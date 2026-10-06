import type { DocumentProviderKind } from "$lib/api/enums";
import { ApiError } from "$lib/api/errors";
import {
  documentProviderConfigSchema,
  type DocumentProviderConfig,
} from "$lib/api/schemas/documents";
import {
  getConnectionRow,
  resolveConnection,
  type ConnectionRow,
} from "$lib/server/connections/connections";
import { IntegrationError } from "$lib/server/connections/errors";
import type { ResolvedConnection } from "$lib/server/connections/registry";
import { notFound, type ServiceContext } from "$lib/server/service";
import { getDocumentProvider, type DocumentProvider } from "./provider";

type Db = Pick<ServiceContext, "db">;

/** The connection settings of a document provider; unusable values fall back to the defaults. */
export function parseProviderConfig(
  raw: Record<string, unknown>,
): DocumentProviderConfig {
  const parsed = documentProviderConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : documentProviderConfigSchema.parse({});
}

/** A person's own connection to a document provider, ready to use. */
export interface DocumentSession {
  row: ConnectionRow;
  connection: ResolvedConnection;
  provider: DocumentProvider;
  config: DocumentProviderConfig;
}

/** The caller's connection row of `kind` when it exists and is switched on; never another person's. */
export function ownConnectionRow(
  ctx: Db,
  kind: DocumentProviderKind,
  userId: string,
): ConnectionRow | undefined {
  const row = getConnectionRow(ctx, kind, userId);
  return row?.enabled ? row : undefined;
}

/**
 * The caller's own connection, with its token. 404 when they have none (or the adapter is not
 * running): documents are read with the caller's account only, never with someone else's.
 */
export function documentSession(
  ctx: Db,
  kind: DocumentProviderKind,
  userId: string,
): DocumentSession {
  const row = ownConnectionRow(ctx, kind, userId);
  const provider = getDocumentProvider(kind);
  if (!row || !provider) throw notFound("Connection");
  try {
    return {
      row,
      provider,
      connection: resolveConnection(row),
      config: parseProviderConfig(row.configJson),
    };
  } catch (err) {
    throw toApiError(err);
  }
}

/** What the caller sees of a provider failure: the document is not there, not allowed, or the system is not answering. */
export function toApiError(err: unknown): unknown {
  if (!(err instanceof IntegrationError)) return err;
  if (err.code === "not_found") return notFound("Document");
  if (err.code === "forbidden") {
    return new ApiError("forbidden", err.message, {
      details: { code: err.code },
    });
  }
  return new ApiError("upstream_error", err.message, {
    details: { code: err.code },
  });
}

/** Runs a provider call and turns its failure into an API error. */
export async function viaProvider<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    throw toApiError(err);
  }
}
