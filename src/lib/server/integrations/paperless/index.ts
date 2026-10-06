import { registerIntegration } from "$lib/server/connections/registry";
import { registerDocumentProvider } from "$lib/server/documents/provider";
import { resumeUploads } from "$lib/server/documents/uploads";
import { paperlessIntegration } from "./adapter";
import { paperlessDocumentProvider } from "./provider";
import { startPaperlessScheduler, type SchedulerOptions } from "./scheduler";

/**
 * Makes the connection settings (`/integrations/paperless`, with the tag, correspondent, field,
 * group and storage path pickers) and the document provider available. Nothing runs until a
 * person saves a connection. Returns a function that undoes it.
 */
export function registerPaperlessAdapter(): () => void {
  const offIntegration = registerIntegration(paperlessIntegration);
  const offProvider = registerDocumentProvider(paperlessDocumentProvider);
  return () => {
    offProvider();
    offIntegration();
  };
}

/**
 * Wires the Paperless-ngx adapter into the app at startup: the adapter and provider, pushes that
 * were still waiting for Paperless when the server stopped, and the sync scheduler. Returns a
 * function that undoes it.
 */
export function registerPaperless(
  options: { scheduler?: SchedulerOptions } = {},
): () => void {
  const off = registerPaperlessAdapter();
  resumeUploads();
  const stopScheduler = startPaperlessScheduler(options.scheduler);
  return () => {
    stopScheduler();
    off();
  };
}

export { paperlessIntegration, validateInput } from "./adapter";
export { paperlessDocumentProvider, uploadPolling } from "./provider";
export {
  startPaperlessScheduler,
  SYNC_INTERVAL_MS,
  type SchedulerOptions,
} from "./scheduler";
export { syncAll, syncConnection, scopeTags, type SyncResult } from "./sync";
export {
  DEFAULT_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  MAX_DOWNLOAD_BYTES,
  MAX_JSON_BYTES,
  MAX_NOTE_LENGTH,
  MAX_UPLOAD_BYTES,
  PaperlessClient,
  UPLOAD_TIMEOUT_MS,
  filenameFromDisposition,
  normalizeBaseUrl,
  sanitizeFilename,
  type ClientOptions,
  type CustomFieldQuery,
  type DocumentFile,
  type DocumentFileKind,
  type DocumentListQuery,
  type DocumentPage,
  type DocumentPatch,
  type PermissionsInput,
  type ServerInfo,
  type UploadInput,
} from "./client";
export {
  PAPERLESS_ERROR_CODES,
  PaperlessError,
  describeError,
  errorCode,
  messageForCode,
  type PaperlessErrorCode,
} from "./errors";
export {
  customFieldDate,
  type CustomFieldValue,
  type DocumentPermissions,
  type PaperlessCorrespondent,
  type PaperlessCustomField,
  type PaperlessDocument,
  type PaperlessGroup,
  type PaperlessNote,
  type PaperlessStoragePath,
  type PaperlessTag,
  type PaperlessTask,
  type PaperlessUser,
  type PermissionSet,
  type SearchHit,
  type TaskStatus,
} from "./schemas";
