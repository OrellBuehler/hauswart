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

const QUICK_PREFIX = "hauswart:quick-book";

const quickKeyFor = (userId: string) => `${QUICK_PREFIX}:${userId}`;

/**
 * The book the last quick entry went to (`null` = never used, or the browser refuses storage). Kept apart from the book
 * the costs page showed last: where an expense is typed in on a phone and what the list is opened on are two habits.
 */
export function loadQuickBook(userId: string): string | null {
  try {
    const id = localStorage.getItem(quickKeyFor(userId))?.trim();
    return id ? id : null;
  } catch (err) {
    console.warn("quick entry book unreadable", err);
    return null;
  }
}

export function rememberQuickBook(userId: string, bookId: string): void {
  try {
    if (bookId) localStorage.setItem(quickKeyFor(userId), bookId);
  } catch (err) {
    console.warn("quick entry book not stored", err);
  }
}
