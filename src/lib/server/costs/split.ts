import { asc } from "drizzle-orm";
import type { CostSplitMode } from "$lib/api/enums";
import { SHARE_BPS_TOTAL } from "$lib/api/schemas/costs";
import { allocate, minor } from "$lib/money";
import { users } from "$lib/server/db";
import { invalidField, type ServiceContext } from "$lib/server/service";

export interface Share {
  userId: string;
  shareBps: number;
}

export interface Person {
  id: string;
  ownershipBps: number;
}

/**
 * The frozen shares of an entry in basis points, summing to exactly 10000.
 * `ownership` weighs the people by their ownership share (normalised, so
 * shares that do not add up to 100% still split fully; nobody with 0% pays;
 * all zero falls back to equal), `equal` weighs everybody the same, `none`
 * is not split. People are taken in id order, so the remainder always falls
 * the same way.
 */
export function sharesFor(
  mode: Exclude<CostSplitMode, "custom">,
  people: readonly Person[],
): Share[] {
  if (mode === "none" || people.length === 0) return [];
  const sorted = [...people].sort((a, b) => a.id.localeCompare(b.id));
  const weights =
    mode === "equal"
      ? sorted.map(() => 1)
      : sorted.map((p) => Math.max(0, p.ownershipBps));
  const effective = weights.some((w) => w > 0) ? weights : sorted.map(() => 1);
  const bps = allocate(minor(SHARE_BPS_TOTAL), effective);
  return sorted
    .map((p, i) => ({ userId: p.id, shareBps: bps[i] as number }))
    .filter((s) => s.shareBps > 0);
}

/** Each person's part of `amountMinor`; the parts add up to the amount exactly. Shares are taken in user id order. */
export function amountsFor(
  amountMinor: number,
  shares: readonly Share[],
): Array<Share & { amountMinor: number }> {
  if (shares.length === 0) return [];
  const sorted = [...shares].sort((a, b) => a.userId.localeCompare(b.userId));
  const parts = allocate(
    minor(amountMinor),
    sorted.map((s) => s.shareBps),
  );
  return sorted.map((s, i) => ({ ...s, amountMinor: parts[i] as number }));
}

export function listPeople(ctx: Pick<ServiceContext, "db">): Person[] {
  return ctx.db
    .select({ id: users.id, ownershipBps: users.ownershipBps })
    .from(users)
    .orderBy(asc(users.id))
    .all();
}

/** Checks explicit shares: known people, each once, adding up to 100%. */
export function validateCustomShares(
  ctx: Pick<ServiceContext, "db">,
  shares: readonly Share[],
): Share[] {
  const known = new Set(listPeople(ctx).map((p) => p.id));
  const seen = new Set<string>();
  for (const s of shares) {
    if (!known.has(s.userId)) {
      throw invalidField("shares", "A person in the shares does not exist");
    }
    if (seen.has(s.userId)) {
      throw invalidField("shares", "A person appears twice in the shares");
    }
    seen.add(s.userId);
  }
  const sum = shares.reduce((acc, s) => acc + s.shareBps, 0);
  if (sum !== SHARE_BPS_TOTAL) {
    throw invalidField(
      "shares",
      `The shares must add up to ${SHARE_BPS_TOTAL} basis points (100%), got ${sum}`,
    );
  }
  return [...shares].sort((a, b) => a.userId.localeCompare(b.userId));
}
