import type {
  AssetKind,
  InsurancePremiumPeriod,
  InsuranceRenewal,
  InsuranceType,
} from "$lib/api/enums";
import type { Asset } from "$lib/api/schemas/assets";
import {
  MAX_NOTICE_MONTHS,
  createInsurancePolicyRequestSchema,
  updateInsurancePolicyRequestSchema,
  type CreateInsurancePolicyRequest,
  type InsurancePolicy,
  type UpdateInsurancePolicyRequest,
} from "$lib/api/schemas/insurance";
import { currencySchema } from "$lib/api/schemas/household";
import { isValidDate } from "$lib/dates";
import { readMoney } from "$lib/format-money";
import { currencyExponent, minor, toDecimalString } from "$lib/money";
import { m } from "$lib/paraglide/messages";
import { issuesToErrors } from "$lib/tasks/field-errors";
import { cancellationDeadline } from "./policy";

/** What the form edits. Text fields stay text until they are checked on submit. */
export type PolicyDraft = {
  title: string;
  type: InsuranceType;
  insurerContactId: string | null;
  policyNumber: string;
  /** The premium of one period as typed. */
  premium: string;
  currency: string;
  premiumPeriod: InsurancePremiumPeriod;
  deductible: string;
  startDate: string;
  endDate: string;
  renewal: InsuranceRenewal;
  noticeMonths: string;
  assistancePhone: string;
  showOnEmergency: boolean;
  notes: string;
  assetIds: string[];
};

export type NewDraftDefaults = {
  today: string;
  /** The household's currency. */
  currency: string;
  type?: InsuranceType | undefined;
  assetIds?: string[] | undefined;
  insurerContactId?: string | null | undefined;
};

export function newDraft(defaults: NewDraftDefaults): PolicyDraft {
  return {
    title: "",
    type: defaults.type ?? "other",
    insurerContactId: defaults.insurerContactId ?? null,
    policyNumber: "",
    premium: "",
    currency: defaults.currency,
    premiumPeriod: "annual",
    deductible: "",
    startDate: defaults.today,
    endDate: "",
    renewal: "auto",
    noticeMonths: "",
    assistancePhone: "",
    showOnEmergency: false,
    notes: "",
    assetIds: [...(defaults.assetIds ?? [])],
  };
}

function amountText(valueMinor: number | null, currency: string): string {
  return valueMinor === null
    ? ""
    : toDecimalString(minor(valueMinor), currencyExponent(currency));
}

export function draftFromPolicy(policy: InsurancePolicy): PolicyDraft {
  return {
    title: policy.title,
    type: policy.type,
    insurerContactId: policy.insurerContactId,
    policyNumber: policy.policyNumber ?? "",
    premium: amountText(policy.premiumMinor, policy.currency),
    currency: policy.currency,
    premiumPeriod: policy.premiumPeriod,
    deductible: amountText(policy.deductibleMinor, policy.currency),
    startDate: policy.startDate,
    endDate: policy.endDate ?? "",
    renewal: policy.renewal,
    noticeMonths:
      policy.cancellationNoticeMonths === null
        ? ""
        : String(policy.cancellationNoticeMonths),
    assistancePhone: policy.assistancePhone ?? "",
    showOnEmergency: policy.showOnEmergency,
    notes: policy.notes ?? "",
    assetIds: policy.assets.map((asset) => asset.id),
  };
}

function nullable(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** The notice period as a whole number of months, null when empty, undefined when it is not a number. */
export function parseNoticeMonths(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number(trimmed);
}

/**
 * The last day a cancellation still counts, from the terms as typed: what the server derives from
 * the same three fields. Null while they do not give one (fixed term, no end date, no notice period,
 * or text that is not a date or a number).
 */
export function draftDeadline(
  draft: Pick<PolicyDraft, "renewal" | "endDate" | "noticeMonths">,
): string | null {
  const months = parseNoticeMonths(draft.noticeMonths);
  if (
    months === undefined ||
    months === null ||
    months > MAX_NOTICE_MONTHS ||
    !isValidDate(draft.endDate)
  ) {
    return null;
  }
  return cancellationDeadline({
    renewal: draft.renewal,
    endDate: draft.endDate,
    cancellationNoticeMonths: months,
  });
}

export type BuiltBody<T> = {
  body: T | undefined;
  errors: Record<string, string>;
};

type Candidate = {
  title: string;
  type: InsuranceType;
  insurerContactId: string | null;
  policyNumber: string | null;
  premiumMinor: number | undefined;
  currency: string;
  premiumPeriod: InsurancePremiumPeriod;
  deductibleMinor: number | null | undefined;
  startDate: string;
  endDate: string | null;
  renewal: InsuranceRenewal;
  cancellationNoticeMonths: number | null | undefined;
  assistancePhone: string | null;
  showOnEmergency: boolean;
  notes: string | null;
  assetIds: string[];
};

function check(draft: PolicyDraft): {
  candidate: Candidate;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  if (!draft.title.trim()) errors.title = m.field_required();

  const currencyOk = currencySchema.safeParse(draft.currency).success;
  if (!currencyOk) errors.currency = m.cost_currency_invalid();

  let premiumMinor: number | undefined;
  let deductibleMinor: number | null | undefined = null;
  if (currencyOk) {
    const premium = readMoney(draft.premium, draft.currency);
    if (premium === null) errors.premiumMinor = m.field_required();
    else if (premium === undefined) {
      errors.premiumMinor = m.cost_amount_invalid({
        decimals: currencyExponent(draft.currency),
      });
    } else premiumMinor = premium;

    deductibleMinor = readMoney(draft.deductible, draft.currency);
    if (deductibleMinor === undefined) {
      errors.deductibleMinor = m.cost_amount_invalid({
        decimals: currencyExponent(draft.currency),
      });
    }
  }

  if (!draft.startDate) errors.startDate = m.field_required();
  else if (!isValidDate(draft.startDate)) {
    errors.startDate = m.field_invalid_date();
  }
  const endDate = draft.endDate === "" ? null : draft.endDate;
  if (endDate !== null && !isValidDate(endDate)) {
    errors.endDate = m.field_invalid_date();
  } else if (
    endDate !== null &&
    isValidDate(draft.startDate) &&
    endDate < draft.startDate
  ) {
    errors.endDate = m.insurance_error_end_before_start();
  }

  const noticeMonths = parseNoticeMonths(draft.noticeMonths);
  if (noticeMonths === undefined) {
    errors.cancellationNoticeMonths = m.field_number();
  } else if (noticeMonths !== null && noticeMonths > MAX_NOTICE_MONTHS) {
    errors.cancellationNoticeMonths = m.field_max({ max: MAX_NOTICE_MONTHS });
  }

  return {
    candidate: {
      title: draft.title.trim(),
      type: draft.type,
      insurerContactId: draft.insurerContactId,
      policyNumber: nullable(draft.policyNumber),
      premiumMinor,
      currency: draft.currency,
      premiumPeriod: draft.premiumPeriod,
      deductibleMinor,
      startDate: draft.startDate,
      endDate,
      renewal: draft.renewal,
      cancellationNoticeMonths: noticeMonths,
      assistancePhone: nullable(draft.assistancePhone),
      showOnEmergency: draft.showOnEmergency,
      notes: nullable(draft.notes),
      assetIds: [...draft.assetIds],
    },
    errors,
  };
}

/** The request for a new policy, or the errors that stop it. */
export function buildCreateBody(
  draft: PolicyDraft,
): BuiltBody<CreateInsurancePolicyRequest> {
  const { candidate, errors } = check(draft);
  if (Object.keys(errors).length > 0) return { body: undefined, errors };
  const result = createInsurancePolicyRequestSchema.safeParse(candidate);
  if (!result.success) {
    return {
      body: undefined,
      errors: issuesToErrors(result.error.issues, candidate),
    };
  }
  return { body: result.data, errors };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/**
 * The request that changes `policy` into the draft, with only what differs. An empty body means
 * nothing changed.
 */
export function buildUpdateBody(
  draft: PolicyDraft,
  policy: InsurancePolicy,
): BuiltBody<UpdateInsurancePolicyRequest> {
  const { candidate, errors } = check(draft);
  if (Object.keys(errors).length > 0) return { body: undefined, errors };

  const patch: Record<string, unknown> = {};
  const before = {
    title: policy.title,
    type: policy.type,
    insurerContactId: policy.insurerContactId,
    policyNumber: policy.policyNumber,
    premiumMinor: policy.premiumMinor,
    currency: policy.currency,
    premiumPeriod: policy.premiumPeriod,
    deductibleMinor: policy.deductibleMinor,
    startDate: policy.startDate,
    endDate: policy.endDate,
    renewal: policy.renewal,
    cancellationNoticeMonths: policy.cancellationNoticeMonths,
    assistancePhone: policy.assistancePhone,
    showOnEmergency: policy.showOnEmergency,
    notes: policy.notes,
  } as const;
  for (const key of Object.keys(before) as (keyof typeof before)[]) {
    if (candidate[key] !== before[key]) patch[key] = candidate[key];
  }
  if (
    !sameIds(
      candidate.assetIds,
      policy.assets.map((asset) => asset.id),
    )
  ) {
    patch.assetIds = candidate.assetIds;
  }

  if (Object.keys(patch).length === 0) return { body: {}, errors };
  const result = updateInsurancePolicyRequestSchema.safeParse(patch);
  if (!result.success) {
    return {
      body: undefined,
      errors: issuesToErrors(result.error.issues, patch),
    };
  }
  return { body: result.data, errors };
}

export type PickerAsset = {
  id: string;
  name: string;
  kind: AssetKind;
  roomName: string | null;
};

/**
 * What a policy can cover: the active assets, by name, plus those a policy already covers even if
 * they were archived since (so saving the form never drops them silently).
 */
export function coverableAssets(
  assets: readonly Pick<
    Asset,
    "id" | "name" | "kind" | "roomName" | "archivedAt"
  >[],
  policy?: Pick<InsurancePolicy, "assets"> | undefined,
): PickerAsset[] {
  const covered = new Set(policy?.assets.map((asset) => asset.id));
  const items: PickerAsset[] = assets
    .filter((asset) => asset.archivedAt === null || covered.has(asset.id))
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      roomName: asset.roomName,
    }));
  const known = new Set(items.map((asset) => asset.id));
  for (const asset of policy?.assets ?? []) {
    if (!known.has(asset.id)) {
      items.push({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        roomName: null,
      });
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}
