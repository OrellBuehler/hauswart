import { z } from "zod";
import { IntegrationError } from "$lib/server/connections/errors";

/** The settings of this kind: the public address of this app as phones reach it (links in notifications). */
export const configSchema = z.object({
  appUrl: z.string().trim().max(500).optional(),
});

export function normalizeAppUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new IntegrationError(
      "invalid_input",
      "The app address must be a valid http:// or https:// address.",
      { cause },
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new IntegrationError(
      "invalid_input",
      "The app address must be a valid http:// or https:// address without credentials.",
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** The public address of this app for links in notifications: the setting, else `ORIGIN`, else none. */
export function appUrlOf(config: Record<string, unknown>): string | null {
  const parsed = configSchema.safeParse(config);
  const configured = parsed.success ? parsed.data.appUrl : undefined;
  const fallback = process.env.ORIGIN?.trim();
  const value = configured || fallback;
  if (!value) return null;
  try {
    return normalizeAppUrl(value);
  } catch (err) {
    if (err instanceof IntegrationError) return null;
    throw err;
  }
}
