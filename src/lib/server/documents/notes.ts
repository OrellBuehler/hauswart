import type { DocumentProviderConfig } from "$lib/api/schemas/documents";

/** The note left on a linked document; German, like the rest of the household's documents. */
export const NOTE_PREFIX = "Verknüpft in hauswart:";

function origin(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text || !URL.canParse(text)) return null;
  const url = new URL(text);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    return null;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** The public address of this app: the connection's setting, else `ORIGIN`, else none. */
export function appBaseUrl(config: DocumentProviderConfig): string | null {
  return origin(config.appUrl) ?? origin(process.env.ORIGIN);
}

/** The text of the note for an owner at `path` (`/assets/<id>`); a bare path when the app address is unknown. */
export function linkNoteText(
  config: DocumentProviderConfig,
  path: string,
): string {
  return `${NOTE_PREFIX} ${appBaseUrl(config) ?? ""}${path}`;
}
