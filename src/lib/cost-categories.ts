import type { CostCategory } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";

const LABELS: Record<CostCategory, () => string> = {
  repair: () => m.cost_category_repair(),
  utilities: () => m.cost_category_utilities(),
  renewal_fund: () => m.cost_category_renewal_fund(),
  purchase: () => m.cost_category_purchase(),
  mortgage_interest: () => m.cost_category_mortgage_interest(),
  mortgage_principal: () => m.cost_category_mortgage_principal(),
  insurance: () => m.cost_category_insurance(),
  renovation: () => m.cost_category_renovation(),
  maintenance: () => m.cost_category_maintenance(),
  taxes_fees: () => m.cost_category_taxes_fees(),
  other: () => m.cost_category_other(),
};

/** The category of a cost entry as people read it, in the active language. */
export function costCategoryLabel(category: CostCategory): string {
  return LABELS[category]();
}
