import { z } from "zod";
import { SESSION_COOKIE } from "./constants";
import { ERROR_STATUS, type ErrorCode } from "./errors";
import { endpointList, type AnyEndpoint } from "./registry";
import { errorEnvelopeSchema } from "./schemas/common";

export const API_VERSION = "1.0.0";

type Json = Record<string, unknown>;

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, unknown>;
  [key: string]: unknown;
}

const REF_PREFIX = "#/components/schemas/";

function rewrite(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewrite);
  if (node && typeof node === "object") {
    const out: Json = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        out[key] = value.replace("#/$defs/", REF_PREFIX);
      } else if (key === "pattern" && "format" in node) {
        // date and date-time carry long validation regexes that only add noise to the document
        const format = (node as Json).format;
        if (format !== "date" && format !== "date-time") out[key] = value;
      } else {
        out[key] = rewrite(value);
      }
    }
    return out;
  }
  return node;
}

class Components {
  readonly schemas: Record<string, unknown> = {};

  /** Converts a Zod schema, moving every named sub-schema into components/schemas. */
  convert(schema: z.ZodType, io: "input" | "output"): Json {
    const generated = z.toJSONSchema(schema, {
      io,
      target: "draft-2020-12",
    }) as Json & { $defs?: Record<string, unknown> };
    const { $defs, ...root } = generated;
    delete root.$schema;
    for (const [name, def] of Object.entries($defs ?? {})) {
      const cleaned = rewrite(def);
      const existing = this.schemas[name];
      if (
        existing !== undefined &&
        JSON.stringify(existing) !== JSON.stringify(cleaned)
      ) {
        throw new Error(
          `Named schema "${name}" renders differently as input and output; use it on one side only`,
        );
      }
      this.schemas[name] = cleaned;
    }
    return rewrite(root) as Json;
  }
}

/** Error codes every endpoint of this shape can produce, plus the ones it declares. */
export function errorCodesFor(endpoint: AnyEndpoint): ErrorCode[] {
  const codes = new Set<ErrorCode>(["internal"]);
  if (endpoint.params || endpoint.query || endpoint.body) {
    codes.add("invalid_request");
  }
  if (endpoint.auth !== "public") {
    codes.add("unauthenticated");
    codes.add("forbidden");
    if (endpoint.auth !== "bearer" && endpoint.method !== "GET") {
      codes.add("csrf_failed");
    }
  }
  if (endpoint.setsSession) codes.add("csrf_failed");
  if (
    endpoint.auth === "bearer" ||
    endpoint.auth === "both" ||
    (endpoint.auth === "public" && endpoint.method !== "GET")
  ) {
    codes.add("rate_limited");
  }
  for (const code of endpoint.errors) codes.add(code);
  return [...codes];
}

function securityFor(endpoint: AnyEndpoint): Json[] {
  const bearer = { bearerAuth: [...endpoint.scopes] };
  switch (endpoint.auth) {
    case "public":
      return [];
    case "session":
      return [{ cookieAuth: [] }];
    case "bearer":
      return [bearer];
    case "both":
      return [{ cookieAuth: [] }, bearer];
  }
}

function operation(endpoint: AnyEndpoint, components: Components): Json {
  const parameters: Json[] = [];
  for (const [location, schema] of [
    ["path", endpoint.params],
    ["query", endpoint.query],
  ] as const) {
    if (!schema) continue;
    const json = components.convert(schema, "input");
    const required = new Set((json.required as string[] | undefined) ?? []);
    for (const [name, prop] of Object.entries(
      (json.properties as Record<string, Json> | undefined) ?? {},
    )) {
      parameters.push({
        name,
        in: location,
        required: location === "path" || required.has(name),
        schema: prop,
      });
    }
  }

  const responses: Record<string, Json> = {};
  if (endpoint.status === 204) {
    responses["204"] = { description: "No content" };
  } else if (endpoint.responseType === "pdf") {
    responses[String(endpoint.status)] = {
      description: "Success",
      content: {
        "application/pdf": { schema: { type: "string", format: "binary" } },
      },
    };
  } else {
    responses[String(endpoint.status)] = {
      description: "Success",
      content: {
        "application/json": {
          schema: components.convert(endpoint.response, "output"),
        },
      },
    };
  }
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of errorCodesFor(endpoint)) {
    const status = ERROR_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  for (const [status, codes] of [...byStatus].sort((a, b) => a[0] - b[0])) {
    responses[String(status)] = {
      description: `Error: ${codes.map((c) => `\`${c}\``).join(", ")}`,
      content: {
        "application/json": {
          schema: { $ref: `${REF_PREFIX}ErrorEnvelope` },
        },
      },
    };
  }

  const op: Json = {
    operationId: endpoint.id,
    summary: endpoint.summary,
    ...(endpoint.description ? { description: endpoint.description } : {}),
    tags: [...endpoint.tags],
    security: securityFor(endpoint),
    ...(endpoint.scopes.length > 0
      ? { "x-required-scopes": [...endpoint.scopes] }
      : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    responses,
  };
  if (endpoint.body) {
    const mediaType =
      endpoint.bodyType === "multipart"
        ? "multipart/form-data"
        : "application/json";
    op.requestBody = {
      required: true,
      content: {
        [mediaType]: { schema: components.convert(endpoint.body, "input") },
      },
    };
  }
  return op;
}

/** OpenAPI 3.1 document for a set of endpoints. Pure and deterministic. */
export function buildOpenApiDocument(
  endpoints: readonly AnyEndpoint[] = endpointList,
): OpenApiDocument {
  const components = new Components();
  components.convert(errorEnvelopeSchema, "output");
  const paths: Record<string, Record<string, Json>> = {};
  for (const endpoint of endpoints) {
    paths[endpoint.path] ??= {};
    paths[endpoint.path][endpoint.method.toLowerCase()] = operation(
      endpoint,
      components,
    );
  }
  const tags = [...new Set(endpoints.flatMap((e) => e.tags))].map((name) => ({
    name,
  }));
  return {
    openapi: "3.1.0",
    info: {
      title: "hauswart API",
      version: API_VERSION,
      description:
        "Versioned JSON API of hauswart, used by the web app, the mobile app and integrations. Errors share one envelope: `{ error: { code, message, details? } }`. Cookie-authenticated requests that change state must send an `Origin` header equal to the app origin and `Content-Type: application/json`; bearer requests are exempt.",
    },
    tags,
    paths,
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: SESSION_COOKIE,
          description: "Browser session cookie set by login or setup.",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "API token (`hw_...`) from `POST /api/v1/auth/token` or `POST /api/v1/tokens`. Listed scopes are required.",
        },
      },
      schemas: components.schemas,
    },
  };
}

/** The exact text committed as `docs/openapi.json`. */
export function serializeOpenApiDocument(document: OpenApiDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
