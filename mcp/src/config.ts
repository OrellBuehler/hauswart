import { z } from "zod";

const configSchema = z.object({
  HAUSWART_URL: z
    .url({ protocol: /^https?$/, error: "must be an http(s) URL" })
    .transform((url) => url.replace(/\/+$/, "")),
  HAUSWART_TOKEN: z.string().trim().min(1, "must not be empty"),
});

export interface Config {
  url: string;
  token: string;
}

const HELP =
  "Create a token of kind mcp under Settings > API tokens in hauswart (scope read, plus write to let Claude change things) and set HAUSWART_URL (e.g. https://hauswart.example.org) and HAUSWART_TOKEN.";

/** Reads the connection settings from the environment; the message names what is missing, never the token. */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const parsed = configSchema.safeParse({
    HAUSWART_URL: env.HAUSWART_URL,
    HAUSWART_TOKEN: env.HAUSWART_TOKEN,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map(
        (i) =>
          `${i.path.join(".")}: ${i.input === undefined ? "is not set" : i.message}`,
      )
      .join("; ");
    throw new Error(`Invalid configuration (${problems}). ${HELP}`);
  }
  return { url: parsed.data.HAUSWART_URL, token: parsed.data.HAUSWART_TOKEN };
}
