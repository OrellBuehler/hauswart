import { isApiError } from "$lib/api/errors";
import { m } from "$lib/paraglide/messages";
import { getLocale } from "$lib/paraglide/runtime";

const INTL_LOCALES = { de: "de-CH", en: "en-GB" } as const;

const HELD: Record<string, () => string> = {
  "saved details": () => m.asset_kind_held_details(),
  "odometer readings": () => m.asset_kind_held_readings(),
  "tire sets": () => m.asset_kind_held_tire_sets(),
};

const MESSAGE = /^Remove the vehicle's (.+) before changing its kind$/;

function split(list: string): string[] {
  return list.split(/, | and /).map((part) => part.trim());
}

export function vehicleKindError(err: unknown): string | null {
  if (!isApiError(err) || err.code !== "invalid_request") return null;
  const messages = (
    err.details as
      { body?: { fieldErrors?: Record<string, unknown> } } | undefined
  )?.body?.fieldErrors?.kind;
  const first = Array.isArray(messages) ? messages[0] : undefined;
  if (typeof first !== "string") return null;
  const held = MESSAGE.exec(first)?.[1];
  const words = held
    ? split(held).flatMap((part) => (HELD[part] ? [HELD[part]()] : []))
    : [];
  if (words.length === 0) return m.asset_error_kind_generic();
  const what = new Intl.ListFormat(INTL_LOCALES[getLocale()], {
    style: "long",
    type: "conjunction",
  }).format(words);
  return m.asset_error_kind_held({ what });
}
