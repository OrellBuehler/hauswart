import type { Component } from "svelte";
import BabyIcon from "@lucide/svelte/icons/baby";
import BikeIcon from "@lucide/svelte/icons/bike";
import BookOpenIcon from "@lucide/svelte/icons/book-open";
import BriefcaseIcon from "@lucide/svelte/icons/briefcase";
import CarIcon from "@lucide/svelte/icons/car";
import GiftIcon from "@lucide/svelte/icons/gift";
import GraduationCapIcon from "@lucide/svelte/icons/graduation-cap";
import HammerIcon from "@lucide/svelte/icons/hammer";
import HeartIcon from "@lucide/svelte/icons/heart";
import HouseIcon from "@lucide/svelte/icons/house";
import PartyPopperIcon from "@lucide/svelte/icons/party-popper";
import PawPrintIcon from "@lucide/svelte/icons/paw-print";
import PiggyBankIcon from "@lucide/svelte/icons/piggy-bank";
import PlaneIcon from "@lucide/svelte/icons/plane";
import ShoppingBasketIcon from "@lucide/svelte/icons/shopping-basket";
import TentIcon from "@lucide/svelte/icons/tent";
import UsersIcon from "@lucide/svelte/icons/users";
import UtensilsIcon from "@lucide/svelte/icons/utensils";
import WalletIcon from "@lucide/svelte/icons/wallet";
import { isApiError } from "$lib/api/errors";
import type { CostBook } from "$lib/api/schemas/cost-books";
import { m } from "$lib/paraglide/messages";
import { apiFieldErrors } from "$lib/tasks/field-errors";

/** What the address says for "every book" (`?book=all`); a book is its id. */
export const ALL_BOOKS = "all";

/**
 * The `book` of an address: `null` when it is not there, `""` for every book, else the id. A page that finds no
 * `book` may fall back to the book the person looked at last.
 */
export function parseBookParam(value: string | null): string | null {
  const text = value?.trim() ?? "";
  if (text === "") return null;
  return text === ALL_BOOKS ? "" : text;
}

/** The `book` value for an address: `""` (every book) becomes `all`. */
export function bookParam(bookId: string): string {
  return bookId === "" ? ALL_BOOKS : bookId;
}

export type BookChoice = {
  /** `""` = every book. */
  bookId: string;
  /** The book comes from what the person looked at last, not from the address. */
  fromMemory: boolean;
};

/**
 * Which book a page shows. The address wins (an id that no book has means every book); without one, the book the
 * person looked at last applies - unless the address narrows the list some other way (a device, a room, a search ...),
 * where a stray book would hide what the link was made to show.
 */
export function chooseBook(input: {
  param: string | null;
  remembered: string | null;
  books: readonly Pick<CostBook, "id">[];
  narrowed: boolean;
}): BookChoice {
  const known = (id: string | null): id is string =>
    id !== null && id !== "" && input.books.some((book) => book.id === id);
  if (input.param !== null) {
    return {
      bookId: known(input.param) ? input.param : "",
      fromMemory: false,
    };
  }
  if (!input.narrowed && known(input.remembered)) {
    return { bookId: input.remembered, fromMemory: true };
  }
  return { bookId: "", fromMemory: false };
}

/** Books that take new entries. */
export function openBooks<T extends Pick<CostBook, "archivedAt">>(
  books: readonly T[],
): T[] {
  return books.filter((book) => book.archivedAt === null);
}

/**
 * The books the switcher offers: those that take entries, and archived ones that still hold something (they count in
 * the balances) or are the one on screen.
 */
export function switcherBooks(
  books: readonly CostBook[],
  selectedId: string,
): CostBook[] {
  return books.filter(
    (book) =>
      book.archivedAt === null ||
      book.id === selectedId ||
      book.entryCount > 0 ||
      book.settlementCount > 0,
  );
}

/** The book an entry without a choice goes to. */
export function defaultBook(books: readonly CostBook[]): CostBook | undefined {
  return books.find((book) => book.isDefault) ?? openBooks(books)[0];
}

export type BookIconEntry = { icon: Component; label: () => string };

/** The icons a book can carry, keyed by the Lucide name stored on the book. */
export const bookIcons: Record<string, BookIconEntry> = {
  house: { icon: HouseIcon, label: () => m.costbook_icon_house() },
  "shopping-basket": {
    icon: ShoppingBasketIcon,
    label: () => m.costbook_icon_shopping(),
  },
  car: { icon: CarIcon, label: () => m.costbook_icon_car() },
  plane: { icon: PlaneIcon, label: () => m.costbook_icon_travel() },
  tent: { icon: TentIcon, label: () => m.costbook_icon_camping() },
  users: { icon: UsersIcon, label: () => m.costbook_icon_group() },
  utensils: { icon: UtensilsIcon, label: () => m.costbook_icon_food() },
  "party-popper": {
    icon: PartyPopperIcon,
    label: () => m.costbook_icon_party(),
  },
  gift: { icon: GiftIcon, label: () => m.costbook_icon_gifts() },
  heart: { icon: HeartIcon, label: () => m.costbook_icon_heart() },
  baby: { icon: BabyIcon, label: () => m.costbook_icon_child() },
  "paw-print": { icon: PawPrintIcon, label: () => m.costbook_icon_pet() },
  bike: { icon: BikeIcon, label: () => m.costbook_icon_bike() },
  "graduation-cap": {
    icon: GraduationCapIcon,
    label: () => m.costbook_icon_education(),
  },
  briefcase: { icon: BriefcaseIcon, label: () => m.costbook_icon_work() },
  hammer: { icon: HammerIcon, label: () => m.costbook_icon_renovation() },
  "piggy-bank": {
    icon: PiggyBankIcon,
    label: () => m.costbook_icon_savings(),
  },
  wallet: { icon: WalletIcon, label: () => m.costbook_icon_wallet() },
};

export const bookIconNames = Object.keys(bookIcons);

/** The icon of a book; one the client does not know (or none) falls back to an open book. */
export function bookIconFor(key: string | null | undefined): Component {
  return (key ? bookIcons[key]?.icon : undefined) ?? BookOpenIcon;
}

/** The reason a book could not be deleted or archived, in words; `undefined` for any other error. */
export function bookConflictMessage(
  err: unknown,
  book: Pick<CostBook, "name">,
): string | undefined {
  if (!isApiError(err) || err.code !== "conflict") return undefined;
  const details = err.details as
    { entryCount?: unknown; settlementCount?: unknown } | null | undefined;
  const entries = details?.entryCount;
  const payments = details?.settlementCount;
  if (typeof entries === "number" && typeof payments === "number") {
    return m.costbook_error_in_use({
      name: book.name,
      entries: m.costbook_entry_count({ count: entries }),
      payments: m.costbook_payment_count({ count: payments }),
    });
  }
  return m.costbook_error_last();
}

/**
 * Why a book could not be made the default, in words: it was archived in the meantime (400 on `isDefault`), or the
 * default was asked to stop being it (409). `undefined` for any other error.
 */
export function bookDefaultMessage(
  err: unknown,
  book: Pick<CostBook, "name">,
): string | undefined {
  if (!isApiError(err)) return undefined;
  if (err.code === "invalid_request" && "isDefault" in apiFieldErrors(err)) {
    return m.costbook_error_default_archived({ name: book.name });
  }
  if (err.code === "conflict") return m.costbook_error_default_conflict();
  return undefined;
}
