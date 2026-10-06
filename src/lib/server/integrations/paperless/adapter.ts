import { documentProviderConfigSchema } from "$lib/api/schemas/documents";
import { IntegrationError } from "$lib/server/connections/errors";
import type {
  IntegrationAdapter,
  IntegrationOperation,
} from "$lib/server/connections/registry";
import { normalizeBaseUrl } from "./client";
import { KIND, clientFor, guarded, toIntegrationError } from "./connection";
import { PaperlessError, describeError, errorCode } from "./errors";

function normalizeAppUrl(value: string): string {
  const fail = () =>
    new IntegrationError(
      "invalid_input",
      "The app address must be a valid http:// or https:// address without credentials.",
    );
  if (!URL.canParse(value)) throw fail();
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw fail();
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Normalises the address and keeps only the known settings (the ids are the person's choices;
 * whether they exist is not checked here, the pickers offer the real ones). A bad value is
 * reported against the settings, not silently dropped.
 */
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
  const parsed = documentProviderConfigSchema.safeParse(input.config);
  if (!parsed.success) {
    throw new IntegrationError("invalid_input", "The settings are not valid.");
  }
  const {
    appUrl,
    warrantyFieldId,
    warrantyExtendedFieldId,
    uploadStoragePathId,
    uploadCorrespondentId,
    ...rest
  } = parsed.data;
  if (
    warrantyFieldId &&
    warrantyExtendedFieldId &&
    warrantyFieldId === warrantyExtendedFieldId
  ) {
    throw new IntegrationError(
      "invalid_input",
      "The two warranty fields must be different fields.",
    );
  }
  return {
    baseUrl,
    config: {
      ...rest,
      ...optionalId("warrantyFieldId", warrantyFieldId),
      ...optionalId("warrantyExtendedFieldId", warrantyExtendedFieldId),
      ...optionalId("uploadStoragePathId", uploadStoragePathId),
      ...optionalId("uploadCorrespondentId", uploadCorrespondentId),
      ...(appUrl ? { appUrl: normalizeAppUrl(appUrl) } : {}),
    },
  };
}

/** A setting that is unset is left out of the stored config. */
function optionalId(
  key: string,
  value: number | null | undefined,
): Record<string, number> {
  return value ? { [key]: value } : {};
}

const matches = (query: Record<string, string>, name: string): boolean =>
  !query.q || name.toLowerCase().includes(query.q.toLowerCase());

const tags: IntegrationOperation = (connection, query) =>
  guarded(async () => ({
    items: (await clientFor(connection).listTags())
      .filter((t) => matches(query, t.name))
      .map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        documentCount: t.documentCount,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "de")),
  }));

const correspondents: IntegrationOperation = (connection, query) =>
  guarded(async () => ({
    items: (await clientFor(connection).listCorrespondents())
      .filter((c) => matches(query, c.name))
      .map((c) => ({
        id: c.id,
        name: c.name,
        documentCount: c.documentCount,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "de")),
  }));

const customFields: IntegrationOperation = (connection, query) =>
  guarded(async () => ({
    items: (await clientFor(connection).listCustomFields())
      .filter((f) => matches(query, f.name))
      .map((f) => ({ id: f.id, name: f.name, dataType: f.dataType }))
      .sort((a, b) => a.name.localeCompare(b.name, "de")),
  }));

const groups: IntegrationOperation = (connection, query) =>
  guarded(async () => ({
    items: (await clientFor(connection).listGroups())
      .filter((g) => matches(query, g.name))
      .map((g) => ({ id: g.id, name: g.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "de")),
  }));

const storagePaths: IntegrationOperation = (connection, query) =>
  guarded(async () => ({
    items: (await clientFor(connection).listStoragePaths())
      .filter((p) => matches(query, p.name))
      .map((p) => ({ id: p.id, name: p.name, path: p.path }))
      .sort((a, b) => a.name.localeCompare(b.name, "de")),
  }));

export const paperlessIntegration: IntegrationAdapter = {
  kind: KIND,
  validate: validateInput,
  async test(connection) {
    try {
      const info = await clientFor(connection).serverInfo();
      return {
        ok: true,
        info: {
          version: info.serverVersion,
          apiVersion: info.apiVersion,
          user: info.user?.username ?? null,
        },
      };
    } catch (err) {
      if (err instanceof PaperlessError) {
        return { ok: false, error: { code: err.code, message: err.message } };
      }
      return {
        ok: false,
        error: { code: errorCode(err), message: describeError(err) },
      };
    }
  },
  describe: () => ({
    capabilities: [
      "tags",
      "correspondents",
      "custom-fields",
      "groups",
      "storage-paths",
      "documents",
    ],
  }),
  operations: {
    tags,
    correspondents,
    "custom-fields": customFields,
    groups,
    "storage-paths": storagePaths,
  },
};
