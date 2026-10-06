import { z } from "zod";
import { isValidDate } from "$lib/dates";

const id = z.number().int().positive();
const nullableId = id.nullish().transform((v) => v ?? null);
const nullableString = z
  .string()
  .nullish()
  .transform((v) => v ?? null);

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    count: z.number().int().nonnegative().optional(),
    next: z.string().nullish(),
    results: z.array(item),
  });
}

const permissionSetSchema = z.object({
  users: z.array(id).default([]),
  groups: z.array(id).default([]),
});

export interface PermissionSet {
  users: number[];
  groups: number[];
}
export interface DocumentPermissions {
  view: PermissionSet;
  change: PermissionSet;
}

export interface CustomFieldValue {
  field: number;
  value: unknown;
}

export interface SearchHit {
  score: number | null;
  rank: number | null;
  /** Plain text: every markup tag of Paperless' highlight excerpt is removed. */
  highlights: string | null;
}

export interface PaperlessDocument {
  id: number;
  title: string;
  /** Full OCR text; only present on single-document reads, never in lists. */
  content: string | null;
  /** Raw `created` value: a date in newer versions, a datetime in older ones. */
  created: string | null;
  /** `YYYY-MM-DD` derived from `created_date` or `created`. */
  createdDate: string | null;
  modified: string | null;
  added: string | null;
  correspondent: number | null;
  documentType: number | null;
  storagePath: number | null;
  tags: number[];
  archiveSerialNumber: number | null;
  originalFileName: string | null;
  mimeType: string | null;
  pageCount: number | null;
  owner: number | null;
  userCanChange: boolean | null;
  customFields: CustomFieldValue[];
  noteCount: number;
  /** Only when requested with `fullPerms`. */
  permissions: DocumentPermissions | null;
  /** Only on full-text search results. */
  searchHit: SearchHit | null;
}

const searchHitSchema = z.object({
  score: z.number().nullish(),
  rank: z.number().nullish(),
  highlights: z.string().nullish(),
});

export function stripMarkup(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

function dateOf(value: string | null | undefined): string | null {
  const head = value?.slice(0, 10) ?? "";
  return isValidDate(head) ? head : null;
}

export const documentSchema = z
  .object({
    id,
    title: z.string().nullish(),
    content: z.string().nullish(),
    created: z.string().nullish(),
    created_date: z.string().nullish(),
    modified: z.string().nullish(),
    added: z.string().nullish(),
    correspondent: nullableId,
    document_type: nullableId,
    storage_path: nullableId,
    tags: z.array(id).nullish(),
    archive_serial_number: z.number().int().nullish(),
    original_file_name: nullableString,
    mime_type: nullableString,
    page_count: z.number().int().nullish(),
    owner: nullableId,
    user_can_change: z.boolean().nullish(),
    custom_fields: z
      .array(z.object({ field: id, value: z.unknown() }))
      .nullish(),
    notes: z.array(z.object({ id: z.number().int() })).nullish(),
    permissions: z
      .object({ view: permissionSetSchema, change: permissionSetSchema })
      .nullish(),
    __search_hit__: searchHitSchema.nullish(),
  })
  .transform((d): PaperlessDocument => ({
    id: d.id,
    title: d.title ?? "",
    content: d.content ?? null,
    created: d.created ?? null,
    createdDate: dateOf(d.created_date) ?? dateOf(d.created),
    modified: d.modified ?? null,
    added: d.added ?? null,
    correspondent: d.correspondent,
    documentType: d.document_type,
    storagePath: d.storage_path,
    tags: d.tags ?? [],
    archiveSerialNumber: d.archive_serial_number ?? null,
    originalFileName: d.original_file_name,
    mimeType: d.mime_type,
    pageCount: d.page_count ?? null,
    owner: d.owner,
    userCanChange: d.user_can_change ?? null,
    customFields: (d.custom_fields ?? []).map((f) => ({
      field: f.field,
      value: f.value ?? null,
    })),
    noteCount: d.notes?.length ?? 0,
    permissions: d.permissions ?? null,
    searchHit: d.__search_hit__
      ? {
          score: d.__search_hit__.score ?? null,
          rank: d.__search_hit__.rank ?? null,
          highlights:
            d.__search_hit__.highlights != null
              ? stripMarkup(d.__search_hit__.highlights)
              : null,
        }
      : null,
  }));

export interface PaperlessNote {
  id: number;
  note: string;
  created: string | null;
  userId: number | null;
}

export const noteSchema = z
  .object({
    id: z.number().int(),
    note: z.string(),
    created: z.string().nullish(),
    user: z
      .union([z.number().int(), z.object({ id: z.number().int() })])
      .nullish(),
  })
  .transform((n): PaperlessNote => ({
    id: n.id,
    note: n.note,
    created: n.created ?? null,
    userId:
      n.user == null ? null : typeof n.user === "number" ? n.user : n.user.id,
  }));

/** Notes come back as a bare list in 2.x and may be wrapped in a page later. */
export const noteListSchema = z.union([
  z.array(noteSchema),
  z.object({ results: z.array(noteSchema) }).transform((o) => o.results),
]);

export interface PaperlessTag {
  id: number;
  name: string;
  color: string | null;
  isInboxTag: boolean;
  documentCount: number | null;
  owner: number | null;
}

export const tagSchema = z
  .object({
    id,
    name: z.string(),
    color: z.string().nullish(),
    is_inbox_tag: z.boolean().nullish(),
    document_count: z.number().int().nullish(),
    owner: nullableId,
  })
  .transform((t): PaperlessTag => ({
    id: t.id,
    name: t.name,
    color: t.color ?? null,
    isInboxTag: t.is_inbox_tag ?? false,
    documentCount: t.document_count ?? null,
    owner: t.owner,
  }));

export interface PaperlessCorrespondent {
  id: number;
  name: string;
  documentCount: number | null;
  owner: number | null;
}

export const correspondentSchema = z
  .object({
    id,
    name: z.string(),
    document_count: z.number().int().nullish(),
    owner: nullableId,
  })
  .transform((c): PaperlessCorrespondent => ({
    id: c.id,
    name: c.name,
    documentCount: c.document_count ?? null,
    owner: c.owner,
  }));

export interface PaperlessCustomField {
  id: number;
  name: string;
  /** string, url, date, boolean, integer, float, monetary, documentlink, select, longtext ... */
  dataType: string;
  selectOptions: Array<{ id: string | null; label: string }>;
}

export const customFieldSchema = z
  .object({
    id,
    name: z.string(),
    data_type: z.string(),
    extra_data: z
      .object({
        select_options: z
          .array(
            z.union([
              z.string(),
              z.object({
                id: z.union([z.string(), z.number()]).nullish(),
                label: z.string(),
              }),
            ]),
          )
          .nullish(),
      })
      .nullish(),
  })
  .transform((f): PaperlessCustomField => ({
    id: f.id,
    name: f.name,
    dataType: f.data_type,
    selectOptions: (f.extra_data?.select_options ?? []).map((o) =>
      typeof o === "string"
        ? { id: null, label: o }
        : { id: o.id == null ? null : String(o.id), label: o.label },
    ),
  }));

export interface PaperlessGroup {
  id: number;
  name: string;
}

export const groupSchema = z
  .object({ id, name: z.string() })
  .transform((g): PaperlessGroup => ({ id: g.id, name: g.name }));

export interface PaperlessUser {
  id: number;
  username: string;
}

export const userSchema = z
  .object({ id, username: z.string() })
  .transform((u): PaperlessUser => ({ id: u.id, username: u.username }));

export const uiSettingsSchema = z.object({
  user: z
    .object({
      id,
      username: z.string().nullish(),
      is_superuser: z.boolean().nullish(),
    })
    .nullish(),
});

export const uploadResponseSchema = z.union([
  z.string().min(1),
  z.object({ task_id: z.string().min(1) }).transform((o) => o.task_id),
]);

const taskSchema = z.object({
  task_id: z.string().nullish(),
  status: z.string(),
  // 2.x returns a string, 3.x an integer.
  related_document: z.union([z.string(), z.number()]).nullish(),
  related_document_ids: z.array(z.number()).nullish(),
  result: z.string().nullish(),
  result_data: z
    .object({
      document_id: z.number().nullish(),
      duplicate_of: z.number().nullish(),
    })
    .nullish(),
});

/** v9 answers with a bare list, v10 with a paginated object. */
export const taskListSchema = z.union([
  z.array(taskSchema),
  z.object({ results: z.array(taskSchema) }).transform((o) => o.results),
]);

export type TaskStatus =
  "pending" | "started" | "success" | "failure" | "revoked";

export interface PaperlessTask {
  status: TaskStatus;
  /** The created document, once the task succeeded. */
  documentId: number | null;
  /** Set when the task failed because Paperless already holds this exact file. */
  duplicateOf: number | null;
}

function asId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d{1,12}$/.test(value)) {
    const n = Number(value);
    return n > 0 ? n : null;
  }
  return null;
}

/** Interprets one task in either API shape. */
export function interpretTask(
  task: z.output<typeof taskSchema>,
): PaperlessTask {
  const status = task.status.toLowerCase();
  if (status === "success") {
    return {
      status: "success",
      documentId:
        asId(task.related_document) ??
        asId(task.related_document_ids?.[0]) ??
        asId(task.result_data?.document_id) ??
        asId(/\bid (\d+)\b/.exec(task.result ?? "")?.[1]),
      duplicateOf: null,
    };
  }
  if (status === "failure" || status === "revoked") {
    return {
      status: status as "failure" | "revoked",
      documentId: null,
      duplicateOf:
        asId(task.result_data?.duplicate_of) ??
        asId(/duplicate of .*\(#(\d+)\)/i.exec(task.result ?? "")?.[1]),
    };
  }
  return {
    status: status === "started" ? "started" : "pending",
    documentId: null,
    duplicateOf: null,
  };
}

/**
 * Reads a custom field value as a calendar date. Date fields hold
 * `YYYY-MM-DD`; a datetime string is cut to its date part.
 */
export function customFieldDate(
  doc: Pick<PaperlessDocument, "customFields">,
  fieldId: number,
): string | null {
  const value = doc.customFields.find((f) => f.field === fieldId)?.value;
  if (typeof value !== "string") return null;
  const head = value.slice(0, 10);
  return isValidDate(head) ? head : null;
}
