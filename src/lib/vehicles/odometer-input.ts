import { parseOdometerValue } from "./format";

export type ReadingInput = { ok: true; value: number | null } | { ok: false };

export function readingToSend(
  text: string,
  known: number | null | undefined,
  max: number,
): ReadingInput {
  const parsed = parseOdometerValue(text, max);
  if (parsed === undefined) return { ok: false };
  if (parsed === null) return { ok: true, value: null };
  return { ok: true, value: parsed === known ? null : parsed };
}

export function readingText(known: number | null | undefined): string {
  return known === null || known === undefined ? "" : String(known);
}
