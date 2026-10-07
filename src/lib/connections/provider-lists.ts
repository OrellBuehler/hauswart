import { api } from "$lib/api/browser";
import type { DocumentProviderKind } from "$lib/api/enums";
import { endpoints } from "$lib/api/registry";
import { m } from "$lib/paraglide/messages";

/** The lists a document system offers to choose from; each is `GET /integrations/{kind}/<source>`. */
export const PICKER_SOURCES = [
  "tags",
  "correspondents",
  "custom-fields",
  "groups",
  "storage-paths",
] as const;
export type PickerSource = (typeof PICKER_SOURCES)[number];

export interface PickerItem {
  id: number;
  name: string;
  /** A second line: how many documents, the field type, the path. */
  detail: string | null;
  /** Custom fields only: `date`, `string`, `monetary`, ... */
  dataType: string | null;
}

const TTL_MS = 60_000;

/** One request for a list, optionally narrowed by the system to names containing `q`. */
export async function fetchPickerItems(
  kind: DocumentProviderKind,
  source: PickerSource,
  q?: string,
): Promise<PickerItem[]> {
  const params = { kind };
  const query = q ? { q } : {};
  const count = (n: number | null) =>
    n === null ? null : m.picker_document_count({ count: n });
  switch (source) {
    case "tags": {
      const { items } = await api.call(endpoints.integrationsTags, {
        params,
        query,
      });
      return items.map((i) => ({
        id: i.id,
        name: i.name,
        detail: count(i.documentCount),
        dataType: null,
      }));
    }
    case "correspondents": {
      const { items } = await api.call(endpoints.integrationsCorrespondents, {
        params,
        query,
      });
      return items.map((i) => ({
        id: i.id,
        name: i.name,
        detail: count(i.documentCount),
        dataType: null,
      }));
    }
    case "custom-fields": {
      const { items } = await api.call(endpoints.integrationsCustomFields, {
        params,
        query,
      });
      return items.map((i) => ({
        id: i.id,
        name: i.name,
        detail: i.dataType,
        dataType: i.dataType,
      }));
    }
    case "groups": {
      const { items } = await api.call(endpoints.integrationsGroups, {
        params,
        query,
      });
      return items.map((i) => ({
        id: i.id,
        name: i.name,
        detail: null,
        dataType: null,
      }));
    }
    case "storage-paths": {
      const { items } = await api.call(endpoints.integrationsStoragePaths, {
        params,
        query,
      });
      return items.map((i) => ({
        id: i.id,
        name: i.name,
        detail: i.path,
        dataType: null,
      }));
    }
  }
}

const cache = new Map<string, { at: number; promise: Promise<PickerItem[]> }>();

/**
 * The whole list of a source, shared between the pickers of a form for a minute (four of them choose
 * tags, two choose date fields), so that opening the settings asks the system once per list.
 */
export function loadAllPickerItems(
  kind: DocumentProviderKind,
  source: PickerSource,
): Promise<PickerItem[]> {
  const key = `${kind}:${source}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetchPickerItems(kind, source);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

/** Forget the lists (the connection was saved, tested or removed). */
export function forgetPickerItems(): void {
  cache.clear();
}
