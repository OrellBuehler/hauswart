#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config";
import { createHauswartServer } from "./server";

const REQUEST_TIMEOUT_MS = 30_000;

async function main() {
  const { url, token } = loadConfig();
  const { server, tools } = await createHauswartServer({
    url,
    token,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
  });
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol; diagnostics go to stderr.
  console.error(`hauswart-mcp: connected to ${url}, ${tools.length} tools`);
}

main().catch((err: unknown) => {
  console.error(
    `hauswart-mcp: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
