import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createApiClient, type FetchLike } from "../../src/lib/api/client";
import { isApiError } from "../../src/lib/api/errors";
import { endpoints } from "../../src/lib/api/registry";
import pkg from "../../package.json" with { type: "json" };
import { createContext, type ToolContext } from "./context";
import { ToolError } from "./errors";
import { tools as allTools } from "./tools";
import type { Tool } from "./tool";

export interface ConnectOptions {
  url: string;
  token: string;
  fetch?: FetchLike;
  now?: () => number;
  newKey?: () => string;
  tools?: readonly Tool[];
}

const INSTRUCTIONS = `hauswart manages one household's apartment: recurring maintenance tasks (cleaning, filters, plants, payments), devices and plants (assets), rooms and notifications. Dates are YYYY-MM-DD in the household's time zone (whoami shows today). Ids come from the list tools; rooms, assets and people can also be given by name. Start with list_upcoming to see what is due. Fields that are empty are left out of results.`;

async function handshake(options: ConnectOptions) {
  const api = createApiClient(options.fetch ?? fetch, options.url, {
    token: options.token,
  });
  try {
    const [me, household] = await Promise.all([
      api.call(endpoints.authMe),
      api.call(endpoints.householdGet),
    ]);
    return { api, me, household };
  } catch (err) {
    throw new Error(handshakeMessage(options.url, err), { cause: err });
  }
}

/** Turns a rejected token or an unreachable server into one actionable message. */
function handshakeMessage(url: string, err: unknown): string {
  if (!isApiError(err)) {
    return `Could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`;
  }
  switch (err.code) {
    case "unauthenticated":
      return `${url} rejected the token (401): it is wrong, expired or revoked. Create a new token of kind mcp in Settings > API tokens.`;
    case "setup_required":
      return `${url} has not been set up yet: open it in a browser and create the first user.`;
    case "forbidden":
      return "The token has no read scope; the MCP server needs at least read.";
    case "rate_limited":
      return "hauswart is rate limiting this token; try again shortly.";
    default:
      return `hauswart answered ${err.status} ${err.code}: ${err.message}`;
  }
}

export interface HauswartServer {
  server: McpServer;
  context: ToolContext;
  /** Names of the registered tools. */
  tools: string[];
}

/**
 * Connects to hauswart, learns the token's scopes with one `whoami` call and
 * registers only the tools those scopes allow.
 */
export async function createHauswartServer(
  options: ConnectOptions,
): Promise<HauswartServer> {
  const { api, me, household } = await handshake(options);
  if (!me.scopes.includes("read")) {
    throw new ToolError(
      "forbidden",
      "The token has no read scope; the MCP server needs at least read.",
    );
  }
  const context = createContext({
    api,
    me: me.user,
    scopes: me.scopes,
    household,
    now: options.now,
    newKey: options.newKey,
  });
  const server = new McpServer(
    { name: "hauswart", version: pkg.version },
    {
      instructions: `${INSTRUCTIONS}${me.scopes.includes("write") ? "" : " This token is read-only: tools that change data are not available."}`,
    },
  );
  const registered: string[] = [];
  for (const tool of options.tools ?? allTools) {
    if (!tool.scopes.every((s) => me.scopes.includes(s))) continue;
    tool.register(server, context);
    registered.push(tool.name);
  }
  return { server, context, tools: registered };
}
