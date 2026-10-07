const KEY = "hauswart:dismissed-document-suggestions";

/**
 * Suggestions the person chose to ignore (`<kind>:<provider>:<id>`). Kept in this browser only
 * (localStorage), like the ignored devices, until the server can store an ignore list.
 */
export function loadDismissedSuggestions(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch (err) {
    console.warn("dismissed suggestions unreadable", err);
    return [];
  }
}

export function saveDismissedSuggestions(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch (err) {
    console.warn("dismissed suggestions not stored", err);
  }
}
