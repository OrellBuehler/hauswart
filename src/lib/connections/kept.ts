import type { z } from "zod";
import { COST_CATEGORIES, type CostCategory } from "$lib/api/enums";
import { isApiError } from "$lib/api/errors";
import type { financeCategorySchema } from "$lib/api/schemas/finance";
import { apiErrorMessage } from "$lib/error-message";
import { m } from "$lib/paraglide/messages";
import { hostOf, integrationErrorMessage } from "./errors";

export type KeptCategory = z.infer<typeof financeCategorySchema>;

/**
 * What a person decides about their Kept connection (the connection's `config`). Everything is
 * opt-in: the defaults read nothing.
 */
export type KeptSettings = {
  /** Kept category id -> the cost category its transactions are offered as. */
  categoryMap: Record<string, CostCategory>;
  /** Kept category ids whose outgoing payments are also offered as devices. */
  purchaseCategoryIds: string[];
  /** Mapped category ids whose transactions are booked without asking. */
  autoAcceptCategoryIds: string[];
  billTasks: boolean;
  /** Creditor names; empty means all creditors. */
  billCreditorFilter: string[];
  /** Cost category for paid invoices, null = they are not offered. */
  billCostCategory: CostCategory | null;
  /** `YYYY-MM-DD`, empty = 1 January of this year. */
  syncFrom: string;
};

/** The limits the server enforces on the settings. */
export const KEPT_LIMITS = {
  categories: 200,
  purchaseCategories: 100,
  creditors: 50,
  creditorLength: 200,
} as const;

const COST_CATEGORY_SET: ReadonlySet<string> = new Set(COST_CATEGORIES);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isCostCategory = (value: unknown): value is CostCategory =>
  typeof value === "string" && COST_CATEGORY_SET.has(value);

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.trim() !== "") seen.add(item.trim());
  }
  return [...seen];
}

/** The settings out of a connection's stored `config`; anything unreadable counts as "not chosen". */
export function readKeptSettings(
  config: Record<string, unknown>,
): KeptSettings {
  const categoryMap: Record<string, CostCategory> = {};
  const rawMap = config.categoryMap;
  if (rawMap !== null && typeof rawMap === "object" && !Array.isArray(rawMap)) {
    for (const [id, category] of Object.entries(rawMap)) {
      if (isCostCategory(category)) categoryMap[id] = category;
    }
  }
  return {
    categoryMap,
    purchaseCategoryIds: strings(config.purchaseCategoryIds),
    autoAcceptCategoryIds: strings(config.autoAcceptCategoryIds).filter(
      (id) => id in categoryMap,
    ),
    billTasks: config.billTasks === true,
    billCreditorFilter: strings(config.billCreditorFilter),
    billCostCategory: isCostCategory(config.billCostCategory)
      ? config.billCostCategory
      : null,
    syncFrom:
      typeof config.syncFrom === "string" && DATE.test(config.syncFrom)
        ? config.syncFrom
        : "",
  };
}

/** The `config` to save: automatic booking only for mapped categories, empty choices left out. */
export function keptConfigOf(settings: KeptSettings): Record<string, unknown> {
  return {
    categoryMap: settings.categoryMap,
    purchaseCategoryIds: settings.purchaseCategoryIds,
    autoAcceptCategoryIds: settings.autoAcceptCategoryIds.filter(
      (id) => id in settings.categoryMap,
    ),
    billTasks: settings.billTasks,
    billCreditorFilter: settings.billCreditorFilter,
    ...(settings.billCostCategory === null
      ? {}
      : { billCostCategory: settings.billCostCategory }),
    ...(settings.syncFrom === "" ? {} : { syncFrom: settings.syncFrom }),
  };
}

/** A string that is equal for settings that mean the same, whatever the order of the lists. */
export function keptSettingsSignature(settings: KeptSettings): string {
  const sorted = (list: string[]) => [...list].sort();
  return JSON.stringify({
    map: Object.entries(settings.categoryMap).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
    purchase: sorted(settings.purchaseCategoryIds),
    auto: sorted(
      settings.autoAcceptCategoryIds.filter((id) => id in settings.categoryMap),
    ),
    billTasks: settings.billTasks,
    creditors: sorted(settings.billCreditorFilter),
    billCost: settings.billCostCategory,
    from: settings.syncFrom,
  });
}

function without(list: string[], id: string): string[] {
  return list.filter((entry) => entry !== id);
}

/** Maps a Kept category to a cost category, or stops reading it (`null`). */
export function withCostCategory(
  settings: KeptSettings,
  id: string,
  category: CostCategory | null,
): KeptSettings {
  const categoryMap = { ...settings.categoryMap };
  if (category === null) delete categoryMap[id];
  else categoryMap[id] = category;
  return {
    ...settings,
    categoryMap,
    autoAcceptCategoryIds:
      category === null
        ? without(settings.autoAcceptCategoryIds, id)
        : settings.autoAcceptCategoryIds,
  };
}

export function withAutoAccept(
  settings: KeptSettings,
  id: string,
  on: boolean,
): KeptSettings {
  const rest = without(settings.autoAcceptCategoryIds, id);
  return {
    ...settings,
    autoAcceptCategoryIds:
      on && id in settings.categoryMap ? [...rest, id] : rest,
  };
}

export function withPurchase(
  settings: KeptSettings,
  id: string,
  on: boolean,
): KeptSettings {
  const rest = without(settings.purchaseCategoryIds, id);
  return { ...settings, purchaseCategoryIds: on ? [...rest, id] : rest };
}

/** Adds a creditor name; a name that is there already (any case) is not added twice. */
export function withCreditor(
  settings: KeptSettings,
  name: string,
): KeptSettings {
  const trimmed = name.trim().slice(0, KEPT_LIMITS.creditorLength);
  if (trimmed === "") return settings;
  const known = settings.billCreditorFilter.some(
    (entry) => entry.toLowerCase() === trimmed.toLowerCase(),
  );
  if (known || settings.billCreditorFilter.length >= KEPT_LIMITS.creditors) {
    return settings;
  }
  return {
    ...settings,
    billCreditorFilter: [...settings.billCreditorFilter, trimmed],
  };
}

export function withoutCreditor(
  settings: KeptSettings,
  name: string,
): KeptSettings {
  return {
    ...settings,
    billCreditorFilter: without(settings.billCreditorFilter, name),
  };
}

export type KeptCategoryRow = {
  id: string;
  /** The category's own name (the id for one Kept no longer shows). */
  name: string;
  /** The names of its parents, "Housing › Rent"; empty at the top. */
  parents: string;
  income: boolean;
  /** False for an id the settings mention but the list from Kept lacks. */
  known: boolean;
};

const MAX_DEPTH = 10;

/**
 * The rows of the category list: expense categories first, then income, each alphabetical by full
 * path; ids the settings mention but Kept does not list (deleted, or hidden from the token) come last
 * so that they can still be dropped.
 */
export function categoryRows(
  categories: readonly KeptCategory[],
  settings: KeptSettings,
): KeptCategoryRow[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parentsOf = (category: KeptCategory): string => {
    const names: string[] = [];
    const seen = new Set([category.id]);
    let parentId = category.parentId;
    while (
      parentId !== null &&
      names.length < MAX_DEPTH &&
      !seen.has(parentId)
    ) {
      const parent = byId.get(parentId);
      if (!parent) break;
      seen.add(parent.id);
      names.unshift(parent.name);
      parentId = parent.parentId;
    }
    return names.join(" › ");
  };
  const rows = categories.map((category) => ({
    id: category.id,
    name: category.name,
    parents: parentsOf(category),
    income: category.kind === "income",
    known: true,
  }));
  const fullPath = (row: KeptCategoryRow) =>
    row.parents === "" ? row.name : `${row.parents} › ${row.name}`;
  rows.sort(
    (a, b) =>
      Number(a.income) - Number(b.income) ||
      fullPath(a).localeCompare(fullPath(b)),
  );
  const missing = [
    ...new Set([
      ...Object.keys(settings.categoryMap),
      ...settings.purchaseCategoryIds,
    ]),
  ]
    .filter((id) => !byId.has(id))
    .sort()
    .map((id) => ({ id, name: id, parents: "", income: false, known: false }));
  return [...rows, ...missing];
}

/** How many categories hauswart reads: mapped ones and those offered as devices. */
export function readCategoryCount(settings: KeptSettings): number {
  return new Set([
    ...Object.keys(settings.categoryMap),
    ...settings.purchaseCategoryIds,
  ]).size;
}

/** The permissions the adapter would use; mirrors what the test reports as missing. */
export const KEPT_SCOPES: ReadonlyArray<{
  id: string;
  label: () => string;
  hint: () => string;
}> = [
  {
    id: "transactions:read",
    label: () => m.integration_kept_scope_transactions(),
    hint: () => m.integration_kept_scope_transactions_hint(),
  },
  {
    id: "bills:read",
    label: () => m.integration_kept_scope_bills(),
    hint: () => m.integration_kept_scope_bills_hint(),
  },
  {
    id: "links:write",
    label: () => m.integration_kept_scope_links(),
    hint: () => m.integration_kept_scope_links_hint(),
  },
  {
    id: "categories:read",
    label: () => m.integration_kept_scope_categories(),
    hint: () => m.integration_kept_scope_categories_hint(),
  },
];

export type KeptTestInfo = {
  currency: string | null;
  /** Permission names the token lacks, as the test reported them. */
  missingScopes: string[];
  /** The token sees only some of the categories. */
  restricted: boolean;
  /** The server does not know its own address (`ORIGIN`), so it cannot link bookings back. */
  backLinksOff: boolean;
};

type TestInfo = Record<string, string | number | boolean | null>;

export function readKeptTestInfo(info: TestInfo | null): KeptTestInfo {
  const missing = info?.missingScopes;
  const currency = info?.defaultCurrency;
  return {
    currency: typeof currency === "string" && currency !== "" ? currency : null,
    missingScopes:
      typeof missing === "string"
        ? missing
            .split(",")
            .map((scope) => scope.trim())
            .filter(Boolean)
        : [],
    restricted: info?.categoryRestricted === true,
    backLinksOff: info?.backLinks === false,
  };
}

const ERRORS: Record<string, () => string> = {
  unauthorized: () => m.integration_kept_error_unauthorized(),
  forbidden: () => m.integration_kept_error_forbidden(),
  not_found: () => m.integration_kept_error_not_found(),
  bad_request: () => m.integration_kept_error_bad_request(),
  redirect: () => m.integration_kept_error_redirect(),
  timeout: () => m.integration_kept_error_timeout(),
  network: () => m.integration_kept_error_network(),
  tls: () => m.integration_kept_error_tls(),
  server: () => m.integration_kept_error_server(),
  invalid_response: () => m.integration_kept_error_invalid_response(),
  too_large: () => m.integration_kept_error_too_large(),
  rate_limited: () => m.integration_kept_error_rate_limited(),
  conflict: () => m.integration_kept_error_conflict(),
  invalid_input: () => m.integration_kept_error_invalid_input(),
};

/** A sentence for the short code of a failed Kept call (`unauthorized`, `tls`, ...). */
export function keptErrorMessage(code: string | null): string {
  return (code && ERRORS[code]?.()) || integrationErrorMessage(code);
}

/** The message for a failed call to Kept itself (a picker): the stored code when Kept failed, else the generic wording. */
export function keptPickerErrorMessage(err: unknown): string {
  if (isApiError(err) && err.code === "upstream_error") {
    const code = (err.details as { code?: unknown } | undefined)?.code;
    if (typeof code === "string") return keptErrorMessage(code);
  }
  return apiErrorMessage(err);
}

/**
 * The message for a 403 when saving a connection: members may only use hosts on the household's
 * list and nobody but administrators the server's own address. Undefined for any other error.
 */
export function keptForbiddenMessage(
  err: unknown,
  baseUrl: string,
): string | undefined {
  if (!isApiError(err) || err.code !== "forbidden") return undefined;
  return m.integration_kept_host_not_allowed({ host: hostOf(baseUrl) });
}

/** Why saving the connection failed: the host rule, a problem with one field, or the generic wording. */
export function keptSaveError(
  err: unknown,
  baseUrl: string,
): { message?: string; fields: Record<string, string> } {
  const forbidden = keptForbiddenMessage(err, baseUrl);
  if (forbidden) return { message: forbidden, fields: {} };
  if (isApiError(err) && err.code === "invalid_request") {
    const fields = (
      err.details as
        { body?: { fieldErrors?: Record<string, unknown> } } | undefined
    )?.body?.fieldErrors;
    if (fields && "baseUrl" in fields) {
      return { fields: { baseUrl: m.integration_kept_url_rejected() } };
    }
    if (fields && "token" in fields) {
      return { fields: { token: m.integration_kept_token_invalid() } };
    }
  }
  return { message: apiErrorMessage(err), fields: {} };
}

const STAT_LINES: ReadonlyArray<[string, (count: number) => string]> = [
  ["suggestions", (count) => m.integration_kept_stat_suggestions({ count })],
  ["autoAccepted", (count) => m.integration_kept_stat_auto_accepted({ count })],
  [
    "assetSuggestions",
    (count) => m.integration_kept_stat_asset_suggestions({ count }),
  ],
  ["tasksCreated", (count) => m.integration_kept_stat_tasks_created({ count })],
  ["tasksUpdated", (count) => m.integration_kept_stat_tasks_updated({ count })],
  [
    "tasksCompleted",
    (count) => m.integration_kept_stat_tasks_completed({ count }),
  ],
  [
    "tasksReopened",
    (count) => m.integration_kept_stat_tasks_reopened({ count }),
  ],
  [
    "tasksArchived",
    (count) => m.integration_kept_stat_tasks_archived({ count }),
  ],
  ["skipped", (count) => m.integration_kept_stat_skipped({ count })],
  ["linksWritten", (count) => m.integration_kept_stat_links_written({ count })],
  ["linksRemoved", (count) => m.integration_kept_stat_links_removed({ count })],
  ["linksFailed", (count) => m.integration_kept_stat_links_failed({ count })],
];

/** What a sync did, one sentence per kind of change that happened (nothing for zero). */
export function syncStatLines(stats: Record<string, number>): string[] {
  return STAT_LINES.flatMap(([key, line]) => {
    const count = stats[key] ?? 0;
    return count > 0 ? [line(count)] : [];
  });
}

/** Whether the sync left something for the person to decide on. */
export function offersWaiting(stats: Record<string, number>): boolean {
  return (stats.suggestions ?? 0) + (stats.assetSuggestions ?? 0) > 0;
}
