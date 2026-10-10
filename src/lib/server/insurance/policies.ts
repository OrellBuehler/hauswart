import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AssetKind, InsuranceType } from "$lib/api/enums";
import type {
  CreateInsurancePolicyRequest,
  UpdateInsurancePolicyRequest,
} from "$lib/api/schemas/insurance";
import {
  annualPremiumMinor,
  cancellationDeadline,
} from "$lib/insurance/policy";
import { minor } from "$lib/money";
import {
  assets,
  contacts,
  insurancePolicies,
  insurancePolicyAssets,
  tasks,
  type DB,
} from "$lib/server/db";
import { removeOwnedAttachments } from "$lib/server/attachments/attachments";
import { commentCountSql } from "$lib/server/comments/counts";
import { getHousehold } from "$lib/server/household/household";
import { paginateArray } from "$lib/server/pagination";
import {
  invalidField,
  notFound,
  type ServiceContext,
} from "$lib/server/service";
import { deleteTask } from "$lib/server/tasks/tasks";
import {
  INSURANCE_EXTERNAL_SOURCE,
  reminderRefPrefix,
  syncReminder,
} from "./reminder";

type Db = Pick<ServiceContext, "db">;

export type PolicyRow = typeof insurancePolicies.$inferSelect;

export interface PolicyAsset {
  id: string;
  name: string;
  kind: AssetKind;
}

export interface PolicyRecord extends PolicyRow {
  insurerName: string | null;
  assets: PolicyAsset[];
  annualPremiumMinor: number;
  cancellationDeadline: string | null;
  reminderTaskId: string | null;
  commentCount: number;
}

const selectPolicies = (db: DB) =>
  db
    .select({
      policy: insurancePolicies,
      insurerName: contacts.name,
      reminderTaskId: sql<
        string | null
      >`(select id from tasks where tasks.external_source = ${INSURANCE_EXTERNAL_SOURCE} and tasks.external_ref = ${insurancePolicies.id} and tasks.archived_at is null)`,
      commentCount: commentCountSql("insurance_policy", insurancePolicies.id),
    })
    .from(insurancePolicies)
    .leftJoin(contacts, eq(contacts.id, insurancePolicies.insurerContactId));

type Joined = {
  policy: PolicyRow;
  insurerName: string | null;
  reminderTaskId: string | null;
  commentCount: number;
};

const toRecord = (j: Joined, covered: PolicyAsset[]): PolicyRecord => ({
  ...j.policy,
  insurerName: j.insurerName,
  assets: covered,
  annualPremiumMinor: annualPremiumMinor(
    j.policy.premiumMinor,
    j.policy.premiumPeriod,
  ),
  cancellationDeadline: cancellationDeadline(j.policy),
  reminderTaskId: j.reminderTaskId,
  commentCount: Number(j.commentCount),
});

/** What each policy covers, by asset name. */
function assetsOf(db: DB, policyIds: string[]): Map<string, PolicyAsset[]> {
  const byPolicy = new Map<string, PolicyAsset[]>();
  if (policyIds.length === 0) return byPolicy;
  const rows = db
    .select({
      policyId: insurancePolicyAssets.policyId,
      id: assets.id,
      name: assets.name,
      kind: assets.kind,
    })
    .from(insurancePolicyAssets)
    .innerJoin(assets, eq(assets.id, insurancePolicyAssets.assetId))
    .where(inArray(insurancePolicyAssets.policyId, policyIds))
    .orderBy(asc(sql`lower(${assets.name})`), asc(assets.id))
    .all();
  for (const { policyId, ...asset } of rows) {
    const list = byPolicy.get(policyId) ?? [];
    list.push(asset);
    byPolicy.set(policyId, list);
  }
  return byPolicy;
}

export interface PolicyFilter {
  assetId?: string;
  type?: InsuranceType;
  /** Only archived policies; otherwise only active ones. */
  archived?: boolean;
  /** Text in the title, the policy number or the insurer's name. */
  q?: string;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The policies whose cancellation deadline comes first, then by title; those without a deadline last. */
function comparePolicies(
  a: { policy: PolicyRow; deadline: string | null },
  b: { policy: PolicyRow; deadline: string | null },
): number {
  return (
    (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31") ||
    a.policy.title.localeCompare(b.policy.title, "de") ||
    a.policy.id.localeCompare(b.policy.id)
  );
}

export function listPolicies(
  ctx: Db,
  filter: PolicyFilter,
  page: { cursor?: string; limit: number },
) {
  const where: SQL[] = [
    filter.archived
      ? isNotNull(insurancePolicies.archivedAt)
      : isNull(insurancePolicies.archivedAt),
  ];
  if (filter.type) where.push(eq(insurancePolicies.type, filter.type));
  if (filter.assetId) {
    where.push(
      inArray(
        insurancePolicies.id,
        ctx.db
          .select({ id: insurancePolicyAssets.policyId })
          .from(insurancePolicyAssets)
          .where(eq(insurancePolicyAssets.assetId, filter.assetId)),
      ),
    );
  }
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q.toLowerCase())}%`;
    const match = (column: Parameters<typeof like>[0]) =>
      sql`lower(${column}) like ${pattern} escape '\\'`;
    where.push(
      or(
        match(insurancePolicies.title),
        match(insurancePolicies.policyNumber),
        match(contacts.name),
      ) as SQL,
    );
  }
  const rows = selectPolicies(ctx.db)
    .where(and(...where))
    .all()
    .map((j) => ({ ...j, deadline: cancellationDeadline(j.policy) }))
    .sort((a, b) => comparePolicies(a, b));
  const paged = paginateArray(rows, page.cursor, page.limit);
  const covered = assetsOf(
    ctx.db,
    paged.items.map((j) => j.policy.id),
  );
  return {
    items: paged.items.map((j) => toRecord(j, covered.get(j.policy.id) ?? [])),
    nextCursor: paged.nextCursor,
  };
}

export function getPolicy(ctx: Db, id: string): PolicyRecord {
  const row = selectPolicies(ctx.db).where(eq(insurancePolicies.id, id)).get();
  if (!row) throw notFound("Insurance policy");
  return toRecord(row, assetsOf(ctx.db, [id]).get(id) ?? []);
}

/** The policies that cover one asset (404 for an unknown asset). */
export function listAssetPolicies(
  ctx: Db,
  assetId: string,
  filter: { archived?: boolean },
  page: { cursor?: string; limit: number },
) {
  const hit = ctx.db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  if (!hit) throw notFound("Asset");
  return listPolicies(ctx, { assetId, archived: filter.archived }, page);
}

function assertRefs(
  ctx: Db,
  refs: { insurerContactId?: string | null; assetIds?: string[] },
) {
  if (refs.insurerContactId) {
    const hit = ctx.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, refs.insurerContactId))
      .get();
    if (!hit) throw invalidField("insurerContactId", "Contact does not exist");
  }
  if (refs.assetIds && refs.assetIds.length > 0) {
    const found = new Set(
      ctx.db
        .select({ id: assets.id })
        .from(assets)
        .where(inArray(assets.id, refs.assetIds))
        .all()
        .map((a) => a.id),
    );
    if (refs.assetIds.some((id) => !found.has(id))) {
      throw invalidField("assetIds", "Asset does not exist");
    }
  }
}

function replaceAssets(db: DB, policyId: string, assetIds: string[]) {
  db.delete(insurancePolicyAssets)
    .where(eq(insurancePolicyAssets.policyId, policyId))
    .run();
  const unique = [...new Set(assetIds)];
  if (unique.length === 0) return;
  db.insert(insurancePolicyAssets)
    .values(unique.map((assetId) => ({ policyId, assetId })))
    .run();
}

const optionalMinor = (value: number | null | undefined) =>
  value === undefined || value === null ? null : minor(value);

export async function createPolicy(
  ctx: ServiceContext,
  input: CreateInsurancePolicyRequest,
): Promise<PolicyRecord> {
  assertRefs(ctx, input);
  const id = ctx.db.transaction((tx) => {
    const row = tx
      .insert(insurancePolicies)
      .values({
        title: input.title,
        type: input.type,
        insurerContactId: input.insurerContactId ?? null,
        policyNumber: input.policyNumber ?? null,
        premiumMinor: minor(input.premiumMinor),
        currency: input.currency ?? getHousehold(ctx).currency,
        premiumPeriod: input.premiumPeriod,
        deductibleMinor: optionalMinor(input.deductibleMinor),
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        renewal: input.renewal,
        cancellationNoticeMonths: input.cancellationNoticeMonths ?? null,
        assistancePhone: input.assistancePhone ?? null,
        showOnEmergency: input.showOnEmergency,
        notes: input.notes ?? null,
      })
      .returning({ id: insurancePolicies.id })
      .get();
    replaceAssets(tx as unknown as DB, row.id, input.assetIds);
    return row.id;
  });
  await syncReminder(ctx, getPolicy(ctx, id));
  return getPolicy(ctx, id);
}

export async function updatePolicy(
  ctx: ServiceContext,
  id: string,
  patch: UpdateInsurancePolicyRequest,
): Promise<PolicyRecord> {
  const current = getPolicy(ctx, id);
  assertRefs(ctx, patch);
  const startDate = patch.startDate ?? current.startDate;
  const endDate = patch.endDate !== undefined ? patch.endDate : current.endDate;
  if (endDate !== null && endDate < startDate) {
    throw invalidField(
      "endDate",
      "The end date must not be before the start date.",
    );
  }
  const { assetIds, archived, premiumMinor, deductibleMinor, ...fields } =
    patch;
  ctx.db.transaction((tx) => {
    tx.update(insurancePolicies)
      .set({
        ...fields,
        // Also set when only the covered assets change, which touches no column of the row.
        updatedAt: new Date(ctx.now),
        ...(premiumMinor === undefined
          ? {}
          : { premiumMinor: minor(premiumMinor) }),
        ...(deductibleMinor === undefined
          ? {}
          : { deductibleMinor: optionalMinor(deductibleMinor) }),
        ...(archived === undefined
          ? {}
          : {
              archivedAt: archived
                ? (current.archivedAt ?? new Date(ctx.now))
                : null,
            }),
      })
      .where(eq(insurancePolicies.id, id))
      .run();
    if (assetIds !== undefined)
      replaceAssets(tx as unknown as DB, id, assetIds);
  });
  await syncReminder(ctx, getPolicy(ctx, id));
  return getPolicy(ctx, id);
}

/** Removes the policy with its reminder tasks (the finished ones too), comments, document links and attachments. */
export function deletePolicy(
  ctx: Pick<ServiceContext, "db" | "now">,
  id: string,
): void {
  getPolicy(ctx, id);
  ctx.db.transaction((tx) => {
    const reminders = tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.externalSource, INSURANCE_EXTERNAL_SOURCE),
          or(
            eq(tasks.externalRef, id),
            like(tasks.externalRef, `${reminderRefPrefix(id)}%`),
          ),
        ),
      )
      .all();
    for (const task of reminders) {
      deleteTask({ db: tx as unknown as DB, now: ctx.now }, task.id);
    }
    tx.delete(insurancePolicies).where(eq(insurancePolicies.id, id)).run();
  });
  removeOwnedAttachments(ctx, "insurance_policy", id);
}
