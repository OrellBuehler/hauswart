import { z } from "zod";
import { API_PREFIX, MCP_PATH } from "./constants";
import type { ErrorCode } from "./errors";
import type { Scope } from "./scopes";
import {
  emptySchema,
  idParamsSchema,
  paginationQuerySchema as paginationQueryOnlySchema,
  binaryResponseSchema,
} from "./schemas/common";
import {
  changePasswordRequestSchema,
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
import { mcpRequestSchema } from "./schemas/mcp";
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
  importRoomAreasRequestSchema,
  importRoomAreasResponseSchema,
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
  createDocumentLinkRequestSchema,
  documentDetailSchema,
  documentLinkSchema,
  documentParamsSchema,
  documentSuggestionsQuerySchema,
  documentSuggestionsResponseSchema,
  documentUploadParamsSchema,
  documentUploadSchema,
  downloadQuerySchema,
  listCorrespondentsResponseSchema,
  listCustomFieldsResponseSchema,
  listDocumentLinksQuerySchema,
  listDocumentLinksResponseSchema,
  listDocumentsQuerySchema,
  listDocumentsResponseSchema,
  listGroupsResponseSchema,
  listPickerQuerySchema,
  listStoragePathsResponseSchema,
  listTagsResponseSchema,
  pushToDocumentsRequestSchema,
} from "./schemas/documents";

import {
  assetContactParamsSchema,
  assetContactSchema,
  contactDetailSchema,
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
  vehicleStatsQuerySchema,
  vehicleStatsSchema,
} from "./schemas/vehicle-stats";
import {
  createFuelLogRequestSchema,
  fuelLogSchema,
  listFuelLogsQuerySchema,
  listFuelLogsResponseSchema,
  updateFuelLogRequestSchema,
} from "./schemas/fuel-logs";
import {
  createTireSetRequestSchema,
  listTireSetsQuerySchema,
  listTireSetsResponseSchema,
  measureTreadRequestSchema,
  mountTireSetRequestSchema,
  tireSetDetailSchema,
  tireSetMountParamsSchema,
  updateTireSetRequestSchema,
} from "./schemas/tire-sets";
import {
  listOdometerQuerySchema,
  listOdometerResponseSchema,
  odometerReadingSchema,
  putVehicleRequestSchema,
  recordOdometerRequestSchema,
  vehicleSchema,
} from "./schemas/vehicles";
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
  actionRequestSchema,
  actionResponseSchema,
  integrationKindParamsSchema,
  integrationSchema,
  listAreasResponseSchema,
  listCalendarsResponseSchema,
  listDevicesResponseSchema,
  listEntitiesQuerySchema,
  listEntitiesResponseSchema,
  listIntegrationsResponseSchema,
  listNotifyServicesResponseSchema,
  saveIntegrationRequestSchema,
  testIntegrationResponseSchema,
} from "./schemas/integrations";
import {
  notificationSettingsResponseSchema,
  notificationSettingsSchema,
} from "./schemas/notification-settings";
import {
  commentSchema,
  createCommentRequestSchema,
  listCommentsQuerySchema,
  listCommentsResponseSchema,
  updateCommentRequestSchema,
} from "./schemas/comments";

import {
  calendarFeedSchema,
  createCalendarFeedRequestSchema,
  createGuestLinkRequestSchema,
  createdGuestLinkSchema,
  emergencySchema,
  exportEmergencyQuerySchema,
  guestLinkSchema,
  listCalendarFeedsResponseSchema,
  listGuestLinksResponseSchema,
  updateCalendarFeedRequestSchema,
  updateGuestLinkRequestSchema,
} from "./schemas/share";

import {
  costEntrySchema,
  costsSummaryQuerySchema,
  costsSummarySchema,
  createCostRequestSchema,
  exportCostsQuerySchema,
  listCostsQuerySchema,
  listCostsResponseSchema,
  updateCostRequestSchema,
} from "./schemas/costs";
import {
  acceptFinanceSuggestionRequestSchema,
  acceptFinanceSuggestionResponseSchema,
  financeSyncResponseSchema,
  listFinanceAccountsResponseSchema,
  listFinanceCategoriesResponseSchema,
  listFinanceSuggestionsQuerySchema,
  listFinanceSuggestionsResponseSchema,
  financeSuggestionSchema,
} from "./schemas/finance";
import {
  assetInsurancePoliciesQuerySchema,
  createInsurancePolicyRequestSchema,
  insurancePolicySchema,
  listInsurancePoliciesQuerySchema,
  listInsurancePoliciesResponseSchema,
  updateInsurancePolicyRequestSchema,
} from "./schemas/insurance";
import {
  assetNoteSchema,
  assetNoteToDefectResponseSchema,
  createAssetNoteRequestSchema,
  listAssetNotesQuerySchema,
  listAssetNotesResponseSchema,
  updateAssetNoteRequestSchema,
} from "./schemas/asset-notes";

const DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/tiff",
  "text/plain",
  "application/octet-stream",
] as const;

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Who may call an endpoint: `session` = browser cookie only, `bearer` = API
 * token only, `both` = either, `public` = anyone.
 */
export type AuthMode = "session" | "bearer" | "both" | "public";

export type ParamsSchema = z.ZodObject;
export type SuccessStatus = 200 | 201 | 202 | 204;

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
    if (def.method !== "GET" && def.method !== "POST") {
      throw new Error(`${def.id}: binary endpoints must be GET or POST`);
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

  mcp: defineEndpoint({
    id: "mcp",
    method: "POST",
    path: MCP_PATH,
    summary: "MCP server (Streamable HTTP, stateless)",
    description:
      "The Model Context Protocol server of hauswart, for Claude Code and other MCP clients: `claude mcp add --transport http hauswart <address>/api/v1/mcp --header \"Authorization: Bearer hw_...\"`. Every POST carries one JSON-RPC message and is answered on its own (no session; the `Mcp-Session-Id` header is not used) with `application/json`; a notification is answered with 202 and no body. GET and DELETE are 405. The tools run through this API with the caller's token, so they offer what its scopes allow and completions are attributed to the token's kind. A request with an `Origin` header other than the app's own is refused with 403 `csrf_failed` (DNS rebinding); clients that are not browsers send none. Protocol and tools: mcp/README.md.",
    tags: ["mcp"],
    auth: "bearer",
    scopes: ["read"],
    body: mcpRequestSchema,
    maxBodyBytes: MAX_MARKDOWN_REQUEST_BYTES,
    response: binaryResponseSchema,
    responseType: "binary",
    contentTypes: ["application/json"],
    errors: ["csrf_failed"],
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

  authChangePassword: defineEndpoint({
    id: "authChangePassword",
    method: "POST",
    path: "/api/v1/me/password",
    summary: "Change the calling user's own password",
    description:
      "Needs the current password; a wrong one is a 400 field error on `currentPassword` (never 401, which would read as an expired session) and counts against the same failed-password budget as sign-in, so repeated guesses end in 429 with `Retry-After`. The new password follows the rules of setup and the administrator's reset (10 to 256 characters) and must differ from the current one. Every other browser session of the user ends; the session that made the call stays. API tokens stay valid (unlike an administrator's reset, which revokes them): revoke them with `DELETE /api/v1/tokens/{id}` when the password changed because of a leak.",
    tags: ["auth"],
    auth: "session",
    scopes: [],
    body: changePasswordRequestSchema,
    response: emptySchema,
    status: 204,
    errors: ["rate_limited"],
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

  roomsImportAreas: defineEndpoint({
    id: "roomsImportAreas",
    method: "POST",
    path: "/api/v1/rooms/import-areas",
    summary: "Take over areas of the connected system as rooms",
    description:
      "Takes ids from `GET /integrations/{kind}/areas`. Per area, in one transaction: a room that already stores the area id is left alone (`unchanged`); an unlinked room with the same name takes the area id instead of a duplicate (`linked`); otherwise a room named like the area is created (`created`) with the area id in `haAreaId`. An area the system no longer lists answers `not_found` and changes nothing. Repeating the call changes nothing more, and renaming the area later never touches the room. 404 without a connection or for a kind without areas; 502 `upstream_error` when the system does not answer.",
    tags: ["rooms"],
    auth: "both",
    scopes: ["write"],
    body: importRoomAreasRequestSchema,
    response: importRoomAreasResponseSchema,
    errors: ["not_found", "upstream_error"],
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
      "Returns the completion and the re-evaluated task. A repeated idempotencyKey returns the first completion with status 200. Browser sessions are attributed as manual (or qr when sent); API tokens by their kind (mcp, ha, otherwise api) and their source field is ignored. Linked spare parts are taken out of stock. With serviceLog the work is also logged on the task's asset (400 for a task without an asset); the entry comes back as serviceLog, and serviceLog.resolvedNoteIds resolves notes of that asset with it (undoing the completion reopens them; another asset's note is a 400 and nothing is completed). The returned task is read after the entry was written, so its openNoteCount is current.",
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
      "Any household member may undo within 7 days of the completion being recorded; the task goes back to its previous due date. Notes that the service log entry written with the completion had resolved are open again (the entry stays in the log). Undoing twice is not an error.",
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
    summary: "Get a contact with the assets it is linked to",
    tags: ["contacts"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: contactDetailSchema,
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
    description:
      "resolvedNoteIds: notes of this asset (see /assets/{id}/notes) the work addressed. They become resolved with this entry; another asset's note or an unknown id is a 400 and nothing is written.",
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
    description:
      "resolvedNoteIds adds notes of this asset to those the entry resolved (open ones become resolved with it, resolved ones stay as they are); it can be the only field. Notes are reopened by changing the note, deleting the entry or undoing the completion the entry was written with.",
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
    description:
      "The notes the entry had resolved are open again; its attachments and comments go with it.",
    tags: ["service-log", "assets"],
    auth: "both",
    scopes: ["write"],
    params: serviceLogParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  vehiclesGet: defineEndpoint({
    id: "vehiclesGet",
    method: "GET",
    path: "/api/v1/assets/{id}/vehicle",
    summary: "Details of a vehicle",
    description:
      "Plate, VIN, registration data, tire sizes, where it is kept and the newest odometer reading. A vehicle whose details were never saved answers with empty ones (and kilometres). 404 for a missing asset and for an asset that is no vehicle.",
    tags: ["vehicles", "assets"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: vehicleSchema,
    errors: ["not_found"],
  }),

  vehicleStats: defineEndpoint({
    id: "vehicleStats",
    method: "GET",
    path: "/api/v1/assets/{id}/vehicle/stats",
    summary: "A vehicle in numbers",
    description:
      "For a year (year=) or for all time: distance driven (from the odometer readings, per month too), the cost entries of the vehicle that count as an expense in the household currency by category and per distance unit, the average and the last ten consumption values (full-to-full) per unit, the price per unit of the fuel, the mounted tire set and the next tasks of the vehicle. 404 for an asset that is no vehicle.",
    tags: ["vehicles", "assets"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    query: vehicleStatsQuerySchema,
    response: vehicleStatsSchema,
    errors: ["not_found"],
  }),

  vehiclesPut: defineEndpoint({
    id: "vehiclesPut",
    method: "PUT",
    path: "/api/v1/assets/{id}/vehicle",
    summary: "Save the details of a vehicle",
    description:
      "Replaces the details: a field left out is cleared and the odometer unit goes back to km. Changing the unit relabels the readings, it does not convert them. 400 unless the asset has kind `vehicle`, 404 for a missing asset.",
    tags: ["vehicles", "assets"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: putVehicleRequestSchema,
    response: vehicleSchema,
    errors: ["not_found"],
  }),

  fuelLogsList: defineEndpoint({
    id: "fuelLogsList",
    method: "GET",
    path: "/api/v1/assets/{id}/fuel-logs",
    summary: "Fuel log (Tankbuch) of a vehicle, newest first",
    description:
      "Every fill-up or charge with its price per unit and, on a full fill that closes a stretch, the distance since the previous full fill, the consumption per 100 and the cost per distance (full-to-full method: partial fills in between are added up, a fill flagged missedPrevious starts the chain again, litres and kWh are counted apart). Filter by year.",
    tags: ["vehicles", "assets"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    query: listFuelLogsQuerySchema,
    response: listFuelLogsResponseSchema,
    errors: ["not_found"],
  }),

  fuelLogsCreate: defineEndpoint({
    id: "fuelLogsCreate",
    method: "POST",
    path: "/api/v1/assets/{id}/fuel-logs",
    summary: "Log a fill-up or charge",
    description:
      'In one transaction: the odometer becomes a reading of the vehicle (source fuel_log; a value lower than the reading before is a 400 on odometer) and, unless amountMinor is 0, a cost entry of the category fuel is booked for the vehicle (title like "Tanken <station>", paid by paidByUserId, default the caller, split by splitMode, default ownership). It needs costs:write because it books money. 400 for an asset that is no vehicle.',
    tags: ["vehicles", "assets"],
    auth: "both",
    scopes: ["costs:write"],
    params: idParamsSchema,
    body: createFuelLogRequestSchema,
    response: fuelLogSchema,
    status: 201,
    errors: ["not_found"],
  }),

  fuelLogsGet: defineEndpoint({
    id: "fuelLogsGet",
    method: "GET",
    path: "/api/v1/fuel-logs/{id}",
    summary: "A fuel log entry",
    tags: ["vehicles"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: fuelLogSchema,
    errors: ["not_found"],
  }),

  fuelLogsUpdate: defineEndpoint({
    id: "fuelLogsUpdate",
    method: "PATCH",
    path: "/api/v1/fuel-logs/{id}",
    summary: "Change a fuel log entry",
    description:
      "The reading follows the date and the odometer; the cost entry follows the amount, currency, date, station, payer and split. An entry made free loses its cost entry, one that costs something now and has none gets one.",
    tags: ["vehicles"],
    auth: "both",
    scopes: ["costs:write"],
    params: idParamsSchema,
    body: updateFuelLogRequestSchema,
    response: fuelLogSchema,
    errors: ["not_found"],
  }),

  fuelLogsDelete: defineEndpoint({
    id: "fuelLogsDelete",
    method: "DELETE",
    path: "/api/v1/fuel-logs/{id}",
    summary: "Delete a fuel log entry",
    description:
      "The odometer reading it wrote and the cost entry it booked are deleted with it (receipts attached to that cost entry too).",
    tags: ["vehicles"],
    auth: "both",
    scopes: ["costs:write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  tireSetsList: defineEndpoint({
    id: "tireSetsList",
    method: "GET",
    path: "/api/v1/assets/{id}/tire-sets",
    summary: "Tire sets of a vehicle",
    description:
      "The mounted set first, then by season; retired sets only with includeRetired=true. Each set carries the distance driven on it, a treadWarning (below 3 mm for summer, 4 mm for winter and all-season) and its age from the DOT code.",
    tags: ["vehicles", "assets"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    query: listTireSetsQuerySchema,
    response: listTireSetsResponseSchema,
    errors: ["not_found"],
  }),

  tireSetsCreate: defineEndpoint({
    id: "tireSetsCreate",
    method: "POST",
    path: "/api/v1/assets/{id}/tire-sets",
    summary: "Add a tire set to a vehicle",
    description:
      "The set is not mounted; mount it with the mount endpoint. 400 for an asset that is no vehicle.",
    tags: ["vehicles", "assets"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: createTireSetRequestSchema,
    response: tireSetDetailSchema,
    status: 201,
    errors: ["not_found"],
  }),

  tireSetsGet: defineEndpoint({
    id: "tireSetsGet",
    method: "GET",
    path: "/api/v1/tire-sets/{id}",
    summary: "A tire set with its mount and measurement history",
    tags: ["vehicles"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: tireSetDetailSchema,
    errors: ["not_found"],
  }),

  tireSetsUpdate: defineEndpoint({
    id: "tireSetsUpdate",
    method: "PATCH",
    path: "/api/v1/tire-sets/{id}",
    summary: "Change or retire a tire set",
    description:
      "Whether the set is mounted and its tread depth change through the mount and tread endpoints only. retired: true takes a mounted set off first.",
    tags: ["vehicles"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: updateTireSetRequestSchema,
    response: tireSetDetailSchema,
    errors: ["not_found"],
  }),

  tireSetsDelete: defineEndpoint({
    id: "tireSetsDelete",
    method: "DELETE",
    path: "/api/v1/tire-sets/{id}",
    summary: "Delete a tire set",
    description:
      "Its events, the odometer readings they wrote and its attachments go with it. Retire the set instead to keep its history.",
    tags: ["vehicles"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  tireSetsMount: defineEndpoint({
    id: "tireSetsMount",
    method: "POST",
    path: "/api/v1/assets/{id}/tire-sets/{setId}/mount",
    summary: "Mount a tire set",
    description:
      "Takes the mounted set off (an unmounted event of the same day) and mounts this one. With an odometer value the vehicle gets that reading (source tire_change); a value lower than the reading before is a 400 on odometer and nothing is changed. 409 for a retired set and for one that is already mounted.",
    tags: ["vehicles", "assets"],
    auth: "both",
    scopes: ["write"],
    params: tireSetMountParamsSchema,
    body: mountTireSetRequestSchema,
    response: tireSetDetailSchema,
    errors: ["not_found", "conflict"],
  }),

  tireSetsTread: defineEndpoint({
    id: "tireSetsTread",
    method: "POST",
    path: "/api/v1/tire-sets/{id}/tread",
    summary: "Record a tread depth measurement",
    description:
      "Adds a measurement event; the newest measurement is the set's current depth. With an odometer value the vehicle gets that reading as well.",
    tags: ["vehicles"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: measureTreadRequestSchema,
    response: tireSetDetailSchema,
    status: 201,
    errors: ["not_found"],
  }),

  odometerList: defineEndpoint({
    id: "odometerList",
    method: "GET",
    path: "/api/v1/assets/{id}/odometer",
    summary: "Odometer readings of a vehicle, newest first",
    description:
      "Every reading ever recorded, by date and then by when it was entered. Readings are never pruned.",
    tags: ["vehicles", "assets"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    query: listOdometerQuerySchema,
    response: listOdometerResponseSchema,
    errors: ["not_found"],
  }),

  odometerCreate: defineEndpoint({
    id: "odometerCreate",
    method: "POST",
    path: "/api/v1/assets/{id}/odometer",
    summary: "Record an odometer reading",
    description:
      "The date defaults to today and must not be in the future. A value lower than the reading before it (by date) is a 400 on `value`, unless `force` is true (a replaced instrument cluster). The newest reading becomes the signal `odometer:<asset id>` that tasks with a counter trigger read, so due dates, estimates and notifications follow at once. 400 for an asset that is no vehicle.",
    tags: ["vehicles", "assets"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: recordOdometerRequestSchema,
    response: odometerReadingSchema,
    status: 201,
    errors: ["not_found"],
  }),

  odometerDelete: defineEndpoint({
    id: "odometerDelete",
    method: "DELETE",
    path: "/api/v1/odometer-readings/{id}",
    summary: "Delete an odometer reading",
    description:
      "The vehicle's newest remaining reading becomes its current one. Readings written by a completion or a service log entry go with them.",
    tags: ["vehicles"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  costsList: defineEndpoint({
    id: "costsList",
    method: "GET",
    path: "/api/v1/costs",
    summary: "List cost entries",
    description:
      "Newest first by date. Filter by year or a date range (`from`/`to`), category, asset, room, defect, who paid (`paidBy`, a user id or `me`) and a search text over title, payee and notes. Amounts are minor units of the entry's currency: positive = expense, negative = refund.",
    tags: ["costs"],
    auth: "both",
    scopes: ["read"],
    query: listCostsQuerySchema,
    response: listCostsResponseSchema,
  }),

  costsCreate: defineEndpoint({
    id: "costsCreate",
    method: "POST",
    path: "/api/v1/costs",
    summary: "Book a cost",
    description:
      "`currency` defaults to the household's, `date` to today. `splitMode` `ownership` (default) divides by the people's current ownership shares, `equal` equally, `custom` by `shares` (basis points, sum 10000), `none` does not split. The shares are frozen with the entry; the parts add up to the amount exactly (largest remainder). `countsAsExpense` defaults to false for a mortgage repayment (equity), else true. Entries cannot be created for a finance provider's transaction here: accept the suggestion instead.",
    tags: ["costs"],
    auth: "both",
    scopes: ["costs:write"],
    body: createCostRequestSchema,
    response: costEntrySchema,
    status: 201,
  }),

  costsSummary: defineEndpoint({
    id: "costsSummary",
    method: "GET",
    path: "/api/v1/costs/summary",
    summary: "Costs of a year: totals and settlement",
    description:
      "Totals per category, month and asset (top ten) and per tax class count entries in the household currency that count as an expense; mortgage repayments are reported as `equityTotalMinor`. `people` and `settlement` cover every split entry with a payer: `balanceMinor` = paid - share, and `settlement` lists who pays whom to square the balances. With assetId only the entries of that asset are counted.",
    tags: ["costs"],
    auth: "both",
    scopes: ["read"],
    query: costsSummaryQuerySchema,
    response: costsSummarySchema,
  }),

  costsExport: defineEndpoint({
    id: "costsExport",
    method: "GET",
    path: "/api/v1/costs/export.csv",
    summary: "Cost entries of a year as CSV",
    description:
      "UTF-8 with a byte order mark, semicolon separated and CRLF line ends (opens in Swiss Excel). Amounts are plain decimals with a point and no thousands separator (`-12.50`), so they parse the same everywhere. Text that would be read as a formula is prefixed with an apostrophe.",
    tags: ["costs"],
    auth: "both",
    scopes: ["read"],
    query: exportCostsQuerySchema,
    response: binaryResponseSchema,
    responseType: "binary",
    contentTypes: ["text/csv"],
  }),

  costsGet: defineEndpoint({
    id: "costsGet",
    method: "GET",
    path: "/api/v1/costs/{id}",
    summary: "Get a cost entry",
    tags: ["costs"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: costEntrySchema,
    errors: ["not_found"],
  }),

  costsUpdate: defineEndpoint({
    id: "costsUpdate",
    method: "PATCH",
    path: "/api/v1/costs/{id}",
    summary: "Change a cost entry",
    description:
      "Setting `splitMode` to `ownership` or `equal` splits again by the people's current shares; `shares` need `custom`. Changing only the amount keeps the frozen shares. An entry booked from a finance provider keeps its source; its back-link in the provider is refreshed.",
    tags: ["costs"],
    auth: "both",
    scopes: ["costs:write"],
    params: idParamsSchema,
    body: updateCostRequestSchema,
    response: costEntrySchema,
    errors: ["not_found"],
  }),

  costsDelete: defineEndpoint({
    id: "costsDelete",
    method: "DELETE",
    path: "/api/v1/costs/{id}",
    summary: "Delete a cost entry",
    description:
      "Removes the entry with its comments and attachments, and its back-link in the finance provider. A transaction booked from a provider is not offered again.",
    tags: ["costs"],
    auth: "both",
    scopes: ["costs:write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  financeSuggestionsList: defineEndpoint({
    id: "financeSuggestionsList",
    method: "GET",
    path: "/api/v1/finance/suggestions",
    summary: "Your suggestions from the connected finance app",
    description:
      "Costs, assets and bill tasks the finance provider offers, waiting for a decision (`status` defaults to `pending`). Strictly your own: no other member sees them, and other members' suggestions are never listed or reachable by id.",
    tags: ["finance"],
    auth: "both",
    scopes: ["read"],
    query: listFinanceSuggestionsQuerySchema,
    response: listFinanceSuggestionsResponseSchema,
  }),

  financeSuggestionsAccept: defineEndpoint({
    id: "financeSuggestionsAccept",
    method: "POST",
    path: "/api/v1/finance/suggestions/{id}/accept",
    summary: "Accept a suggestion",
    description:
      "Creates the cost entry (paid by you, split by ownership unless the body says otherwise), the asset or the bill task. The body may override category, title, split, asset link and so on; fields of another kind are a 400. Accepting twice is a 409.",
    tags: ["finance"],
    auth: "both",
    scopes: ["costs:write"],
    params: idParamsSchema,
    body: acceptFinanceSuggestionRequestSchema,
    response: acceptFinanceSuggestionResponseSchema,
    errors: ["not_found", "conflict"],
  }),

  financeSuggestionsDismiss: defineEndpoint({
    id: "financeSuggestionsDismiss",
    method: "POST",
    path: "/api/v1/finance/suggestions/{id}/dismiss",
    summary: "Dismiss a suggestion",
    description:
      "A dismissed suggestion is never offered again. Dismissing an accepted one is a 409.",
    tags: ["finance"],
    auth: "both",
    scopes: ["costs:write"],
    params: idParamsSchema,
    response: financeSuggestionSchema,
    errors: ["not_found", "conflict"],
  }),

  financeSync: defineEndpoint({
    id: "financeSync",
    method: "POST",
    path: "/api/v1/finance/sync",
    summary: "Sync your finance connection now",
    description:
      "Runs one sync of your own connection (404 without one). A provider that cannot be reached is a normal answer (`ok: false` with an error code), not an HTTP error.",
    tags: ["finance"],
    auth: "both",
    scopes: ["costs:write"],
    response: financeSyncResponseSchema,
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

  insurancePoliciesList: defineEndpoint({
    id: "insurancePoliciesList",
    method: "GET",
    path: "/api/v1/insurance-policies",
    summary: "List insurance policies",
    description:
      "Active policies by cancellation deadline (those without one last), then title. Filter by covered asset, type and a text (q: title, policy number or the insurer's name); archived=true lists the archived ones instead. Every policy carries the assets it covers, the insurer's name, the premium normalised to a year and the cancellation deadline derived from the end date and the notice period.",
    tags: ["insurance"],
    auth: "both",
    scopes: ["read"],
    query: listInsurancePoliciesQuerySchema,
    response: listInsurancePoliciesResponseSchema,
  }),

  insurancePoliciesCreate: defineEndpoint({
    id: "insurancePoliciesCreate",
    method: "POST",
    path: "/api/v1/insurance-policies",
    summary: "Create an insurance policy",
    description:
      "currency defaults to the household's. A policy that renews by itself (renewal auto) with an end date and a notice period gets a cancellation deadline and keeps a reminder task due on that day. endDate is the last day of cover.",
    tags: ["insurance"],
    auth: "both",
    scopes: ["write"],
    body: createInsurancePolicyRequestSchema,
    response: insurancePolicySchema,
    status: 201,
  }),

  insurancePoliciesGet: defineEndpoint({
    id: "insurancePoliciesGet",
    method: "GET",
    path: "/api/v1/insurance-policies/{id}",
    summary: "Get an insurance policy",
    tags: ["insurance"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    response: insurancePolicySchema,
    errors: ["not_found"],
  }),

  insurancePoliciesUpdate: defineEndpoint({
    id: "insurancePoliciesUpdate",
    method: "PATCH",
    path: "/api/v1/insurance-policies/{id}",
    summary: "Update an insurance policy",
    description:
      "assetIds replaces the covered assets; archived archives or restores the policy (its reminder task follows). After an automatic renewal, move endDate to the end of the next term: the cancellation deadline and the reminder follow.",
    tags: ["insurance"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: updateInsurancePolicyRequestSchema,
    response: insurancePolicySchema,
    errors: ["not_found"],
  }),

  insurancePoliciesDelete: defineEndpoint({
    id: "insurancePoliciesDelete",
    method: "DELETE",
    path: "/api/v1/insurance-policies/{id}",
    summary: "Delete an insurance policy",
    description:
      "Comments, attachments, document links and reminder tasks go with it. Archive the policy to keep it.",
    tags: ["insurance"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  assetInsurancePoliciesList: defineEndpoint({
    id: "assetInsurancePoliciesList",
    method: "GET",
    path: "/api/v1/assets/{id}/insurance-policies",
    summary: "Insurance policies that cover an asset",
    description:
      "The same policies as GET /insurance-policies?assetId=, for the asset page; 404 for an unknown asset. Active policies unless archived=true.",
    tags: ["insurance", "assets"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    query: assetInsurancePoliciesQuerySchema,
    response: listInsurancePoliciesResponseSchema,
    errors: ["not_found"],
  }),

  assetNotesList: defineEndpoint({
    id: "assetNotesList",
    method: "GET",
    path: "/api/v1/assets/{id}/notes",
    summary: "Notes on an asset for the next appointment",
    description:
      'Small issues to mention at the next service appointment ("brakes squeak"), newest first. status: open (default), resolved or all.',
    tags: ["asset-notes", "assets"],
    auth: "both",
    scopes: ["read"],
    params: idParamsSchema,
    query: listAssetNotesQuerySchema,
    response: listAssetNotesResponseSchema,
    errors: ["not_found"],
  }),

  assetNotesCreate: defineEndpoint({
    id: "assetNotesCreate",
    method: "POST",
    path: "/api/v1/assets/{id}/notes",
    summary: "Add a note to an asset",
    description:
      "A photo of the issue is an attachment of the owner type asset_note.",
    tags: ["asset-notes", "assets"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: createAssetNoteRequestSchema,
    response: assetNoteSchema,
    status: 201,
    errors: ["not_found"],
  }),

  assetNotesUpdate: defineEndpoint({
    id: "assetNotesUpdate",
    method: "PATCH",
    path: "/api/v1/asset-notes/{id}",
    summary: "Change the text of a note, resolve or reopen it",
    description:
      "status resolved records who resolved it and when; open reopens it and forgets the service log entry that had addressed it. A service log entry resolves notes itself (resolvedNoteIds).",
    tags: ["asset-notes"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: updateAssetNoteRequestSchema,
    response: assetNoteSchema,
    errors: ["not_found"],
  }),

  assetNotesDelete: defineEndpoint({
    id: "assetNotesDelete",
    method: "DELETE",
    path: "/api/v1/asset-notes/{id}",
    summary: "Delete a note",
    description: "Its attachments go with it. Resolve a note to keep it.",
    tags: ["asset-notes"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  assetNotesToDefect: defineEndpoint({
    id: "assetNotesToDefect",
    method: "POST",
    path: "/api/v1/asset-notes/{id}/to-defect",
    summary: "Turn a note into a defect",
    description:
      "Creates a defect on the note's asset (title from the first line, description the whole text, discovered the day the note was written, no deadline) and marks the note resolved with a link to it, in one transaction. Answers with both. 409 when the note already is a defect.",
    tags: ["asset-notes", "defects"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: assetNoteToDefectResponseSchema,
    status: 201,
    errors: ["not_found", "conflict"],
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
    summary:
      "Search pages, assets, rooms, tasks, defects, contacts, parts and care hints",
    description:
      "Full-text search, best match first; every word is matched as a prefix. Archived pages, assets, tasks and parts are not searched. Searched fields: titles and names, plus page text, device data and notes, descriptions, a defect's location, a contact's company and notes (never phone, e-mail or address), a part's number, supplier and notes, a hint's text. Pages are searched without their secret blocks, and every other free text is cut off at the first `:::` block when it mentions a secret, so a snippet never contains secret text. Snippets are plain text. `url` is the app path of the hit.",
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
  notificationSettingsGet: defineEndpoint({
    id: "notificationSettingsGet",
    method: "GET",
    path: "/api/v1/me/notification-settings",
    summary: "The caller's push preferences and notification targets",
    description:
      "Own settings only. `pushStages` are the kinds of notification that reach the phone (the in-app list always has all of them); notifications arriving between `quietStart` and `quietEnd` (household time zone) are held back and sent afterwards. A target is a notify service of the connected smart-home system.",
    tags: ["notifications"],
    auth: "both",
    scopes: ["read"],
    response: notificationSettingsResponseSchema,
  }),

  notificationSettingsPut: defineEndpoint({
    id: "notificationSettingsPut",
    method: "PUT",
    path: "/api/v1/me/notification-settings",
    summary: "Replace the caller's push preferences and targets",
    description:
      "Replaces preferences and the whole list of targets (at most 10). Target names are lowercase letters, digits and underscores.",
    tags: ["notifications"],
    auth: "both",
    scopes: ["write"],
    body: notificationSettingsSchema,
    response: notificationSettingsResponseSchema,
  }),

  integrationsList: defineEndpoint({
    id: "integrationsList",
    method: "GET",
    path: "/api/v1/integrations",
    summary: "The integrations and their connection status",
    description:
      "One entry per kind: the household's connection, or the caller's own for kinds each person connects. Never contains the access token; the address and settings of a household connection are shown to administrators only.",
    tags: ["integrations"],
    auth: "both",
    scopes: ["read"],
    response: listIntegrationsResponseSchema,
  }),

  integrationsSave: defineEndpoint({
    id: "integrationsSave",
    method: "PUT",
    path: "/api/v1/integrations/{kind}",
    summary: "Create or change a connection",
    description:
      "Household-level kinds need an administrator. A new connection needs the token, and so does a changed address (a stored token is never sent to another host); a blank token keeps the stored one. The status resets to `unknown` until the next check.",
    tags: ["integrations"],
    auth: "both",
    scopes: ["write"],
    params: integrationKindParamsSchema,
    body: saveIntegrationRequestSchema,
    response: integrationSchema,
    errors: ["forbidden"],
  }),

  integrationsDelete: defineEndpoint({
    id: "integrationsDelete",
    method: "DELETE",
    path: "/api/v1/integrations/{kind}",
    summary: "Remove a connection",
    description:
      "Household-level kinds need an administrator. Tasks, assets and hints that refer to the system keep working without live data.",
    tags: ["integrations"],
    auth: "both",
    scopes: ["write"],
    params: integrationKindParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["forbidden", "not_found"],
  }),

  integrationsTest: defineEndpoint({
    id: "integrationsTest",
    method: "POST",
    path: "/api/v1/integrations/{kind}/test",
    summary: "Check the connection now",
    description:
      "Calls the system once and records the outcome as the connection's status. An unreachable system is a normal answer (`ok: false` with an error code and message), not an HTTP error. Household-level kinds need an administrator.",
    tags: ["integrations"],
    auth: "both",
    scopes: ["write"],
    params: integrationKindParamsSchema,
    response: testIntegrationResponseSchema,
    errors: ["forbidden", "not_found"],
  }),

  integrationsEntities: defineEndpoint({
    id: "integrationsEntities",
    method: "GET",
    path: "/api/v1/integrations/{kind}/entities",
    summary: "Entities of the connected system (entity picker)",
    description:
      "From a short-lived cache of the system's states. Filter by `q` (id or name) and `domain`. 404 when the kind has no connection or no such operation; 502 `upstream_error` when the system does not answer.",
    tags: ["integrations"],
    auth: "both",
    scopes: ["read"],
    params: integrationKindParamsSchema,
    query: listEntitiesQuerySchema,
    response: listEntitiesResponseSchema,
    errors: ["not_found", "upstream_error"],
  }),

  integrationsNotifyServices: defineEndpoint({
    id: "integrationsNotifyServices",
    method: "GET",
    path: "/api/v1/integrations/{kind}/notify-services",
    summary: "Notify services of the connected system",
    description: "Candidates for a person's notification targets.",
    tags: ["integrations"],
    auth: "both",
    scopes: ["read"],
    params: integrationKindParamsSchema,
    response: listNotifyServicesResponseSchema,
    errors: ["not_found", "upstream_error"],
  }),

  integrationsCalendars: defineEndpoint({
    id: "integrationsCalendars",
    method: "GET",
    path: "/api/v1/integrations/{kind}/calendars",
    summary: "Calendars of the connected system",
    tags: ["integrations"],
    auth: "both",
    scopes: ["read"],
    params: integrationKindParamsSchema,
    response: listCalendarsResponseSchema,
    errors: ["not_found", "upstream_error"],
  }),

  integrationsDevices: defineEndpoint({
    id: "integrationsDevices",
    method: "GET",
    path: "/api/v1/integrations/{kind}/devices",
    summary: "Devices of the connected system that no asset represents yet",
    description:
      "Suggestions for the inventory: manufacturer, model, name and area of every enabled device that matches no asset (by external reference, name, or manufacturer and model). Creating an asset from one is a separate call with `externalSource` and `externalRef`.",
    tags: ["integrations"],
    auth: "both",
    scopes: ["read"],
    params: integrationKindParamsSchema,
    response: listDevicesResponseSchema,
    errors: ["not_found", "upstream_error"],
  }),

  integrationsAreas: defineEndpoint({
    id: "integrationsAreas",
    method: "GET",
    path: "/api/v1/integrations/{kind}/areas",
    summary: "Areas of the connected system (area picker)",
    description:
      "Every area with its name, the name of its floor when the system has floors, and the id of the room that already stores it in `haAreaId` (null when none does). Candidates for `POST /rooms/import-areas`. 404 without a connection or for a kind without areas; 502 `upstream_error` when the system does not answer.",
    tags: ["integrations"],
    auth: "both",
    scopes: ["read"],
    params: integrationKindParamsSchema,
    response: listAreasResponseSchema,
    errors: ["not_found", "upstream_error"],
  }),

  integrationsTags: defineEndpoint({
    id: "integrationsTags",
    method: "GET",
    path: "/api/v1/integrations/{kind}/tags",
    summary: "Tags of the connected document system",
    description:
      "From the caller's own connection (each person connects their own account). 404 without a connection or for a kind without tags; 502 `upstream_error` when the system does not answer.",
    tags: ["integrations"],
    auth: "both",
    scopes: ["read"],
    params: integrationKindParamsSchema,
    query: listPickerQuerySchema,
    response: listTagsResponseSchema,
    errors: ["not_found", "upstream_error"],
  }),

  integrationsCorrespondents: defineEndpoint({
    id: "integrationsCorrespondents",
    method: "GET",
    path: "/api/v1/integrations/{kind}/correspondents",
    summary: "Correspondents of the connected document system",
    tags: ["integrations"],
    auth: "both",
    scopes: ["read"],
    params: integrationKindParamsSchema,
    query: listPickerQuerySchema,
    response: listCorrespondentsResponseSchema,
    errors: ["not_found", "upstream_error"],
  }),

  integrationsCustomFields: defineEndpoint({
    id: "integrationsCustomFields",
    method: "GET",
    path: "/api/v1/integrations/{kind}/custom-fields",
    summary: "Custom fields of the connected document system",
    description: "Candidates for the warranty fields: pick date fields.",
    tags: ["integrations"],
    auth: "both",
    scopes: ["read"],
    params: integrationKindParamsSchema,
    query: listPickerQuerySchema,
    response: listCustomFieldsResponseSchema,
    errors: ["not_found", "upstream_error"],
  }),

  integrationsGroups: defineEndpoint({
    id: "integrationsGroups",
    method: "GET",
    path: "/api/v1/integrations/{kind}/groups",
    summary: "Groups of the connected document system",
    description:
      "Candidates for the groups that get access to pushed documents. The account needs the permission to view groups, otherwise 502 `upstream_error` with `details.code` `forbidden`.",
    tags: ["integrations"],
    auth: "both",
    scopes: ["read"],
    params: integrationKindParamsSchema,
    query: listPickerQuerySchema,
    response: listGroupsResponseSchema,
    errors: ["not_found", "upstream_error"],
  }),

  integrationsStoragePaths: defineEndpoint({
    id: "integrationsStoragePaths",
    method: "GET",
    path: "/api/v1/integrations/{kind}/storage-paths",
    summary: "Storage paths of the connected document system",
    tags: ["integrations"],
    auth: "both",
    scopes: ["read"],
    params: integrationKindParamsSchema,
    query: listPickerQuerySchema,
    response: listStoragePathsResponseSchema,
    errors: ["not_found", "upstream_error"],
  }),

  documentsList: defineEndpoint({
    id: "documentsList",
    method: "GET",
    path: "/api/v1/documents",
    summary: "Documents of the caller's document system",
    description:
      "Read through the caller's own connection, so everybody sees what their own account may see. With `q` the title and text are searched live in the provider (at most 100 hits); without it the synced household documents are listed (tag, correspondent and linked filters apply to both). Every item says where hauswart uses it (`linkedTo`). 404 without a connection; 502 `upstream_error` when the system does not answer.",
    tags: ["documents"],
    auth: "both",
    scopes: ["read"],
    query: listDocumentsQuerySchema,
    response: listDocumentsResponseSchema,
    errors: ["not_found", "upstream_error"],
  }),

  documentsSuggestions: defineEndpoint({
    id: "documentsSuggestions",
    method: "GET",
    path: "/api/v1/documents/suggestions",
    summary: "Inventory and contact suggestions from the document system",
    description:
      "`kind=asset`: receipts (documents with a receipt tag) with a warranty date that no asset is linked to yet; accepting creates the asset and links the document with role `receipt` (the link fills the warranty dates). `kind=contact`: correspondents of the synced documents that no contact stands for yet; pass `externalSource` and `externalRef` of the item when creating the contact. Built from the caller's own synced documents only.",
    tags: ["documents"],
    auth: "both",
    scopes: ["read"],
    query: documentSuggestionsQuerySchema,
    response: documentSuggestionsResponseSchema,
    errors: ["not_found"],
  }),

  documentUploadsGet: defineEndpoint({
    id: "documentUploadsGet",
    method: "GET",
    path: "/api/v1/documents/uploads/{jobId}",
    summary: "State of a push to the document system",
    description:
      "Only the person who started the job sees it (404 for everybody else). Poll until `status` is `done` or `failed`.",
    tags: ["documents"],
    auth: "both",
    scopes: ["read"],
    params: documentUploadParamsSchema,
    response: documentUploadSchema,
    errors: ["not_found"],
  }),

  documentsGet: defineEndpoint({
    id: "documentsGet",
    method: "GET",
    path: "/api/v1/documents/{provider}/{externalId}",
    summary: "One document: metadata and where it is used",
    description:
      "Asked live through the caller's own connection (never another person's): 404 when the caller has no connection or the system does not show them the document.",
    tags: ["documents"],
    auth: "both",
    scopes: ["read"],
    params: documentParamsSchema,
    response: documentDetailSchema,
    errors: ["not_found", "upstream_error"],
  }),

  documentsPreview: defineEndpoint({
    id: "documentsPreview",
    method: "GET",
    path: "/api/v1/documents/{provider}/{externalId}/preview",
    summary: "Preview of a document (PDF or image)",
    description:
      "Streamed through the caller's own connection, at most 25 MB; only PDF, raster images and plain text are sent inline, anything else as `application/octet-stream` download. `nosniff`, a restrictive CSP, `Cache-Control: private`. 404 without a connection or when the account may not see the document.",
    tags: ["documents"],
    auth: "both",
    scopes: ["read"],
    params: documentParamsSchema,
    response: binaryResponseSchema,
    responseType: "binary",
    contentTypes: DOCUMENT_CONTENT_TYPES,
    errors: ["not_found", "upstream_error"],
  }),

  documentsThumb: defineEndpoint({
    id: "documentsThumb",
    method: "GET",
    path: "/api/v1/documents/{provider}/{externalId}/thumb",
    summary: "Thumbnail of a document",
    description: "Same rules as the preview; WebP.",
    tags: ["documents"],
    auth: "both",
    scopes: ["read"],
    params: documentParamsSchema,
    response: binaryResponseSchema,
    responseType: "binary",
    contentTypes: DOCUMENT_CONTENT_TYPES,
    errors: ["not_found", "upstream_error"],
  }),

  documentsDownload: defineEndpoint({
    id: "documentsDownload",
    method: "GET",
    path: "/api/v1/documents/{provider}/{externalId}/download",
    summary: "Download of a document",
    description:
      "The archived PDF, or with `?original=1` the original file; sent as an attachment. Same rules as the preview.",
    tags: ["documents"],
    auth: "both",
    scopes: ["read"],
    params: documentParamsSchema,
    query: downloadQuerySchema,
    response: binaryResponseSchema,
    responseType: "binary",
    contentTypes: DOCUMENT_CONTENT_TYPES,
    errors: ["not_found", "upstream_error"],
  }),

  documentLinksList: defineEndpoint({
    id: "documentLinksList",
    method: "GET",
    path: "/api/v1/document-links",
    summary: "Links between documents and things in hauswart",
    description:
      "Filter by owner (`ownerType` + `ownerId`) or by document (`provider` + `externalId`). Each link says whether the caller's own account can read the document (`available`); a document that is not shared with the caller shows no title.",
    tags: ["documents"],
    auth: "both",
    scopes: ["read"],
    query: listDocumentLinksQuerySchema,
    response: listDocumentLinksResponseSchema,
  }),

  documentLinksCreate: defineEndpoint({
    id: "documentLinksCreate",
    method: "POST",
    path: "/api/v1/document-links",
    summary: "Link a document to an asset, room, task, ...",
    description:
      "The caller's own account must be able to read the document (404 otherwise). The same document can be linked to the same owner once per role (409 `conflict`). A receipt or warranty document on an asset fills its warranty dates when they are empty or came from a document. A page owner needs `docs:write`. With the connection setting `writeBackNotes` a note with the hauswart link is added to the document (once).",
    tags: ["documents"],
    auth: "both",
    scopes: ["write"],
    body: createDocumentLinkRequestSchema,
    response: documentLinkSchema,
    status: 201,
    errors: ["not_found", "conflict", "upstream_error"],
  }),

  documentLinksDelete: defineEndpoint({
    id: "documentLinksDelete",
    method: "DELETE",
    path: "/api/v1/document-links/{id}",
    summary: "Remove a link",
    description:
      "Only the link: the document stays in its system and an asset keeps the warranty dates it got. A page owner needs `docs:write`.",
    tags: ["documents"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  attachmentsPushToDocuments: defineEndpoint({
    id: "attachmentsPushToDocuments",
    method: "POST",
    path: "/api/v1/attachments/{id}/push-to-documents",
    summary: "Send an attachment to the caller's document system",
    description:
      "Starts a job (202) that uploads the file with the connection's upload tags, storage path and correspondent, waits until the system has consumed it, gives the connection's groups access, links the new document to the attachment's owner and, when enabled, leaves a note with the hauswart link. Poll `GET /documents/uploads/{jobId}`. Owners that cannot be linked (a hint) are refused with 400; 404 without a connection.",
    tags: ["documents"],
    auth: "both",
    scopes: ["write"],
    params: idParamsSchema,
    body: pushToDocumentsRequestSchema,
    response: documentUploadSchema,
    status: 202,
    errors: ["not_found"],
  }),

  integrationsCategories: defineEndpoint({
    id: "integrationsCategories",
    method: "GET",
    path: "/api/v1/integrations/{kind}/categories",
    summary: "Categories of the connected finance app (category map picker)",
    description:
      "Your own connection only. 404 when you have no connection of this kind or it has no such operation; 502 `upstream_error` when the system does not answer.",
    tags: ["integrations"],
    auth: "both",
    scopes: ["read"],
    params: integrationKindParamsSchema,
    response: listFinanceCategoriesResponseSchema,
    errors: ["not_found", "upstream_error"],
  }),

  integrationsAccounts: defineEndpoint({
    id: "integrationsAccounts",
    method: "GET",
    path: "/api/v1/integrations/{kind}/accounts",
    summary: "Accounts of the connected finance app",
    tags: ["integrations"],
    auth: "both",
    scopes: ["read"],
    params: integrationKindParamsSchema,
    response: listFinanceAccountsResponseSchema,
    errors: ["not_found", "upstream_error"],
  }),

  haAction: defineEndpoint({
    id: "haAction",
    method: "POST",
    path: "/api/v1/ha/action",
    summary: "A button on a pushed notification was tapped",
    description:
      'Called by the smart-home system when someone taps "done" on a notification: `{"action": "HW_DONE_<token>"}` with an API token of kind `ha` and the `ha:action` scope. The token resolves to the task occurrence the notification was about and to the person it was sent to; the completion is attributed to that person (source `notification`), not to the calling token. 404 for an unknown action, 410 `gone` when the token expired, its task is gone, the occurrence was settled otherwise, or the first completion was undone. Tapping again (or a retried request) answers 200 with the first completion and `replayed: true`.',
    tags: ["notifications"],
    auth: "bearer",
    scopes: ["ha:action"],
    body: actionRequestSchema,
    response: actionResponseSchema,
    errors: ["forbidden", "not_found", "gone"],
  }),

  calendarFeedsList: defineEndpoint({
    id: "calendarFeedsList",
    method: "GET",
    path: "/api/v1/calendar-feeds",
    summary: "List the calling user's calendar feeds",
    description:
      "Each feed has a secret subscription address (`url`, `https://…/api/public/cal/<token>.ics`) for any calendar app; only its owner sees it. Other users' feeds are not visible.",
    tags: ["calendar"],
    auth: "session",
    scopes: [],
    response: listCalendarFeedsResponseSchema,
  }),

  calendarFeedsCreate: defineEndpoint({
    id: "calendarFeedsCreate",
    method: "POST",
    path: "/api/v1/calendar-feeds",
    summary: "Create a calendar feed",
    description:
      "`scope` `mine` = tasks assigned to the caller or to nobody, `all` = every active task. Estimated dates are only included with `includeEstimated`. `alarmTime` (`HH:MM`, household time zone) adds an alarm `alarmDaysBefore` days ahead of each event (1 = the evening before). At most 10 feeds per user.",
    tags: ["calendar"],
    auth: "session",
    scopes: [],
    body: createCalendarFeedRequestSchema,
    response: calendarFeedSchema,
    status: 201,
    errors: ["conflict"],
  }),

  calendarFeedsUpdate: defineEndpoint({
    id: "calendarFeedsUpdate",
    method: "PATCH",
    path: "/api/v1/calendar-feeds/{id}",
    summary: "Change a calendar feed",
    tags: ["calendar"],
    auth: "session",
    scopes: [],
    params: idParamsSchema,
    body: updateCalendarFeedRequestSchema,
    response: calendarFeedSchema,
    errors: ["not_found"],
  }),

  calendarFeedsDelete: defineEndpoint({
    id: "calendarFeedsDelete",
    method: "DELETE",
    path: "/api/v1/calendar-feeds/{id}",
    summary: "Delete a calendar feed",
    description: "The subscription address stops working at once (404).",
    tags: ["calendar"],
    auth: "session",
    scopes: [],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  calendarFeedsRotate: defineEndpoint({
    id: "calendarFeedsRotate",
    method: "POST",
    path: "/api/v1/calendar-feeds/{id}/rotate",
    summary: "Give a calendar feed a new address",
    description:
      "The old address stops working at once; subscribers must use the new `url`.",
    tags: ["calendar"],
    auth: "session",
    scopes: [],
    params: idParamsSchema,
    response: calendarFeedSchema,
    errors: ["not_found"],
  }),

  emergencyGet: defineEndpoint({
    id: "emergencyGet",
    method: "GET",
    path: "/api/v1/emergency",
    summary: "Everything for the emergency page",
    description:
      "Pages of the sections `emergency` and `rules` (member HTML, secret blocks included), contacts marked as emergency contacts and devices marked `showOnEmergency` with their pinned hints.",
    tags: ["emergency"],
    auth: "both",
    scopes: ["read"],
    response: emergencySchema,
  }),

  emergencyExport: defineEndpoint({
    id: "emergencyExport",
    method: "GET",
    path: "/api/v1/emergency/export.pdf",
    summary: "Printable emergency and cover sheet as a PDF",
    description:
      "An A4 document with the emergency contacts, the important places and devices (with pinned hints) and the text of the emergency and rules pages. Secret blocks are left out unless `includeSecrets=1`; the sheet then carries a prominent confidentiality notice. Language follows the caller's account.",
    tags: ["emergency"],
    auth: "both",
    scopes: ["read"],
    query: exportEmergencyQuerySchema,
    response: binaryResponseSchema,
    responseType: "binary",
    contentTypes: ["application/pdf"],
  }),

  guestLinksList: defineEndpoint({
    id: "guestLinksList",
    method: "GET",
    path: "/api/v1/guest-links",
    summary: "List the household's guest links",
    description:
      "All members see and manage all guest links. The address is shown on creation only; a lost one is replaced with a rotation.",
    tags: ["guest-links"],
    auth: "session",
    scopes: [],
    response: listGuestLinksResponseSchema,
  }),

  guestLinksCreate: defineEndpoint({
    id: "guestLinksCreate",
    method: "POST",
    path: "/api/v1/guest-links",
    summary: "Create a guest link",
    description:
      "`expiresAt` is required and at most 90 days away. `pin` (4 to 8 digits) adds a PIN gate. A guest sees only content flagged guest-visible that the link's `sections` (and `pageIds`) cover; secret blocks only with `includeSecrets`. The response carries the address (`url`, `/g/<token>`) once.",
    tags: ["guest-links"],
    auth: "session",
    scopes: [],
    body: createGuestLinkRequestSchema,
    response: createdGuestLinkSchema,
    status: 201,
  }),

  guestLinksUpdate: defineEndpoint({
    id: "guestLinksUpdate",
    method: "PATCH",
    path: "/api/v1/guest-links/{id}",
    summary: "Change a guest link",
    description:
      "`pin` sets a new PIN (which also reopens a link closed by wrong guesses) or removes it with null. A revoked link cannot be changed (409).",
    tags: ["guest-links"],
    auth: "session",
    scopes: [],
    params: idParamsSchema,
    body: updateGuestLinkRequestSchema,
    response: guestLinkSchema,
    errors: ["not_found", "conflict"],
  }),

  guestLinksRevoke: defineEndpoint({
    id: "guestLinksRevoke",
    method: "DELETE",
    path: "/api/v1/guest-links/{id}",
    summary: "Revoke a guest link",
    description:
      "The address stops working at once; the link stays in the list as revoked.",
    tags: ["guest-links"],
    auth: "session",
    scopes: [],
    params: idParamsSchema,
    response: emptySchema,
    status: 204,
    errors: ["not_found"],
  }),

  guestLinksRotate: defineEndpoint({
    id: "guestLinksRotate",
    method: "POST",
    path: "/api/v1/guest-links/{id}/rotate",
    summary: "Give a guest link a new address",
    description:
      "The old address stops working at once. The response carries the new address (`url`) once.",
    tags: ["guest-links"],
    auth: "session",
    scopes: [],
    params: idParamsSchema,
    response: createdGuestLinkSchema,
    errors: ["not_found", "conflict"],
  }),
};

export type Endpoints = typeof endpoints;
export const endpointList: readonly AnyEndpoint[] = Object.values(endpoints);
