import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Scope } from "../../src/lib/api/scopes";
import type { ToolContext } from "./context";
import { describeError } from "./errors";
import { compact } from "./format";

/**
 * How a tool touches the household's data; fixes the MCP annotations and the
 * scope the token needs.
 *
 * - `read`: changes nothing (`read`)
 * - `create`: adds a record; repeating it adds another (`write`)
 * - `update`: changes records; repeating it with the same input changes nothing more (`write`)
 * - `undo`: revokes a record; repeating it is harmless (`write`, destructive)
 */
export type ToolMode = "read" | "create" | "update" | "undo";

const ANNOTATIONS: Record<ToolMode, ToolAnnotations> = {
  read: { readOnlyHint: true, openWorldHint: false },
  create: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  update: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  undo: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/** What a handler returns: one line for the reader, the data as JSON. */
export interface ToolOutput {
  summary: string;
  data: unknown;
}

export interface ToolSpec<Shape extends z.ZodRawShape> {
  /** snake_case, verb first: `list_tasks`, `complete_task`. */
  name: string;
  title: string;
  description: string;
  mode: ToolMode;
  /** Scopes the token needs; default `read` for read tools, `write` otherwise. */
  scopes?: readonly Scope[];
  input: Shape;
  handler: (
    args: z.infer<z.ZodObject<Shape>>,
    ctx: ToolContext,
  ) => Promise<ToolOutput>;
}

/** A tool with its input type erased, so tools of any shape fit in one registry. */
export interface Tool {
  readonly name: string;
  readonly scopes: readonly Scope[];
  register(server: McpServer, ctx: ToolContext): void;
}

export function toolResult({ summary, data }: ToolOutput): CallToolResult {
  const body = JSON.stringify(compact(data));
  return { content: [{ type: "text", text: `${summary}\n\n${body}` }] };
}

export function toolErrorResult(err: unknown): CallToolResult {
  const { code, message } = describeError(err);
  return {
    isError: true,
    content: [{ type: "text", text: `Error [${code}]: ${message}` }],
  };
}

/**
 * Defines one tool. A new tool is a name, a description, an input shape and a
 * handler that calls the typed client; scoping, annotations, result and error
 * formatting come from here.
 */
export function defineTool<Shape extends z.ZodRawShape>(
  spec: ToolSpec<Shape>,
): Tool {
  const scopes = spec.scopes ?? [spec.mode === "read" ? "read" : "write"];
  return {
    name: spec.name,
    scopes,
    register(server, ctx) {
      server.registerTool(
        spec.name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema: spec.input,
          annotations: { title: spec.title, ...ANNOTATIONS[spec.mode] },
        },
        (async (args: z.infer<z.ZodObject<Shape>>) => {
          try {
            return toolResult(await spec.handler(args, ctx));
          } catch (err) {
            return toolErrorResult(err);
          }
        }) as never,
      );
    },
  };
}
