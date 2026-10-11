import type { CalendarItemKind } from "$lib/api/enums";

/**
 * The name an event carries so hauswart can find it again: `hw-ref: <ref>@sync.hauswart`, where
 * `<ref>` is the stable name of the item (`task-<id>-<occurrence>`, `appointment-<id>`, ...). A calendar
 * that has a field of its own for it may keep the ref there instead; what counts is that the
 * provider hands it back as `RemoteEvent.ref`. An event without it is not ours and is never touched.
 */
export const REF_DOMAIN = "sync.hauswart";
const MARKER_PREFIX = "hw-ref: ";

const MARKER_LINE = new RegExp(
  `^hw-ref: ([A-Za-z0-9:._-]{1,300})@${REF_DOMAIN.replace(/\./g, "\\.")}$`,
);

export function markerLine(ref: string): string {
  return `${MARKER_PREFIX}${ref}@${REF_DOMAIN}`;
}

/** The ref in a text that has a marker line (the last one counts), else null. */
export function parseMarker(text: string | null | undefined): string | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = MARKER_LINE.exec(lines[i]!.trim());
    if (match) return match[1]!;
  }
  return null;
}

/** The text without any marker line, and without the blank lines that were left before it. */
export function stripMarker(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !MARKER_LINE.test(line.trim()))
    .join("\n")
    .replace(/\s+$/, "");
}

const PREFIXES: ReadonlyArray<readonly [string, CalendarItemKind]> = [
  ["appointment-", "appointments"],
  ["task-", "task_due"],
  ["prep-", "preparations"],
  ["defect-", "defect_deadlines"],
  ["insurance-", "insurance_deadlines"],
  ["warranty-", "warranty_ends"],
];

/** The kind of item a ref names; null for a ref this version does not know (it is left alone). */
export function kindOfRef(ref: string): CalendarItemKind | null {
  return PREFIXES.find(([prefix]) => ref.startsWith(prefix))?.[1] ?? null;
}
