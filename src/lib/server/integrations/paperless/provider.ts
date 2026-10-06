import { IntegrationError } from "$lib/server/connections/errors";
import type { DocumentProvider } from "$lib/server/documents/provider";
import { parseProviderConfig } from "$lib/server/documents/session";
import { clientFor, guarded } from "./connection";
import { toExternalMeta, taxonomyOf } from "./mapping";

/** How long and how often a pushed file is waited for; tests shorten it. */
export const uploadPolling = { timeoutMs: 10 * 60_000, pollMs: 2_000 };

/** Notes of one document are written one after the other, so the same note is never added twice at once. */
const noteQueues = new Map<string, Promise<unknown>>();

async function serialized<T>(key: string, job: () => Promise<T>): Promise<T> {
  const previous = noteQueues.get(key) ?? Promise.resolve();
  const next = previous.then(job, job);
  noteQueues.set(key, next);
  try {
    return await next;
  } finally {
    if (noteQueues.get(key) === next) noteQueues.delete(key);
  }
}

const MIN_DOCUMENT_ID = 1;

export const paperlessDocumentProvider: DocumentProvider = {
  provider: "paperless",

  search: (connection, query) =>
    guarded(async () => {
      const client = clientFor(connection);
      const config = parseProviderConfig(connection.config);
      const [page, taxonomy] = await Promise.all([
        client.listDocuments({
          text: query.q,
          tagsAll: query.tagId === undefined ? undefined : [query.tagId],
          correspondentId: query.correspondentId,
          ordering: "-created",
          pageSize: Math.min(100, Math.max(1, query.limit)),
        }),
        taxonomyOf(connection.id, client),
      ]);
      return page.results.map((d) => toExternalMeta(d, taxonomy, config));
    }),

  get: (connection, externalId) =>
    guarded(async () => {
      if (!Number.isSafeInteger(externalId) || externalId < MIN_DOCUMENT_ID) {
        return null;
      }
      const client = clientFor(connection);
      const config = parseProviderConfig(connection.config);
      // A list filtered by id: it answers with nothing (not an error) for a document the account cannot see.
      const [page, taxonomy] = await Promise.all([
        client.listDocuments({ idIn: [externalId], pageSize: 1 }),
        taxonomyOf(connection.id, client),
      ]);
      const doc = page.results.find((d) => d.id === externalId);
      return doc ? toExternalMeta(doc, taxonomy, config) : null;
    }),

  openFile: (connection, externalId, kind, options) =>
    guarded(() =>
      clientFor(connection).openDocumentFile(externalId, kind, options),
    ),

  webUrl: (connection, externalId) =>
    clientFor(connection).documentUrl(externalId),

  startUpload: (connection, request) =>
    guarded(() => {
      const config = parseProviderConfig(connection.config);
      return clientFor(connection).postDocument({
        file: request.bytes,
        filename: request.filename,
        contentType: request.contentType,
        title: request.title,
        tags: config.uploadTagIds.length > 0 ? config.uploadTagIds : undefined,
        correspondent: config.uploadCorrespondentId ?? undefined,
        storagePath: config.uploadStoragePathId ?? undefined,
      });
    }),

  awaitUpload: (connection, taskId) =>
    guarded(async () => {
      const task = await clientFor(connection).waitForTask(taskId, {
        timeoutMs: uploadPolling.timeoutMs,
        pollMs: uploadPolling.pollMs,
      });
      if (task.status === "success") {
        if (task.documentId === null) {
          throw new IntegrationError(
            "invalid_response",
            "Paperless did not say which document it created.",
          );
        }
        return { status: "done" as const, externalId: task.documentId };
      }
      if (task.duplicateOf !== null) {
        return { status: "duplicate" as const, duplicateOf: task.duplicateOf };
      }
      throw new IntegrationError(
        "consume_failed",
        "Paperless could not process the file.",
      );
    }),

  shareUploaded: (connection, externalId) =>
    guarded(async () => {
      const config = parseProviderConfig(connection.config);
      if (config.shareGroupIds.length === 0) return;
      const client = clientFor(connection);
      const info = await client.serverInfo();
      await client.setPermissions(externalId, {
        ...(info.user ? { owner: info.user.id } : {}),
        viewGroups: config.shareGroupIds,
        changeGroups: config.shareGroupIds,
      });
    }),

  addNote: (connection, externalId, text) =>
    guarded(() =>
      serialized(`${connection.id}:${externalId}`, async () => {
        const client = clientFor(connection);
        const notes = await client.getDocumentNotes(externalId);
        if (notes.some((n) => n.note.trim() === text.trim())) return false;
        await client.addDocumentNote(externalId, text);
        return true;
      }),
    ),
};
