import { z } from "zod";
import {
  INSURANCE_PREMIUM_PERIODS,
  INSURANCE_RENEWALS,
  INSURANCE_TYPES,
} from "../enums";
import { assetKindSchema } from "./assets";
import {
  atLeastOne,
  dateSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
  queryBooleanSchema,
} from "./common";
import { minorAmountSchema } from "./fields";
import { currencySchema } from "./household";

export const insuranceTypeSchema = z.enum(INSURANCE_TYPES);
export const insurancePremiumPeriodSchema = z.enum(INSURANCE_PREMIUM_PERIODS);
export const insuranceRenewalSchema = z.enum(INSURANCE_RENEWALS);

/** How far ahead a notice period can reach (10 years). */
export const MAX_NOTICE_MONTHS = 120;
export const MAX_POLICY_ASSETS = 50;

export const insurancePolicyAssetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: assetKindSchema,
  })
  .meta({ id: "InsurancePolicyAsset" });

export const insurancePolicySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    type: insuranceTypeSchema,
    insurerContactId: z.string().nullable(),
    /** The name of the insurer's contact; null without one. */
    insurerName: z.string().nullable(),
    policyNumber: z.string().nullable(),
    /** The premium of one period (`premiumPeriod`), in minor units of `currency`. */
    premiumMinor: z.number().int(),
    currency: z.string(),
    premiumPeriod: insurancePremiumPeriodSchema,
    /** `premiumMinor` times the periods in a year (12, 4, 2, 1), exact. */
    annualPremiumMinor: z.number().int(),
    /** What is paid in a claim before the insurer pays, in minor units of `currency`. */
    deductibleMinor: z.number().int().nullable(),
    startDate: dateSchema,
    /** The last day of cover of the current term; null = open-ended. */
    endDate: dateSchema.nullable(),
    renewal: insuranceRenewalSchema,
    cancellationNoticeMonths: z.number().int().nullable(),
    /**
     * The last day on which a cancellation still ends the contract at `endDate`: `endDate` minus
     * `cancellationNoticeMonths` months (clamped to the end of the month). Null unless `renewal`
     * is `auto` and both the end date and the notice period are set. Derived, never stored.
     */
    cancellationDeadline: dateSchema.nullable(),
    assistancePhone: z.string().nullable(),
    showOnEmergency: z.boolean(),
    notes: z.string().nullable(),
    /** What the policy covers, by name. */
    assets: z.array(insurancePolicyAssetSchema),
    /** The task that reminds the household of the cancellation deadline, while there is one. */
    reminderTaskId: z.string().nullable(),
    commentCount: z.number().int(),
    archivedAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "InsurancePolicy" });
export type InsurancePolicy = z.infer<typeof insurancePolicySchema>;

/**
 * Active policies unless `archived=true`, which lists the archived ones only. `q` matches the title,
 * the policy number and the insurer's name. Sorted by cancellation deadline (none last), then title.
 */
export const listInsurancePoliciesQuerySchema = paginationQuerySchema.extend({
  assetId: idSchema.optional(),
  type: insuranceTypeSchema.optional(),
  archived: queryBooleanSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export const listInsurancePoliciesResponseSchema = paginated(
  insurancePolicySchema,
);

export const assetInsurancePoliciesQuerySchema = paginationQuerySchema.extend({
  archived: queryBooleanSchema.optional(),
});

const policyFields = {
  title: z.string().trim().min(1).max(200),
  type: insuranceTypeSchema,
  insurerContactId: idSchema.nullable(),
  policyNumber: nullableText(100),
  premiumMinor: minorAmountSchema,
  currency: currencySchema,
  premiumPeriod: insurancePremiumPeriodSchema,
  deductibleMinor: minorAmountSchema.nullable(),
  startDate: dateSchema,
  endDate: dateSchema.nullable(),
  renewal: insuranceRenewalSchema,
  cancellationNoticeMonths: z
    .number()
    .int()
    .min(0)
    .max(MAX_NOTICE_MONTHS)
    .nullable(),
  assistancePhone: nullableText(60),
  showOnEmergency: z.boolean(),
  notes: nullableText(10_000),
  assetIds: z.array(idSchema).max(MAX_POLICY_ASSETS),
};

const endsAfterStart = (v: { startDate?: string; endDate?: string | null }) =>
  v.startDate === undefined ||
  v.endDate === undefined ||
  v.endDate === null ||
  v.endDate >= v.startDate;
const endsAfterStartMessage = {
  error: "The end date must not be before the start date.",
  path: ["endDate"],
};

/** `currency` defaults to the household's, `premiumPeriod` to `annual`, `renewal` to `auto`. */
export const createInsurancePolicyRequestSchema = z
  .strictObject({
    title: policyFields.title,
    type: policyFields.type.default("other"),
    insurerContactId: policyFields.insurerContactId.optional(),
    policyNumber: policyFields.policyNumber.optional(),
    premiumMinor: policyFields.premiumMinor,
    currency: policyFields.currency.optional(),
    premiumPeriod: policyFields.premiumPeriod.default("annual"),
    deductibleMinor: policyFields.deductibleMinor.optional(),
    startDate: policyFields.startDate,
    endDate: policyFields.endDate.optional(),
    renewal: policyFields.renewal.default("auto"),
    cancellationNoticeMonths: policyFields.cancellationNoticeMonths.optional(),
    assistancePhone: policyFields.assistancePhone.optional(),
    showOnEmergency: policyFields.showOnEmergency.default(false),
    notes: policyFields.notes.optional(),
    assetIds: policyFields.assetIds.default([]),
  })
  .refine(endsAfterStart, endsAfterStartMessage);
export type CreateInsurancePolicyRequest = z.output<
  typeof createInsurancePolicyRequestSchema
>;

/** `assetIds` replaces the whole list of covered assets; `archived` archives or restores. */
export const updateInsurancePolicyRequestSchema = atLeastOne(
  z
    .strictObject({
      title: policyFields.title.optional(),
      type: policyFields.type.optional(),
      insurerContactId: policyFields.insurerContactId.optional(),
      policyNumber: policyFields.policyNumber.optional(),
      premiumMinor: policyFields.premiumMinor.optional(),
      currency: policyFields.currency.optional(),
      premiumPeriod: policyFields.premiumPeriod.optional(),
      deductibleMinor: policyFields.deductibleMinor.optional(),
      startDate: policyFields.startDate.optional(),
      endDate: policyFields.endDate.optional(),
      renewal: policyFields.renewal.optional(),
      cancellationNoticeMonths:
        policyFields.cancellationNoticeMonths.optional(),
      assistancePhone: policyFields.assistancePhone.optional(),
      showOnEmergency: policyFields.showOnEmergency.optional(),
      notes: policyFields.notes.optional(),
      assetIds: policyFields.assetIds.optional(),
      archived: z.boolean().optional(),
    })
    .refine(endsAfterStart, endsAfterStartMessage),
);
export type UpdateInsurancePolicyRequest = z.output<
  typeof updateInsurancePolicyRequestSchema
>;
