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
  listUsersResponseSchema,
  updateUserRequestSchema,
} from "./schemas/users";
import { healthResponseSchema, openApiDocumentSchema } from "./schemas/system";

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
};

export type Endpoints = typeof endpoints;
export const endpointList: readonly AnyEndpoint[] = Object.values(endpoints);
