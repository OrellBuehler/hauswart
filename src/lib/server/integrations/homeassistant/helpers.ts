import { addDays, compareDates, isValidDate, localDateOf } from "$lib/dates";
import type { HaCalendarEvent, HaState } from "./schemas";

/** Thrown by the pure helpers for input that cannot be used (bad pattern, bad payload field). */
export class HaInputError extends Error {
  override name = "HaInputError";
}

// ---- states ---------------------------------------------------------------

const NON_VALUES = new Set(["unavailable", "unknown", "none", ""]);
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** `true` for the states Home Assistant uses when a value is not there. */
export function isUnavailableState(state: string | null | undefined): boolean {
  return state == null || NON_VALUES.has(state.trim().toLowerCase());
}

/**
 * The numeric value of an entity state, or `null` for `unavailable`,
 * `unknown`, empty and anything that is not a plain decimal number
 * (no hex, no `Infinity`, no thousands separators).
 */
export function parseNumericState(
  state: string | number | null | undefined,
): number | null {
  if (typeof state === "number") return Number.isFinite(state) ? state : null;
  if (state == null) return null;
  const text = state.trim();
  if (NON_VALUES.has(text.toLowerCase()) || !NUMBER_RE.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export interface Signal {
  /** Numeric value; `null` when the state is unavailable or not a number. */
  numeric: number | null;
  /** The raw state text; `null` when the state is unavailable, unknown or empty. */
  text: string | null;
  /** When the state last changed (ms since the epoch); `null` when Home Assistant sent no usable time. */
  changedAt: number | null;
  /** When this application read the state (ms since the epoch). */
  seenAt: number;
}

export function toSignal(
  state: Pick<HaState, "state" | "lastChanged">,
  seenAt: number,
): Signal {
  const changed = Date.parse(state.lastChanged);
  return {
    numeric: parseNumericState(state.state),
    text: isUnavailableState(state.state) ? null : state.state,
    changedAt: Number.isNaN(changed) ? null : changed,
    seenAt,
  };
}

// ---- calendar ---------------------------------------------------------------

export const MAX_SUMMARY_MATCH_LENGTH = 100;
const MAX_SUMMARY_TEXT = 200;
const MAX_UNBOUNDED_QUANTIFIERS = 3;
const MAX_GROUP_DEPTH = 3;
const MAX_ALL_DAY_SPAN = 366;

const isQuantChar = (c: string | undefined) =>
  c !== undefined && "?*+{".includes(c);

const SPECIAL = new Set("\\^$.|?*+()[]{}");
const ESCAPE_CLASSES = new Set("dwsDWSb");

/**
 * Checks a regular expression against a small, linear-ish subset and throws
 * `HaInputError` otherwise. Allowed: literals, `.`, `[...]` classes with
 * ranges, `\d \w \s \b` (and upper-case negations), escaped punctuation,
 * `^` `$`, alternation, plain `(...)` and `(?:...)` groups, and the
 * quantifiers `?` `*` `+` on a single atom. Not allowed: `{n,m}`, lazy
 * quantifiers, quantified groups, lookarounds, backreferences, more than
 * three `*`/`+` in total. Without quantified groups nothing can nest, so
 * matching cannot blow up exponentially; the cap on `*`/`+` and the cap on
 * the matched text bound the polynomial cases.
 */
function assertSafeRegex(source: string): void {
  if (source.length === 0 || source.length > MAX_SUMMARY_MATCH_LENGTH) {
    throw new HaInputError("pattern is empty or too long");
  }
  let i = 0;
  let unbounded = 0;
  const fail = (why: string): never => {
    throw new HaInputError(`pattern is not allowed: ${why}`);
  };

  const quantifier = () => {
    const q = source[i];
    if (q === "?" || q === "*" || q === "+") {
      if (q !== "?" && ++unbounded > MAX_UNBOUNDED_QUANTIFIERS) {
        fail("too many repetitions");
      }
      i++;
      if (isQuantChar(source[i])) fail("stacked quantifier");
    } else if (q === "{") fail("{n,m} repetition");
  };

  const escape = (inClass: boolean) => {
    const c = source[i + 1];
    if (c === undefined) fail("dangling backslash");
    if (ESCAPE_CLASSES.has(c!) && !(inClass && c === "b")) {
      i += 2;
      return;
    }
    if (c !== undefined && SPECIAL.has(c)) {
      i += 2;
      return;
    }
    if (c === "-" || c === "/") {
      i += 2;
      return;
    }
    fail("unsupported escape");
  };

  const charClass = () => {
    i++; // [
    if (source[i] === "^") i++;
    let count = 0;
    for (;;) {
      const c = source[i];
      if (c === undefined) fail("unterminated class");
      if (c === "]") {
        if (count === 0) fail("empty class");
        i++;
        return;
      }
      if (c === "[") fail("nested class");
      if (c === "\\") escape(true);
      else i++;
      count++;
      if (
        source[i] === "-" &&
        source[i + 1] !== "]" &&
        source[i + 1] !== undefined
      ) {
        i++;
        if (source[i] === "\\") escape(true);
        else if (source[i] === "[") fail("nested class");
        else i++;
      }
    }
  };

  const alternation = (depth: number) => {
    if (depth > MAX_GROUP_DEPTH) fail("groups nested too deeply");
    for (;;) {
      const c = source[i];
      if (c === undefined || c === ")") return;
      if (c === "|") {
        i++;
        continue;
      }
      if (c === "(") {
        i++;
        if (source[i] === "?") {
          if (source.slice(i, i + 2) !== "?:")
            fail("lookaround or named group");
          i += 2;
        }
        alternation(depth + 1);
        if (source[i] !== ")") fail("unterminated group");
        i++;
        if (isQuantChar(source[i])) fail("quantified group");
        continue;
      }
      if (c === "^" || c === "$") {
        i++;
        if (isQuantChar(source[i])) fail("quantified anchor");
        continue;
      }
      if (c === "[") charClass();
      else if (c === "\\") {
        if (source[i + 1] === "b") {
          i += 2;
          if (isQuantChar(source[i])) fail("quantified anchor");
          continue;
        }
        escape(false);
      } else if (c === ".") i++;
      else if (c === "]" || c === "}" || c === "{") fail("stray bracket");
      else if (SPECIAL.has(c)) fail("misplaced character");
      else i++;
      quantifier();
    }
  };

  alternation(0);
  if (i < source.length) fail("unbalanced parenthesis");
}

/**
 * Compiles a summary filter into a predicate. `match` is either a plain
 * case-insensitive substring, or `/pattern/` (optionally `/pattern/i`) in the
 * restricted regular-expression subset described at `assertSafeRegex`.
 * Throws `HaInputError` for a pattern that is invalid or outside the subset;
 * call it when the setting is saved. Only the first 200 characters of a
 * summary are examined.
 */
export function compileSummaryMatcher(
  match: string | null | undefined,
): (summary: string) => boolean {
  const raw = match?.trim() ?? "";
  if (raw === "") return () => true;
  if (raw.length > MAX_SUMMARY_MATCH_LENGTH + 3) {
    throw new HaInputError("pattern is empty or too long");
  }
  const delimited = /^\/(.+)\/i?$/.exec(raw);
  if (delimited) {
    const source = delimited[1]!;
    assertSafeRegex(source);
    let re: RegExp;
    try {
      re = new RegExp(source, "i");
    } catch (cause) {
      throw new HaInputError("pattern is invalid", { cause });
    }
    return (summary) => re.test(summary.slice(0, MAX_SUMMARY_TEXT));
  }
  const needle = raw.toLowerCase();
  return (summary) => summary.toLowerCase().includes(needle);
}

const OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function timedDate(dateTime: string, timeZone: string): string {
  if (OFFSET_RE.test(dateTime)) {
    const ms = Date.parse(dateTime);
    if (Number.isNaN(ms)) throw new HaInputError("event time is not valid");
    return localDateOf(timeZone, ms);
  }
  // No offset: Home Assistant already sent local wall-clock time.
  const head = dateTime.slice(0, 10);
  if (!isValidDate(head)) throw new HaInputError("event time is not valid");
  return head;
}

/**
 * The local calendar dates (`YYYY-MM-DD` in `timeZone`) that events fall on,
 * sorted and unique. An all-day event covers every day from its start to its
 * (exclusive) end, at most a year. A timed event counts on the local date it
 * starts, so 23:30 UTC on 30 March is already 31 March in Zurich.
 * `summaryMatch` filters by summary, see `compileSummaryMatcher`.
 */
export function calendarEventsToDates(
  events: ReadonlyArray<Pick<HaCalendarEvent, "summary" | "start" | "end">>,
  timeZone: string,
  summaryMatch?: string | null,
): string[] {
  const matches = compileSummaryMatcher(summaryMatch);
  const dates = new Set<string>();
  for (const event of events) {
    if (!matches(event.summary)) continue;
    if ("date" in event.start) {
      const first = event.start.date;
      const endExclusive =
        event.end && "date" in event.end ? event.end.date : addDays(first, 1);
      let day = first;
      for (
        let n = 0;
        n < MAX_ALL_DAY_SPAN && compareDates(day, endExclusive) < 0;
        n++
      ) {
        dates.add(day);
        day = addDays(day, 1);
      }
      if (compareDates(first, endExclusive) >= 0) dates.add(first);
    } else {
      dates.add(timedDate(event.start.dateTime, timeZone));
    }
  }
  return [...dates].sort(compareDates);
}

// ---- notifications ------------------------------------------------------------

export type InterruptionLevel =
  "passive" | "active" | "time-sensitive" | "critical";

export interface ActionableNotificationInput {
  title: string;
  message: string;
  /** Opened when the notification is tapped: an absolute http(s) URL or a path such as `/lovelace/home`. */
  url: string;
  /** Replaces an earlier notification with the same tag. */
  tag: string;
  actions?: Array<{ action: string; title: string }>;
  /** iOS only. */
  interruptionLevel?: InterruptionLevel;
}

export type NotificationPayload = {
  title: string;
  message: string;
  data: {
    url: string;
    clickAction: string;
    tag: string;
    actions?: Array<{ action: string; title: string }>;
    push?: { "interruption-level": InterruptionLevel };
  };
};

const TAG_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const ACTION_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const MAX_ACTIONS = 3;
const MAX_TITLE = 100;
const MAX_MESSAGE = 600;
const MAX_ACTION_TITLE = 40;
const LEVELS = new Set<string>([
  "passive",
  "active",
  "time-sensitive",
  "critical",
]);

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function assertTarget(url: string): void {
  // eslint-disable-next-line no-control-regex
  if (url === "" || url.length > 2000 || /[\u0000-\u001f\u007f\s]/.test(url)) {
    throw new HaInputError("notification url is not valid");
  }
  if (url.startsWith("/") && !url.startsWith("//")) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (cause) {
    throw new HaInputError("notification url is not valid", { cause });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HaInputError("notification url must be http(s) or a path");
  }
}

/**
 * The service data for `notify.mobile_app_<device>` (iOS and Android
 * companion apps): `data.url` for iOS and `data.clickAction` for Android open
 * the same target, `data.tag` replaces an earlier notification, `data.actions`
 * are the buttons (at most three, the Android limit). Title, message and
 * button text are shortened to fit a push payload. Throws `HaInputError` for
 * an unusable url, tag, action id or interruption level.
 */
export function buildActionableNotification(
  input: ActionableNotificationInput,
): NotificationPayload {
  if (input.message.trim() === "") {
    throw new HaInputError("notification message is empty");
  }
  assertTarget(input.url);
  if (!TAG_RE.test(input.tag))
    throw new HaInputError("notification tag is not valid");
  const actions = input.actions ?? [];
  if (actions.length > MAX_ACTIONS) {
    throw new HaInputError(`at most ${MAX_ACTIONS} actions are supported`);
  }
  const seen = new Set<string>();
  for (const a of actions) {
    if (!ACTION_RE.test(a.action) || a.title.trim() === "") {
      throw new HaInputError("notification action is not valid");
    }
    if (seen.has(a.action))
      throw new HaInputError("duplicate notification action");
    seen.add(a.action);
  }
  if (
    input.interruptionLevel !== undefined &&
    !LEVELS.has(input.interruptionLevel)
  ) {
    throw new HaInputError("interruption level is not valid");
  }
  return {
    title: clip(input.title, MAX_TITLE),
    message: clip(input.message, MAX_MESSAGE),
    data: {
      url: input.url,
      clickAction: input.url,
      tag: input.tag,
      ...(actions.length > 0
        ? {
            actions: actions.map((a) => ({
              action: a.action,
              title: clip(a.title, MAX_ACTION_TITLE),
            })),
          }
        : {}),
      ...(input.interruptionLevel
        ? { push: { "interruption-level": input.interruptionLevel } }
        : {}),
    },
  };
}

const PREFIX_RE = /^[A-Za-z0-9_]{1,32}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The action id for a button, e.g. `HW_DONE_<token>`; the token is an opaque identifier chosen by the caller. */
export function notificationActionToken(prefix: string, token: string): string {
  if (!PREFIX_RE.test(prefix))
    throw new HaInputError("action prefix is not valid");
  if (!TOKEN_RE.test(token))
    throw new HaInputError("action token is not valid");
  return `${prefix}${token}`;
}

/**
 * The token of an action id built with `notificationActionToken`, or `null`
 * when the id has another prefix or a malformed token. The action id of a
 * `mobile_app_notification_action` event is user-controlled input.
 */
export function parseNotificationActionToken(
  prefix: string,
  action: unknown,
): string | null {
  if (!PREFIX_RE.test(prefix) || typeof action !== "string") return null;
  if (!action.startsWith(prefix)) return null;
  const token = action.slice(prefix.length);
  return TOKEN_RE.test(token) ? token : null;
}
