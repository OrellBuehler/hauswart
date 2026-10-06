import { resolve } from "$app/paths";
import type { DocSection } from "$lib/api/enums";

export function docHref(slug: string) {
  return resolve(`/docs/${encodeURIComponent(slug)}` as "/");
}

export function docEditHref(slug: string) {
  return resolve(`/docs/${encodeURIComponent(slug)}/edit` as "/");
}

export interface NewDocDefaults {
  section?: DocSection | undefined;
  assetId?: string | null | undefined;
  roomId?: string | null | undefined;
  title?: string | undefined;
}

/** The editor for a new page, with the link target (and more) prefilled. */
export function newDocHref(defaults: NewDocDefaults = {}) {
  const query = new URLSearchParams();
  if (defaults.section) query.set("section", defaults.section);
  if (defaults.assetId) query.set("assetId", defaults.assetId);
  if (defaults.roomId) query.set("roomId", defaults.roomId);
  if (defaults.title) query.set("title", defaults.title);
  const qs = query.toString();
  return resolve(`/docs/new${qs ? `?${qs}` : ""}` as "/");
}

export interface DocsFilter {
  q?: string | null | undefined;
  section?: DocSection | null | undefined;
  assetId?: string | null | undefined;
  roomId?: string | null | undefined;
  archived?: boolean | undefined;
}

/** The documentation list with a filter in the query string. */
export function docsFilterHref(filter: DocsFilter = {}) {
  const query = new URLSearchParams();
  if (filter.q) query.set("q", filter.q);
  if (filter.section) query.set("section", filter.section);
  if (filter.assetId) query.set("assetId", filter.assetId);
  if (filter.roomId) query.set("roomId", filter.roomId);
  if (filter.archived) query.set("archived", "1");
  const qs = query.toString();
  return resolve(`/docs${qs ? `?${qs}` : ""}` as "/");
}

export function searchHref(q: string, type?: string | null) {
  const query = new URLSearchParams({ q });
  if (type) query.set("type", type);
  return resolve(`/search?${query}` as "/");
}
