import { z } from "zod";

/** One JSON-RPC 2.0 message; the MCP transport checks the rest (method, params, id). */
export const mcpMessageSchema = z.looseObject({ jsonrpc: z.literal("2.0") });

/** The body of `POST /mcp`: a JSON-RPC request or notification, or a batch of them. */
export const mcpRequestSchema = z.union([
  mcpMessageSchema,
  z.array(mcpMessageSchema).min(1),
]);
