import { z } from "zod";
import { INSURANCE_TYPES } from "../../../src/lib/api/enums";
import { endpoints } from "../../../src/lib/api/registry";
import type { InsurancePolicy } from "../../../src/lib/api/schemas/insurance";
import { moreHint, plural } from "../format";
import { defineTool } from "../tool";
import { attachmentRows } from "./attachments";
import { resolvePolicy } from "./resolve";

const policyRow = (p: InsurancePolicy) => ({
  id: p.id,
  title: p.title,
  type: p.type,
  insurer: p.insurerName,
  policyNumber: p.policyNumber,
  premiumMinor: p.premiumMinor,
  premiumPeriod: p.premiumPeriod,
  annualPremiumMinor: p.annualPremiumMinor,
  currency: p.currency,
  deductibleMinor: p.deductibleMinor,
  start: p.startDate,
  end: p.endDate,
  renewal: p.renewal,
  noticeMonths: p.cancellationNoticeMonths,
  cancellationDeadline: p.cancellationDeadline,
  assets: p.assets.map((a) => a.name),
  archived: p.archivedAt ? true : null,
});

export const listInsurancePolicies = defineTool({
  name: "list_insurance_policies",
  title: "List insurance policies",
  description:
    "The household's insurance policies (car liability and casco, contents, personal liability, building, legal, travel, health, life ...), soonest cancellation deadline first, those without one last. Amounts are minor units of the currency (cents/Rappen; 48000 = 480.00); annualPremiumMinor is the premium of a whole year whatever the payment period. cancellationDeadline is the last day to cancel a policy that renews by itself. Filter by asset (id or name, for what it covers), type, q (title, policy number, insurer) or archived: true. Read one in full with get_insurance_policy.",
  mode: "read",
  input: {
    asset: z.string().min(1).max(120).optional(),
    type: z.enum(INSURANCE_TYPES).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    archived: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    const asset = args.asset ? await ctx.resolveAsset(args.asset) : undefined;
    const page = await ctx.api.call(endpoints.insurancePoliciesList, {
      query: {
        assetId: asset?.id,
        type: args.type,
        q: args.q,
        archived:
          args.archived === undefined
            ? undefined
            : args.archived
              ? "true"
              : "false",
        cursor: args.cursor,
        limit: args.limit,
      },
    });
    return {
      summary: `${plural(page.items.length, "insurance policy", "insurance policies")}${asset ? ` covering ${asset.name}` : ""}.${moreHint(page.nextCursor)}`,
      data: {
        policies: page.items.map(policyRow),
        nextCursor: page.nextCursor,
      },
    };
  },
});

export const getInsurancePolicy = defineTool({
  name: "get_insurance_policy",
  title: "Get an insurance policy",
  description:
    "One insurance policy in full: insurer, policy number, premium and deductible, term, notice period and cancellation deadline, what it covers, the assistance phone number, notes and the names of attached files. policy is the id, the title or the policy number.",
  mode: "read",
  input: {
    policy: z
      .string()
      .min(1)
      .max(160)
      .describe("Policy id, title or policy number"),
  },
  async handler({ policy: ref }, ctx) {
    const policy = await resolvePolicy(ctx, ref);
    const attachments = await attachmentRows(
      ctx,
      "insurance_policy",
      policy.id,
    );
    return {
      summary: `${policy.title}${policy.insurerName ? ` (${policy.insurerName})` : ""}: ${policy.cancellationDeadline ? `cancel by ${policy.cancellationDeadline}` : policy.endDate ? `runs until ${policy.endDate}` : "no end date"}.`,
      data: {
        ...policyRow(policy),
        assistancePhone: policy.assistancePhone,
        showOnEmergency: policy.showOnEmergency ? true : null,
        comments: policy.commentCount || null,
        notes: policy.notes,
        attachments,
      },
    };
  },
});

export const insuranceTools = [listInsurancePolicies, getInsurancePolicy];
