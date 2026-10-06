import type { Component } from "svelte";
import Building2Icon from "@lucide/svelte/icons/building-2";
import ContactIcon from "@lucide/svelte/icons/contact";
import HeadsetIcon from "@lucide/svelte/icons/headset";
import HouseIcon from "@lucide/svelte/icons/house";
import ShieldCheckIcon from "@lucide/svelte/icons/shield-check";
import SirenIcon from "@lucide/svelte/icons/siren";
import StoreIcon from "@lucide/svelte/icons/store";
import WrenchIcon from "@lucide/svelte/icons/wrench";
import ZapIcon from "@lucide/svelte/icons/zap";
import type { AssetContactRole, ContactKind } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";

export const contactKindLabels: Record<ContactKind, () => string> = {
  installer: () => m.contact_kind_installer(),
  property_mgmt: () => m.contact_kind_property_mgmt(),
  manufacturer_support: () => m.contact_kind_manufacturer_support(),
  emergency: () => m.contact_kind_emergency(),
  utility: () => m.contact_kind_utility(),
  insurance: () => m.contact_kind_insurance(),
  neighbor: () => m.contact_kind_neighbor(),
  seller: () => m.contact_kind_seller(),
  other: () => m.contact_kind_other(),
};

/** Plural headings of the groups on the contact list. */
export const contactKindGroupLabels: Record<ContactKind, () => string> = {
  installer: () => m.contact_group_installer(),
  property_mgmt: () => m.contact_group_property_mgmt(),
  manufacturer_support: () => m.contact_group_manufacturer_support(),
  emergency: () => m.contact_group_emergency(),
  utility: () => m.contact_group_utility(),
  insurance: () => m.contact_group_insurance(),
  neighbor: () => m.contact_group_neighbor(),
  seller: () => m.contact_group_seller(),
  other: () => m.contact_group_other(),
};

export const contactKindIcons: Record<ContactKind, Component> = {
  installer: WrenchIcon,
  property_mgmt: Building2Icon,
  manufacturer_support: HeadsetIcon,
  emergency: SirenIcon,
  utility: ZapIcon,
  insurance: ShieldCheckIcon,
  neighbor: HouseIcon,
  seller: StoreIcon,
  other: ContactIcon,
};

export const assetContactRoleLabels: Record<AssetContactRole, () => string> = {
  support: () => m.contact_role_support(),
  installer: () => m.contact_role_installer(),
  seller: () => m.contact_role_seller(),
  service: () => m.contact_role_service(),
  other: () => m.contact_role_other(),
};

/** `tel:` target without spaces and separators; the visible text stays as typed. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
