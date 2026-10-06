import type { Component } from "svelte";
import BoxIcon from "@lucide/svelte/icons/box";
import CpuIcon from "@lucide/svelte/icons/cpu";
import DoorClosedIcon from "@lucide/svelte/icons/door-closed";
import SproutIcon from "@lucide/svelte/icons/sprout";
import type { AssetKind } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";

export const kindIcons: Record<AssetKind, Component> = {
  device: CpuIcon,
  plant: SproutIcon,
  fixture: DoorClosedIcon,
  other: BoxIcon,
};

export const kindLabels: Record<AssetKind, () => string> = {
  device: () => m.asset_kind_device(),
  plant: () => m.asset_kind_plant(),
  fixture: () => m.asset_kind_fixture(),
  other: () => m.asset_kind_other(),
};

/** Kinds that belong in the inventory; plants have their own page. */
export const INVENTORY_KINDS = ["device", "fixture", "other"] as const;
