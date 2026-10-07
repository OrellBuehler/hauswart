import {
  documentProviderConfigSchema,
  type DocumentProviderConfig,
} from "$lib/api/schemas/documents";

/** The settings a connection stored; anything missing or not valid falls back to the defaults. */
export function readProviderConfig(
  raw: Record<string, unknown>,
): DocumentProviderConfig {
  const parsed = documentProviderConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : documentProviderConfigSchema.parse({});
}

/** A list of ids as the form edits it: sorted, so that order alone never counts as a change. */
export function sameIds(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = (ids: readonly number[]) => [...ids].sort((x, y) => x - y);
  const left = sorted(a);
  const right = sorted(b);
  return left.every((id, index) => id === right[index]);
}

/** Whether `value` is a usable address for the public URL of this app: http(s), nothing else. */
export function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password
  );
}
