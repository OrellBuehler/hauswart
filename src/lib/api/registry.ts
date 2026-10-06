import { z } from "zod";
import { API_PREFIX } from "./constants";
import type { ErrorCode } from "./errors";
import type { Scope } from "./scopes";
import { emptySchema, idParamsSchema } from "./schemas/common";
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

export interface EndpointDef<
  A extends AuthMode,
  P extends ParamsSchema | undefined,
  Q extends ParamsSchema | undefined,
  B extends z.ZodType | undefined,
  R extends z.ZodType,
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
>(def: EndpointDef<A, P, Q, B, R>): Endpoint<A, P, Q, B, R> {
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
    description: "True until the first administrator account exists.",
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
      "Only works while no user exists. Starts a browser session (sets the session cookie).",
    tags: ["setup"],
    auth: "public",
    scopes: [],
    setsSession: true,
    body: setupRequestSchema,
    response: userEnvelopeSchema,
    status: 201,
    errors: ["setup_complete"],
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
      "A password reset ends the user's sessions and revokes their device tokens. The last administrator cannot be demoted.",
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
      "Returns the completion and the re-evaluated task. A repeated idempotencyKey returns the first completion with status 200. Browser sessions are attributed as manual (or qr when sent); API tokens by their kind (mcp, ha, otherwise api) and their source field is ignored.",
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
      "Overdue, today, this week, later (60 days) and signal-based tasks, relevant preparations and the last completions. openDefects, expiringWarranties and orderNow are reserved and empty until later milestones.",
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
};

export type Endpoints = typeof endpoints;
export const endpointList: readonly AnyEndpoint[] = Object.values(endpoints);
