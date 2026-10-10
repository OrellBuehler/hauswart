import type { InsuranceType } from "$lib/api/enums";
import type { InsurancePolicy } from "$lib/api/schemas/insurance";

export type PolicyFilter = {
  q: string;
  type: InsuranceType | null;
  archived: boolean;
};

export const emptyFilter: PolicyFilter = { q: "", type: null, archived: false };

function haystack(policy: InsurancePolicy): string {
  return [
    policy.title,
    policy.insurerName,
    policy.policyNumber,
    ...policy.assets.map((asset) => asset.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** The policies the filter lets through; `archived` picks the archived ones instead of the active ones. */
export function filterPolicies(
  policies: readonly InsurancePolicy[],
  filter: PolicyFilter,
): InsurancePolicy[] {
  const terms = filter.q.toLowerCase().split(/\s+/).filter(Boolean);
  return policies.filter((policy) => {
    if ((policy.archivedAt !== null) !== filter.archived) return false;
    if (filter.type && policy.type !== filter.type) return false;
    if (terms.length === 0) return true;
    const text = haystack(policy);
    return terms.every((term) => text.includes(term));
  });
}

export function isFiltered(filter: PolicyFilter): boolean {
  return filter.q.trim() !== "" || filter.type !== null;
}

export type PremiumTotal = {
  /** The yearly premiums in the household currency added up. */
  totalMinor: number;
  /** Policies in another currency, left out of the total. */
  otherCurrencyCount: number;
};

/** What the policies cost a year; other currencies are not converted, only counted. */
export function annualTotal(
  policies: readonly InsurancePolicy[],
  currency: string,
): PremiumTotal {
  let totalMinor = 0;
  let otherCurrencyCount = 0;
  for (const policy of policies) {
    if (policy.currency === currency) totalMinor += policy.annualPremiumMinor;
    else otherCurrencyCount += 1;
  }
  return { totalMinor, otherCurrencyCount };
}
