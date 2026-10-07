import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createApiClient } from "$lib/api/client";
import { ApiError } from "$lib/api/errors";
import type { endpoints } from "$lib/api/registry";
import { householdSchema } from "$lib/api/schemas/household";
import { hasForeignOrigin } from "$lib/server/auth/origin";
import { getHousehold } from "$lib/server/household/household";
import { APP_VERSION } from "$lib/server/version";
import { buildHauswartServer } from "../../../../../mcp/src/server";
import type { Handler } from "../bind";
import { wireHousehold, wireUser } from "../wire";

const BEARER = /^Bearer\s+(\S+)\s*$/i;

/** The transport answers what it refuses with a JSON-RPC error; the API answers with its own envelope. */
async function refusal(response: Response): Promise<ApiError> {
  const body = (await response.json()) as { error?: { message?: string } };
  return new ApiError(
    "invalid_request",
    body.error?.message ?? "The MCP transport refused the request",
    { status: response.status },
  );
}

/**
 * The MCP server over Streamable HTTP, stateless: every request gets its own server and transport,
 * so there is no session to keep, expire or share between instances. The tools call this API with
 * the caller's own token through `event.fetch` (SvelteKit answers it in process, through the hook
 * and `bind` like any other request), so scopes, the rate limit and the attribution of completions
 * are the token's. Who the token belongs to is already known here, so there is no handshake.
 *
 * GET and DELETE have no route (SvelteKit answers 405): a stateless server opens no streams and
 * ends no sessions.
 */
export const serve: Handler<typeof endpoints.mcp> = async ({
  ctx,
  body,
  event,
}) => {
  if (hasForeignOrigin(event.request, event.url)) {
    throw new ApiError("csrf_failed", "Cross-origin request rejected");
  }
  const token = BEARER.exec(
    event.request.headers.get("authorization") ?? "",
  )?.[1];
  if (!token) throw new ApiError("unauthenticated", "Bearer token required");

  const scopes = ctx.principal.scopes;
  const { server } = buildHauswartServer({
    // `credentials: "omit"` keeps SvelteKit from adding the caller's cookies to the inner requests.
    api: createApiClient(
      (input, init) => event.fetch(input, { ...init, credentials: "omit" }),
      "",
      { token },
    ),
    me: wireUser(ctx.user),
    scopes,
    household: householdSchema.parse(
      wireHousehold(getHousehold(ctx), {
        showHostAllowlist: scopes.includes("admin"),
      }),
    ),
    version: APP_VERSION,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(event.request, {
      parsedBody: body,
    });
    if (!response.ok) throw await refusal(response);
    return response;
  } finally {
    await server.close();
  }
};
