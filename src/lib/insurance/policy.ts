import type { InsurancePremiumPeriod, InsuranceRenewal } from "$lib/api/enums";
import { addMonths, monthEnd } from "$lib/dates";

/** How many premium payments make a year. */
export const PERIODS_PER_YEAR: Record<InsurancePremiumPeriod, number> = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
};

/** The premium of a whole year in minor units. The premium is per period, so this is exact. */
export function annualPremiumMinor(
  premiumMinor: number,
  period: InsurancePremiumPeriod,
): number {
  return premiumMinor * PERIODS_PER_YEAR[period];
}

export interface CancellationTerms {
  renewal: InsuranceRenewal;
  /** The last day of cover of the current term. */
  endDate: string | null;
  cancellationNoticeMonths: number | null;
}

/**
 * The last day on which a cancellation still ends the contract at its end date: the end date minus
 * the notice period in months, clamped to the end of a shorter month (31 May and 3 months give
 * 28 February). An end date that is the last day of its month stays at the end of the month:
 * 30 June and 3 months give 31 March, not 30 March, because "three months before the end of June"
 * is the end of March. The end date is the last day of cover, so a policy that insurers print as
 * "expires 1 January" has the end date 31 December.
 *
 * Only a policy that renews by itself (`auto`) has to be cancelled, and only when both the end date
 * and the notice period are known: otherwise there is no deadline (null). It is derived from the
 * stored terms every time, so it cannot disagree with them; after an automatic renewal the end date
 * is moved to the end of the next term and the deadline follows.
 */
export function cancellationDeadline(terms: CancellationTerms): string | null {
  if (
    terms.renewal !== "auto" ||
    terms.endDate === null ||
    terms.cancellationNoticeMonths === null
  ) {
    return null;
  }
  const earlier = addMonths(terms.endDate, -terms.cancellationNoticeMonths);
  return terms.endDate === monthEnd(terms.endDate)
    ? monthEnd(earlier)
    : earlier;
}
