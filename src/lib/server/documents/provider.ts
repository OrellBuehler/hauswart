import type { DocumentProviderKind } from "$lib/api/enums";
import type { ResolvedConnection } from "$lib/server/connections/registry";

/** What the core keeps of a document: the same shape whatever the provider is. */
export interface ExternalDocumentMeta {
  externalId: number;
  title: string;
  /** The date on the document, `YYYY-MM-DD`. */
  createdDate: string | null;
  /** The provider's modification instant, ISO. */
  modifiedAt: string | null;
  correspondentId: number | null;
  correspondentName: string | null;
  tagIds: number[];
  tagNames: string[];
  mimeType: string | null;
  pageCount: number | null;
  noteCount: number;
  /** The configured warranty fields as dates; null when not configured or empty. */
  warrantyUntil: string | null;
  warrantyExtendedUntil: string | null;
}

export type DocumentFileKind = "preview" | "thumb" | "download";

export interface DocumentFileStream {
  /** Never longer than the provider's size cap; errors when the source exceeds it. */
  stream: ReadableStream<Uint8Array>;
  /** `application/octet-stream` unless the type is safe to show inline. */
  contentType: string;
  inlineSafe: boolean;
  filename: string;
  size: number | null;
}

export interface DocumentSearch {
  q: string;
  tagId?: number;
  correspondentId?: number;
  limit: number;
}

export interface UploadRequest {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  title: string;
}

export type UploadOutcome =
  | { status: "done"; externalId: number }
  | { status: "duplicate"; duplicateOf: number | null };

/**
 * What a system that holds the household's documents offers the core. Registered at startup by an
 * adapter; every method runs with the caller's own connection and throws `IntegrationError` (a
 * stable `code`, a message that is safe to show). `get` answers `null` when the connection's
 * account cannot see the document (deleted or not shared), never an error.
 */
export interface DocumentProvider {
  provider: DocumentProviderKind;
  search(
    connection: ResolvedConnection,
    query: DocumentSearch,
  ): Promise<ExternalDocumentMeta[]>;
  get(
    connection: ResolvedConnection,
    externalId: number,
  ): Promise<ExternalDocumentMeta | null>;
  openFile(
    connection: ResolvedConnection,
    externalId: number,
    kind: DocumentFileKind,
    options: { original?: boolean },
  ): Promise<DocumentFileStream>;
  /** The document in the provider's own web app. */
  webUrl(connection: ResolvedConnection, externalId: number): string;
  /** Hands a file over for consumption; returns the provider's task id. */
  startUpload(
    connection: ResolvedConnection,
    request: UploadRequest,
  ): Promise<string>;
  /** Waits until the task is finished: the new document, or the one that already existed. */
  awaitUpload(
    connection: ResolvedConnection,
    taskId: string,
  ): Promise<UploadOutcome>;
  /** Owner = the connection's account, the configured groups may view and change. */
  shareUploaded(
    connection: ResolvedConnection,
    externalId: number,
  ): Promise<void>;
  /** Adds the note once: false when an identical one was already there. */
  addNote(
    connection: ResolvedConnection,
    externalId: number,
    text: string,
  ): Promise<boolean>;
}

const providers = new Map<DocumentProviderKind, DocumentProvider>();

/** Adds (or replaces) the provider of a kind; returns a function that removes it. */
export function registerDocumentProvider(
  provider: DocumentProvider,
): () => void {
  providers.set(provider.provider, provider);
  return () => {
    if (providers.get(provider.provider) === provider) {
      providers.delete(provider.provider);
    }
  };
}

export function getDocumentProvider(
  kind: DocumentProviderKind,
): DocumentProvider | undefined {
  return providers.get(kind);
}
