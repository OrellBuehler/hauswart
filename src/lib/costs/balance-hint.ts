const PREFIX = "hauswart:balances-history-hint-dismissed";

const keyFor = (userId: string) => `${PREFIX}:${userId}`;

/**
 * Whether the person hid the note that old balances may have been settled outside the app. Kept in this browser only
 * (localStorage, per person); a browser that refuses storage shows it again.
 */
export function historyHintDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(keyFor(userId)) === "1";
  } catch (err) {
    console.warn("balance hint state unreadable", err);
    return false;
  }
}

export function dismissHistoryHint(userId: string): void {
  try {
    localStorage.setItem(keyFor(userId), "1");
  } catch (err) {
    console.warn("balance hint state not stored", err);
  }
}
