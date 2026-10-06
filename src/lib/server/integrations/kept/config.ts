import { z } from "zod";
import { COST_CATEGORIES } from "$lib/api/enums";
import { dateSchema } from "$lib/api/schemas/common";
import { IntegrationError } from "$lib/server/connections/errors";

const categoryId = z.string().trim().min(1).max(128);

/**
 * What a person decides about their Kept connection. Everything is opt-in:
 * nothing is read from a category that is not mapped, and no bill reaches the
 * household unless `billTasks` is on.
 */
export const keptConfigSchema = z.object({
  /** Kept category id -> the cost category its transactions are offered as. */
  categoryMap: z
    .record(categoryId, z.enum(COST_CATEGORIES))
    .refine((m) => Object.keys(m).length <= 200, "At most 200 categories")
    .default({}),
  /** Kept category ids whose outgoing payments are offered as inventory entries. */
  purchaseCategoryIds: z.array(categoryId).max(100).default([]),
  /** Mapped categories whose transactions become cost entries without asking. */
  autoAcceptCategoryIds: z.array(categoryId).max(200).default([]),
  /**
   * Open bills become tasks of this person. The task shows creditor,
   * invoice number, amount and due date to the whole household: switching
   * this on is the consent to that.
   */
  billTasks: z.boolean().default(false),
  /** Only bills of these creditors (case-insensitive, exact name) become tasks; empty = all. */
  billCreditorFilter: z
    .array(z.string().trim().min(1).max(200))
    .max(50)
    .default([]),
  /** Paid invoices (that no mapped transaction already covers) are offered as costs of this category. */
  billCostCategory: z.enum(COST_CATEGORIES).optional(),
  assignBillTasksTo: z.literal("owner").default("owner"),
  /** Earliest booking date to read; default 1 January of the current year. */
  syncFrom: dateSchema.optional(),
});
export type KeptConfig = z.output<typeof keptConfigSchema>;

/** Checks and normalises the settings a person entered; unknown keys are dropped. */
export function parseConfig(raw: Record<string, unknown>): KeptConfig {
  const parsed = keptConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new IntegrationError("invalid_input", "The settings are not valid.");
  }
  const config = parsed.data;
  const mapped = new Set(Object.keys(config.categoryMap));
  if (config.autoAcceptCategoryIds.some((id) => !mapped.has(id))) {
    throw new IntegrationError(
      "invalid_input",
      "Automatic booking is only possible for mapped categories.",
    );
  }
  return {
    ...config,
    purchaseCategoryIds: [...new Set(config.purchaseCategoryIds)],
    autoAcceptCategoryIds: [...new Set(config.autoAcceptCategoryIds)],
    billCreditorFilter: [...new Set(config.billCreditorFilter)],
  };
}

/** The stored settings for a sync run; settings that cannot be read mean "nothing enabled", never a crash. */
export function storedConfig(raw: Record<string, unknown>): KeptConfig {
  try {
    return parseConfig(raw);
  } catch (err) {
    if (!(err instanceof IntegrationError)) throw err;
    console.warn(JSON.stringify({ event: "kept.config_unreadable" }));
    return keptConfigSchema.parse({});
  }
}
