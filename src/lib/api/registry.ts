import { z } from "zod";
import { API_PREFIX } from "./constants";
import type { ErrorCode } from "./errors";
import type { Scope } from "./scopes";
import {
  emptySchema,
  idParamsSchema,
  paginationQuerySchema as paginationQueryOnlySchema,
  binaryResponseSchema,
} from "./schemas/common";
import {
  loginRequestSchema,
  meResponseSchema,
  setupRequestSchema,
  setupStatusSchema,
  tokenRequestSchema,
  tokenResponseSchema,
  updateMeRequestSchema,
  userEnvelopeSchema,
} from "./schemas/auth";
import {
  createTokenRequestSchema,
  createdTokenSchema,
  listTokensResponseSchema,
} from "./schemas/tokens";
import {
  adminUserEnvelopeSchema,
  createUserRequestSchema,
  listDirectoryResponseSchema,
  listUsersResponseSchema,
  revokeTokensResponseSchema,
  updateUserRequestSchema,
} from "./schemas/users";
import { healthResponseSchema, openApiDocumentSchema } from "./schemas/system";
import {
  assetByQrParamsSchema,
  assetSchema,
  createAssetRequestSchema,
  listAssetsQuerySchema,
  listAssetsResponseSchema,
  updateAssetRequestSchema,
} from "./schemas/assets";
import {
  createRoomRequestSchema,
  listRoomsQuerySchema,
  listRoomsResponseSchema,
  roomSchema,
  updateRoomRequestSchema,
} from "./schemas/rooms";
import {
  completePreparationRequestSchema,
  completeTaskRequestSchema,
  completeTaskResponseSchema,
  createPreparationRequestSchema,
  createTaskRequestSchema,
  dueResultSchema,
  listCompletionsQuerySchema,
  listCompletionsResponseSchema,
  listPreparationsResponseSchema,
  listTasksQuerySchema,
  listTasksResponseSchema,
  preparationParamsSchema,
  preparationSchema,
  previewTaskRequestSchema,
  skipTaskRequestSchema,
  snoozeTaskRequestSchema,
  taskDetailSchema,
  taskSchema,
  updatePreparationRequestSchema,
  updateTaskRequestSchema,
} from "./schemas/tasks";
import {
  dashboardSchema,
  statsQuerySchema,
  statsSchema,
} from "./schemas/dashboard";
import {
  listNotificationsQuerySchema,
  listNotificationsResponseSchema,
  notificationIdParamsSchema,
  notificationSchema,
  readAllResponseSchema,
  unreadCountResponseSchema,
} from "./schemas/notifications";
import {
  householdSchema,
  updateHouseholdRequestSchema,
} from "./schemas/household";
import {
  createPageRequestSchema,
  docPageSchema,
  listPagesQuerySchema,
  listPagesResponseSchema,
  listRevisionsResponseSchema,
  pageParamsSchema,
  pageRevisionParamsSchema,
  pageRevisionSchema,
  previewPageRequestSchema,
  previewPageResponseSchema,
  updatePageRequestSchema,
} from "./schemas/docs";
import {
  ATTACHMENT_CONTENT_TYPES,
  MAX_UPLOAD_REQUEST_BYTES,
  attachmentContentQuerySchema,
  attachmentSchema,
  listAttachmentsQuerySchema,
  listAttachmentsResponseSchema,
  updateAttachmentRequestSchema,
  uploadAttachmentRequestSchema,
} from "./schemas/attachments";
import { searchQuerySchema, searchResponseSchema } from "./schemas/search";

import {
  assetContactParamsSchema,
  assetContactSchema,
  contactSchema,
  createContactRequestSchema,
  linkAssetContactRequestSchema,
  listAssetContactsResponseSchema,
  listContactsQuerySchema,
  listContactsResponseSchema,
  updateContactRequestSchema,
} from "./schemas/contacts";
import {
  assetPartParamsSchema,
  assetPartSchema,
  createPartRequestSchema,
  linkAssetPartRequestSchema,
  linkTaskPartRequestSchema,
  listAssetPartsResponseSchema,
  listMovementsResponseSchema,
  listOrderNowResponseSchema,
  listPartsQuerySchema,
  listPartsResponseSchema,
  listTaskPartsResponseSchema,
  markOrderedRequestSchema,
  partDetailSchema,
  partSchema,
  stockMovementRequestSchema,
  taskPartSchema,
  updatePartRequestSchema,
  updateTaskPartRequestSchema,
} from "./schemas/parts";
import {
  createServiceLogRequestSchema,
  listAssetServiceLogQuerySchema,
  listServiceLogQuerySchema,
  listServiceLogResponseSchema,
  serviceLogEntrySchema,
  serviceLogParamsSchema,
  updateServiceLogRequestSchema,
} from "./schemas/service-log";
import {
  addDefectEventRequestSchema,
  changeDefectStatusRequestSchema,
  createDefectRequestSchema,
  defectDetailSchema,
  defectEventSchema,
  defectSchema,
  defectTimelineResponseSchema,
  exportDefectsQuerySchema,
  listDefectsQuerySchema,
  listDefectsResponseSchema,
  updateDefectRequestSchema,
} from "./schemas/defects";
import {
  listWarrantiesQuerySchema,
  listWarrantiesResponseSchema,
} from "./schemas/warranties";
import {
  createHintRequestSchema,
  hintSchema,
  listAssetHintsResponseSchema,
  listHintsQuerySchema,
  updateHintRequestSchema,
} from "./schemas/hints";
import {
  commentSchema,
  createCommentRequestSchema,
  listCommentsQuerySchema,
  listCommentsResponseSchema,
  updateCommentRequestSchema,
} from "./schemas/comments";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Who may call an endpoint: `session` = browser cookie only, `bearer` = API
 * token only, `both` = either, `public` = anyone.
 */
export type AuthMode = "session" | "bearer" | "both" | "public";

export type ParamsSchema = z.ZodObject;
export type SuccessStatus = 200 | 201 | 204;

export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
/** Request body limit of the markdown endpoints (the source is capped at 200 KB; JSON escaping adds some). */
export const MAX_MARKDOWN_REQUEST_BYTES = 512 * 1024;

/**
 * `json` endpoints answer with the `response` schema. `binary` endpoints stream a file: the
 * handler returns a `Response`, `response` is only a placeholder and `contentTypes` lists what
 * the endpoint can send (OpenAPI documents the body as `string`/`binary` under each type).
 */
export type ResponseType = "json" | "binary";

export interface EndpointDef<
  A extends AuthMode,
  P extends ParamsSchema | undefined,
  Q extends ParamsSchema | undefined,
  B extends z.ZodType | undefined,
  R extends z.ZodType,
  T extends ResponseType = "json",
> {
  /** Stable camelCase identifier; also the OpenAPI operationId and the key in `endpoints`. */
  id: string;
  method: HttpMethod;
  /** `/api/v1/tokens/{id}`: every `{name}` must be a key of `params`. */
  path: string;
  summary: string;
  description?: string;
  tags: readonly string[];
  auth: A;
  /** Scopes the caller needs (all of them); `[]` = any authenticated caller. */
  scopes: readonly Scope[];
  params?: P;
  query?: Q;
  body?: B;
  /** `multipart` bodies are parsed as form data; everything else is JSON. */
  bodyType?: "json" | "multipart";
  response: R;
  responseType?: T;
  /** Binary endpoints: the content types the response can have. */
  contentTypes?: readonly string[];
  /** Success status; `204` endpoints use `emptySchema` and return no body. Default 200. */
  status?: SuccessStatus;
  /** Extra error codes the handler can raise (beyond those every endpoint can). */
  errors?: readonly ErrorCode[];
  /** The endpoint starts a cookie session; CSRF-checked even though the caller is anonymous. */
  setsSession?: boolean;
  maxBodyBytes?: number;
}

export interface Endpoint<
  A extends AuthMode = AuthMode,
  P extends ParamsSchema | undefined = ParamsSchema | undefined,
  Q extends ParamsSchema | undefined = ParamsSchema | undefined,
  B extends z.ZodType | undefined = z.ZodType | undefined,
  R extends z.ZodType = z.ZodType,
  T extends ResponseType = ResponseType,
> {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly auth: A;
  readonly scopes: readonly Scope[];
  readonly params: P;
  readonly query: Q;
  readonly body: B;
  readonly bodyType: "json" | "multipart";
  readonly response: R;
  readonly responseType: T;
  readonly contentTypes: readonly string[];
  readonly status: SuccessStatus;
  readonly errors: readonly ErrorCode[];
  readonly setsSession: boolean;
  readonly maxBodyBytes: number;
}

export type AnyEndpoint = Endpoint;

export function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
}

export function defineEndpoint<
  const A extends AuthMode,
  P extends ParamsSchema | undefined = undefined,
  Q extends ParamsSchema | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
  R extends z.ZodType = z.ZodType,
  const T extends ResponseType = "json",
>(def: EndpointDef<A, P, Q, B, R, T>): Endpoint<A, P, Q, B, R, T> {
  if (!def.path.startsWith(`${API_PREFIX}/`)) {
    throw new Error(`${def.id}: path must start with ${API_PREFIX}/`);
  }
  const names = pathParamNames(def.path).sort();
  const keys = Object.keys(def.params?.shape ?? {}).sort();
  if (names.join() !== keys.join()) {
    throw new Error(
      `${def.id}: path parameters (${names.join(", ")}) must match the params schema (${keys.join(", ")})`,
    );
  }
  if (def.body && (def.method === "GET" || def.method === "DELETE")) {
    throw new Error(`${def.id}: ${def.method} endpoints cannot have a body`);
  }
  const status = def.status ?? 200;
  if (def.responseType === "binary") {
    if (def.method !== "GET") {
      throw new Error(`${def.id}: binary endpoints must be GET`);
    }
    if (!def.contentTypes || def.contentTypes.length === 0) {
      throw new Error(`${def.id}: binary endpoints must list contentTypes`);
    }
  }
  return {
    id: def.id,
    method: def.method,
    path: def.path,
    summary: def.summary,
    description: def.description,
    tags: def.tags,
    auth: def.auth,
    scopes: def.scopes,
    params: def.params as P,
    query: def.query as Q,
    body: def.body as B,
    bodyType: def.bodyType ?? "json",
    response: def.response,
    responseType: (def.responseType ?? "json") as T,
    contentTypes: def.contentTypes ?? [],
    status,
    errors: def.errors ?? [],
    setsSession: def.setsSession ?? false,
    maxBodyBytes: def.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
  };
}

export const endpoints = {
  health: defineEndpoint({
    id: "health",
    method: "GET",
    path: "/api/v1/health",
    summary: "Liveness probe",
    tags: ["system"],
    auth: "public",
    scopes: [],
    response: healthResponseSchema,
  }),

  openapi: defineEndpoint({
    id: "openapi",
    method: "GET",
    path: "/api/v1/openapi.json",
    summary: "OpenAPI document of this API",
    tags: ["system"],
    auth: "public",
    scopes: [],
    response: openApiDocumentSchema,
  }),

  setupStatus: defineEndpoint({
    id: "setupStatus",
    method: "GET",
    path: "/api/v1/setup",
    summary: "Whether first-run setup is still open",
    description:
      "`needsSetup` is true until the first administrator account exists. `tokenRequired` is true while setup is open and the server was started with `HAUSWART_SETUP_TOKEN`: the setup request must then carry `setupToken`.",
    tags: ["setup"],
    auth: "public",
    scopes: [],
    response: setupStatusSchema,
  }),

  setup: defineEndpoint({
    id: "setup",
    method: "POST",
    path: "/api/v1/setup",
    summary: "Create the first administrator and sign in",
    description:
      "Only works while no user exists (409 `setup_complete` afterwards). When the server runs with `HAUSWART_SETUP_TOKEN`, `setupToken` must match it (403 `forbidden`). Starts a browser session (sets the session cookie).",
    tags: ["setup"],
    auth: "public",
    scopes: [],
    setsSession: true,
    body: setupRequestSchema,
    response: userEnvelopeSchema,
    status: 201,
    errors: ["setup_complete", "forbidden"],
  }),

  authLogin: defineEndpoint({
    id: "authLogin",
    method: "POST",
    path: "/api/v1/auth/login",
    summary: "Sign in with a username and password",
    description:
      "Starts a browser session (sets the session cookie). Failed attempts are rate limited per user and client address.",
    tags: ["auth"],
    auth: "public",
    scopes: [],
    setsSession: true,
    body: loginRequestSchema,
    response: userEnvelopeSchema,
    errors: ["invalid_credentials"],
  }),

  authLogout: defineEndpoint({
    id: "authLogout",
    method: "POST",
    path: "/api/v1/auth/logout",
    summary: "End the current browser session",
    tags: ["auth"],
    auth: "session",
    scopes: [],
    response: emptySchema,
    status: 204,
  }),

  authMe: defineEndpoint({
    id: "authMe",
    method: "GET",
    path: "/api/v1/auth/me",
    summary:
      "The calling user, how they authenticated and their effective scopes",
    tags: ["auth"],
    auth: "both",
    scopes: [],
    response: meResponseSchema,
  }),

  authUpdateMe: defineEndpoint({
    id: "authUpdateMe",
    method: "PATCH",
    path: "/api/v1/auth/me",
    summary: "Update the calling user's display name or language",
    tags: ["auth"],
    auth: "session",
    scopes: [],
    body: updateMeRequestSchema,
    response: userEnvelopeSchema,
  }),

  authToken: defineEndpoint({
    id: "authToken",
    method: "POST",
    path: "/api/v1/auth/token",
    summary: "Exchange a username and password for a device token",
    description:
      "Issues a `mobile` bearer token (scopes read, write, docs:write, costs:write; valid for 90 days). The token is shown once. Failed attempts share the login rate limit.",
    tags: ["auth"],
    auth: "public",
    scopes: [],
    body: tokenRequestSchema,
    response: tokenResponseSchema,
    status: 201,
    errors: ["invalid_credentials"],
  }),

  authRevokeToken: defineEndpoint({
    id: "authRevokeToken",
    method: "DELETE",
    path: "/api/v1/auth/token",
    summary: "Revoke the token used for this request",
    tags: ["auth"],
    auth: "bearer",
    scopes: [],
    response: emptySchema,
    status: 204,
  }),

  tokensList: defineEndpoint({
    id: "tokensList",
    method: "GET",
    path: "/api/v1/tokens",
    summary: "List the calling user's API tokens",
    description: "Never includes token values or hashes.",
    tags: ["tokens"],
    auth: "session",
    scopes: [],
    response: listTokensResponseSchema,
  }),

  tokensCreate: defineEndpoint({
    id: "tokensCreate",
    method: "POST",
    path: "/api/v1/tokens",
    summary: "Create an API token for an integration",
    description:
      "The plaintext token is in the response and never shown again. Scopes cannot exceed the caller's own.",
    tags: ["tokens"],
    auth: "session",
    scopes: [],
    body: createTokenRequestSchema,
    response: createdTokenSchema,
    status: 201,
  }),

  tokensRevoke: defineEndpoint({
    id: "tokensRevoke",
    method: "DELETE",
    path: "/api/v1/tokens/{id}",
    summary: "Revoke one of the calling user's API tokens",
    description: "Other users' tokens are not visible: 404.",
    tags: ["tokens"],
    auth: "session",
    scopes: [],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  usersList: defineEndpoint({
    id: "usersList",
    method: "GET",
    path: "/api/v1/users",
    summary: "List all users",
    tags: ["users"],
    auth: "session",
    scopes: ["admin"],
    response: listUsersResponseSchema,
  }),

  usersCreate: defineEndpoint({
    id: "usersCreate",
    method: "POST",
    path: "/api/v1/users",
    summary: "Create a user",
    tags: ["users"],
    auth: "session",
    scopes: ["admin"],
    body: createUserRequestSchema,
    response: adminUserEnvelopeSchema,
    status: 201,
    errors: ["conflict"],
  }),

  usersUpdate: defineEndpoint({
    id: "usersUpdate",
    method: "PATCH",
    path: "/api/v1/users/{id}",
    summary: "Change a user's role, name, cost share or password",
    description:
      "A password reset ends the user's sessions and revokes all of their live API tokens. Demoting an administrator revokes their tokens that hold the `admin` scope. The last administrator cannot be demoted.",
    tags: ["users"],
    auth: "session",
    scopes: ["admin"],
    params: idParamsSchema,
    body: updateUserRequestSchema,
    response: adminUserEnvelopeSchema,
    errors: ["not_found", "conflict"],
  }),

  roomsList: defineEndpoint({
    id: "roomsList",
    method: "GET",
    path: "/api/v1/rooms",
    summary: "List rooms",
    tags: ["rooms"],
    auth: "both",
    scopes: ["read"],
    query: listRoomsQuerySchema,
    response: listRoomsResponseSchema,
  }),

  roomsCreate: defineEndpoint({
    id: "roomsCreate",
    method: "POST",
    path: "/api/v1/rooms",
    summary: "Create a room",
    description: "The slug is derived from the name unless given.",
    tags: ["rooms"],
    auth: "both",
    scopes: ["write"],
    body: createRoomRequestSchema,
    response: roomSchema,
    status: 201,
    errors: ["conflict"],
  }),

  roomsGet: defineEndpoint({
    id: "roomsGet",
    method: "GET",
    path: "/api/v1/rooms/{id}",
    summary: "Get a room",
    tags: ["rooms"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: roomSchema,
    errors: ["not_found"],
  }),

  roomsUpdate: defineEndpoint({
    id: "roomsUpdate",
    method: "PATCH",
    path: "/api/v1/rooms/{id}",
    summary: "Update a room",
    tags: ["rooms"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: updateRoomRequestSchema,
    response: roomSchema,
    errors: ["not_found", "conflict"],
  }),

  roomsDelete: defineEndpoint({
    id: "roomsDelete",
    method: "DELETE",
    path: "/api/v1/rooms/{id}",
    summary: "Delete a room",
    description: "Assets and tasks in the room stay and lose their room.",
    tags: ["rooms"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  assetsList: defineEndpoint({
    id: "assetsList",
    method: "GET",
    path: "/api/v1/assets",
    summary: "List assets (devices, plants, fixtures)",
    description:
      "Filter by kind, room or a search text. Archived assets are left out unless includeArchived=true.",
    tags: ["assets"],
    auth: "both",
    scopes: ["read"],
    query: listAssetsQuerySchema,
    response: listAssetsResponseSchema,
  }),

  assetsCreate: defineEndpoint({
    id: "assetsCreate",
    method: "POST",
    path: "/api/v1/assets",
    summary: "Create an asset",
    description:
      "Gets a random qrSlug for QR deep links. The slug is derived from the name unless given.",
    tags: ["assets"],
    auth: "both",
    scopes: ["write"],
    body: createAssetRequestSchema,
    response: assetSchema,
    status: 201,
    errors: ["conflict"],
  }),

  assetsByQr: defineEndpoint({
    id: "assetsByQr",
    method: "GET",
    path: "/api/v1/assets/by-qr/{qrSlug}",
    summary: "Look up an asset by its QR slug",
    tags: ["assets"],
    auth: "both",
    scopes: ["read"],
    params: assetByQrParamsSchema,
    response: assetSchema,
    errors: ["not_found"],
  }),

  assetsGet: defineEndpoint({
    id: "assetsGet",
    method: "GET",
    path: "/api/v1/assets/{id}",
    summary: "Get an asset",
    tags: ["assets"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: assetSchema,
    errors: ["not_found"],
  }),

  assetsUpdate: defineEndpoint({
    id: "assetsUpdate",
    method: "PATCH",
    path: "/api/v1/assets/{id}",
    summary: "Update or archive an asset",
    description: "Set archived to true to archive, false to restore.",
    tags: ["assets"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: updateAssetRequestSchema,
    response: assetSchema,
    errors: ["not_found", "conflict"],
  }),

  assetsDelete: defineEndpoint({
    id: "assetsDelete",
    method: "DELETE",
    path: "/api/v1/assets/{id}",
    summary: "Delete an asset",
    description:
      "Tasks of the asset stay and lose the link. Archive instead to keep it.",
    tags: ["assets"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  tasksList: defineEndpoint({
    id: "tasksList",
    method: "GET",
    path: "/api/v1/tasks",
    summary: "List tasks with their due state",
    description:
      "Ordered overdue first, then by due date. assignee=me or a user id matches the current assignee.",
    tags: ["tasks"],
    auth: "both",
    scopes: ["read"],
    query: listTasksQuerySchema,
    response: listTasksResponseSchema,
  }),

  tasksCreate: defineEndpoint({
    id: "tasksCreate",
    method: "POST",
    path: "/api/v1/tasks",
    summary: "Create a task",
    description:
      "The trigger is validated by the due-date engine; the first due date is computed before the response.",
    tags: ["tasks"],
    auth: "both",
    scopes: ["write"],
    body: createTaskRequestSchema,
    response: taskSchema,
    status: 201,
    errors: ["conflict"],
  }),

  tasksPreview: defineEndpoint({
    id: "tasksPreview",
    method: "POST",
    path: "/api/v1/tasks/preview",
    summary: "Preview what a trigger would give",
    description:
      "Evaluates the trigger as if it had never been completed. Nothing is stored. POST for the body; needs only read access.",
    tags: ["tasks"],
    auth: "both",
    scopes: ["read"],
    body: previewTaskRequestSchema,
    response: dueResultSchema,
  }),

  tasksGet: defineEndpoint({
    id: "tasksGet",
    method: "GET",
    path: "/api/v1/tasks/{id}",
    summary: "Get a task with preparations and recent completions",
    tags: ["tasks"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: taskDetailSchema,
    errors: ["not_found"],
  }),

  tasksUpdate: defineEndpoint({
    id: "tasksUpdate",
    method: "PATCH",
    path: "/api/v1/tasks/{id}",
    summary: "Update or archive a task",
    description:
      "Re-evaluates the task. archived=true archives, false restores.",
    tags: ["tasks"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: updateTaskRequestSchema,
    response: taskSchema,
    errors: ["not_found"],
  }),

  tasksDelete: defineEndpoint({
    id: "tasksDelete",
    method: "DELETE",
    path: "/api/v1/tasks/{id}",
    summary: "Delete a task",
    description:
      "Removes the task with its completions, preparations and notifications. Archive instead to keep the history.",
    tags: ["tasks"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  tasksComplete: defineEndpoint({
    id: "tasksComplete",
    method: "POST",
    path: "/api/v1/tasks/{id}/complete",
    summary: "Mark a task done",
    description:
      "Returns the completion and the re-evaluated task. A repeated idempotencyKey returns the first completion with status 200. Browser sessions are attributed as manual (or qr when sent); API tokens by their kind (mcp, ha, otherwise api) and their source field is ignored. Linked spare parts are taken out of stock. With serviceLog the work is also logged on the task's asset (400 for a task without an asset); the entry comes back as serviceLog.",
    tags: ["tasks"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: completeTaskRequestSchema,
    response: completeTaskResponseSchema,
    status: 201,
    errors: ["not_found", "conflict"],
  }),

  tasksSkip: defineEndpoint({
    id: "tasksSkip",
    method: "POST",
    path: "/api/v1/tasks/{id}/skip",
    summary: "Skip the current occurrence of a task",
    description:
      "Like complete, but recorded as skipped: the next occurrence follows without counting as done.",
    tags: ["tasks"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: skipTaskRequestSchema,
    response: completeTaskResponseSchema,
    status: 201,
    errors: ["not_found", "conflict"],
  }),

  tasksSnooze: defineEndpoint({
    id: "tasksSnooze",
    method: "POST",
    path: "/api/v1/tasks/{id}/snooze",
    summary: "Hide a task until a date",
    description:
      "until must be after today; null ends the snooze. Snoozed tasks send no notifications.",
    tags: ["tasks"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: snoozeTaskRequestSchema,
    response: taskSchema,
    errors: ["not_found"],
  }),

  preparationsList: defineEndpoint({
    id: "preparationsList",
    method: "GET",
    path: "/api/v1/tasks/{id}/preparations",
    summary: "List the preparations of a task",
    tags: ["tasks"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: listPreparationsResponseSchema,
    errors: ["not_found"],
  }),

  preparationsCreate: defineEndpoint({
    id: "preparationsCreate",
    method: "POST",
    path: "/api/v1/tasks/{id}/preparations",
    summary: "Add a preparation to a task",
    tags: ["tasks"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: createPreparationRequestSchema,
    response: preparationSchema,
    status: 201,
    errors: ["not_found"],
  }),

  preparationsUpdate: defineEndpoint({
    id: "preparationsUpdate",
    method: "PATCH",
    path: "/api/v1/tasks/{id}/preparations/{prepId}",
    summary: "Update a preparation",
    tags: ["tasks"],
    auth: "both",
    scopes: ["write"],
    params: preparationParamsSchema,
    body: updatePreparationRequestSchema,
    response: preparationSchema,
    errors: ["not_found"],
  }),

  preparationsDelete: defineEndpoint({
    id: "preparationsDelete",
    method: "DELETE",
    path: "/api/v1/tasks/{id}/preparations/{prepId}",
    summary: "Delete a preparation",
    tags: ["tasks"],
    auth: "both",
    scopes: ["write"],
    params: preparationParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  preparationsComplete: defineEndpoint({
    id: "preparationsComplete",
    method: "POST",
    path: "/api/v1/tasks/{id}/preparations/{prepId}/complete",
    summary: "Tick off a preparation",
    description:
      "For the occurrence the task shows now unless occurrenceKey is given. Repeating it is not an error.",
    tags: ["tasks"],
    auth: "both",
    scopes: ["write"],
    params: preparationParamsSchema,
    body: completePreparationRequestSchema,
    response: preparationSchema,
    errors: ["not_found"],
  }),

  completionsList: defineEndpoint({
    id: "completionsList",
    method: "GET",
    path: "/api/v1/completions",
    summary: "Recent completions, newest first",
    tags: ["tasks"],
    auth: "both",
    scopes: ["read"],
    query: listCompletionsQuerySchema,
    response: listCompletionsResponseSchema,
  }),

  completionsUndo: defineEndpoint({
    id: "completionsUndo",
    method: "DELETE",
    path: "/api/v1/completions/{id}",
    summary: "Undo a completion",
    description:
      "Any household member may undo within 7 days of the completion being recorded; the task goes back to its previous due date. Undoing twice is not an error.",
    tags: ["tasks"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found", "conflict"],
  }),

  dashboard: defineEndpoint({
    id: "dashboard",
    method: "GET",
    path: "/api/v1/dashboard",
    summary: "Overview for the start page",
    description:
      "Overdue, today, this week, later (60 days) and signal-based tasks, relevant preparations and the last completions. openDefects: defects that need attention, by deadline. expiringWarranties: warranties ending within 90 days or ended at most 30 days ago. orderNow: parts to order now (same items as GET /parts/order-now).",
    tags: ["dashboard"],
    auth: "both",
    scopes: ["read"],
    response: dashboardSchema,
  }),

  stats: defineEndpoint({
    id: "stats",
    method: "GET",
    path: "/api/v1/stats",
    summary: "Completions per person and category",
    description:
      "By completion date between from and to (default: the last 90 days, at most 800 days).",
    tags: ["dashboard"],
    auth: "both",
    scopes: ["read"],
    query: statsQuerySchema,
    response: statsSchema,
  }),

  notificationsList: defineEndpoint({
    id: "notificationsList",
    method: "GET",
    path: "/api/v1/notifications",
    summary: "The caller's notifications, unread first",
    description:
      "Own and household-wide notifications. Text is a message key plus params, rendered in the reader's language.",
    tags: ["notifications"],
    auth: "both",
    scopes: ["read"],
    query: listNotificationsQuerySchema,
    response: listNotificationsResponseSchema,
  }),

  notificationsUnreadCount: defineEndpoint({
    id: "notificationsUnreadCount",
    method: "GET",
    path: "/api/v1/notifications/unread-count",
    summary: "Number of unread notifications",
    tags: ["notifications"],
    auth: "both",
    scopes: ["read"],
    response: unreadCountResponseSchema,
  }),

  notificationsReadAll: defineEndpoint({
    id: "notificationsReadAll",
    method: "POST",
    path: "/api/v1/notifications/read-all",
    summary: "Mark all notifications read",
    tags: ["notifications"],
    auth: "both",
    scopes: ["write"],
    response: readAllResponseSchema,
  }),

  notificationsRead: defineEndpoint({
    id: "notificationsRead",
    method: "POST",
    path: "/api/v1/notifications/{id}/read",
    summary: "Mark a notification read",
    description: "Other users' notifications are not visible: 404.",
    tags: ["notifications"],
    auth: "both",
    scopes: ["write"],
    params: notificationIdParamsSchema,
    response: notificationSchema,
    errors: ["not_found"],
  }),

  householdGet: defineEndpoint({
    id: "householdGet",
    method: "GET",
    path: "/api/v1/household",
    summary: "The household's name, settings and time zone",
    tags: ["household"],
    auth: "both",
    scopes: ["read"],
    response: householdSchema,
  }),

  householdUpdate: defineEndpoint({
    id: "householdUpdate",
    method: "PATCH",
    path: "/api/v1/household",
    summary: "Change the household's name, handover date or settings",
    tags: ["household"],
    auth: "both",
    scopes: ["admin"],
    body: updateHouseholdRequestSchema,
    response: householdSchema,
  }),

  usersDirectory: defineEndpoint({
    id: "usersDirectory",
    method: "GET",
    path: "/api/v1/users/directory",
    summary: "Names of everyone in the household",
    description:
      "Id and display name only, for assignee pickers and activity lines. Open to every authenticated caller.",
    tags: ["users"],
    auth: "both",
    scopes: [],
    response: listDirectoryResponseSchema,
  }),

  usersRevokeTokens: defineEndpoint({
    id: "usersRevokeTokens",
    method: "POST",
    path: "/api/v1/users/{id}/revoke-tokens",
    summary: "Revoke all of a user's API tokens",
    description:
      "Revokes every live API token (mobile, integration, MCP) of the user, e.g. after a leaked token. Browser sessions are not affected. Returns how many tokens were revoked.",
    tags: ["users"],
    auth: "session",
    scopes: ["admin"],
    params: idParamsSchema,
    response: revokeTokensResponseSchema,
    errors: ["not_found"],
  }),

  contactsList: defineEndpoint({
    id: "contactsList",
    method: "GET",
    path: "/api/v1/contacts",
    summary: "List contacts",
    description:
      "Filter by kind, emergency flag or a search text over name, company, e-mail and phone. Sorted by sort order, then name.",
    tags: ["contacts"],
    auth: "both",
    scopes: ["read"],
    query: listContactsQuerySchema,
    response: listContactsResponseSchema,
  }),

  contactsCreate: defineEndpoint({
    id: "contactsCreate",
    method: "POST",
    path: "/api/v1/contacts",
    summary: "Create a contact",
    description:
      "externalSource and externalRef link the contact to a record in another system; the pair is unique.",
    tags: ["contacts"],
    auth: "both",
    scopes: ["write"],
    body: createContactRequestSchema,
    response: contactSchema,
    status: 201,
    errors: ["conflict"],
  }),

  contactsGet: defineEndpoint({
    id: "contactsGet",
    method: "GET",
    path: "/api/v1/contacts/{id}",
    summary: "Get a contact",
    tags: ["contacts"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: contactSchema,
    errors: ["not_found"],
  }),

  contactsUpdate: defineEndpoint({
    id: "contactsUpdate",
    method: "PATCH",
    path: "/api/v1/contacts/{id}",
    summary: "Update a contact",
    tags: ["contacts"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: updateContactRequestSchema,
    response: contactSchema,
    errors: ["not_found", "conflict"],
  }),

  contactsDelete: defineEndpoint({
    id: "contactsDelete",
    method: "DELETE",
    path: "/api/v1/contacts/{id}",
    summary: "Delete a contact",
    description:
      "Links to assets are removed; service log entries and defects that named the contact keep their text and lose the link.",
    tags: ["contacts"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  assetContactsList: defineEndpoint({
    id: "assetContactsList",
    method: "GET",
    path: "/api/v1/assets/{id}/contacts",
    summary: "Contacts linked to an asset",
    tags: ["contacts", "assets"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    query: paginationQueryOnlySchema,
    response: listAssetContactsResponseSchema,
    errors: ["not_found"],
  }),

  assetContactsLink: defineEndpoint({
    id: "assetContactsLink",
    method: "POST",
    path: "/api/v1/assets/{id}/contacts",
    summary: "Link a contact to an asset",
    description:
      "A contact can be linked to an asset once per role; repeating it is a conflict.",
    tags: ["contacts", "assets"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: linkAssetContactRequestSchema,
    response: assetContactSchema,
    status: 201,
    errors: ["not_found", "conflict"],
  }),

  assetContactsUnlink: defineEndpoint({
    id: "assetContactsUnlink",
    method: "DELETE",
    path: "/api/v1/assets/{id}/contacts/{linkId}",
    summary: "Unlink a contact from an asset",
    tags: ["contacts", "assets"],
    auth: "both",
    scopes: ["write"],
    params: assetContactParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  partsList: defineEndpoint({
    id: "partsList",
    method: "GET",
    path: "/api/v1/parts",
    summary: "List spare parts",
    description:
      "Filter by a search text, by linked asset or task, or to parts below their minimum stock. Archived parts are left out unless includeArchived=true.",
    tags: ["parts"],
    auth: "both",
    scopes: ["read"],
    query: listPartsQuerySchema,
    response: listPartsResponseSchema,
  }),

  partsCreate: defineEndpoint({
    id: "partsCreate",
    method: "POST",
    path: "/api/v1/parts",
    summary: "Create a spare part",
    description:
      "A starting stock above zero is booked as a movement. The currency defaults to the household's.",
    tags: ["parts"],
    auth: "both",
    scopes: ["write"],
    body: createPartRequestSchema,
    response: partSchema,
    status: 201,
  }),

  partsOrderNow: defineEndpoint({
    id: "partsOrderNow",
    method: "GET",
    path: "/api/v1/parts/order-now",
    summary: "Parts to order now",
    description:
      "For each task with linked parts: the parts whose stock (plus what is on order) does not cover the quantity the task needs plus the minimum stock, once today has reached the order-by date (needed-by date minus the part's lead time). Sorted by order-by date.",
    tags: ["parts"],
    auth: "both",
    scopes: ["read"],
    response: listOrderNowResponseSchema,
  }),

  partsGet: defineEndpoint({
    id: "partsGet",
    method: "GET",
    path: "/api/v1/parts/{id}",
    summary: "Get a spare part with its links and recent movements",
    tags: ["parts"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: partDetailSchema,
    errors: ["not_found"],
  }),

  partsUpdate: defineEndpoint({
    id: "partsUpdate",
    method: "PATCH",
    path: "/api/v1/parts/{id}",
    summary: "Update a spare part",
    description:
      "Stock is changed with the stock endpoint, which records a movement.",
    tags: ["parts"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: updatePartRequestSchema,
    response: partSchema,
    errors: ["not_found"],
  }),

  partsDelete: defineEndpoint({
    id: "partsDelete",
    method: "DELETE",
    path: "/api/v1/parts/{id}",
    summary: "Delete a spare part",
    description:
      "Links to assets and tasks and the movement history go with it; preparations that named the part lose the link. Archive to keep the history.",
    tags: ["parts"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  partsStock: defineEndpoint({
    id: "partsStock",
    method: "POST",
    path: "/api/v1/parts/{id}/stock",
    summary: "Book a stock movement",
    description:
      "`used` takes stock out (negative delta), `bought` brings it in (positive delta) and ends a pending order, `correction` does either. Stock cannot go below zero. Completing a task that has the part linked books a `used` movement by itself.",
    tags: ["parts"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: stockMovementRequestSchema,
    response: partSchema,
    errors: ["not_found"],
  }),

  partsMovements: defineEndpoint({
    id: "partsMovements",
    method: "GET",
    path: "/api/v1/parts/{id}/movements",
    summary: "Stock movements of a part, newest first",
    tags: ["parts"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    query: paginationQueryOnlySchema,
    response: listMovementsResponseSchema,
    errors: ["not_found"],
  }),

  partsOrdered: defineEndpoint({
    id: "partsOrdered",
    method: "POST",
    path: "/api/v1/parts/{id}/ordered",
    summary: "Mark a part as ordered",
    description:
      "Records the order time and quantity (default: the reorder quantity); qty 0 clears the order. Booking the stock as bought clears it too.",
    tags: ["parts"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: markOrderedRequestSchema,
    response: partSchema,
    errors: ["not_found"],
  }),

  assetPartsList: defineEndpoint({
    id: "assetPartsList",
    method: "GET",
    path: "/api/v1/assets/{id}/parts",
    summary: "Spare parts of an asset",
    tags: ["parts", "assets"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    query: paginationQueryOnlySchema,
    response: listAssetPartsResponseSchema,
    errors: ["not_found"],
  }),

  assetPartsLink: defineEndpoint({
    id: "assetPartsLink",
    method: "POST",
    path: "/api/v1/assets/{id}/parts",
    summary: "Link a spare part to an asset",
    tags: ["parts", "assets"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: linkAssetPartRequestSchema,
    response: assetPartSchema,
    status: 201,
    errors: ["not_found", "conflict"],
  }),

  assetPartsUnlink: defineEndpoint({
    id: "assetPartsUnlink",
    method: "DELETE",
    path: "/api/v1/assets/{id}/parts/{partId}",
    summary: "Unlink a spare part from an asset",
    tags: ["parts", "assets"],
    auth: "both",
    scopes: ["write"],
    params: assetPartParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  taskPartsList: defineEndpoint({
    id: "taskPartsList",
    method: "GET",
    path: "/api/v1/tasks/{id}/parts",
    summary: "Spare parts a task uses",
    tags: ["parts", "tasks"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    query: paginationQueryOnlySchema,
    response: listTaskPartsResponseSchema,
    errors: ["not_found"],
  }),

  taskPartsLink: defineEndpoint({
    id: "taskPartsLink",
    method: "POST",
    path: "/api/v1/tasks/{id}/parts",
    summary: "Link a spare part to a task",
    description:
      "Completing the task takes qty of the part out of stock; undoing the completion puts it back.",
    tags: ["parts", "tasks"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: linkTaskPartRequestSchema,
    response: taskPartSchema,
    status: 201,
    errors: ["not_found", "conflict"],
  }),

  taskPartsUpdate: defineEndpoint({
    id: "taskPartsUpdate",
    method: "PATCH",
    path: "/api/v1/tasks/{id}/parts/{partId}",
    summary: "Change the quantity a task uses",
    tags: ["parts", "tasks"],
    auth: "both",
    scopes: ["write"],
    params: assetPartParamsSchema,
    body: updateTaskPartRequestSchema,
    response: taskPartSchema,
    errors: ["not_found"],
  }),

  taskPartsUnlink: defineEndpoint({
    id: "taskPartsUnlink",
    method: "DELETE",
    path: "/api/v1/tasks/{id}/parts/{partId}",
    summary: "Unlink a spare part from a task",
    tags: ["parts", "tasks"],
    auth: "both",
    scopes: ["write"],
    params: assetPartParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  serviceLogList: defineEndpoint({
    id: "serviceLogList",
    method: "GET",
    path: "/api/v1/service-log",
    summary: "Recent service log entries across all assets",
    description: "Newest first; filter by asset, kind or a date range.",
    tags: ["service-log"],
    auth: "both",
    scopes: ["read"],
    query: listServiceLogQuerySchema,
    response: listServiceLogResponseSchema,
  }),

  assetServiceLogList: defineEndpoint({
    id: "assetServiceLogList",
    method: "GET",
    path: "/api/v1/assets/{id}/service-log",
    summary: "Service log of an asset, newest first",
    tags: ["service-log", "assets"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    query: listAssetServiceLogQuerySchema,
    response: listServiceLogResponseSchema,
    errors: ["not_found"],
  }),

  assetServiceLogCreate: defineEndpoint({
    id: "assetServiceLogCreate",
    method: "POST",
    path: "/api/v1/assets/{id}/service-log",
    summary: "Add a service log entry",
    tags: ["service-log", "assets"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: createServiceLogRequestSchema,
    response: serviceLogEntrySchema,
    status: 201,
    errors: ["not_found"],
  }),

  assetServiceLogGet: defineEndpoint({
    id: "assetServiceLogGet",
    method: "GET",
    path: "/api/v1/assets/{id}/service-log/{entryId}",
    summary: "Get a service log entry",
    tags: ["service-log", "assets"],
    auth: "both",
    scopes: ["read"],
    params: serviceLogParamsSchema,
    response: serviceLogEntrySchema,
    errors: ["not_found"],
  }),

  assetServiceLogUpdate: defineEndpoint({
    id: "assetServiceLogUpdate",
    method: "PATCH",
    path: "/api/v1/assets/{id}/service-log/{entryId}",
    summary: "Update a service log entry",
    tags: ["service-log", "assets"],
    auth: "both",
    scopes: ["write"],
    params: serviceLogParamsSchema,
    body: updateServiceLogRequestSchema,
    response: serviceLogEntrySchema,
    errors: ["not_found"],
  }),

  assetServiceLogDelete: defineEndpoint({
    id: "assetServiceLogDelete",
    method: "DELETE",
    path: "/api/v1/assets/{id}/service-log/{entryId}",
    summary: "Delete a service log entry",
    tags: ["service-log", "assets"],
    auth: "both",
    scopes: ["write"],
    params: serviceLogParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  defectsList: defineEndpoint({
    id: "defectsList",
    method: "GET",
    path: "/api/v1/defects",
    summary: "List defects",
    description:
      "Defects that still need attention come first, by deadline (none last), then by number. Filter by status (or active=true for open, reported and in progress), severity, room, asset or a search text.",
    tags: ["defects"],
    auth: "both",
    scopes: ["read"],
    query: listDefectsQuerySchema,
    response: listDefectsResponseSchema,
  }),

  defectsCreate: defineEndpoint({
    id: "defectsCreate",
    method: "POST",
    path: "/api/v1/defects",
    summary: "Record a defect",
    description:
      "Without deadlineDate the deadline is the household's handover date plus its defect deadline months, when a handover date is set. A deadline creates a reminder task.",
    tags: ["defects"],
    auth: "both",
    scopes: ["write"],
    body: createDefectRequestSchema,
    response: defectSchema,
    status: 201,
  }),

  defectsExport: defineEndpoint({
    id: "defectsExport",
    method: "GET",
    path: "/api/v1/defects/export.pdf",
    summary: "Defect list as a PDF",
    description:
      "An A4 document: a table of the defects (filtered by status and room) and the history of each one. Language follows the caller's account.",
    tags: ["defects"],
    auth: "both",
    scopes: ["read"],
    query: exportDefectsQuerySchema,
    response: binaryResponseSchema,
    responseType: "binary",
    contentTypes: ["application/pdf"],
  }),

  defectsGet: defineEndpoint({
    id: "defectsGet",
    method: "GET",
    path: "/api/v1/defects/{id}",
    summary: "Get a defect with its events",
    tags: ["defects"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: defectDetailSchema,
    errors: ["not_found"],
  }),

  defectsUpdate: defineEndpoint({
    id: "defectsUpdate",
    method: "PATCH",
    path: "/api/v1/defects/{id}",
    summary: "Update a defect",
    description:
      "The status has its own endpoint. Changing the deadline updates the reminder task.",
    tags: ["defects"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: updateDefectRequestSchema,
    response: defectSchema,
    errors: ["not_found"],
  }),

  defectsDelete: defineEndpoint({
    id: "defectsDelete",
    method: "DELETE",
    path: "/api/v1/defects/{id}",
    summary: "Delete a defect",
    description:
      "Events, comments and the reminder task go with it. Close a defect (fixed, rejected) to keep the history.",
    tags: ["defects"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  defectsStatus: defineEndpoint({
    id: "defectsStatus",
    method: "POST",
    path: "/api/v1/defects/{id}/status",
    summary: "Change the status of a defect",
    description:
      "From open, reported or in progress to any other status; fixed and rejected defects can only be reopened. Every change is written to the defect's events. Fixed and rejected archive the reminder task, reopening restores it.",
    tags: ["defects"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: changeDefectStatusRequestSchema,
    response: defectDetailSchema,
    errors: ["not_found", "conflict"],
  }),

  defectsAddEvent: defineEndpoint({
    id: "defectsAddEvent",
    method: "POST",
    path: "/api/v1/defects/{id}/events",
    summary: "Note correspondence on a defect",
    description:
      "Adds a correspondence entry (a letter sent or received) to the defect's history. Remarks use the generic comments endpoints.",
    tags: ["defects"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: addDefectEventRequestSchema,
    response: defectEventSchema,
    status: 201,
    errors: ["not_found"],
  }),

  defectsTimeline: defineEndpoint({
    id: "defectsTimeline",
    method: "GET",
    path: "/api/v1/defects/{id}/timeline",
    summary: "Events and comments of a defect, oldest first",
    tags: ["defects"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: defectTimelineResponseSchema,
    errors: ["not_found"],
  }),

  warrantiesList: defineEndpoint({
    id: "warrantiesList",
    method: "GET",
    path: "/api/v1/warranties",
    summary: "Warranty overview",
    description:
      "Assets with a warranty date, by the day the warranty ends (the later of warrantyUntil and warrantyExtendedUntil). Status: expired once that day has passed, expiring within 90 days, otherwise valid.",
    tags: ["warranties"],
    auth: "both",
    scopes: ["read"],
    query: listWarrantiesQuerySchema,
    response: listWarrantiesResponseSchema,
  }),

  commentsList: defineEndpoint({
    id: "commentsList",
    method: "GET",
    path: "/api/v1/comments",
    summary: "Comments on a task, defect, asset or other entity",
    description:
      "Oldest first. Deleted comments stay in the thread with an empty body and deleted=true.",
    tags: ["comments"],
    auth: "both",
    scopes: ["read"],
    query: listCommentsQuerySchema,
    response: listCommentsResponseSchema,
    errors: ["not_found"],
  }),

  commentsCreate: defineEndpoint({
    id: "commentsCreate",
    method: "POST",
    path: "/api/v1/comments",
    summary: "Add a comment",
    description:
      "The other household members involved get an in-app notification.",
    tags: ["comments"],
    auth: "both",
    scopes: ["write"],
    body: createCommentRequestSchema,
    response: commentSchema,
    status: 201,
    errors: ["not_found"],
  }),

  commentsUpdate: defineEndpoint({
    id: "commentsUpdate",
    method: "PATCH",
    path: "/api/v1/comments/{id}",
    summary: "Edit a comment",
    description:
      "Only its author may edit, at any time; the edit time is recorded. Deleted comments cannot be edited.",
    tags: ["comments"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: updateCommentRequestSchema,
    response: commentSchema,
    errors: ["not_found", "forbidden", "conflict"],
  }),

  commentsDelete: defineEndpoint({
    id: "commentsDelete",
    method: "DELETE",
    path: "/api/v1/comments/{id}",
    summary: "Delete a comment",
    description:
      "Its author or an administrator may delete. The comment stays in the thread as deleted; deleting twice is not an error.",
    tags: ["comments"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found", "forbidden"],
  }),

  assetHintsList: defineEndpoint({
    id: "assetHintsList",
    method: "GET",
    path: "/api/v1/assets/{id}/hints",
    summary: "Care hints of an asset",
    description: "Pinned hints first, then by sort order and creation time.",
    tags: ["hints", "assets"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    query: paginationQueryOnlySchema,
    response: listAssetHintsResponseSchema,
    errors: ["not_found"],
  }),

  assetHintsCreate: defineEndpoint({
    id: "assetHintsCreate",
    method: "POST",
    path: "/api/v1/assets/{id}/hints",
    summary: "Add a care hint to an asset",
    description:
      "A hint is a tip, rule or warning for using or caring for the device. It may link a recurring task and carry a signal reaction (stored; an adapter carries it out). Without sortOrder it goes to the end.",
    tags: ["hints", "assets"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: createHintRequestSchema,
    response: hintSchema,
    status: 201,
    errors: ["not_found"],
  }),

  hintsList: defineEndpoint({
    id: "hintsList",
    method: "GET",
    path: "/api/v1/hints",
    summary: "List care hints across assets",
    description:
      "Filter by asset, kind or reactive=true (hints with a signal reaction). Archived assets' hints are left out.",
    tags: ["hints"],
    auth: "both",
    scopes: ["read"],
    query: listHintsQuerySchema,
    response: listAssetHintsResponseSchema,
  }),

  hintsGet: defineEndpoint({
    id: "hintsGet",
    method: "GET",
    path: "/api/v1/hints/{id}",
    summary: "Get a care hint",
    tags: ["hints"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: hintSchema,
    errors: ["not_found"],
  }),

  hintsUpdate: defineEndpoint({
    id: "hintsUpdate",
    method: "PATCH",
    path: "/api/v1/hints/{id}",
    summary: "Update a care hint",
    description: "Reorder by changing sortOrder; pin with pinned.",
    tags: ["hints"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: updateHintRequestSchema,
    response: hintSchema,
    errors: ["not_found"],
  }),

  hintsDelete: defineEndpoint({
    id: "hintsDelete",
    method: "DELETE",
    path: "/api/v1/hints/{id}",
    summary: "Delete a care hint",
    description: "Its comments go with it; a linked task stays.",
    tags: ["hints"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),
  pagesList: defineEndpoint({
    id: "pagesList",
    method: "GET",
    path: "/api/v1/pages",
    summary: "List documentation pages",
    description:
      "Pinned first, then by sortOrder and title; with q, best match first. q is a full-text search over title and text (secret blocks excluded); archived pages are never found by it. Archived pages are left out unless includeArchived=true.",
    tags: ["docs"],
    auth: "both",
    scopes: ["read"],
    query: listPagesQuerySchema,
    response: listPagesResponseSchema,
  }),

  pagesCreate: defineEndpoint({
    id: "pagesCreate",
    method: "POST",
    path: "/api/v1/pages",
    summary: "Create a documentation page",
    description:
      "The markdown is rendered before the response (member and guest HTML, plain text, headings). 400 `invalid_request` with `details.code` `too_large` (over 200 KB) or `too_complex` (rendering exceeded its time limit) when it cannot be rendered. Writes revision 1. `attachment:<id>` links and images resolve to attachments, `[[slug]]` and `[[slug|label]]` to `/docs/<slug>`.",
    tags: ["docs"],
    auth: "both",
    scopes: ["docs:write"],
    body: createPageRequestSchema,
    maxBodyBytes: MAX_MARKDOWN_REQUEST_BYTES,
    response: docPageSchema,
    status: 201,
    errors: ["conflict"],
  }),

  pagesPreview: defineEndpoint({
    id: "pagesPreview",
    method: "POST",
    path: "/api/v1/pages/preview",
    summary: "Render markdown for the editor preview",
    description:
      "Renders as a member sees the page (secret blocks shown). Nothing is stored. Same size and complexity limits as saving; rate limited per user (429 `rate_limited`).",
    tags: ["docs"],
    auth: "both",
    scopes: ["docs:write"],
    body: previewPageRequestSchema,
    maxBodyBytes: MAX_MARKDOWN_REQUEST_BYTES,
    response: previewPageResponseSchema,
    errors: ["rate_limited"],
  }),

  pagesGet: defineEndpoint({
    id: "pagesGet",
    method: "GET",
    path: "/api/v1/pages/{slug}",
    summary: "Get a documentation page",
    description:
      "Markdown source, rendered HTML for members (secret blocks included), headings, revision number and backlinks.",
    tags: ["docs"],
    auth: "both",
    scopes: ["read"],
    params: pageParamsSchema,
    response: docPageSchema,
    errors: ["not_found"],
  }),

  pagesUpdate: defineEndpoint({
    id: "pagesUpdate",
    method: "PATCH",
    path: "/api/v1/pages/{slug}",
    summary: "Edit, move, pin or archive a page",
    description:
      "`rev` is the revision the client edited; when the page has moved on the answer is 409 `conflict` with `details.currentRev`. Every successful save writes a revision (the last 50 are kept). Changing the slug does not rewrite `[[links]]` in other pages.",
    tags: ["docs"],
    auth: "both",
    scopes: ["docs:write"],
    params: pageParamsSchema,
    body: updatePageRequestSchema,
    maxBodyBytes: MAX_MARKDOWN_REQUEST_BYTES,
    response: docPageSchema,
    errors: ["not_found", "conflict"],
  }),

  pagesDelete: defineEndpoint({
    id: "pagesDelete",
    method: "DELETE",
    path: "/api/v1/pages/{slug}",
    summary: "Delete a page",
    description:
      "Removes the page with its revisions and attachments. Archive instead to keep it.",
    tags: ["docs"],
    auth: "both",
    scopes: ["docs:write"],
    params: pageParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  pageRevisionsList: defineEndpoint({
    id: "pageRevisionsList",
    method: "GET",
    path: "/api/v1/pages/{slug}/revisions",
    summary: "Revision history of a page, newest first",
    description: "The last 50 saved states (no markdown; fetch one for that).",
    tags: ["docs"],
    auth: "both",
    scopes: ["read"],
    params: pageParamsSchema,
    response: listRevisionsResponseSchema,
    errors: ["not_found"],
  }),

  pageRevisionsGet: defineEndpoint({
    id: "pageRevisionsGet",
    method: "GET",
    path: "/api/v1/pages/{slug}/revisions/{rev}",
    summary: "One saved state of a page, with its markdown",
    tags: ["docs"],
    auth: "both",
    scopes: ["read"],
    params: pageRevisionParamsSchema,
    response: pageRevisionSchema,
    errors: ["not_found"],
  }),

  pageRevisionsRestore: defineEndpoint({
    id: "pageRevisionsRestore",
    method: "POST",
    path: "/api/v1/pages/{slug}/revisions/{rev}/restore",
    summary: "Make an earlier revision the current one",
    description:
      "Saves the title and markdown of that revision as a new revision (history is never rewritten, so nothing is lost). Returns the page.",
    tags: ["docs"],
    auth: "both",
    scopes: ["docs:write"],
    params: pageRevisionParamsSchema,
    response: docPageSchema,
    errors: ["not_found"],
  }),

  search: defineEndpoint({
    id: "search",
    method: "GET",
    path: "/api/v1/search",
    summary: "Search pages, assets, rooms and tasks",
    description:
      "Full-text search, best match first; every word is matched as a prefix. Archived pages, assets and tasks are not searched. Pages are searched without their secret blocks, and the free text of assets, rooms and tasks is cut off at the first `:::` block when it mentions a secret, so a snippet never contains secret text. Snippets are plain text.",
    tags: ["search"],
    auth: "both",
    scopes: ["read"],
    query: searchQuerySchema,
    response: searchResponseSchema,
  }),

  attachmentsUpload: defineEndpoint({
    id: "attachmentsUpload",
    method: "POST",
    path: "/api/v1/attachments",
    summary: "Upload a file to an owner",
    description:
      "multipart/form-data with `file`, `ownerType`, `ownerId`, optional `caption` and `guestVisible`. JPEG, PNG and WebP images are re-encoded (metadata removed, orientation applied, longest side capped) and get a thumbnail; PDFs are stored as uploaded. At most 25 MiB. Errors are 400/413/415 `invalid_request` with `details.code`: `empty`, `too_large` (413), `unsupported_type` (415), `unsupported_heic` (415), `corrupt_image`, `image_too_large` (413); an unknown or unsupported owner is a field error on `ownerId` or `ownerType`. Attaching to a page needs the `docs:write` scope.",
    tags: ["attachments"],
    auth: "both",
    scopes: ["write"],
    body: uploadAttachmentRequestSchema,
    bodyType: "multipart",
    maxBodyBytes: MAX_UPLOAD_REQUEST_BYTES,
    response: attachmentSchema,
    status: 201,
  }),

  attachmentsList: defineEndpoint({
    id: "attachmentsList",
    method: "GET",
    path: "/api/v1/attachments",
    summary: "List the attachments of an owner",
    description: "Oldest first.",
    tags: ["attachments"],
    auth: "both",
    scopes: ["read"],
    query: listAttachmentsQuerySchema,
    response: listAttachmentsResponseSchema,
  }),

  attachmentsGet: defineEndpoint({
    id: "attachmentsGet",
    method: "GET",
    path: "/api/v1/attachments/{id}",
    summary: "Attachment metadata",
    tags: ["attachments"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: attachmentSchema,
    errors: ["not_found"],
  }),

  attachmentsUpdate: defineEndpoint({
    id: "attachmentsUpdate",
    method: "PATCH",
    path: "/api/v1/attachments/{id}",
    summary: "Change the caption or the guest visibility",
    description:
      "Pages that embed the attachment are rendered again. Needs `docs:write` when the owner is a page.",
    tags: ["attachments"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: updateAttachmentRequestSchema,
    response: attachmentSchema,
    errors: ["not_found"],
  }),

  attachmentsDelete: defineEndpoint({
    id: "attachmentsDelete",
    method: "DELETE",
    path: "/api/v1/attachments/{id}",
    summary: "Delete an attachment",
    description:
      "Removes the row and, when nothing else uses the stored file, the file (a file stored less than a minute ago is kept until the next cleanup). An asset photo pointing at it is cleared. Pages that embed it are rendered again. Needs `docs:write` when the owner is a page.",
    tags: ["attachments"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  attachmentsContent: defineEndpoint({
    id: "attachmentsContent",
    method: "GET",
    path: "/api/v1/attachments/{id}/content",
    summary: "The file itself",
    description:
      "Streams the stored bytes with their detected content type: images and PDFs inline, `?download=1` as a download. Sent with `nosniff`, a restrictive CSP, an ETag (`If-None-Match` answers 304) and `Cache-Control: private, max-age=31536000, immutable`. Works for `<img src>` with the session cookie.",
    tags: ["attachments"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    query: attachmentContentQuerySchema,
    response: binaryResponseSchema,
    responseType: "binary",
    contentTypes: [...ATTACHMENT_CONTENT_TYPES, "application/octet-stream"],
    errors: ["not_found"],
  }),

  attachmentsThumb: defineEndpoint({
    id: "attachmentsThumb",
    method: "GET",
    path: "/api/v1/attachments/{id}/thumb",
    summary: "Thumbnail of an image attachment",
    description:
      "480 px WebP; 404 for attachments without a thumbnail (PDFs). Same headers as the content endpoint.",
    tags: ["attachments"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: binaryResponseSchema,
    responseType: "binary",
    contentTypes: ["image/webp"],
    errors: ["not_found"],
  }),
};

export type Endpoints = typeof endpoints;
export const endpointList: readonly AnyEndpoint[] = Object.values(endpoints);
