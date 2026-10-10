import type { Component } from "svelte";
import BanknoteIcon from "@lucide/svelte/icons/banknote";
import BuildingIcon from "@lucide/svelte/icons/building";
import FuelIcon from "@lucide/svelte/icons/fuel";
import HammerIcon from "@lucide/svelte/icons/hammer";
import HouseIcon from "@lucide/svelte/icons/house";
import LandmarkIcon from "@lucide/svelte/icons/landmark";
import PiggyBankIcon from "@lucide/svelte/icons/piggy-bank";
import ReceiptIcon from "@lucide/svelte/icons/receipt";
import ShieldIcon from "@lucide/svelte/icons/shield";
import ShoppingBagIcon from "@lucide/svelte/icons/shopping-bag";
import WrenchIcon from "@lucide/svelte/icons/wrench";
import ZapIcon from "@lucide/svelte/icons/zap";
import type {
  CostCategory,
  CostDeductible,
  CostSource,
  CostSplitMode,
  FinanceSuggestionKind,
} from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";

export const categoryLabels: Record<CostCategory, () => string> = {
  repair: () => m.cost_category_repair(),
  utilities: () => m.cost_category_utilities(),
  renewal_fund: () => m.cost_category_renewal_fund(),
  purchase: () => m.cost_category_purchase(),
  mortgage_interest: () => m.cost_category_mortgage_interest(),
  mortgage_principal: () => m.cost_category_mortgage_principal(),
  insurance: () => m.cost_category_insurance(),
  renovation: () => m.cost_category_renovation(),
  maintenance: () => m.cost_category_maintenance(),
  fuel: () => m.cost_category_fuel(),
  taxes_fees: () => m.cost_category_taxes_fees(),
  other: () => m.cost_category_other(),
};

export const categoryIcons: Record<CostCategory, Component> = {
  repair: WrenchIcon,
  utilities: ZapIcon,
  renewal_fund: PiggyBankIcon,
  purchase: ShoppingBagIcon,
  mortgage_interest: LandmarkIcon,
  mortgage_principal: HouseIcon,
  insurance: ShieldIcon,
  renovation: HammerIcon,
  maintenance: WrenchIcon,
  fuel: FuelIcon,
  taxes_fees: BuildingIcon,
  other: ReceiptIcon,
};

export const splitModeLabels: Record<CostSplitMode, () => string> = {
  ownership: () => m.cost_split_ownership(),
  equal: () => m.cost_split_equal(),
  custom: () => m.cost_split_custom(),
  none: () => m.cost_split_none(),
};

export const splitModeHints: Record<CostSplitMode, () => string> = {
  ownership: () => m.cost_split_ownership_hint(),
  equal: () => m.cost_split_equal_hint(),
  custom: () => m.cost_split_custom_hint(),
  none: () => m.cost_split_none_hint(),
};

export const deductibleLabels: Record<CostDeductible, () => string> = {
  unknown: () => m.cost_deductible_unknown(),
  maintenance: () => m.cost_deductible_maintenance(),
  investment: () => m.cost_deductible_investment(),
  no: () => m.cost_deductible_no(),
};

export const sourceLabels: Record<CostSource, () => string> = {
  manual: () => m.cost_source_manual(),
  finance_transaction: () => m.cost_source_finance_transaction(),
  finance_bill: () => m.cost_source_finance_bill(),
};

export const suggestionKindLabels: Record<FinanceSuggestionKind, () => string> =
  {
    cost: () => m.finance_kind_cost(),
    asset: () => m.finance_kind_asset(),
    bill_task: () => m.finance_kind_bill_task(),
  };

export const suggestionKindIcons: Record<FinanceSuggestionKind, Component> = {
  cost: BanknoteIcon,
  asset: ShoppingBagIcon,
  bill_task: ReceiptIcon,
};
