/**
 * A small fake Paperless-ngx server for tests (local `Bun.serve`, port 0).
 * Nothing here talks to a real instance; every body is written by hand from
 * the Paperless-ngx API documentation. Behaviour switches mimic the quirks of
 * 2.16+ / 3.x and let tests inject failures.
 */
export interface FakeNote {
  id: number;
  note: string;
  created: string;
  user: number;
}

export interface FakePermissionSet {
  users: number[];
  groups: number[];
}

export interface FakeDoc {
  id: number;
  title: string;
  content: string;
  /** Date (`YYYY-MM-DD`), as in newer Paperless versions. */
  created: string;
  modified: string;
  added: string;
  correspondent: number | null;
  document_type: number | null;
  storage_path: number | null;
  tags: number[];
  archive_serial_number: number | null;
  original_file_name: string | null;
  mime_type: string;
  page_count: number;
  owner: number | null;
  custom_fields: Array<{ field: number; value: unknown }>;
  notes: FakeNote[];
  permissions: { view: FakePermissionSet; change: FakePermissionSet };
  original?: Uint8Array;
  archive?: Uint8Array;
  thumb?: Uint8Array;
  /** Content type to answer previews and downloads with (defaults to the mime type). */
  contentType?: string;
  /** Raw `Content-Disposition` to answer downloads with. */
  disposition?: string;
}

export interface FakeTag {
  id: number;
  name: string;
  color?: string;
  is_inbox_tag?: boolean;
  document_count?: number;
  owner?: number | null;
}
export interface FakeCorrespondent {
  id: number;
  name: string;
  document_count?: number;
  owner?: number | null;
}
export interface FakeCustomField {
  id: number;
  name: string;
  data_type: string;
  extra_data?: {
    select_options?: Array<string | { id: string; label: string }>;
  } | null;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  json?: unknown;
}

export interface FakeUpload {
  taskId: string;
  title: string | null;
  created: string | null;
  fileName: string;
  size: number;
  contentType: string;
  tags: string[];
  correspondent: string | null;
  documentType: string | null;
  storagePath: string | null;
  customFields: string[];
}

export type TaskStep =
  "pending" | "started" | "success" | "failure" | "duplicate" | "missing";

interface FakeTask {
  id: string;
  upload: FakeUpload;
  steps: TaskStep[];
  polls: number;
  documentId: number | null;
}

interface Injection {
  pathPart: string;
  method?: string;
  status: number;
  remaining: number;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

type CustomFieldQuery =
  [string, string, unknown] | ["AND" | "OR", unknown[]] | ["NOT", unknown];

export class FakePaperless {
  token = "test-token";
  /** The user the token belongs to. */
  user = { id: 1, username: "admin", is_superuser: false };
  serverVersion = "2.20.3";
  maxApiVersion = 10;
  accepted = [9, 10];
  /** Path prefix, like a reverse proxy sub-path ("" or "/paperless"). */
  prefix = "";
  docs = new Map<number, FakeDoc>();
  tags: FakeTag[] = [];
  correspondents: FakeCorrespondent[] = [];
  customFields: FakeCustomField[] = [];
  groups: Array<{ id: number; name: string }> = [];
  users: Array<{ id: number; username: string }> = [];
  pageSize: number | null = null;
  wrongHostNext = false;
  redirectAll = false;
  delayMs = 0;
  taskShape: "v9" | "v10" = "v9";
  /** Each task poll consumes one step; the last step repeats. */
  taskSteps: TaskStep[] = ["success"];
  uploadStatus = 200;
  newDocumentId = 900;
  duplicateOf = 7;
  /** `normal`: one buffer with Content-Length; `chunked`: no length; `stall`: first chunk, then silence. */
  downloadMode: "normal" | "chunked" | "stall" = "normal";
  requests: RecordedRequest[] = [];
  uploads: FakeUpload[] = [];
  server!: ReturnType<typeof Bun.serve>;
  private injections: Injection[] = [];
  private tasks = new Map<string, FakeTask>();
  private nextNoteId = 1;
  private taskCounter = 0;

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
    this.token = "test-token";
    this.user = { id: 1, username: "admin", is_superuser: false };
    this.serverVersion = "2.20.3";
    this.maxApiVersion = 10;
    this.accepted = [9, 10];
    this.prefix = "";
    this.docs.clear();
    this.tags = [];
    this.correspondents = [];
    this.customFields = [];
    this.groups = [];
    this.users = [];
    this.pageSize = null;
    this.wrongHostNext = false;
    this.redirectAll = false;
    this.delayMs = 0;
    this.taskShape = "v9";
    this.taskSteps = ["success"];
    this.uploadStatus = 200;
    this.newDocumentId = 900;
    this.duplicateOf = 7;
    this.downloadMode = "normal";
    this.requests = [];
    this.uploads = [];
    this.injections = [];
    this.tasks.clear();
    this.nextNoteId = 1;
  }

  get origin(): string {
    return `http://127.0.0.1:${this.server.port}`;
  }

  get baseUrl(): string {
    return `${this.origin}${this.prefix}`;
  }

  /** Answer the next `times` requests whose path contains `pathPart` with `status`. */
  failNext(
    pathPart: string,
    status: number,
    options: { method?: string; times?: number } = {},
  ): void {
    this.injections.push({
      pathPart,
      method: options.method,
      status,
      remaining: options.times ?? 1,
    });
  }

  addDoc(doc: Partial<FakeDoc> & { id: number }): FakeDoc {
    const full: FakeDoc = {
      title: `Synthetic document ${doc.id}`,
      content: `Synthetic OCR text of document ${doc.id}.`,
      created: "2026-01-15",
      modified: "2026-09-01T10:00:00+00:00",
      added: "2026-09-01T09:00:00+00:00",
      correspondent: null,
      document_type: null,
      storage_path: null,
      tags: [],
      archive_serial_number: null,
      original_file_name: `doc-${doc.id}.pdf`,
      mime_type: "application/pdf",
      page_count: 1,
      owner: null,
      custom_fields: [],
      notes: [],
      permissions: {
        view: { users: [], groups: [] },
        change: { users: [], groups: [] },
      },
      ...doc,
    };
    this.docs.set(full.id, full);
    return full;
  }

  requestsTo(pathPart: string, method?: string): RecordedRequest[] {
    return this.requests.filter(
      (r) => r.path.includes(pathPart) && (!method || r.method === method),
    );
  }

  private json(
    body: unknown,
    init: ResponseInit = {},
    extra: HeadersInit = {},
  ) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    for (const [k, v] of new Headers(extra)) headers.set(k, v);
    return new Response(JSON.stringify(body), { ...init, headers });
  }

  private docJson(d: FakeDoc, fields: Set<string> | null, fullPerms: boolean) {
    const full: Record<string, unknown> = {
      id: d.id,
      title: d.title,
      content: d.content,
      created: d.created,
      created_date: d.created,
      modified: d.modified,
      added: d.added,
      correspondent: d.correspondent,
      document_type: d.document_type,
      storage_path: d.storage_path,
      tags: d.tags,
      archive_serial_number: d.archive_serial_number,
      original_file_name: d.original_file_name,
      archived_file_name: d.archive ? `doc-${d.id}-archive.pdf` : null,
      mime_type: d.mime_type,
      page_count: d.page_count,
      owner: d.owner,
      user_can_change: true,
      custom_fields: d.custom_fields,
      notes: d.notes,
      ...(fullPerms ? { permissions: d.permissions } : {}),
    };
    if (!fields) return full;
    return Object.fromEntries(
      Object.entries(full).filter(([k]) => fields.has(k)),
    );
  }

  private page<T>(url: URL, items: T[]) {
    const size =
      this.pageSize ?? (Number(url.searchParams.get("page_size")) || 25);
    const page = Number(url.searchParams.get("page")) || 1;
    const slice = items.slice((page - 1) * size, page * size);
    let next: string | null = null;
    if (page * size < items.length) {
      const q = new URLSearchParams(url.searchParams);
      q.set("page", String(page + 1));
      const host = this.wrongHostNext
        ? "http://wrong-host.invalid"
        : this.origin;
      next = `${host}${url.pathname}?${q.toString()}`;
    }
    return { count: items.length, next, previous: null, results: slice };
  }

  private matchesCustomFieldQuery(doc: FakeDoc, expr: unknown): boolean {
    const [head, ...rest] = expr as CustomFieldQuery;
    if (head === "AND" || head === "OR") {
      const parts = rest[0] as unknown[];
      return head === "AND"
        ? parts.every((p) => this.matchesCustomFieldQuery(doc, p))
        : parts.some((p) => this.matchesCustomFieldQuery(doc, p));
    }
    if (head === "NOT") return !this.matchesCustomFieldQuery(doc, rest[0]);
    const [op, operand] = rest as [string, unknown];
    const def = this.customFields.find((f) => f.name === head);
    const present = def
      ? doc.custom_fields.find((f) => f.field === def.id)
      : undefined;
    const value = present?.value ?? null;
    switch (op) {
      case "exists":
        return (present !== undefined) === Boolean(operand);
      case "isnull":
        return (value === null) === Boolean(operand);
      case "exact":
        return value === operand;
      case "in":
        return Array.isArray(operand) && operand.includes(value);
      case "icontains":
        return (
          typeof value === "string" &&
          value.toLowerCase().includes(String(operand).toLowerCase())
        );
      case "gt":
        return (
          value !== null &&
          (value as string | number) > (operand as string | number)
        );
      case "gte":
        return (
          value !== null &&
          (value as string | number) >= (operand as string | number)
        );
      case "lt":
        return (
          value !== null &&
          (value as string | number) < (operand as string | number)
        );
      case "lte":
        return (
          value !== null &&
          (value as string | number) <= (operand as string | number)
        );
      case "range": {
        const [lo, hi] = operand as [string | number, string | number];
        return value !== null && value >= lo && value <= hi;
      }
      default:
        throw new Error(`unsupported custom field operator ${op}`);
    }
  }

  private listDocuments(url: URL) {
    const q = url.searchParams;
    let list = [...this.docs.values()];
    const ints = (v: string) => v.split(",").map(Number);
    const all = q.get("tags__id__all");
    if (all)
      list = list.filter((d) => ints(all).every((t) => d.tags.includes(t)));
    const any = q.get("tags__id__in");
    if (any)
      list = list.filter((d) => ints(any).some((t) => d.tags.includes(t)));
    const none = q.get("tags__id__none");
    if (none)
      list = list.filter((d) => !ints(none).some((t) => d.tags.includes(t)));
    const corr = q.get("correspondent__id");
    if (corr) list = list.filter((d) => d.correspondent === Number(corr));
    const type = q.get("document_type__id");
    if (type) list = list.filter((d) => d.document_type === Number(type));
    const owner = q.get("owner__id");
    if (owner) list = list.filter((d) => d.owner === Number(owner));
    const ids = q.get("id__in");
    if (ids) list = list.filter((d) => ints(ids).includes(d.id));
    const gt = q.get("modified__gt");
    if (gt) list = list.filter((d) => Date.parse(d.modified) > Date.parse(gt));
    const cfq = q.get("custom_field_query");
    if (cfq) {
      const expr = JSON.parse(cfq) as unknown;
      list = list.filter((d) => this.matchesCustomFieldQuery(d, expr));
    }
    const title = q.get("title_search");
    if (title) {
      list = list.filter((d) =>
        d.title.toLowerCase().includes(title.toLowerCase()),
      );
    }
    const text = q.get("text");
    if (text) {
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(text.toLowerCase()) ||
          d.content.toLowerCase().includes(text.toLowerCase()),
      );
    }
    const search = q.get("query");
    if (search) {
      const needle = search.toLowerCase();
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(needle) ||
          d.content.toLowerCase().includes(needle),
      );
    }
    const ordering = q.get("ordering") ?? "id";
    const desc = ordering.startsWith("-");
    const key = ordering.replace(/^-/, "") as keyof FakeDoc;
    list.sort((a, b) => {
      const av = String(a[key] ?? "");
      const bv = String(b[key] ?? "");
      const cmp =
        key === "id" ? a.id - b.id : av < bv ? -1 : av > bv ? 1 : a.id - b.id;
      return desc ? -cmp : cmp;
    });
    const fieldsParam = q.get("fields");
    const fields = fieldsParam ? new Set(fieldsParam.split(",")) : null;
    const fullPerms = q.get("full_perms") === "true";
    const page = this.page(url, list);
    return {
      ...page,
      results: page.results.map((d, i) => {
        const base = this.docJson(d, fields, fullPerms);
        return search
          ? {
              ...base,
              __search_hit__: {
                score: 1 / (i + 1),
                rank: i,
                highlights: `text <span class="match">${search}</span> <script>x</script> text`,
              },
            }
          : base;
      }),
    };
  }

  private takeInjection(req: Request, path: string): number | null {
    const hit = this.injections.find(
      (i) =>
        path.includes(i.pathPart) &&
        (!i.method || i.method === req.method) &&
        i.remaining > 0,
    );
    if (!hit) return null;
    hit.remaining--;
    return hit.status;
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    let json: unknown;
    if (
      req.method !== "GET" &&
      req.headers.get("content-type")?.includes("json")
    ) {
      json = await req.clone().json();
    }
    this.requests.push({
      method: req.method,
      path: url.pathname,
      query: url.searchParams,
      headers: req.headers,
      json,
    });
    if (this.delayMs) await sleep(this.delayMs);
    if (this.redirectAll) {
      return new Response(null, {
        status: 301,
        headers: { location: "https://elsewhere.invalid/" },
      });
    }
    if (!url.pathname.endsWith("/")) {
      return new Response(null, {
        status: 301,
        headers: { location: `${url.pathname}/${url.search}` },
      });
    }
    if (req.headers.get("authorization") !== `Token ${this.token}`) {
      return this.json({ detail: "Invalid token." }, { status: 401 });
    }
    const version = Number(
      /version=(\d+)/.exec(req.headers.get("accept") ?? "")?.[1],
    );
    const extra = {
      "X-Version": this.serverVersion,
      "X-Api-Version": String(this.maxApiVersion),
    };
    if (Number.isFinite(version) && !this.accepted.includes(version)) {
      return new Response(null, { status: 406, headers: extra });
    }
    const respond = (body: unknown, init: ResponseInit = {}) =>
      this.json(body, init, extra);
    const injected = this.takeInjection(req, url.pathname);
    if (injected !== null) {
      return respond({ detail: "injected failure" }, { status: injected });
    }

    let path = url.pathname;
    if (this.prefix && path.startsWith(this.prefix)) {
      path = path.slice(this.prefix.length);
    }
    const parts = path
      .replace(/^\/api\//, "")
      .replace(/\/$/, "")
      .split("/");
    const [root, second, third] = parts;
    const notFound = () => respond({ detail: "Not found." }, { status: 404 });

    if (root === "ui_settings") {
      return respond({ user: this.user, settings: {}, permissions: [] });
    }
    if (root === "documents" && !second && req.method === "GET") {
      return respond(this.listDocuments(url));
    }
    if (
      root === "documents" &&
      second === "post_document" &&
      req.method === "POST"
    ) {
      if (this.uploadStatus !== 200) {
        return respond({ error: "rejected" }, { status: this.uploadStatus });
      }
      const form = await req.formData();
      const file = form.get("document");
      const taskId = `b3f1c0de-0000-4000-8000-${String(++this.taskCounter).padStart(12, "0")}`;
      const strings = (key: string) =>
        form.getAll(key).filter((v): v is string => typeof v === "string");
      const upload: FakeUpload = {
        taskId,
        title: (form.get("title") as string | null) ?? null,
        created: (form.get("created") as string | null) ?? null,
        fileName: file instanceof File ? file.name : "",
        size: file instanceof File ? file.size : 0,
        contentType: file instanceof File ? file.type : "",
        tags: strings("tags"),
        correspondent: (form.get("correspondent") as string | null) ?? null,
        documentType: (form.get("document_type") as string | null) ?? null,
        storagePath: (form.get("storage_path") as string | null) ?? null,
        customFields: strings("custom_fields"),
      };
      this.uploads.push(upload);
      this.tasks.set(taskId, {
        id: taskId,
        upload,
        steps: [...this.taskSteps],
        polls: 0,
        documentId: null,
      });
      return respond(taskId);
    }
    if (root === "documents" && second && /^\d+$/.test(second)) {
      const doc = this.docs.get(Number(second));
      if (!doc) return notFound();
      if (!third && req.method === "GET") {
        return respond(
          this.docJson(
            doc,
            null,
            url.searchParams.get("full_perms") === "true",
          ),
        );
      }
      if (!third && req.method === "PATCH") {
        const body = json as Record<string, unknown>;
        const touchesPermissions = "set_permissions" in body || "owner" in body;
        if (
          touchesPermissions &&
          doc.owner !== null &&
          doc.owner !== this.user.id &&
          !this.user.is_superuser
        ) {
          return respond({ detail: "forbidden" }, { status: 403 });
        }
        for (const key of [
          "title",
          "tags",
          "correspondent",
          "document_type",
          "storage_path",
          "custom_fields",
          "owner",
        ] as const) {
          if (key in body) {
            (doc as unknown as Record<string, unknown>)[key] = body[key];
          }
        }
        if ("set_permissions" in body) {
          const p = body.set_permissions as FakeDoc["permissions"];
          doc.permissions = {
            view: { users: p.view.users, groups: p.view.groups },
            change: { users: p.change.users, groups: p.change.groups },
          };
        }
        return respond(this.docJson(doc, null, true));
      }
      if (third === "notes") {
        if (req.method === "POST") {
          const note = (json as { note?: string } | undefined)?.note;
          if (typeof note !== "string" || note === "") {
            return respond({ note: ["required"] }, { status: 400 });
          }
          doc.notes.push({
            id: this.nextNoteId++,
            note,
            created: "2026-09-02T08:00:00+00:00",
            user: this.user.id,
          });
        }
        return respond(doc.notes);
      }
      if (
        (third === "download" || third === "preview" || third === "thumb") &&
        req.method === "GET"
      ) {
        const original = url.searchParams.get("original") === "true";
        const bytes =
          third === "thumb"
            ? (doc.thumb ?? new TextEncoder().encode("RIFFxxxxWEBPsynthetic"))
            : third === "download" && original
              ? doc.original
              : (doc.archive ?? doc.original);
        if (!bytes) return notFound();
        const type =
          third === "thumb"
            ? "image/webp"
            : (doc.contentType ??
              (third === "download" && original
                ? doc.mime_type
                : "application/pdf"));
        const disposition =
          doc.disposition ??
          `${third === "download" ? "attachment" : "inline"}; filename="${doc.original_file_name ?? `doc-${doc.id}.pdf`}"`;
        const headers: Record<string, string> = {
          "content-type": type,
          "content-disposition": disposition,
          ...extra,
        };
        if (this.downloadMode === "normal") {
          return new Response(bytes as Uint8Array<ArrayBuffer>, { headers });
        }
        const stall = this.downloadMode === "stall";
        return new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              const size = Math.max(1, Math.ceil(bytes.byteLength / 4));
              for (let i = 0; i < bytes.byteLength; i += size) {
                controller.enqueue(bytes.slice(i, i + size));
                if (stall) await new Promise(() => undefined);
              }
              controller.close();
            },
          }),
          { headers },
        );
      }
      return notFound();
    }
    if (root === "tags" || root === "correspondents") {
      const list: Array<{ id: number }> =
        root === "tags" ? this.tags : this.correspondents;
      if (second) {
        const item = list.find((t) => t.id === Number(second));
        return item ? respond(item) : notFound();
      }
      return respond(this.page(url, list));
    }
    if (root === "custom_fields")
      return respond(this.page(url, this.customFields));
    if (root === "groups") return respond(this.page(url, this.groups));
    if (root === "users") return respond(this.page(url, this.users));
    if (root === "tasks") {
      const task = this.tasks.get(url.searchParams.get("task_id") ?? "");
      if (!task) return respond(this.taskList([]));
      const step =
        task.steps[Math.min(task.polls, task.steps.length - 1)] ?? "pending";
      task.polls++;
      if (step === "missing") return respond(this.taskList([]));
      if (step === "success" && task.documentId === null) {
        task.documentId = this.newDocumentId++;
        this.addDoc({
          id: task.documentId,
          title: task.upload.title ?? task.upload.fileName,
          tags: task.upload.tags.map(Number),
        });
      }
      return respond(this.taskList([this.taskBody(step, task)]));
    }
    return notFound();
  }

  private taskList(tasks: unknown[]) {
    return this.taskShape === "v9"
      ? tasks
      : { count: tasks.length, next: null, previous: null, results: tasks };
  }

  private taskBody(step: TaskStep, task: FakeTask) {
    const id = task.documentId;
    if (this.taskShape === "v9") {
      switch (step) {
        case "pending":
        case "started":
          return {
            task_id: task.id,
            status: step === "pending" ? "PENDING" : "STARTED",
            result: null,
            related_document: null,
          };
        case "success":
          return {
            task_id: task.id,
            status: "SUCCESS",
            result: `New document id ${id} created`,
            // 2.x reports this as a string, 3.x as a number.
            related_document: String(id),
          };
        case "duplicate":
          return {
            task_id: task.id,
            status: "FAILURE",
            result: `file.pdf: Not consuming file.pdf: It is a duplicate of Other (#${this.duplicateOf})`,
            related_document: null,
          };
        default:
          return {
            task_id: task.id,
            status: "FAILURE",
            result: "boom",
            related_document: null,
          };
      }
    }
    switch (step) {
      case "pending":
      case "started":
        return {
          task_id: task.id,
          status: step,
          related_document_ids: [],
          result_data: null,
        };
      case "success":
        return {
          task_id: task.id,
          status: "success",
          related_document_ids: [id],
          result_data: { document_id: id },
        };
      case "duplicate":
        return {
          task_id: task.id,
          status: "failure",
          related_document_ids: [],
          result_data: { duplicate_of: this.duplicateOf, reason: "duplicate" },
        };
      default:
        return {
          task_id: task.id,
          status: "failure",
          related_document_ids: [],
          result_data: { error_message: "boom" },
        };
    }
  }
}

/** Starts a fake server; call `.stop()` when done. */
export function startFakePaperless(): FakePaperless {
  const fake = new FakePaperless();
  fake.start();
  return fake;
}
