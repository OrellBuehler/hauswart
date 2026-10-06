import { ApiError, type ErrorCode } from "../../src/lib/api/errors";

/** A failure the model can act on; becomes an MCP tool error with the API error code. */
export class ToolError extends Error {
  readonly code: ErrorCode | "unreachable";

  constructor(code: ErrorCode | "unreachable", message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

interface FlatErrors {
  formErrors?: string[];
  fieldErrors?: Record<string, string[]>;
}

/** `{body: {formErrors, fieldErrors}}` (the API's 400 details) as `body.title: Too small; ...`. */
function describeDetails(details: unknown): string {
  if (!details || typeof details !== "object") return "";
  const lines: string[] = [];
  for (const [source, flat] of Object.entries(details)) {
    const { formErrors = [], fieldErrors = {} } = (flat ?? {}) as FlatErrors;
    for (const message of formErrors) lines.push(`${source}: ${message}`);
    for (const [field, messages] of Object.entries(fieldErrors)) {
      lines.push(`${source}.${field}: ${messages.join(", ")}`);
    }
  }
  return lines.join("; ");
}

export function describeError(err: unknown): { code: string; message: string } {
  if (err instanceof ToolError) return { code: err.code, message: err.message };
  if (err instanceof ApiError) {
    const detail = describeDetails(err.details);
    return {
      code: err.code,
      message: detail ? `${err.message} (${detail})` : err.message,
    };
  }
  if (err instanceof Error && err.name === "TimeoutError") {
    return { code: "unreachable", message: "The hauswart server timed out." };
  }
  if (err instanceof TypeError) {
    return {
      code: "unreachable",
      message: `Could not reach the hauswart server: ${err.message}`,
    };
  }
  return {
    code: "internal",
    message: err instanceof Error ? err.message : String(err),
  };
}
