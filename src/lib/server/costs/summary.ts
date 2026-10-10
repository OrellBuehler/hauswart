import { and, eq, sql } from "drizzle-orm";
import { COST_DEDUCTIBLE, type CostCategory } from "$lib/api/enums";
import type { CostsSummary } from "$lib/api/schemas/costs";
import { assets, costEntries, costEntryShares, users } from "$lib/server/db";
import { getHousehold } from "$lib/server/household/household";
import type { ServiceContext } from "$lib/server/service";
import { clockAt } from "$lib/server/tasks/evaluator";
import { yearRange } from "./costs";
import { amountsFor, type Share } from "./split";

type Db = Pick<ServiceContext, "db">;

export const TOP_ASSETS = 10;
export const DASHBOARD_TOP_CATEGORIES = 3;

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amountMinor: number;
}

/**
 * The payments that square the balances (balance = paid - share; positive =
 * the others owe this person): the largest debtor pays the largest creditor
 * until nothing is left. Balances of one currency add up to zero.
 */
export function settle(
  balances: readonly { userId: string; balanceMinor: number }[],
): Transfer[] {
  const order = (a: { userId: string; left: number }, b: typeof a) =>
    b.left - a.left || a.userId.localeCompare(b.userId);
  const debtors = balances
    .filter((b) => b.balanceMinor < 0)
    .map((b) => ({ userId: b.userId, left: -b.balanceMinor }))
    .sort(order);
  const creditors = balances
    .filter((b) => b.balanceMinor > 0)
    .map((b) => ({ userId: b.userId, left: b.balanceMinor }))
    .sort(order);
  const out: Transfer[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d]!;
    const creditor = creditors[c]!;
    const pay = Math.min(debtor.left, creditor.left);
    out.push({
      fromUserId: debtor.userId,
      toUserId: creditor.userId,
      amountMinor: pay,
    });
    debtor.left -= pay;
    creditor.left -= pay;
    if (debtor.left === 0) d++;
    if (creditor.left === 0) c++;
  }
  return out;
}

interface Tally {
  totalMinor: number;
  count: number;
}

const bump = (map: Map<string, Tally>, key: string, amount: number) => {
  const t = map.get(key) ?? { totalMinor: 0, count: 0 };
  t.totalMinor += amount;
  t.count += 1;
  map.set(key, t);
};

/**
 * The year in numbers. Totals, categories, months, assets and tax classes
 * count entries in the household currency that count as an expense;
 * settlement covers every split entry with a payer (it is about who paid,
 * not about what is an expense). With an `assetId` only the entries of that
 * asset are counted, all of it.
 */
export function costsSummary(
  ctx: Db,
  year: number,
  filter: { assetId?: string } = {},
): CostsSummary {
  const { currency } = getHousehold(ctx);
  const { from, to } = yearRange(year);
  const inYear = and(
    sql`${costEntries.date} >= ${from}`,
    sql`${costEntries.date} <= ${to}`,
    filter.assetId ? eq(costEntries.assetId, filter.assetId) : undefined,
  );
  const entries = ctx.db
    .select({
      id: costEntries.id,
      date: costEntries.date,
      amountMinor: costEntries.amountMinor,
      currency: costEntries.currency,
      category: costEntries.category,
      assetId: costEntries.assetId,
      assetName: assets.name,
      countsAsExpense: costEntries.countsAsExpense,
      deductible: costEntries.deductible,
      splitMode: costEntries.splitMode,
      paidByUserId: costEntries.paidByUserId,
    })
    .from(costEntries)
    .leftJoin(assets, eq(assets.id, costEntries.assetId))
    .where(inYear)
    .all();
  const shareRows = ctx.db
    .select({
      entryId: costEntryShares.entryId,
      userId: costEntryShares.userId,
      shareBps: costEntryShares.shareBps,
    })
    .from(costEntryShares)
    .innerJoin(costEntries, eq(costEntries.id, costEntryShares.entryId))
    .where(inYear)
    .all();
  const sharesByEntry = new Map<string, Share[]>();
  for (const s of shareRows) {
    sharesByEntry.set(s.entryId, [
      ...(sharesByEntry.get(s.entryId) ?? []),
      { userId: s.userId, shareBps: s.shareBps },
    ]);
  }

  const people = ctx.db
    .select({
      id: users.id,
      name: sql<
        string | null
      >`coalesce(${users.displayName}, ${users.username})`,
    })
    .from(users)
    .all();
  const paid = new Map<string, number>();
  const share = new Map<string, number>();

  const categories = new Map<string, Tally>();
  const months = new Map<string, Tally>();
  const assetTallies = new Map<string, Tally>();
  const assetNames = new Map<string, string>();
  const deductibles = new Map<string, Tally>();
  let expense = 0;
  let equity = 0;
  let otherCurrency = 0;
  let unassigned = 0;

  for (const e of entries) {
    if (e.currency !== currency) {
      otherCurrency++;
      continue;
    }
    if (e.countsAsExpense) {
      expense += e.amountMinor;
      bump(categories, e.category, e.amountMinor);
      bump(months, e.date.slice(0, 7), e.amountMinor);
      bump(deductibles, e.deductible, e.amountMinor);
      if (e.assetId) {
        bump(assetTallies, e.assetId, e.amountMinor);
        assetNames.set(e.assetId, e.assetName ?? "");
      }
    } else {
      equity += e.amountMinor;
    }
    const shares = sharesByEntry.get(e.id) ?? [];
    if (e.splitMode === "none" || shares.length === 0) continue;
    if (e.paidByUserId === null) {
      unassigned++;
      continue;
    }
    paid.set(e.paidByUserId, (paid.get(e.paidByUserId) ?? 0) + e.amountMinor);
    for (const part of amountsFor(e.amountMinor, shares)) {
      share.set(part.userId, (share.get(part.userId) ?? 0) + part.amountMinor);
    }
  }

  const peopleRows = people
    .map((p) => {
      const paidMinor = paid.get(p.id) ?? 0;
      const shareMinor = share.get(p.id) ?? 0;
      return {
        userId: p.id,
        userName: p.name,
        paidMinor,
        shareMinor,
        balanceMinor: paidMinor - shareMinor,
      };
    })
    .sort(
      (a, b) =>
        (a.userName ?? "").localeCompare(b.userName ?? "", "de") ||
        a.userId.localeCompare(b.userId),
    );
  const nameOf = new Map(peopleRows.map((p) => [p.userId, p.userName]));

  return {
    year,
    currency,
    otherCurrencyCount: otherCurrency,
    expenseTotalMinor: expense,
    equityTotalMinor: equity,
    byCategory: [...categories]
      .map(([category, t]) => ({ category: category as CostCategory, ...t }))
      .sort(
        (a, b) =>
          b.totalMinor - a.totalMinor || a.category.localeCompare(b.category),
      ),
    byMonth: Array.from({ length: 12 }, (_, i) => {
      const month = `${String(year).padStart(4, "0")}-${String(i + 1).padStart(2, "0")}`;
      const t = months.get(month);
      return { month, totalMinor: t?.totalMinor ?? 0, count: t?.count ?? 0 };
    }),
    byAsset: [...assetTallies]
      .map(([assetId, t]) => ({
        assetId,
        assetName: assetNames.get(assetId) ?? "",
        totalMinor: t.totalMinor,
        count: t.count,
      }))
      .sort(
        (a, b) =>
          b.totalMinor - a.totalMinor || a.assetName.localeCompare(b.assetName),
      )
      .slice(0, TOP_ASSETS),
    byDeductible: COST_DEDUCTIBLE.flatMap((deductible) => {
      const t = deductibles.get(deductible);
      return t ? [{ deductible, ...t }] : [];
    }),
    people: peopleRows,
    settlement: settle(peopleRows).map((t) => ({
      fromUserId: t.fromUserId,
      fromName: nameOf.get(t.fromUserId) ?? null,
      toUserId: t.toUserId,
      toName: nameOf.get(t.toUserId) ?? null,
      amountMinor: t.amountMinor,
    })),
    unassignedPayerCount: unassigned,
  };
}

/** The dashboard's slice: this year so far, the three largest categories and the settlement. */
export function costsYearToDate(ctx: Pick<ServiceContext, "db" | "now">) {
  const year = Number(clockAt(ctx.now).today.slice(0, 4));
  const s = costsSummary(ctx, year);
  return {
    year,
    currency: s.currency,
    totalMinor: s.expenseTotalMinor,
    byCategory: s.byCategory.slice(0, DASHBOARD_TOP_CATEGORIES),
    settlement: s.settlement,
  };
}
