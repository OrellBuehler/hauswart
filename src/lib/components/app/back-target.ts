/** The first path segment of every page that lives in the app shell and has detail or form pages below it. */
export const SECTIONS = [
  "tasks",
  "assets",
  "d",
  "inventory",
  "rooms",
  "plants",
  "docs",
  "documents",
  "defects",
  "parts",
  "contacts",
  "costs",
  "warranties",
  "emergency",
] as const;

/**
 * Parents that are not a page of their own: `/assets/<id>` and `/d/<slug>` belong to the inventory,
 * which is the list of devices.
 */
const PARENT_PAGES: Record<string, string> = {
  "/assets": "/inventory",
  "/d": "/inventory",
};

/**
 * Where the arrow in the header of a phone leads from a nested page: its parent, as a real address.
 * `null` for the pages the navigation reaches directly (sections, the dashboard, settings, the
 * administration). It is a link, never `history.back()`: a page opened from a home screen shortcut or
 * a notification has no history to go back to, and going back would leave the app.
 *
 * - `/tasks/12` -> `/tasks`, `/tasks/12/edit` -> `/tasks/12`, `/tasks/new` -> `/tasks`
 * - `/assets/12` and `/d/<slug>` -> `/inventory`, `/inventory/qr` -> `/inventory`
 * - `/rooms/12/qr` -> `/rooms/12`, `/costs/inbox` -> `/costs`
 */
export function backTarget(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  if (!(SECTIONS as readonly string[]).includes(segments[0]!)) return null;
  const parent = `/${segments.slice(0, -1).join("/")}`;
  return PARENT_PAGES[parent] ?? parent;
}
