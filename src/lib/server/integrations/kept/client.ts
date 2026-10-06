import { z } from "zod";
import { isValidDate } from "$lib/dates";
import {
  assertToken,
  checkStatus,
  discard,
  fetchOnce,
  normalizeBaseUrl as normalizeUrl,
  readJson,
  toSearch,
  type FailOptions,
} from "../http";
import { KeptError, keptFail, type KeptErrorCode } from "./errors";
import { parseRetryAfter, withRetry, type RetryOptions } from "./retry";
import {
  BILL_QUERY_STATUSES,
  LINK_ENTITY_TYPES,
  SERIES_STATUSES,
  accountSchema,
  billSchema,
  categorySchema,
  linkListSchema,
  linkSchema,
  meSchema,
  pageSchema,
  recurringSeriesSchema,
  transactionSchema,
  type BillQueryStatus,
  type KeptAccount,
  type KeptBill,
  type KeptCategory,
  type KeptLink,
  type KeptMe,
  type KeptPage,
  type KeptRecurringSeries,
  type KeptTransaction,
  type LinkEntityType,
  type SeriesStatus,
} from "./schemas";

export function normalizeBaseUrl(input: string): string {
  return normalizeUrl(input, keptFail);
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_JSON_BYTES = 5 * 1024 * 1024;
export const MAX_LIMIT = 200;
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_LINK_SOURCE = 64;
export const MAX_LINK_LABEL = 200;
export const MAX_LINK_URL = 2048;
const MAX_PAGES = 1000;
const MAX_SEARCH = 100;

export interface KeptClientOptions {
  baseUrl: string;
  token: string;
  allowInsecureTls?: boolean;
  /** Administrators' and household-wide connections only; see `net/host-policy.ts`. */
  allowLoopback?: boolean;
  timeoutMs?: number;
  maxJsonBytes?: number;
  /** Retry behaviour of the iterators and the "all pages" lists. */
  retry?: RetryOptions;
}

interface ListBase {
  updatedSince?: string | Date;
  cursor?: string;
  limit?: number;
}

export interface BillQuery extends ListBase {
  /** Omitted or empty means every bill. */
  status?: readonly BillQueryStatus[];
  /** `YYYY-MM-DD`, inclusive; bills without a due date are left out when either is set. */
  dueFrom?: string;
  dueTo?: string;
}

export interface TransactionQuery extends ListBase {
  /** Booking date, `YYYY-MM-DD`, inclusive. */
  from?: string;
  to?: string;
  categoryId?: string;
  accountId?: string;
  /** Case-insensitive text in description or counterparty, up to 100 characters. */
  q?: string;
}

export interface LinkInput {
  /** Which app attached the link (part of the link's identity), up to 64 characters. */
  source: string;
  /** Text Kept shows, up to 200 characters. */
  label: string;
  /** Absolute http(s) URL, up to 2048 characters, no credentials. */
  url: string;
}

function invalid(detail: string): KeptError {
  return new KeptError("invalid_input", { detail });
}

function assertId(value: unknown, what: string): string {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.length > 128 ||
    value === "." ||
    value === ".."
  ) {
    throw invalid(`${what} is not valid`);
  }
  return value;
}

function assertDate(value: unknown, what: string): string {
  if (typeof value !== "string" || !isValidDate(value)) {
    throw invalid(`${what} must be a YYYY-MM-DD date`);
  }
  return value;
}

const OFFSET_INSTANT = z.iso.datetime({ offset: true });

/** An ISO 8601 instant with an explicit offset (a bare local time is ambiguous), or a Date. */
function toInstant(value: string | Date, what: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw invalid(`${what} is not a date`);
    return value.toISOString();
  }
  if (!OFFSET_INSTANT.safeParse(value).success) {
    throw invalid(`${what} must be an ISO 8601 timestamp with an offset`);
  }
  return value;
}

function assertLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw invalid(`limit must be a whole number from 1 to ${MAX_LIMIT}`);
  }
  return value;
}

function listParams(q: ListBase): URLSearchParams {
  const p = new URLSearchParams();
  if (q.updatedSince !== undefined) {
    p.set("updatedSince", toInstant(q.updatedSince, "updatedSince"));
  }
  if (q.cursor !== undefined) {
    if (q.cursor === "" || q.cursor.length > 512) {
      throw invalid("cursor is not valid");
    }
    p.set("cursor", q.cursor);
  }
  if (q.limit !== undefined) p.set("limit", String(assertLimit(q.limit)));
  return p;
}

function billParams(q: BillQuery): URLSearchParams {
  const p = listParams(q);
  if (q.status?.length) {
    for (const s of q.status) {
      if (!(BILL_QUERY_STATUSES as readonly string[]).includes(s)) {
        throw invalid("status is not valid");
      }
    }
    p.set("status", [...new Set(q.status)].join(","));
  }
  if (q.dueFrom !== undefined)
    p.set("dueFrom", assertDate(q.dueFrom, "dueFrom"));
  if (q.dueTo !== undefined) p.set("dueTo", assertDate(q.dueTo, "dueTo"));
  return p;
}

function transactionParams(q: TransactionQuery): URLSearchParams {
  const p = listParams(q);
  if (q.from !== undefined) p.set("from", assertDate(q.from, "from"));
  if (q.to !== undefined) p.set("to", assertDate(q.to, "to"));
  for (const key of ["categoryId", "accountId"] as const) {
    const v = q[key];
    if (v === undefined) continue;
    if (v === "" || v.length > 64) throw invalid(`${key} is not valid`);
    p.set(key, v);
  }
  if (q.q !== undefined) {
    const text = q.q.trim();
    if (text.length > MAX_SEARCH) throw invalid("q is too long");
    if (text !== "") p.set("q", text);
  }
  return p;
}

/** Control and invisible format characters (zero width, bidi overrides) can disguise text. */
function hasControlOrFormat(value: string, spaces = false): boolean {
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || (spaces && c === 0x20)) {
      return true;
    }
    if (/\p{Cf}/u.test(ch)) return true;
  }
  return false;
}

/** Mirrors what Kept accepts, so a bad input fails here instead of as an opaque 400. */
export function validateLinkInput(input: LinkInput): LinkInput {
  const field = (value: unknown, max: number, what: string): string => {
    if (typeof value !== "string") throw invalid(`${what} must be text`);
    const v = value.trim();
    if (v === "" || v.length > max || hasControlOrFormat(v)) {
      throw invalid(`${what} is not valid`);
    }
    return v;
  };
  const source = field(input.source, MAX_LINK_SOURCE, "source");
  const label = field(input.label, MAX_LINK_LABEL, "label");
  const raw = typeof input.url === "string" ? input.url.trim() : "";
  if (
    raw === "" ||
    raw.length > MAX_LINK_URL ||
    hasControlOrFormat(raw, true) ||
    !/^https?:\/\/[^/\\?#@]/i.test(raw) ||
    !URL.canParse(raw)
  ) {
    throw invalid("url must be an absolute http(s) URL");
  }
  const parsed = new URL(raw);
  if (parsed.username !== "" || parsed.password !== "") {
    throw invalid("url must not contain credentials");
  }
  return { source, label, url: raw };
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  /** Route template for error messages, e.g. `/bills/{id}`: never contains ids. */
  route: string;
  query?: URLSearchParams;
  json?: unknown;
}

/** One place for every call to Kept: auth, redirects, timeouts, size limits, error mapping. */
export class KeptClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly allowInsecureTls: boolean;
  private readonly allowLoopback: boolean;
  private readonly timeoutMs: number;
  private readonly maxJsonBytes: number;
  private readonly retry: RetryOptions;

  constructor(options: KeptClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    assertToken(options.token, keptFail);
    this.token = options.token;
    this.allowInsecureTls = options.allowInsecureTls ?? false;
    this.allowLoopback = options.allowLoopback ?? false;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxJsonBytes = options.maxJsonBytes ?? MAX_JSON_BYTES;
    this.retry = options.retry ?? {};
  }

  /** `{base}/api/external/v1{path}`; `path` starts with a slash. */
  url(path: string, query?: URLSearchParams): string {
    const search = toSearch(query).toString();
    return `${this.baseUrl}/api/external/v1${path}${search ? `?${search}` : ""}`;
  }

  private async send(path: string, options: RequestOptions): Promise<Response> {
    const method = options.method ?? "GET";
    const endpoint = `${method} ${options.route}`;
    const fail = (code: KeptErrorCode, o?: FailOptions) =>
      keptFail(code, { ...o, endpoint });
    const headers = new Headers({
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    });
    let body: string | undefined;
    if (options.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.json);
    }
    const res = await fetchOnce(
      this.url(path, options.query),
      {
        method,
        headers,
        body,
        timeoutMs: this.timeoutMs,
        allowInsecureTls: this.allowInsecureTls,
        allowLoopback: this.allowLoopback,
      },
      fail,
    );
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const status = res.status;
      await discard(res, "kept");
      throw keptFail(status === 429 ? "rate_limited" : "server", {
        status,
        retryAfter,
        endpoint,
      });
    }
    if (res.status === 409) {
      await discard(res, "kept");
      throw fail("conflict", { status: 409 });
    }
    return checkStatus(res, "kept", fail);
  }

  private async getJson<S extends z.ZodType>(
    path: string,
    route: string,
    schema: S,
    query?: URLSearchParams,
  ): Promise<z.output<S>> {
    const res = await this.send(path, { route, query });
    return readJson(res, schema, this.maxJsonBytes, "kept", (code, o) =>
      keptFail(code, { ...o, endpoint: `GET ${route}` }),
    );
  }

  /** Walks a cursor-paginated list; each page is retried after 429/5xx. */
  private async *pages<S extends z.ZodType>(
    path: string,
    schema: S,
    params: URLSearchParams,
    maxPages: number = MAX_PAGES,
  ): AsyncGenerator<Array<z.output<S>>> {
    const listSchema = pageSchema(schema);
    const query = new URLSearchParams(params);
    if (!query.has("limit")) query.set("limit", String(DEFAULT_PAGE_SIZE));
    const seen = new Set<string>();
    const cursor0 = query.get("cursor");
    if (cursor0 !== null) seen.add(cursor0);
    for (let i = 0; i < maxPages; i++) {
      const page = await withRetry(
        () => this.getJson(path, path, listSchema, query),
        this.retry,
      );
      yield page.items as Array<z.output<S>>;
      if (page.nextCursor === null) return;
      if (seen.has(page.nextCursor)) {
        throw new KeptError("invalid_response", {
          detail: "pagination does not advance",
          endpoint: `GET ${path}`,
        });
      }
      seen.add(page.nextCursor);
      query.set("cursor", page.nextCursor);
    }
    throw new KeptError("invalid_response", {
      detail: "too many pages",
      endpoint: `GET ${path}`,
    });
  }

  private async all<S extends z.ZodType>(
    path: string,
    schema: S,
    params: URLSearchParams,
  ): Promise<Array<z.output<S>>> {
    const out: Array<z.output<S>> = [];
    for await (const page of this.pages(path, schema, params)) {
      out.push(...page);
    }
    return out;
  }

  // ---- connection -------------------------------------------------------

  /** Connection test: needs a valid token, no scope. Reports the scopes and category restriction. */
  async me(): Promise<KeptMe> {
    return this.getJson("/me", "/me", meSchema);
  }

  // ---- bills ------------------------------------------------------------

  async listBills(q: BillQuery = {}): Promise<KeptPage<KeptBill>> {
    return this.getJson(
      "/bills",
      "/bills",
      pageSchema(billSchema),
      billParams(q),
    );
  }

  /** Every page of `/bills` in order, as arrays; follows `nextCursor` from `q.cursor` on. */
  async *iterateBills(q: BillQuery = {}): AsyncGenerator<KeptBill[]> {
    yield* this.pages("/bills", billSchema, billParams(q));
  }

  async getBill(id: string): Promise<KeptBill> {
    return this.getJson(
      `/bills/${encodeURIComponent(assertId(id, "bill id"))}`,
      "/bills/{id}",
      billSchema,
    );
  }

  // ---- transactions -----------------------------------------------------

  async listTransactions(
    q: TransactionQuery = {},
  ): Promise<KeptPage<KeptTransaction>> {
    return this.getJson(
      "/transactions",
      "/transactions",
      pageSchema(transactionSchema),
      transactionParams(q),
    );
  }

  async *iterateTransactions(
    q: TransactionQuery = {},
  ): AsyncGenerator<KeptTransaction[]> {
    yield* this.pages("/transactions", transactionSchema, transactionParams(q));
  }

  async getTransaction(id: string): Promise<KeptTransaction> {
    return this.getJson(
      `/transactions/${encodeURIComponent(assertId(id, "transaction id"))}`,
      "/transactions/{id}",
      transactionSchema,
    );
  }

  // ---- catalogue --------------------------------------------------------

  /** All categories the token may see (every page). */
  async listCategories(
    q: { updatedSince?: string | Date } = {},
  ): Promise<KeptCategory[]> {
    return this.all("/categories", categorySchema, listParams(q));
  }

  /** All recurring series; a category-restricted token gets `forbidden`. */
  async listRecurringSeries(
    q: { status?: SeriesStatus; updatedSince?: string | Date } = {},
  ): Promise<KeptRecurringSeries[]> {
    const p = listParams(q);
    if (q.status !== undefined) {
      if (!(SERIES_STATUSES as readonly string[]).includes(q.status)) {
        throw invalid("status is not valid");
      }
      p.set("status", q.status);
    }
    return this.all("/recurring-series", recurringSeriesSchema, p);
  }

  async listAccounts(
    q: { updatedSince?: string | Date } = {},
  ): Promise<KeptAccount[]> {
    return this.all("/accounts", accountSchema, listParams(q));
  }

  // ---- links ------------------------------------------------------------

  private static entity(type: LinkEntityType, id: string): string {
    if (!(LINK_ENTITY_TYPES as readonly string[]).includes(type)) {
      throw invalid("entity type is not valid");
    }
    const segment = type === "bill" ? "bills" : "transactions";
    return `/${segment}/${encodeURIComponent(assertId(id, `${type} id`))}/links`;
  }

  async listLinks(type: LinkEntityType, id: string): Promise<KeptLink[]> {
    const path = KeptClient.entity(type, id);
    const route = `/${type === "bill" ? "bills" : "transactions"}/{id}/links`;
    const res = await this.getJson(path, route, linkListSchema);
    return res.items;
  }

  /**
   * Adds a link, or refreshes the label of the identical one (same entity,
   * source and URL): `created` is true for 201 and false for 200.
   */
  async upsertLink(
    type: LinkEntityType,
    id: string,
    input: LinkInput,
  ): Promise<{ link: KeptLink; created: boolean }> {
    const body = validateLinkInput(input);
    const path = KeptClient.entity(type, id);
    const route = `/${type === "bill" ? "bills" : "transactions"}/{id}/links`;
    const res = await this.send(path, { method: "POST", route, json: body });
    if (res.status !== 200 && res.status !== 201) {
      const status = res.status;
      await discard(res, "kept");
      throw keptFail("invalid_response", {
        status,
        detail: `status ${status}`,
        endpoint: `POST ${route}`,
      });
    }
    const link = await readJson(
      res,
      linkSchema,
      this.maxJsonBytes,
      "kept",
      (code, o) => keptFail(code, { ...o, endpoint: `POST ${route}` }),
    );
    if (link.entityType !== type || link.entityId !== id) {
      throw keptFail("invalid_response", {
        detail: "link belongs to another entity",
        endpoint: `POST ${route}`,
      });
    }
    return { link, created: res.status === 201 };
  }

  /** Deletes any link of the token's user, including those other apps created. */
  async deleteLink(linkId: string): Promise<void> {
    const res = await this.send(
      `/links/${encodeURIComponent(assertId(linkId, "link id"))}`,
      { method: "DELETE", route: "/links/{linkId}" },
    );
    await discard(res, "kept");
  }
}
