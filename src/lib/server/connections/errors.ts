/**
 * A failure of an outside system, in a form the core can show: `code` is
 * short and machine-readable, `message` is safe for the user (an adapter never
 * puts tokens, bodies or entity states into it).
 */
export class IntegrationError extends Error {
  override name = "IntegrationError";
  /** The request field a check of the settings is about (`config`), when it is about one. */
  readonly field: string | undefined;
  constructor(
    readonly code: string,
    message: string,
    options?: { cause?: unknown; field?: string },
  ) {
    super(message, options);
    this.field = options?.field;
  }
}
