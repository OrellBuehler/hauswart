import type { Component } from "svelte";
import BanknoteIcon from "@lucide/svelte/icons/banknote";
import BuildingIcon from "@lucide/svelte/icons/building";
import BusIcon from "@lucide/svelte/icons/bus";
import FuelIcon from "@lucide/svelte/icons/fuel";
import GiftIcon from "@lucide/svelte/icons/gift";
import HammerIcon from "@lucide/svelte/icons/hammer";
import HeartPulseIcon from "@lucide/svelte/icons/heart-pulse";
import HouseIcon from "@lucide/svelte/icons/house";
import LandmarkIcon from "@lucide/svelte/icons/landmark";
import PartyPopperIcon from "@lucide/svelte/icons/party-popper";
import PiggyBankIcon from "@lucide/svelte/icons/piggy-bank";
import PlaneIcon from "@lucide/svelte/icons/plane";
import ReceiptIcon from "@lucide/svelte/icons/receipt";
import RepeatIcon from "@lucide/svelte/icons/repeat";
import ShieldIcon from "@lucide/svelte/icons/shield";
import ShoppingBagIcon from "@lucide/svelte/icons/shopping-bag";
import ShoppingBasketIcon from "@lucide/svelte/icons/shopping-basket";
import SofaIcon from "@lucide/svelte/icons/sofa";
import UtensilsIcon from "@lucide/svelte/icons/utensils";
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
  groceries: () => m.cost_category_groceries(),
  household: () => m.cost_category_household(),
  dining: () => m.cost_category_dining(),
  leisure: () => m.cost_category_leisure(),
  travel: () => m.cost_category_travel(),
  health: () => m.cost_category_health(),
  gifts: () => m.cost_category_gifts(),
  transport: () => m.cost_category_transport(),
  subscriptions: () => m.cost_category_subscriptions(),
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
  groceries: ShoppingBasketIcon,
  household: SofaIcon,
  dining: UtensilsIcon,
  leisure: PartyPopperIcon,
  travel: PlaneIcon,
  health: HeartPulseIcon,
  gifts: GiftIcon,
  transport: BusIcon,
  subscriptions: RepeatIcon,
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
  recurring: () => m.cost_source_recurring(),
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
