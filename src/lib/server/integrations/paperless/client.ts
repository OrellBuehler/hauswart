import { z } from "zod";
import {
  assertToken,
  boundedStream,
  checkStatus,
  discard,
  fetchOnce,
  normalizeBaseUrl as normalizeUrl,
  readCapped,
  readJson,
  toSearch,
  type Query,
} from "../http";
import { PaperlessError, paperlessFail } from "./errors";
import {
  correspondentSchema,
  customFieldSchema,
  documentSchema,
  groupSchema,
  interpretTask,
  noteListSchema,
  pageSchema,
  storagePathSchema,
  tagSchema,
  taskListSchema,
  uiSettingsSchema,
  uploadResponseSchema,
  userSchema,
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
} from "./schemas";

export function normalizeBaseUrl(input: string): string {
  return normalizeUrl(input, paperlessFail);
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DOWNLOAD_TIMEOUT_MS = 60_000;
export const UPLOAD_TIMEOUT_MS = 120_000;
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_JSON_BYTES = 10 * 1024 * 1024;
export const MAX_NOTE_LENGTH = 10_000;
const MAX_PAGES = 200;
const MAX_LIST_PAGE_SIZE = 100;
const MAX_CUSTOM_FIELD_QUERY_LENGTH = 4000;
const FIRST_VERSION = 9;
const SECOND_VERSION = 10;

export interface ClientOptions {
  baseUrl: string;
  token: string;
  allowInsecureTls?: boolean;
  /** Last negotiated API version; defaults to 9. */
  apiVersion?: number | null;
  timeoutMs?: number;
  downloadTimeoutMs?: number;
  uploadTimeoutMs?: number;
  maxDownloadBytes?: number;
  maxUploadBytes?: number;
  maxJsonBytes?: number;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  query?: Query;
  json?: unknown;
  form?: FormData;
  timeoutMs?: number;
}

export interface ServerInfo {
  /** `X-Version`: the Paperless-ngx release, e.g. "2.20.3". */
  serverVersion: string | null;
  /** `X-Api-Version`: the highest API version the server speaks. */
  maxApiVersion: number | null;
  /** The API version this client currently negotiates. */
  apiVersion: number;
  /** The user the token belongs to, when the server tells. */
  user: { id: number; username: string | null; isSuperuser: boolean } | null;
}

/**
 * A `custom_field_query` expression, e.g. `["Warranty until", "range", ["2026-01-01", "2026-12-31"]]`
 * or `["AND", [expr, expr]]`. Field names are Paperless field names, not ids.
 */
export type CustomFieldQuery =
  | [string, string, unknown]
  | ["AND" | "OR", CustomFieldQuery[]]
  | ["NOT", CustomFieldQuery];

export interface DocumentListQuery {
  /** Full-text query (Paperless search syntax); results carry `searchHit`. */
  query?: string;
  /** Simple substring search over title and content. */
  text?: string;
  titleSearch?: string;
  /** Documents that carry all of these tags. */
  tagsAll?: number[];
  tagsAny?: number[];
  tagsNone?: number[];
  correspondentId?: number;
  documentTypeId?: number;
  ownerId?: number;
  idIn?: number[];
  customFieldQuery?: CustomFieldQuery;
  /** Field name, optionally prefixed with `-`: `created`, `-modified`, `title`, ... */
  ordering?: string;
  /** Only documents modified after this instant (ISO 8601). */
  modifiedAfter?: string;
  /** Include the permission sets of every document. */
  fullPerms?: boolean;
  page?: number;
  pageSize?: number;
}

export interface DocumentPage {
  count: number;
  hasNext: boolean;
  results: PaperlessDocument[];
}

export type DocumentFileKind = "preview" | "thumb" | "download";

export interface DocumentFile {
  /** Never yields more than the configured maximum; errors with `too_large` beyond it. */
  stream: ReadableStream<Uint8Array>;
  /** Normalised content type; `application/octet-stream` unless it is safe to display inline. */
  contentType: string;
  /** True when `contentType` is a PDF, a raster image or plain text (never HTML or SVG). */
  inlineSafe: boolean;
  /** Sanitised file name without path separators or control characters. */
  filename: string;
  /** Declared size, when the server sent one. */
  size: number | null;
}

export interface UploadInput {
  file: Uint8Array;
  filename: string;
  contentType?: string;
  title?: string;
  /** `YYYY-MM-DD` or an ISO datetime. */
  created?: string;
  tags?: number[];
  correspondent?: number;
  documentType?: number;
  storagePath?: number;
  archiveSerialNumber?: number;
  /** Field ids to add empty, or a map of field id to value. */
  customFields?: number[] | Record<number, unknown>;
}

export interface PermissionsInput {
  /** New owner; `null` removes the owner; omitted leaves it unchanged. */
  owner?: number | null;
  viewUsers?: number[];
  viewGroups: number[];
  changeUsers?: number[];
  changeGroups: number[];
}

export interface DocumentPatch {
  title?: string;
  tags?: number[];
  correspondent?: number | null;
  documentType?: number | null;
  storagePath?: number | null;
  /** Replaces the whole list of custom field values of the document. */
  customFields?: Array<{ field: number; value: unknown }>;
}

const SAFE_INLINE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/tiff",
  "text/plain",
]);

const ORDERING_RE = /^-?[a-z_]{1,40}$/;
const TASK_ID_RE = /^[0-9a-zA-Z-]{8,64}$/;

function invalid(detail: string): PaperlessError {
  return new PaperlessError("invalid_input", { detail });
}

function assertId(value: unknown, what: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw invalid(`${what} must be a positive integer`);
  }
  return value as number;
}

function assertIds(values: unknown, what: string, max = 200): number[] {
  if (!Array.isArray(values) || values.length > max) {
    throw invalid(`${what} must be a list of at most ${max} ids`);
  }
  return values.map((v) => assertId(v, what));
}

function assertNullableId(value: unknown, what: string): number | null {
  return value === null ? null : assertId(value, what);
}

/** `Content-Disposition` file name, sanitised; falls back to `fallback`. */
export function filenameFromDisposition(
  header: string | null,
  fallback: string,
): string {
  let name: string | null = null;
  if (header) {
    const star = /filename\*\s*=\s*(?:[\w-]+)?'[^']*'([^;]+)/i.exec(header);
    if (star) {
      try {
        name = decodeURIComponent(star[1]!.trim());
      } catch {
        name = null;
      }
    }
    if (!name) {
      const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(
        header,
      );
      if (plain) name = (plain[1] ?? plain[2] ?? "").replace(/\\(.)/g, "$1");
    }
  }
  return sanitizeFilename(name ?? "", fallback);
}

export function sanitizeFilename(name: string, fallback: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮"\\/<>|:*?]/g, "_")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 200);
  return cleaned === "" || /^_+$/.test(cleaned) ? fallback : cleaned;
}

function mediaType(res: Response): string {
  return (res.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
}

/** One place for every call to Paperless: auth, versioning, redirects, timeouts, size limits. */
export class PaperlessClient {
  readonly baseUrl: string;
  apiVersion: number;
  private info: { serverVersion: string | null; maxApiVersion: number | null } =
    { serverVersion: null, maxApiVersion: null };
  private readonly token: string;
  private readonly allowInsecureTls: boolean;
  private readonly timeoutMs: number;
  private readonly downloadTimeoutMs: number;
  private readonly uploadTimeoutMs: number;
  private readonly maxDownloadBytes: number;
  private readonly maxUploadBytes: number;
  private readonly maxJsonBytes: number;

  constructor(options: ClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    assertToken(options.token, paperlessFail);
    this.token = options.token;
    this.allowInsecureTls = options.allowInsecureTls ?? false;
    this.apiVersion = options.apiVersion ?? FIRST_VERSION;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS;
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS;
    this.maxDownloadBytes = options.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES;
    this.maxUploadBytes = options.maxUploadBytes ?? MAX_UPLOAD_BYTES;
    this.maxJsonBytes = options.maxJsonBytes ?? MAX_JSON_BYTES;
  }

  /** `{base}/api/<path>/`, always with the trailing slash Paperless requires. */
  url(path: string, query?: Query): string {
    const clean = path.replace(/^\/+|\/+$/g, "");
    const search = toSearch(query).toString();
    return `${this.baseUrl}/api/${clean}/${search ? `?${search}` : ""}`;
  }

  /** Public URL of a document in the web UI. */
  documentUrl(documentId: number): string {
    return `${this.baseUrl}/documents/${assertId(documentId, "document id")}/details`;
  }

  private async fetchRaw(
    url: string,
    init: {
      method: string;
      accept: string;
      body?: BodyInit;
      contentType?: string;
      timeoutMs: number;
    },
  ): Promise<Response> {
    const headers = new Headers({
      Authorization: `Token ${this.token}`,
      Accept: init.accept,
    });
    if (init.contentType) headers.set("Content-Type", init.contentType);
    const res = await fetchOnce(
      url,
      {
        method: init.method,
        headers,
        body: init.body,
        timeoutMs: init.timeoutMs,
        allowInsecureTls: this.allowInsecureTls,
      },
      paperlessFail,
    );
    const serverVersion = res.headers.get("x-version");
    const maxApi = Number(res.headers.get("x-api-version"));
    if (serverVersion) this.info.serverVersion = serverVersion;
    if (Number.isInteger(maxApi) && maxApi > 0)
      this.info.maxApiVersion = maxApi;
    return res;
  }

  private check(res: Response): Promise<Response> {
    return checkStatus(res, "paperless", paperlessFail, (status) =>
      status === 406 ? "version" : undefined,
    );
  }

  /** Sends a JSON API request; a 406 is retried once with the other API version. */
  private async send(path: string, options: RequestOptions): Promise<Response> {
    const url = this.url(path, options.query);
    const method = options.method ?? "GET";
    const body: BodyInit | undefined = options.form
      ? options.form
      : options.json === undefined
        ? undefined
        : JSON.stringify(options.json);
    const contentType =
      options.json !== undefined ? "application/json" : undefined;
    const attempt = (version: number) =>
      this.fetchRaw(url, {
        method,
        accept: `application/json; version=${version}`,
        body,
        contentType,
        timeoutMs: options.timeoutMs ?? this.timeoutMs,
      });

    let res = await attempt(this.apiVersion);
    if (res.status === 406) {
      await discard(res, "paperless");
      const other =
        this.apiVersion === FIRST_VERSION ? SECOND_VERSION : FIRST_VERSION;
      res = await attempt(other);
      if (res.status !== 406) this.apiVersion = other;
    }
    return this.check(res);
  }

  async json<S extends z.ZodType>(
    path: string,
    schema: S,
    options: RequestOptions = {},
  ): Promise<z.output<S>> {
    const res = await this.send(path, options);
    return readJson(res, schema, this.maxJsonBytes, "paperless", paperlessFail);
  }

  /**
   * Walks a paginated list. `next` URLs are never followed as given (a proxy
   * may have put the wrong host in them): only their query string is reused
   * against the configured base URL.
   */
  async *pages<S extends z.ZodType>(
    path: string,
    query: Query,
    item: S,
  ): AsyncGenerator<Array<z.output<S>>> {
    let current = toSearch(query);
    const schema = pageSchema(item);
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await this.json(path, schema, { query: current });
      yield page.results as Array<z.output<S>>;
      if (!page.next) return;
      let nextQuery: URLSearchParams;
      try {
        nextQuery = new URL(page.next, this.baseUrl).searchParams;
      } catch (cause) {
        throw new PaperlessError("invalid_response", {
          detail: "bad next link",
          cause,
        });
      }
      if (nextQuery.toString() === current.toString()) {
        throw new PaperlessError("invalid_response", {
          detail: "pagination does not advance",
        });
      }
      current = nextQuery;
    }
    throw new PaperlessError("invalid_response", { detail: "too many pages" });
  }

  private async all<S extends z.ZodType>(
    path: string,
    item: S,
  ): Promise<Array<z.output<S>>> {
    const out: Array<z.output<S>> = [];
    for await (const page of this.pages(
      path,
      { page_size: MAX_LIST_PAGE_SIZE },
      item,
    )) {
      out.push(...page);
    }
    return out;
  }

  /** Downloads a whole file into memory with a size cap and a content-type check. */
  async download(
    path: string,
    query?: Query,
    options: { expectType?: string } = {},
  ): Promise<Uint8Array> {
    const expectType = options.expectType ?? "application/pdf";
    const res = await this.check(
      await this.fetchRaw(this.url(path, query), {
        method: "GET",
        accept: "*/*",
        timeoutMs: this.downloadTimeoutMs,
      }),
    );
    if (mediaType(res) !== expectType) {
      await discard(res, "paperless");
      throw new PaperlessError("wrong_type");
    }
    return readCapped(res, this.maxDownloadBytes, "paperless", paperlessFail);
  }

  // ---- connection -------------------------------------------------------

  /** Connection test: verifies URL, token and API version, and reports the server release. */
  async serverInfo(): Promise<ServerInfo> {
    const settings = await this.json("ui_settings", uiSettingsSchema);
    return {
      ...this.info,
      apiVersion: this.apiVersion,
      user: settings.user
        ? {
            id: settings.user.id,
            username: settings.user.username ?? null,
            isSuperuser: settings.user.is_superuser ?? false,
          }
        : null,
    };
  }

  // ---- documents --------------------------------------------------------

  private documentParams(q: DocumentListQuery): URLSearchParams {
    const p = new URLSearchParams();
    const text = (key: string, value: string | undefined, max = 500) => {
      if (value === undefined) return;
      if (value.length > max) throw invalid(`${key} is too long`);
      p.set(key, value);
    };
    text("query", q.query);
    text("text", q.text);
    text("title_search", q.titleSearch);
    if (q.tagsAll?.length) {
      p.set("tags__id__all", assertIds(q.tagsAll, "tagsAll").join(","));
    }
    if (q.tagsAny?.length) {
      p.set("tags__id__in", assertIds(q.tagsAny, "tagsAny").join(","));
    }
    if (q.tagsNone?.length) {
      p.set("tags__id__none", assertIds(q.tagsNone, "tagsNone").join(","));
    }
    if (q.correspondentId !== undefined) {
      p.set(
        "correspondent__id",
        String(assertId(q.correspondentId, "correspondentId")),
      );
    }
    if (q.documentTypeId !== undefined) {
      p.set(
        "document_type__id",
        String(assertId(q.documentTypeId, "documentTypeId")),
      );
    }
    if (q.ownerId !== undefined) {
      p.set("owner__id", String(assertId(q.ownerId, "ownerId")));
    }
    if (q.idIn?.length) p.set("id__in", assertIds(q.idIn, "idIn").join(","));
    if (q.customFieldQuery !== undefined) {
      const json = JSON.stringify(q.customFieldQuery);
      if (json.length > MAX_CUSTOM_FIELD_QUERY_LENGTH) {
        throw invalid("customFieldQuery is too long");
      }
      p.set("custom_field_query", json);
    }
    if (q.ordering !== undefined) {
      if (!ORDERING_RE.test(q.ordering)) throw invalid("ordering is not valid");
      p.set("ordering", q.ordering);
    }
    if (q.modifiedAfter !== undefined) {
      if (Number.isNaN(Date.parse(q.modifiedAfter))) {
        throw invalid("modifiedAfter is not a date");
      }
      p.set("modified__gt", q.modifiedAfter);
    }
    if (q.fullPerms) p.set("full_perms", "true");
    if (q.page !== undefined) p.set("page", String(assertId(q.page, "page")));
    const size = q.pageSize ?? 25;
    if (!Number.isInteger(size) || size < 1 || size > MAX_LIST_PAGE_SIZE) {
      throw invalid(`pageSize must be between 1 and ${MAX_LIST_PAGE_SIZE}`);
    }
    p.set("page_size", String(size));
    // Without OCR text: a page of long documents would otherwise exceed the size cap.
    p.set(
      "fields",
      [
        "id",
        "title",
        "created",
        "created_date",
        "modified",
        "added",
        "correspondent",
        "document_type",
        "storage_path",
        "tags",
        "archive_serial_number",
        "original_file_name",
        "mime_type",
        "page_count",
        "owner",
        "user_can_change",
        "custom_fields",
        "notes",
        ...(q.fullPerms ? ["permissions"] : []),
      ].join(","),
    );
    return p;
  }

  /** One page of documents; with `query` this is a full-text search. */
  async listDocuments(q: DocumentListQuery = {}): Promise<DocumentPage> {
    const page = await this.json("documents", pageSchema(documentSchema), {
      query: this.documentParams(q),
    });
    return {
      count: page.count ?? page.results.length,
      hasNext: Boolean(page.next),
      results: page.results,
    };
  }

  /** Every matching document, page by page (bounded by the pagination guard). */
  async *iterateDocuments(
    q: Omit<DocumentListQuery, "page"> = {},
  ): AsyncGenerator<PaperlessDocument[]> {
    yield* this.pages("documents", this.documentParams(q), documentSchema);
  }

  /** One document including OCR `content`, custom fields and the note count. */
  async getDocument(
    documentId: number,
    options: { fullPerms?: boolean } = {},
  ): Promise<PaperlessDocument> {
    return this.json(
      `documents/${assertId(documentId, "document id")}`,
      documentSchema,
      options.fullPerms ? { query: { full_perms: "true" } } : {},
    );
  }

  async getDocumentNotes(documentId: number): Promise<PaperlessNote[]> {
    return this.json(
      `documents/${assertId(documentId, "document id")}/notes`,
      noteListSchema,
    );
  }

  /** Adds a note; returns the notes of the document afterwards. */
  async addDocumentNote(
    documentId: number,
    text: string,
  ): Promise<PaperlessNote[]> {
    const note = text.trim();
    if (note === "" || note.length > MAX_NOTE_LENGTH) {
      throw invalid(`a note needs 1 to ${MAX_NOTE_LENGTH} characters`);
    }
    return this.json(
      `documents/${assertId(documentId, "document id")}/notes`,
      noteListSchema,
      { method: "POST", json: { note } },
    );
  }

  /**
   * Opens the preview (PDF or image), thumbnail (WebP) or download of a
   * document as a stream capped at `maxDownloadBytes`. Redirects are refused.
   * `original` selects the original file instead of the archived PDF for downloads.
   */
  async openDocumentFile(
    documentId: number,
    kind: DocumentFileKind,
    options: { original?: boolean } = {},
  ): Promise<DocumentFile> {
    const docId = assertId(documentId, "document id");
    const res = await this.check(
      await this.fetchRaw(
        this.url(
          `documents/${docId}/${kind}`,
          kind === "download" && options.original ? { original: "true" } : {},
        ),
        { method: "GET", accept: "*/*", timeoutMs: this.downloadTimeoutMs },
      ),
    );
    const type = mediaType(res);
    const inlineSafe = SAFE_INLINE_TYPES.has(type);
    const declared = Number(res.headers.get("content-length"));
    const stream = await boundedStream(
      res,
      this.maxDownloadBytes,
      "paperless",
      paperlessFail,
    );
    return {
      stream,
      contentType: inlineSafe ? type : "application/octet-stream",
      inlineSafe,
      filename: filenameFromDisposition(
        res.headers.get("content-disposition"),
        `document-${docId}`,
      ),
      size:
        res.headers.get("content-length") !== null && Number.isFinite(declared)
          ? declared
          : null,
    };
  }

  // ---- upload and tasks -------------------------------------------------

  /** Uploads a file for consumption; returns the task id (a UUID). */
  async postDocument(input: UploadInput): Promise<string> {
    if (input.file.byteLength === 0) throw invalid("the file is empty");
    if (input.file.byteLength > this.maxUploadBytes) {
      throw new PaperlessError("too_large", { detail: "the upload" });
    }
    const filename = sanitizeFilename(input.filename, "document");
    const form = new FormData();
    form.set(
      "document",
      new Blob([input.file as Uint8Array<ArrayBuffer>], {
        type: input.contentType ?? "application/octet-stream",
      }),
      filename,
    );
    if (input.title !== undefined) form.set("title", input.title.slice(0, 128));
    if (input.created !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}([T ][\d:.+\-Z]+)?$/.test(input.created)) {
        throw invalid("created is not a date");
      }
      form.set("created", input.created);
    }
    for (const t of assertIds(input.tags ?? [], "tags")) {
      form.append("tags", String(t));
    }
    if (input.correspondent !== undefined) {
      form.set(
        "correspondent",
        String(assertId(input.correspondent, "correspondent")),
      );
    }
    if (input.documentType !== undefined) {
      form.set(
        "document_type",
        String(assertId(input.documentType, "documentType")),
      );
    }
    if (input.storagePath !== undefined) {
      form.set(
        "storage_path",
        String(assertId(input.storagePath, "storagePath")),
      );
    }
    if (input.archiveSerialNumber !== undefined) {
      form.set(
        "archive_serial_number",
        String(assertId(input.archiveSerialNumber, "archiveSerialNumber")),
      );
    }
    if (Array.isArray(input.customFields)) {
      for (const f of assertIds(input.customFields, "customFields")) {
        form.append("custom_fields", String(f));
      }
    } else if (input.customFields) {
      const entries = Object.entries(input.customFields);
      for (const [key] of entries) assertId(Number(key), "custom field id");
      if (entries.length > 0) {
        form.set("custom_fields", JSON.stringify(input.customFields));
      }
    }
    const taskId = await this.json(
      "documents/post_document",
      uploadResponseSchema,
      {
        method: "POST",
        form,
        timeoutMs: this.uploadTimeoutMs,
      },
    );
    if (!TASK_ID_RE.test(taskId)) {
      throw new PaperlessError("invalid_response", { detail: "bad task id" });
    }
    return taskId;
  }

  /**
   * State of a consumption task. Returns `null` while Paperless does not
   * know the task yet (right after an upload that can be a moment).
   */
  async getTask(taskId: string): Promise<PaperlessTask | null> {
    if (!TASK_ID_RE.test(taskId)) throw invalid("task id is not valid");
    const tasks = await this.json("tasks", taskListSchema, {
      query: { task_id: taskId },
    });
    const task = tasks[0];
    return task ? interpretTask(task) : null;
  }

  /** Polls until the task is finished or `timeoutMs` has passed (then `timeout`). */
  async waitForTask(
    taskId: string,
    options: {
      timeoutMs?: number;
      pollMs?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ): Promise<PaperlessTask> {
    const sleep =
      options.sleep ??
      ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const pollMs = options.pollMs ?? 1000;
    const deadline = Date.now() + (options.timeoutMs ?? 60_000);
    for (;;) {
      const task = await this.getTask(taskId);
      if (task && task.status !== "pending" && task.status !== "started") {
        return task;
      }
      if (Date.now() + pollMs > deadline) {
        throw new PaperlessError("timeout", {
          detail: "the task is still running",
        });
      }
      await sleep(pollMs);
    }
  }

  // ---- changing documents -----------------------------------------------

  private patchDocument(
    documentId: number,
    body: Record<string, unknown>,
  ): Promise<PaperlessDocument> {
    return this.json(
      `documents/${assertId(documentId, "document id")}`,
      documentSchema,
      { method: "PATCH", json: body },
    );
  }

  async updateDocument(
    documentId: number,
    patch: DocumentPatch,
  ): Promise<PaperlessDocument> {
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.title = patch.title.slice(0, 128);
    if (patch.tags !== undefined) body.tags = assertIds(patch.tags, "tags");
    if (patch.correspondent !== undefined) {
      body.correspondent = assertNullableId(
        patch.correspondent,
        "correspondent",
      );
    }
    if (patch.documentType !== undefined) {
      body.document_type = assertNullableId(patch.documentType, "documentType");
    }
    if (patch.storagePath !== undefined) {
      body.storage_path = assertNullableId(patch.storagePath, "storagePath");
    }
    if (patch.customFields !== undefined) {
      body.custom_fields = patch.customFields.map((f) => ({
        field: assertId(f.field, "custom field id"),
        value: f.value,
      }));
    }
    if (Object.keys(body).length === 0) throw invalid("nothing to update");
    return this.patchDocument(documentId, body);
  }

  /**
   * Sets owner and permissions of a document with `PATCH` and `set_permissions`.
   * Paperless overwrites the permission sets: users that are not listed lose
   * access, so pass `viewUsers`/`changeUsers` to keep any. The token's user
   * must own the document or be a superuser.
   */
  async setPermissions(
    documentId: number,
    input: PermissionsInput,
  ): Promise<PaperlessDocument> {
    const permissions: DocumentPermissions = {
      view: {
        users: assertIds(input.viewUsers ?? [], "viewUsers"),
        groups: assertIds(input.viewGroups, "viewGroups"),
      },
      change: {
        users: assertIds(input.changeUsers ?? [], "changeUsers"),
        groups: assertIds(input.changeGroups, "changeGroups"),
      },
    };
    const body: Record<string, unknown> = { set_permissions: permissions };
    if (input.owner !== undefined) {
      body.owner = assertNullableId(input.owner, "owner");
    }
    return this.patchDocument(documentId, body);
  }

  // ---- taxonomy ---------------------------------------------------------

  listTags(): Promise<PaperlessTag[]> {
    return this.all("tags", tagSchema);
  }

  async getTag(tagId: number): Promise<PaperlessTag> {
    return this.json(`tags/${assertId(tagId, "tag id")}`, tagSchema);
  }

  listCorrespondents(): Promise<PaperlessCorrespondent[]> {
    return this.all("correspondents", correspondentSchema);
  }

  async getCorrespondent(
    correspondentId: number,
  ): Promise<PaperlessCorrespondent> {
    return this.json(
      `correspondents/${assertId(correspondentId, "correspondent id")}`,
      correspondentSchema,
    );
  }

  listStoragePaths(): Promise<PaperlessStoragePath[]> {
    return this.all("storage_paths", storagePathSchema);
  }

  listCustomFields(): Promise<PaperlessCustomField[]> {
    return this.all("custom_fields", customFieldSchema);
  }

  /** Needs the "view group" permission; otherwise `forbidden`. */
  listGroups(): Promise<PaperlessGroup[]> {
    return this.all("groups", groupSchema);
  }

  /** Needs the "view user" permission; otherwise `forbidden`. */
  listUsers(): Promise<PaperlessUser[]> {
    return this.all("users", userSchema);
  }
}
