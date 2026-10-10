import type { ContactKind } from "$lib/api/enums";

/** The contacts of `kind` first, each group in the order it came in (a stable partition). */
export function preferKind<T extends { kind: ContactKind }>(
  contacts: readonly T[],
  kind: ContactKind | undefined,
): T[] {
  if (kind === undefined) return [...contacts];
  return [
    ...contacts.filter((contact) => contact.kind === kind),
    ...contacts.filter((contact) => contact.kind !== kind),
  ];
}
