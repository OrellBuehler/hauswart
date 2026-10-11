import type { FuelUnit } from "$lib/api/enums";

/** What the consumption needs of a fuel log entry. */
export interface FuelFill {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** The odometer when filling up. */
  odometer: number;
  quantity: number;
  unit: FuelUnit;
  /** Null when the amount is unknown or not in the household currency: the cost of a stretch is then unknown too. */
  amountMinor: number | null;
  /** The tank was filled up. Only a full fill closes a stretch. */
  fullTank: boolean;
  /** At least one fill before this one is missing from the log, so no stretch reaches back past it. */
  missedPrevious: boolean;
}

/** From one full fill to the next: what was filled in between (the closing fill included) over the distance driven. */
export interface Stretch {
  /** The full fill that closes the stretch. */
  fillId: string;
  date: string;
  unit: FuelUnit;
  distance: number;
  quantity: number;
  /** Litres or kWh per 100 distance units. */
  consumptionPer100: number;
  amountMinor: number | null;
  /** Minor units per distance unit; null when some amount is unknown. */
  costPerDistanceMinor: number | null;
}

const byTime = (a: FuelFill, b: FuelFill) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.odometer - b.odometer;

/**
 * Consumption by the full-to-full method. Within one unit (litres and kWh are counted apart, as a
 * plug-in hybrid has both) the fills are taken in order of date and odometer. A full fill closes a
 * stretch that starts at the previous full fill; everything filled since then, partial fills
 * included, counts to it, and the distance is the difference of the two odometer values. Nothing
 * is said about the first full fill (nothing before it is known), about a fill after a gap
 * (`missedPrevious`: the chain starts again there) or about an odometer that did not go up.
 * Partial fills before the first full one are ignored. Chronological.
 */
export function fuelStretches(fills: readonly FuelFill[]): Stretch[] {
  const out: Stretch[] = [];
  for (const unit of ["l", "kWh"] as const) {
    const chain = fills
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.unit === unit)
      .sort((a, b) => byTime(a.f, b.f) || a.i - b.i)
      .map(({ f }) => f);
    let anchor: FuelFill | null = null;
    let quantity = 0;
    let amount: number | null = 0;
    for (const fill of chain) {
      if (fill.missedPrevious) {
        anchor = null;
        quantity = 0;
        amount = 0;
      }
      if (anchor) {
        quantity += fill.quantity;
        amount =
          amount === null || fill.amountMinor === null
            ? null
            : amount + fill.amountMinor;
      }
      if (!fill.fullTank) continue;
      if (anchor) {
        const distance = fill.odometer - anchor.odometer;
        if (distance > 0) {
          out.push({
            fillId: fill.id,
            date: fill.date,
            unit,
            distance,
            quantity,
            consumptionPer100: (quantity / distance) * 100,
            amountMinor: amount,
            costPerDistanceMinor: amount === null ? null : amount / distance,
          });
        }
      }
      anchor = fill;
      quantity = 0;
      amount = 0;
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The price of a unit of what was filled, in minor units (a rate, not an amount); null without an amount. */
export function pricePerUnitMinor(fill: {
  amountMinor: number | null;
  quantity: number;
}): number | null {
  return fill.amountMinor === null || fill.quantity <= 0
    ? null
    : fill.amountMinor / fill.quantity;
}

/** Quantity over distance of all stretches together, per 100: long stretches weigh more than short ones. Null without a stretch. */
export function averageConsumption(
  stretches: readonly Stretch[],
): number | null {
  const distance = stretches.reduce((sum, s) => sum + s.distance, 0);
  if (distance <= 0) return null;
  return (stretches.reduce((sum, s) => sum + s.quantity, 0) / distance) * 100;
}

/** Cost per distance unit over the stretches whose cost is known; null when none is. */
export function averageCostPerDistance(
  stretches: readonly Stretch[],
): number | null {
  const known = stretches.filter((s) => s.amountMinor !== null);
  const distance = known.reduce((sum, s) => sum + s.distance, 0);
  if (distance <= 0) return null;
  return (
    known.reduce((sum, s) => sum + (s.amountMinor as number), 0) / distance
  );
}
