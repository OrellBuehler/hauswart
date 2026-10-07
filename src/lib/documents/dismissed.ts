const PREFIX = "hauswart:dismissed-document-suggestions";

function keyFor(userId: string): string {
  return `${PREFIX}:${userId}`;
}

/**
 * Suggestions the person chose to ignore (`<kind>:<provider>:<id>`). Kept in this browser only
 * (localStorage, per person), like the ignored devices, until the server can store an ignore list.
 */
export function loadDismissedSuggestions(userId: string): string[] {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch (err) {
    console.warn("dismissed suggestions unreadable", err);
    return [];
  }
}

export function saveDismissedSuggestions(userId: string, ids: string[]): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(ids));
  } catch (err) {
    console.warn("dismissed suggestions not stored", err);
  }
}
