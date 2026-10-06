import { registerIntegration } from "$lib/server/connections/registry";
import { registerFinanceProvider } from "$lib/server/finance/providers";
import { keptIntegration } from "./adapter";
import { KIND } from "./connection";
import { startKeptScheduler, type SchedulerOptions } from "./scheduler";
import { syncConnection } from "./sync";

/**
 * Wires the Kept adapter into the app at startup: the per-person connection
 * settings (`/integrations/kept`, category and account pickers), the finance
 * provider behind `POST /finance/sync` and the scheduler that syncs every
 * connection. Everything is inert until a person saves a connection. Returns a
 * function that undoes it.
 */
export function registerKept(
  options: { scheduler?: SchedulerOptions } = {},
): () => void {
  const offIntegration = registerIntegration(keptIntegration);
  const offProvider = registerFinanceProvider({
    kind: KIND,
    sync: (ctx, row) => syncConnection(ctx, row),
  });
  const stopScheduler = startKeptScheduler(options.scheduler);
  return () => {
    stopScheduler();
    offProvider();
    offIntegration();
  };
}

export { keptIntegration } from "./adapter";
export { startKeptScheduler, type SchedulerOptions } from "./scheduler";
export { syncConnection } from "./sync";
export { keptConfigSchema, type KeptConfig } from "./config";
export {
  DEFAULT_PAGE_SIZE,
  DEFAULT_TIMEOUT_MS,
  KeptClient,
  MAX_JSON_BYTES,
  MAX_LIMIT,
  normalizeBaseUrl,
  validateLinkInput,
  type BillQuery,
  type KeptClientOptions,
  type LinkInput,
  type TransactionQuery,
} from "./client";
export {
  KEPT_ERROR_CODES,
  KeptError,
  describeError,
  errorCode,
  messageForCode,
  type KeptErrorCode,
} from "./errors";
export {
  DEFAULT_ASSET_MIN_PRICE_MINOR,
  SEED_TEXT_MAX,
  billTitle,
  billToTaskSeed,
  taskStatusOf,
  transactionToAssetSuggestion,
  transactionToCostSeed,
  type AssetSuggestion,
  type AssetSuggestionOptions,
  type CostSeed,
  type TaskSeed,
  type TaskSeedStatus,
} from "./mappers";
export { parseRetryAfter, withRetry, type RetryOptions } from "./retry";
export {
  BILL_QUERY_STATUSES,
  BILL_STATUSES,
  KEPT_SCOPES,
  missingScopes,
  type BillQueryStatus,
  type BillStatus,
  type KeptAccount,
  type KeptBill,
  type KeptCategory,
  type KeptLink,
  type KeptMe,
  type KeptPage,
  type KeptRecurringSeries,
  type KeptScope,
  type KeptTransaction,
  type LinkEntityType,
  type SeriesStatus,
} from "./schemas";
