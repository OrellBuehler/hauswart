const KEY = "hauswart:dismissed-ha-devices";

/**
 * Devices the person chose not to track. Kept in this browser only (localStorage)
 * until the server can store a per-household ignore list.
 */
export function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch (err) {
    console.warn("dismissed devices unreadable", err);
    return [];
  }
}

export function saveDismissed(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch (err) {
    console.warn("dismissed devices not stored", err);
  }
}
