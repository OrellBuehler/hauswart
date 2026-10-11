import type { z } from "zod";
import { toIso } from "$lib/api/schemas/common";
import type { insurancePolicySchema } from "$lib/api/schemas/insurance";
import type { endpoints } from "$lib/api/registry";
import {
  createPolicy,
  deletePolicy,
  getPolicy,
  listAssetPolicies,
  listPolicies,
  updatePolicy,
  type PolicyRecord,
} from "$lib/server/insurance/policies";
import type { Handler } from "../bind";

export function wireInsurancePolicy(
  p: PolicyRecord,
): z.input<typeof insurancePolicySchema> {
  return {
    id: p.id,
    title: p.title,
    type: p.type,
    insurerContactId: p.insurerContactId,
    insurerName: p.insurerName,
    policyNumber: p.policyNumber,
    premiumMinor: p.premiumMinor,
    currency: p.currency,
    premiumPeriod: p.premiumPeriod,
    annualPremiumMinor: p.annualPremiumMinor,
    deductibleMinor: p.deductibleMinor,
    startDate: p.startDate,
    endDate: p.endDate,
    renewal: p.renewal,
    cancellationNoticeMonths: p.cancellationNoticeMonths,
    cancellationDeadline: p.cancellationDeadline,
    assistancePhone: p.assistancePhone,
    showOnEmergency: p.showOnEmergency,
    notes: p.notes,
    assets: p.assets,
    reminderTaskId: p.reminderTaskId,
    commentCount: p.commentCount,
    archivedAt: p.archivedAt ? toIso(p.archivedAt) : null,
    createdAt: toIso(p.createdAt),
    updatedAt: toIso(p.updatedAt),
  };
}

export const list: Handler<typeof endpoints.insurancePoliciesList> = ({
  ctx,
  query,
}) => {
  const { cursor, limit, ...filter } = query;
  const page = listPolicies(ctx, filter, { cursor, limit });
  return {
    items: page.items.map(wireInsurancePolicy),
    nextCursor: page.nextCursor,
  };
};

export const create: Handler<
  typeof endpoints.insurancePoliciesCreate
> = async ({ ctx, body }) => wireInsurancePolicy(await createPolicy(ctx, body));

export const get: Handler<typeof endpoints.insurancePoliciesGet> = ({
  ctx,
  params,
}) => wireInsurancePolicy(getPolicy(ctx, params.id));

export const update: Handler<
  typeof endpoints.insurancePoliciesUpdate
> = async ({ ctx, params, body }) =>
  wireInsurancePolicy(await updatePolicy(ctx, params.id, body));

export const remove: Handler<typeof endpoints.insurancePoliciesDelete> = ({
  ctx,
  params,
}) => {
  deletePolicy(ctx, params.id);
  return null;
};

export const listForAsset: Handler<
  typeof endpoints.assetInsurancePoliciesList
> = ({ ctx, params, query }) => {
  const { cursor, limit, ...filter } = query;
  const page = listAssetPolicies(ctx, params.id, filter, { cursor, limit });
  return {
    items: page.items.map(wireInsurancePolicy),
    nextCursor: page.nextCursor,
  };
};
