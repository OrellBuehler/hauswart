import { parseBookParam, bookParam } from "./books";

const PREFIX = "hauswart:cost-book";

const keyFor = (userId: string) => `${PREFIX}:${userId}`;

/**
 * The book a person looked at last (`""` = every book, `null` = never chose one). Kept in this browser only
 * (localStorage, per person) until the server can store a preference; a browser that refuses storage just forgets.
 */
export function loadRememberedBook(userId: string): string | null {
  try {
    return parseBookParam(localStorage.getItem(keyFor(userId)));
  } catch (err) {
    console.warn("remembered cost book unreadable", err);
    return null;
  }
}

export function rememberBook(userId: string, bookId: string): void {
  try {
    localStorage.setItem(keyFor(userId), bookParam(bookId));
  } catch (err) {
    console.warn("remembered cost book not stored", err);
  }
}

/** Drops what the person looked at last, because that book no longer exists. */
export function forgetBook(userId: string): void {
  try {
    localStorage.removeItem(keyFor(userId));
  } catch (err) {
    console.warn("remembered cost book not cleared", err);
  }
}
