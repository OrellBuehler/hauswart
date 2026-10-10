import type { Component } from "svelte";
import ContactIcon from "@lucide/svelte/icons/contact";
import CpuIcon from "@lucide/svelte/icons/cpu";
import DoorOpenIcon from "@lucide/svelte/icons/door-open";
import FileSearchIcon from "@lucide/svelte/icons/file-search";
import FileTextIcon from "@lucide/svelte/icons/file-text";
import LightbulbIcon from "@lucide/svelte/icons/lightbulb";
import ListChecksIcon from "@lucide/svelte/icons/list-checks";
import PuzzleIcon from "@lucide/svelte/icons/puzzle";
import UmbrellaIcon from "@lucide/svelte/icons/umbrella";
import WrenchIcon from "@lucide/svelte/icons/wrench";
import type { z } from "zod";
import {
  SEARCH_HIT_TYPES,
  type searchHitSchema,
} from "$lib/api/schemas/search";
import { m } from "$lib/paraglide/messages";

export type SearchHit = z.output<typeof searchHitSchema>;
export type SearchHitType = (typeof SEARCH_HIT_TYPES)[number];

/** The order groups appear in. */
export const HIT_TYPES = SEARCH_HIT_TYPES;

export const hitLabels: Record<SearchHitType, () => string> = {
  page: () => m.search_type_page(),
  asset: () => m.search_type_asset(),
  room: () => m.search_type_room(),
  task: () => m.search_type_task(),
  defect: () => m.search_type_defect(),
  contact: () => m.search_type_contact(),
  part: () => m.search_type_part(),
  asset_hint: () => m.search_type_hint(),
  insurance_policy: () => m.search_type_insurance_policy(),
  document: () => m.search_type_document(),
};

export const hitIcons: Record<SearchHitType, Component> = {
  page: FileTextIcon,
  asset: CpuIcon,
  room: DoorOpenIcon,
  task: ListChecksIcon,
  defect: WrenchIcon,
  contact: ContactIcon,
  part: PuzzleIcon,
  asset_hint: LightbulbIcon,
  insurance_policy: UmbrellaIcon,
  document: FileSearchIcon,
};

/** The groups of a hit list in display order, empty ones left out. */
export function groupHits(
  hits: SearchHit[],
): { type: SearchHitType; items: SearchHit[] }[] {
  return HIT_TYPES.map((type) => ({
    type,
    items: hits.filter((hit) => hit.type === type),
  })).filter((group) => group.items.length > 0);
}

/** A hit's url is an app path; anything else (another origin, a `//host` url) is not followed. */
export function safeHitUrl(url: string): string | null {
  return url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")
    ? url
    : null;
}
