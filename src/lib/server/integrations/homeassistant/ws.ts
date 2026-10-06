import { z } from "zod";
import {
  normalizeBaseUrl as normalizeUrl,
  assertToken,
  parseWith,
} from "../http";
import { HomeAssistantError, haFail } from "./errors";
import {
  areaRegistrySchema,
  deviceRegistrySchema,
  entityRegistrySchema,
  type HaArea,
  type HaDevice,
  type HaEntityRegistryEntry,
} from "./schemas";

export type WsRegistryCommand = {
  type:
    | "config/device_registry/list"
    | "config/area_registry/list"
    | "config/entity_registry/list";
};

export interface WsResultMap {
  "config/device_registry/list": HaDevice[];
  "config/area_registry/list": HaArea[];
  "config/entity_registry/list": HaEntityRegistryEntry[];
}

const SCHEMAS: Record<WsRegistryCommand["type"], z.ZodType> = {
  "config/device_registry/list": deviceRegistrySchema,
  "config/area_registry/list": areaRegistrySchema,
  "config/entity_registry/list": entityRegistrySchema,
};

export interface WsOptions {
  /** For the whole exchange: connect, authenticate, command, result. */
  timeoutMs?: number;
  allowInsecureTls?: boolean;
  /** Largest single message accepted. */
  maxMessageBytes?: number;
}

export const WS_TIMEOUT_MS = 10_000;
export const WS_MAX_MESSAGE_BYTES = 20 * 1024 * 1024;

const envelopeSchema = z.object({
  type: z.string(),
  id: z.number().optional(),
  success: z.boolean().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string().optional() }).nullish(),
});

/**
 * Runs one registry command over Home Assistant's WebSocket API: connect,
 * `auth_required`, send `{type: "auth", access_token}`, `auth_ok`, send the
 * command with an id, read the matching `result`, close. The socket is
 * closed on every outcome, the timeout covers the whole exchange, and the
 * token only ever goes to the configured base URL.
 */
export async function haWsCommand<T extends WsRegistryCommand["type"]>(
  baseUrl: string,
  token: string,
  command: { type: T },
  options: WsOptions = {},
): Promise<WsResultMap[T]> {
  const schema = SCHEMAS[command.type];
  if (!schema) {
    return Promise.reject(
      new HomeAssistantError("invalid_input", {
        detail: "unsupported command",
      }),
    );
  }
  const base = normalizeUrl(baseUrl, haFail);
  assertToken(token, haFail);
  const url = `${base.replace(/^http/, "ws")}/api/websocket`;
  const maxBytes = options.maxMessageBytes ?? WS_MAX_MESSAGE_BYTES;
  const COMMAND_ID = 1;

  return new Promise<WsResultMap[T]>((resolve, reject) => {
    let settled = false;
    let authenticated = false;
    let socket: WebSocket | undefined;

    const finish = (outcome: { error: Error } | { value: WsResultMap[T] }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch (err) {
        console.warn(
          "homeassistant: could not close the websocket",
          err instanceof Error ? err.name : "unknown",
        );
      }
      if ("error" in outcome) reject(outcome.error);
      else resolve(outcome.value);
    };
    const fail = (code: Parameters<typeof haFail>[0], detail?: string) =>
      finish({ error: haFail(code, { detail }) });

    const timer = setTimeout(
      () => fail("timeout"),
      options.timeoutMs ?? WS_TIMEOUT_MS,
    );

    let ws: WebSocket;
    try {
      ws = socket = new WebSocket(
        url,
        // Opt-in per connection for self-signed certificates on a private network; off by default.
        options.allowInsecureTls
          ? ({
              // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
              tls: { rejectUnauthorized: false },
            } as unknown as ConstructorParameters<typeof WebSocket>[1])
          : undefined,
      );
    } catch (cause) {
      finish({ error: haFail("network", { cause }) });
      return;
    }

    const failed = url.startsWith("wss:")
      ? "the connection failed, check the TLS certificate"
      : "the connection failed";
    ws.onerror = () => fail("network", failed);
    ws.onclose = () =>
      fail(
        "network",
        authenticated
          ? "the connection was closed"
          : "closed before authentication",
      );
    ws.onmessage = (event) => {
      if (settled) return;
      const raw = event.data;
      if (typeof raw !== "string")
        return fail("invalid_response", "binary message");
      if (raw.length > maxBytes) return fail("too_large");
      let parsed: z.output<typeof envelopeSchema>;
      try {
        parsed = envelopeSchema.parse(JSON.parse(raw));
      } catch (cause) {
        return finish({
          error: haFail("invalid_response", { detail: "bad message", cause }),
        });
      }
      switch (parsed.type) {
        case "auth_required":
          ws.send(JSON.stringify({ type: "auth", access_token: token }));
          return;
        case "auth_invalid":
          return fail("unauthorized");
        case "auth_ok":
          authenticated = true;
          ws.send(JSON.stringify({ id: COMMAND_ID, type: command.type }));
          return;
        case "result": {
          if (parsed.id !== COMMAND_ID) return;
          if (!parsed.success) {
            const code = parsed.error?.code;
            return fail(
              code === "unauthorized" ? "forbidden" : "bad_request",
              code ? `command failed: ${code}` : undefined,
            );
          }
          try {
            finish({
              value: parseWith(schema, parsed.result, haFail) as WsResultMap[T],
            });
          } catch (err) {
            finish({ error: err as Error });
          }
          return;
        }
        default:
          return;
      }
    };
  });
}
