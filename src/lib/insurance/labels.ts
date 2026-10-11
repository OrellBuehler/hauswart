import type { Component } from "svelte";
import BuildingIcon from "@lucide/svelte/icons/building";
import CarIcon from "@lucide/svelte/icons/car";
import HeartPulseIcon from "@lucide/svelte/icons/heart-pulse";
import PlaneIcon from "@lucide/svelte/icons/plane";
import ScaleIcon from "@lucide/svelte/icons/scale";
import ShieldIcon from "@lucide/svelte/icons/shield";
import SofaIcon from "@lucide/svelte/icons/sofa";
import SproutIcon from "@lucide/svelte/icons/sprout";
import UsersIcon from "@lucide/svelte/icons/users";
import type {
  InsurancePremiumPeriod,
  InsuranceRenewal,
  InsuranceType,
} from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";

export const insuranceTypeLabels: Record<InsuranceType, () => string> = {
  motor_liability: () => m.insurance_type_motor_liability(),
  motor_partial_casco: () => m.insurance_type_motor_partial_casco(),
  motor_full_casco: () => m.insurance_type_motor_full_casco(),
  household: () => m.insurance_type_household(),
  personal_liability: () => m.insurance_type_personal_liability(),
  building: () => m.insurance_type_building(),
  legal: () => m.insurance_type_legal(),
  travel: () => m.insurance_type_travel(),
  health: () => m.insurance_type_health(),
  life: () => m.insurance_type_life(),
  other: () => m.insurance_type_other(),
};

export const insuranceTypeIcons: Record<InsuranceType, Component> = {
  motor_liability: CarIcon,
  motor_partial_casco: CarIcon,
  motor_full_casco: CarIcon,
  household: SofaIcon,
  personal_liability: UsersIcon,
  building: BuildingIcon,
  legal: ScaleIcon,
  travel: PlaneIcon,
  health: HeartPulseIcon,
  life: SproutIcon,
  other: ShieldIcon,
};

export const premiumPeriodLabels: Record<InsurancePremiumPeriod, () => string> =
  {
    monthly: () => m.insurance_period_monthly(),
    quarterly: () => m.insurance_period_quarterly(),
    semiannual: () => m.insurance_period_semiannual(),
    annual: () => m.insurance_period_annual(),
  };

/** "per month" and friends, for an amount that is shown next to it. */
export const premiumPerLabels: Record<InsurancePremiumPeriod, () => string> = {
  monthly: () => m.insurance_per_monthly(),
  quarterly: () => m.insurance_per_quarterly(),
  semiannual: () => m.insurance_per_semiannual(),
  annual: () => m.insurance_per_annual(),
};

export const renewalLabels: Record<InsuranceRenewal, () => string> = {
  auto: () => m.insurance_renewal_auto(),
  fixed: () => m.insurance_renewal_fixed(),
};
