import type { z } from "zod";
import { isApiError } from "$lib/api/errors";
import { m } from "$lib/paraglide/messages";

type Issue = z.core.$ZodIssue;

function valueAt(root: unknown, path: PropertyKey[]): unknown {
  let current = root;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

/** A localized sentence for one validation issue; the schema's own (English) message is never shown. */
export function issueMessage(issue: Issue, value: unknown): string {
  const empty = value === undefined || value === null || value === "";
  switch (issue.code) {
    case "invalid_type":
    case "invalid_value":
      return empty ? m.field_required() : m.field_invalid();
    case "too_small": {
      if (issue.origin === "number" || issue.origin === "int") {
        return issue.inclusive === false
          ? m.field_greater_than({ min: Number(issue.minimum) })
          : m.field_min({ min: Number(issue.minimum) });
      }
      return empty || Number(issue.minimum) <= 1
        ? issue.origin === "array"
          ? m.field_choose_one()
          : m.field_required()
        : m.field_invalid();
    }
    case "too_big":
      return issue.origin === "number" || issue.origin === "int"
        ? m.field_max({ max: Number(issue.maximum) })
        : m.field_too_long({ max: Number(issue.maximum) });
    case "invalid_format":
      return empty ? m.field_required() : m.field_invalid_date();
    case "custom": {
      if (empty) return m.field_required();
      if (issue.message.includes("YYYY-MM-DD")) return m.field_invalid_date();
      if (issue.message.includes("numeric")) return m.field_number();
      return m.field_invalid();
    }
    default:
      return m.field_invalid();
  }
}

/** Issues keyed by dotted path (`trigger.every`, `seasons.0.unit`); the first message per path wins. */
export function issuesToErrors(
  issues: readonly Issue[],
  root: unknown,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".");
    if (key in errors) continue;
    errors[key] = issueMessage(issue, valueAt(root, issue.path));
  }
  return errors;
}

/** The part of an error map below `prefix` (`trigger` -> `every`), the prefix itself becoming `""`. */
export function errorsUnder(
  errors: Record<string, string>,
  prefix: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    if (key === prefix) out[""] = message;
    else if (key.startsWith(`${prefix}.`))
      out[key.slice(prefix.length + 1)] = message;
  }
  return out;
}

/** Field errors from an `invalid_request` API error: the offending top-level body fields. */
export function apiFieldErrors(err: unknown): Record<string, string> {
  if (!isApiError(err) || err.code !== "invalid_request") return {};
  const body = (
    err.details as
      { body?: { fieldErrors?: Record<string, unknown> } } | undefined
  )?.body;
  const out: Record<string, string> = {};
  for (const field of Object.keys(body?.fieldErrors ?? {})) {
    out[field] = m.field_invalid();
  }
  return out;
}
