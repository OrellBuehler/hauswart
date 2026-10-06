import type { Component } from "svelte";
import DoorOpenIcon from "@lucide/svelte/icons/door-open";
import CookingPotIcon from "@lucide/svelte/icons/cooking-pot";
import BathIcon from "@lucide/svelte/icons/bath";
import ShowerHeadIcon from "@lucide/svelte/icons/shower-head";
import ToiletIcon from "@lucide/svelte/icons/toilet";
import SofaIcon from "@lucide/svelte/icons/sofa";
import ArmchairIcon from "@lucide/svelte/icons/armchair";
import BedIcon from "@lucide/svelte/icons/bed";
import BedDoubleIcon from "@lucide/svelte/icons/bed-double";
import BabyIcon from "@lucide/svelte/icons/baby";
import TvIcon from "@lucide/svelte/icons/tv";
import MonitorIcon from "@lucide/svelte/icons/monitor";
import BookOpenIcon from "@lucide/svelte/icons/book-open";
import ShirtIcon from "@lucide/svelte/icons/shirt";
import WashingMachineIcon from "@lucide/svelte/icons/washing-machine";
import WarehouseIcon from "@lucide/svelte/icons/warehouse";
import ArchiveIcon from "@lucide/svelte/icons/archive";
import Flower2Icon from "@lucide/svelte/icons/flower-2";
import TreesIcon from "@lucide/svelte/icons/trees";
import CarIcon from "@lucide/svelte/icons/car";
import HammerIcon from "@lucide/svelte/icons/hammer";
import DumbbellIcon from "@lucide/svelte/icons/dumbbell";
import Gamepad2Icon from "@lucide/svelte/icons/gamepad-2";
import HouseIcon from "@lucide/svelte/icons/house";
import { m } from "$lib/paraglide/messages";

export type RoomIconEntry = { icon: Component; label: () => string };

/** The curated icon set for rooms, keyed by the lucide icon name stored on the room. */
export const roomIcons: Record<string, RoomIconEntry> = {
  "cooking-pot": { icon: CookingPotIcon, label: () => m.icon_kitchen() },
  bath: { icon: BathIcon, label: () => m.icon_bath() },
  "shower-head": { icon: ShowerHeadIcon, label: () => m.icon_shower() },
  toilet: { icon: ToiletIcon, label: () => m.icon_toilet() },
  sofa: { icon: SofaIcon, label: () => m.icon_living() },
  armchair: { icon: ArmchairIcon, label: () => m.icon_armchair() },
  bed: { icon: BedIcon, label: () => m.icon_bedroom() },
  "bed-double": { icon: BedDoubleIcon, label: () => m.icon_bed_double() },
  baby: { icon: BabyIcon, label: () => m.icon_child() },
  tv: { icon: TvIcon, label: () => m.icon_tv() },
  monitor: { icon: MonitorIcon, label: () => m.icon_office() },
  "book-open": { icon: BookOpenIcon, label: () => m.icon_library() },
  shirt: { icon: ShirtIcon, label: () => m.icon_wardrobe() },
  "washing-machine": {
    icon: WashingMachineIcon,
    label: () => m.icon_laundry(),
  },
  warehouse: { icon: WarehouseIcon, label: () => m.icon_cellar() },
  archive: { icon: ArchiveIcon, label: () => m.icon_storage() },
  "door-open": { icon: DoorOpenIcon, label: () => m.icon_entrance() },
  "flower-2": { icon: Flower2Icon, label: () => m.icon_balcony() },
  trees: { icon: TreesIcon, label: () => m.icon_garden() },
  car: { icon: CarIcon, label: () => m.icon_garage() },
  hammer: { icon: HammerIcon, label: () => m.icon_workshop() },
  dumbbell: { icon: DumbbellIcon, label: () => m.icon_fitness() },
  "gamepad-2": { icon: Gamepad2Icon, label: () => m.icon_games() },
  house: { icon: HouseIcon, label: () => m.icon_house() },
};

export const roomIconNames = Object.keys(roomIcons);

export const DEFAULT_ROOM_ICON: Component = DoorOpenIcon;

export function roomIconFor(name: string | null | undefined): Component {
  return (name ? roomIcons[name]?.icon : undefined) ?? DEFAULT_ROOM_ICON;
}
