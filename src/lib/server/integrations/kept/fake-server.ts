import type {
  KeptAccount,
  KeptBill,
  KeptCategory,
  KeptLink,
  KeptRecurringSeries,
  KeptTransaction,
} from "./schemas";

/**
 * A small fake Kept external API for tests (local `Bun.serve`, port 0),
 * written by hand from the API documentation. It implements the endpoints,
 * scopes, category restriction, cursor pagination, `updatedSince`, link
 * idempotency and the documented errors, plus switches to inject failures.
 * All data here is synthetic.
 */

export const ALL_SCOPES = [
  "bills:read",
  "transactions:read",
  "recurring:read",
  "categories:read",
  "accounts:read",
  "links:write",
];

export interface FakeToken {
  scopes: string[];
  /** Category restriction; null means all categories. */
  categoryIds: string[] | null;
}

export interface FakeTransaction extends KeptTransaction {
  /** Insertion order within a booking date (newer = larger). */
  seq?: number;
}

export interface RecordedRequest {
  method: string;
  /** Path below `/api/external/v1`, e.g. `/bills/b1/links`. */
  path: string;
  query: URLSearchParams;
  headers: Headers;
  json?: unknown;
}

export interface FakeReply {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

interface Injection {
  pathPart: string;
  method?: string;
  reply: FakeReply;
  remaining: number;
}

let counter = 0;
const nextId = (prefix: string) =>
  `${prefix}-${String(++counter).padStart(4, "0")}`;

export function fakeBill(over: Partial<KeptBill> = {}): KeptBill {
  const id = over.id ?? nextId("bill");
  return {
    id,
    kind: "invoice",
    creditorName: "Muster Verwaltung AG",
    amount: 12345,
    currency: "CHF",
    issueDate: "2026-09-01",
    dueDate: "2026-10-01",
    invoiceNumber: "INV-2026-17",
    status: "open",
    overdue: false,
    paidAmount: 0,
    remainingAmount: 12345,
    lastPaymentDate: null,
    notes: null,
    url: `https://kept.example.org/bills/${id}`,
    updatedAt: "2026-09-20T08:15:00.000Z",
    ...over,
  };
}

export function fakeTransaction(
  over: Partial<FakeTransaction> = {},
): FakeTransaction {
  const id = over.id ?? nextId("tx");
  const accountId = over.accountId ?? "acc-0001";
  return {
    id,
    accountId,
    bookingDate: "2026-09-20",
    amount: -5000,
    currency: "CHF",
    counterpartyName: "Beispiel Haushalt GmbH",
    description: "Rechnung INV-2026-17",
    categoryId: "cat-0001",
    billIds: [],
    url: `https://kept.example.org/accounts/${accountId}?tx=${id}`,
    updatedAt: "2026-09-20T08:15:00.000Z",
    ...over,
  };
}

export function fakeCategory(over: Partial<KeptCategory> = {}): KeptCategory {
  return {
    id: over.id ?? nextId("cat"),
    name: "Housing",
    parentId: null,
    kind: "expense",
    color: "#2a9d8f",
    updatedAt: "2026-01-02T10:00:00.000Z",
    ...over,
  };
}

export function fakeAccount(over: Partial<KeptAccount> = {}): KeptAccount {
  return {
    id: over.id ?? nextId("acc"),
    name: "Everyday",
    currency: "CHF",
    type: "current",
    archived: false,
    updatedAt: "2026-01-02T10:00:00.000Z",
    ...over,
  };
}

export function fakeSeries(
  over: Partial<KeptRecurringSeries> = {},
): KeptRecurringSeries {
  return {
    id: over.id ?? nextId("ser"),
    status: "confirmed",
    name: "Example Streaming",
    cadence: "monthly",
    currency: "CHF",
    amount: -1500,
    monthlyCost: -1500,
    annualCost: -18000,
    firstDate: "2025-01-05",
    lastDate: "2026-09-05",
    lastAmount: -1500,
    occurrences: 21,
    nextExpected: "2026-10-05",
    overdue: false,
    updatedAt: "2026-09-06T04:00:00.000Z",
    ...over,
  };
}

type Key = Array<string | number | null>;

function compareValue(a: string | number | null, b: string | number | null) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function compareKeys(a: Key, b: Key): number {
  for (let i = 0; i < a.length; i++) {
    const c = compareValue(a[i]!, b[i]!);
    if (c !== 0) return c;
  }
  return 0;
}

class HttpFail extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BILL_STATUSES = ["all", "open", "overdue", "paid", "refund", "cancelled"];

function matchesStatus(b: KeptBill, status: string): boolean {
  switch (status) {
    case "all":
      return true;
    case "open":
      return (
        (b.status === "open" || b.status === "partially_paid") && !b.overdue
      );
    case "overdue":
      return b.overdue;
    case "paid":
      return b.status === "paid";
    case "refund":
      return (
        b.status === "credit_due" ||
        (b.status === "overpaid" && b.kind === "invoice")
      );
    default:
      return b.status === "cancelled";
  }
}

export class FakeKept {
  /** The primary token; it holds every scope and no category restriction until changed in `tokens`. */
  token = "kept_test-token";
  tokens = new Map<string, FakeToken>();
  user = {
    id: "user-0001",
    username: "muster",
    displayName: "Muster Person",
    locale: "de-CH",
    defaultCurrency: "CHF",
  };
  /** Path prefix, like a reverse proxy sub-path ("" or "/kept"). */
  prefix = "";
  bills: KeptBill[] = [];
  transactions: FakeTransaction[] = [];
  categories: KeptCategory[] = [];
  accounts: KeptAccount[] = [];
  series: KeptRecurringSeries[] = [];
  links: KeptLink[] = [];
  maxLinksPerEntity = 20;
  /** Requests per token before 429 (the fake never resets the window by itself). */
  rateLimit = { limit: Infinity, retryAfter: 60 };
  redirectAll = false;
  delayMs = 0;
  requests: RecordedRequest[] = [];
  private injections: Injection[] = [];
  private counts = new Map<string, number>();
  private server!: ReturnType<typeof Bun.serve>;

  constructor() {
    this.reset();
  }

  start(): void {
    this.server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) => this.handle(req),
    });
  }

  stop(): void {
    void this.server.stop(true);
  }

  /** Back to a clean state between tests (the server keeps running). */
  reset(): void {
    this.token = "kept_test-token";
    this.tokens = new Map([
      [this.token, { scopes: [...ALL_SCOPES], categoryIds: null }],
    ]);
    this.prefix = "";
    this.bills = [];
    this.transactions = [];
    this.categories = [];
    this.accounts = [];
    this.series = [];
    this.links = [];
    this.maxLinksPerEntity = 20;
    this.rateLimit = { limit: Infinity, retryAfter: 60 };
    this.redirectAll = false;
    this.delayMs = 0;
    this.requests = [];
    this.injections = [];
    this.counts = new Map();
  }

  get origin(): string {
    return `http://127.0.0.1:${this.server.port}`;
  }

  get baseUrl(): string {
    return `${this.origin}${this.prefix}`;
  }

  /** Changes what the primary token may do. */
  setToken(over: Partial<FakeToken>): void {
    const current = this.tokens.get(this.token)!;
    this.tokens.set(this.token, { ...current, ...over });
  }

  /** Answer the next `times` requests whose path contains `pathPart` with `reply`. */
  replyNext(
    pathPart: string,
    reply: FakeReply,
    options: { method?: string; times?: number } = {},
  ): void {
    this.injections.push({
      pathPart,
      method: options.method,
      reply,
      remaining: options.times ?? 1,
    });
  }

  failNext(
    pathPart: string,
    status: number,
    options: { method?: string; times?: number } = {},
  ): void {
    this.replyNext(
      pathPart,
      { status, body: JSON.stringify({ message: "Injected failure." }) },
      options,
    );
  }

  /** 429 with a `Retry-After` header for the next `times` matching requests. */
  rateLimitNext(
    pathPart: string,
    retryAfter: string | number,
    options: { method?: string; times?: number } = {},
  ): void {
    this.replyNext(
      pathPart,
      {
        status: 429,
        body: JSON.stringify({ message: "Rate limit exceeded." }),
        headers: { "retry-after": String(retryAfter) },
      },
      options,
    );
  }

  /** The recorded requests whose path (below the API root) starts with `path`. */
  requestsTo(path: string, method?: string): RecordedRequest[] {
    return this.requests.filter(
      (r) => r.path.startsWith(path) && (!method || r.method === method),
    );
  }

  // ---- HTTP -------------------------------------------------------------

  private json(
    body: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ): Response {
    return Response.json(body, {
      status,
      headers: { "cache-control": "no-store", ...headers },
    });
  }

  private error(status: number, message: string): Response {
    return this.json({ message }, status);
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    const root = `${this.prefix}/api/external/v1`;
    const inApi = url.pathname === root || url.pathname.startsWith(`${root}/`);
    const path = inApi ? url.pathname.slice(root.length) || "/" : url.pathname;
    let json: unknown;
    const raw = req.method === "POST" ? await req.text() : "";
    if (raw !== "") {
      try {
        json = JSON.parse(raw);
      } catch {
        json = undefined;
      }
    }
    this.requests.push({
      method: req.method,
      path,
      query: url.searchParams,
      headers: req.headers,
      json,
    });
    if (this.redirectAll) {
      return new Response(null, {
        status: 302,
        headers: { location: `${this.origin}/elsewhere` },
      });
    }
    const hit = this.injections.find(
      (i) =>
        i.remaining > 0 &&
        path.includes(i.pathPart) &&
        (!i.method || i.method === req.method),
    );
    if (hit) {
      hit.remaining--;
      return new Response(hit.reply.body ?? null, {
        status: hit.reply.status,
        headers: hit.reply.headers,
      });
    }
    if (!inApi) return this.error(404, "Not found");
    try {
      return this.route(req, path, url, raw);
    } catch (err) {
      if (err instanceof HttpFail) return this.error(err.status, err.message);
      throw err;
    }
  }

  private authenticate(req: Request): { token: string; grant: FakeToken } {
    const header = req.headers.get("authorization") ?? "";
    const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
    const grant = match ? this.tokens.get(match[1]!) : undefined;
    if (!match || !grant) throw new HttpFail(401, "The token is not valid.");
    const count = (this.counts.get(match[1]!) ?? 0) + 1;
    this.counts.set(match[1]!, count);
    if (count > this.rateLimit.limit) {
      throw new RateLimited(this.rateLimit.retryAfter);
    }
    return { token: match[1]!, grant };
  }

  private route(req: Request, path: string, url: URL, raw: string): Response {
    let auth;
    try {
      auth = this.authenticate(req);
    } catch (err) {
      if (err instanceof RateLimited) {
        return this.json({ message: "Rate limit exceeded." }, 429, {
          "retry-after": String(err.retryAfter),
        });
      }
      throw err;
    }
    const grant = auth.grant;
    const need = (scope: string) => {
      if (!grant.scopes.includes(scope)) {
        throw new HttpFail(403, `This token lacks the ${scope} permission.`);
      }
    };
    const method = req.method;
    const segments = path.split("/").filter(Boolean).map(decodeURIComponent);
    const [a, b, c] = segments;
    const allow = (...methods: string[]) => {
      if (!methods.includes(method))
        throw new HttpFail(405, "Method not allowed");
    };

    if (a === "me" && segments.length === 1) {
      allow("GET");
      return this.json({
        ...this.user,
        token: { scopes: grant.scopes, categoryIds: grant.categoryIds },
      });
    }
    if (a === "bills") {
      if (segments.length === 1) {
        allow("GET");
        need("bills:read");
        return this.listBills(url);
      }
      if (segments.length === 2) {
        allow("GET");
        need("bills:read");
        const bill = this.bills.find((x) => x.id === b);
        if (!bill) throw new HttpFail(404, "Bill not found.");
        return this.json(bill);
      }
      if (segments.length === 3 && c === "links") {
        allow("GET", "POST");
        need(method === "GET" ? "bills:read" : "links:write");
        if (!this.bills.some((x) => x.id === b)) {
          throw new HttpFail(404, "Bill not found.");
        }
        return this.entityLinks(method, "bill", b!, req, raw);
      }
    }
    if (a === "transactions") {
      if (segments.length === 1) {
        allow("GET");
        need("transactions:read");
        return this.listTransactions(url, grant);
      }
      if (segments.length === 2) {
        allow("GET");
        need("transactions:read");
        const tx = this.visibleTransactions(grant).find((x) => x.id === b);
        if (!tx) throw new HttpFail(404, "Transaction not found.");
        return this.json(stripSeq(tx));
      }
      if (segments.length === 3 && c === "links") {
        allow("GET", "POST");
        need(method === "GET" ? "transactions:read" : "links:write");
        if (!this.visibleTransactions(grant).some((x) => x.id === b)) {
          throw new HttpFail(404, "Transaction not found.");
        }
        return this.entityLinks(method, "transaction", b!, req, raw);
      }
    }
    if (a === "links" && segments.length === 2) {
      allow("DELETE");
      need("links:write");
      const link = this.links.find((l) => l.id === b);
      const visible =
        link &&
        (link.entityType === "bill"
          ? this.bills.some((x) => x.id === link.entityId)
          : this.visibleTransactions(grant).some(
              (x) => x.id === link.entityId,
            ));
      if (!link || !visible) throw new HttpFail(404, "Link not found.");
      this.links = this.links.filter((l) => l.id !== link.id);
      return new Response(null, {
        status: 204,
        headers: { "cache-control": "no-store" },
      });
    }
    if (a === "categories" && segments.length === 1) {
      allow("GET");
      need("categories:read");
      const rows =
        grant.categoryIds === null
          ? this.categories
          : this.categories.filter((x) => grant.categoryIds!.includes(x.id));
      const visible = new Set(rows.map((x) => x.id));
      const items = rows.map((x) => ({
        ...x,
        parentId:
          x.parentId !== null && visible.has(x.parentId) ? x.parentId : null,
      }));
      return this.page(url, items, (x) => [x.name, x.id], 2);
    }
    if (a === "accounts" && segments.length === 1) {
      allow("GET");
      need("accounts:read");
      return this.page(url, this.accounts, (x) => [0, x.name, x.id], 3);
    }
    if (a === "recurring-series" && segments.length === 1) {
      allow("GET");
      need("recurring:read");
      if (grant.categoryIds !== null) {
        throw new HttpFail(
          403,
          "Recurring series are not available to tokens limited to categories.",
        );
      }
      const status = url.searchParams.get("status");
      if (
        status !== null &&
        !["suggested", "confirmed", "dismissed"].includes(status)
      ) {
        throw new HttpFail(400, "Invalid status: Invalid option.");
      }
      const rows = this.series.filter(
        (s) => status === null || s.status === status,
      );
      return this.page(url, rows, (x) => [x.nextExpected, x.name, x.id], 3);
    }
    throw new HttpFail(404, "Endpoint not found.");
  }

  // ---- lists ------------------------------------------------------------

  private limit(url: URL): number {
    const raw = url.searchParams.get("limit");
    if (raw === null) return 50;
    if (!/^\d{1,4}$/.test(raw) || Number(raw) < 1 || Number(raw) > 200) {
      throw new HttpFail(400, "Invalid limit: Must be between 1 and 200.");
    }
    return Number(raw);
  }

  private since(url: URL): number | null {
    const raw = url.searchParams.get("updatedSince");
    if (raw === null) return null;
    if (!/(Z|[+-]\d{2}:\d{2})$/i.test(raw) || Number.isNaN(Date.parse(raw))) {
      throw new HttpFail(
        400,
        "Invalid updatedSince: Use an ISO 8601 timestamp.",
      );
    }
    return Date.parse(raw);
  }

  private date(url: URL, name: string): string | null {
    const raw = url.searchParams.get(name);
    if (raw === null) return null;
    const d = new Date(`${raw}T00:00:00Z`);
    if (
      !DATE_RE.test(raw) ||
      Number.isNaN(d.getTime()) ||
      !d.toISOString().startsWith(raw)
    ) {
      throw new HttpFail(400, `Invalid ${name}: Use YYYY-MM-DD.`);
    }
    return raw;
  }

  private decode(url: URL, length: number): Key | null {
    const raw = url.searchParams.get("cursor");
    if (raw === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    } catch {
      throw new HttpFail(400, "Invalid cursor.");
    }
    if (!Array.isArray(value) || value.length !== length) {
      throw new HttpFail(400, "Invalid cursor.");
    }
    return value as Key;
  }

  private page<T extends { updatedAt: string }>(
    url: URL,
    items: readonly T[],
    key: (item: T) => Key,
    keyLength: number,
    descending = false,
  ): Response {
    const limit = this.limit(url);
    const since = this.since(url);
    const after = this.decode(url, keyLength);
    const sign = descending ? -1 : 1;
    const sorted = items
      .filter((i) => since === null || Date.parse(i.updatedAt) >= since)
      .map((item) => ({ item, key: key(item) }))
      .sort((x, y) => sign * compareKeys(x.key, y.key));
    const rest = after
      ? sorted.filter((s) => sign * compareKeys(s.key, after) > 0)
      : sorted;
    const slice = rest.slice(0, limit);
    return this.json({
      items: slice.map((s) => stripSeq(s.item)),
      nextCursor:
        rest.length > limit
          ? Buffer.from(JSON.stringify(slice[slice.length - 1]!.key)).toString(
              "base64url",
            )
          : null,
    });
  }

  private listBills(url: URL): Response {
    const raw = url.searchParams.get("status");
    const statuses = raw === null ? null : raw.split(",").map((s) => s.trim());
    if (
      statuses &&
      (statuses.length === 0 ||
        statuses.some((s) => !BILL_STATUSES.includes(s)))
    ) {
      throw new HttpFail(400, "Invalid status: Invalid option.");
    }
    const from = this.date(url, "dueFrom");
    const to = this.date(url, "dueTo");
    const rows = this.bills
      .filter((b) => !statuses || statuses.some((s) => matchesStatus(b, s)))
      .filter((b) => {
        if (from === null && to === null) return true;
        if (b.dueDate === null) return false;
        return (
          (from === null || b.dueDate >= from) &&
          (to === null || b.dueDate <= to)
        );
      });
    return this.page(url, rows, (b) => [b.dueDate, b.id], 2);
  }

  private visibleTransactions(grant: FakeToken): FakeTransaction[] {
    if (grant.categoryIds === null) return this.transactions;
    return this.transactions.filter(
      (t) => t.categoryId !== null && grant.categoryIds!.includes(t.categoryId),
    );
  }

  private listTransactions(url: URL, grant: FakeToken): Response {
    const from = this.date(url, "from");
    const to = this.date(url, "to");
    const categoryId = url.searchParams.get("categoryId");
    const accountId = url.searchParams.get("accountId");
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    if (q.length > 100) throw new HttpFail(400, "Invalid q: Too long.");
    if (
      grant.categoryIds !== null &&
      categoryId !== null &&
      !grant.categoryIds.includes(categoryId)
    ) {
      return this.json({ items: [], nextCursor: null });
    }
    const seq = new Map(this.transactions.map((t, i) => [t.id, t.seq ?? i]));
    const rows = this.visibleTransactions(grant)
      .filter((t) => categoryId === null || t.categoryId === categoryId)
      .filter((t) => accountId === null || t.accountId === accountId)
      .filter((t) => from === null || t.bookingDate >= from)
      .filter((t) => to === null || t.bookingDate <= to)
      .filter(
        (t) =>
          q === "" ||
          (t.description ?? "").toLowerCase().includes(q) ||
          (t.counterpartyName ?? "").toLowerCase().includes(q),
      );
    return this.page(
      url,
      rows,
      (t) => [t.bookingDate, seq.get(t.id)!, t.id],
      3,
      true,
    );
  }

  // ---- links ------------------------------------------------------------

  private entityLinks(
    method: string,
    entityType: "bill" | "transaction",
    entityId: string,
    req: Request,
    raw: string,
  ): Response {
    const mine = () =>
      this.links.filter(
        (l) => l.entityType === entityType && l.entityId === entityId,
      );
    if (method === "GET") return this.json({ items: mine() });
    if (
      !/^application\/json\s*(;|$)/i.test(req.headers.get("content-type") ?? "")
    ) {
      throw new HttpFail(415, "Content-Type must be application/json.");
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpFail(400, "Body is not valid JSON.");
    }
    const { source, label, url } = (body ?? {}) as Record<string, unknown>;
    const text = (v: unknown, max: number, what: string): string => {
      if (typeof v !== "string")
        throw new HttpFail(400, `Invalid ${what}: Required.`);
      const t = v.trim();
      if (t === "" || t.length > max || hasControl(t)) {
        throw new HttpFail(400, `Invalid ${what}.`);
      }
      return t;
    };
    const s = text(source, 64, "source");
    const l = text(label, 200, "label");
    if (
      typeof url !== "string" ||
      url.length > 2048 ||
      !/^https?:\/\/[^/\\?#@]/i.test(url.trim()) ||
      !URL.canParse(url.trim())
    ) {
      throw new HttpFail(
        400,
        "Invalid url: Use an absolute http or https URL without credentials.",
      );
    }
    const normalised = new URL(url.trim());
    if (normalised.username !== "" || normalised.password !== "") {
      throw new HttpFail(
        400,
        "Invalid url: Use an absolute http or https URL without credentials.",
      );
    }
    const existing = mine().find(
      (x) => x.source === s && x.url === normalised.href,
    );
    if (existing) {
      existing.label = l;
      return this.json(existing, 200);
    }
    if (mine().length >= this.maxLinksPerEntity) {
      throw new HttpFail(
        409,
        `At most ${this.maxLinksPerEntity} links per ${entityType}.`,
      );
    }
    const link: KeptLink = {
      id: nextId("link"),
      entityType,
      entityId,
      source: s,
      label: l,
      url: normalised.href,
      createdAt: new Date().toISOString(),
    };
    this.links.push(link);
    return this.json(link, 201);
  }
}

function hasControl(value: string): boolean {
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || /\p{Cf}/u.test(ch)) return true;
  }
  return false;
}

class RateLimited extends Error {
  constructor(readonly retryAfter: number) {
    super("rate limited");
  }
}

function stripSeq<T>(item: T): T {
  if (item && typeof item === "object" && "seq" in item) {
    const { seq: _seq, ...rest } = item as T & { seq?: number };
    void _seq;
    return rest as T;
  }
  return item;
}

export function startFakeKept(): FakeKept {
  const fake = new FakeKept();
  fake.start();
  return fake;
}
