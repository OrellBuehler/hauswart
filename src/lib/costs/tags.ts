import { COST_TAG_COLORS, type CostTagColor } from "$lib/api/enums";
import { isApiError } from "$lib/api/errors";
import {
  COST_TAG_NAME_MAX,
  MAX_COST_TAGS,
  MAX_TAGS_PER_COST,
  type CostTag,
  type CostTagRef,
} from "$lib/api/schemas/cost-tags";
import { nameKey } from "$lib/costs/names";
import { m } from "$lib/paraglide/messages";

/**
 * The classes of each colour key of a tag. A chip reads its meaning from its name, the colour only helps to find it
 * again; every pair keeps the text at a high contrast to its background in the light and the dark theme. The classes are
 * written out in full so that Tailwind finds them.
 */
export const TAG_COLOR_STYLES: Record<
  CostTagColor,
  { chip: string; dot: string }
> = {
  gray: {
    chip: "border-gray-300 bg-gray-100 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100",
    dot: "bg-gray-500 dark:bg-gray-400",
  },
  red: {
    chip: "border-red-300 bg-red-100 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
    dot: "bg-red-500",
  },
  orange: {
    chip: "border-orange-300 bg-orange-100 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-100",
    dot: "bg-orange-500",
  },
  amber: {
    chip: "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
    dot: "bg-amber-500",
  },
  green: {
    chip: "border-green-300 bg-green-100 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100",
    dot: "bg-green-600",
  },
  teal: {
    chip: "border-teal-300 bg-teal-100 text-teal-900 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-100",
    dot: "bg-teal-600",
  },
  blue: {
    chip: "border-blue-300 bg-blue-100 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
    dot: "bg-blue-500",
  },
  violet: {
    chip: "border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100",
    dot: "bg-violet-500",
  },
  pink: {
    chip: "border-pink-300 bg-pink-100 text-pink-900 dark:border-pink-800 dark:bg-pink-950 dark:text-pink-100",
    dot: "bg-pink-500",
  },
};

export const tagColorLabels: Record<CostTagColor, () => string> = {
  gray: () => m.costtag_color_gray(),
  red: () => m.costtag_color_red(),
  orange: () => m.costtag_color_orange(),
  amber: () => m.costtag_color_amber(),
  green: () => m.costtag_color_green(),
  teal: () => m.costtag_color_teal(),
  blue: () => m.costtag_color_blue(),
  violet: () => m.costtag_color_violet(),
  pink: () => m.costtag_color_pink(),
};

/** Tags by name without regard to case or accents, as the server lists them. */
export function sortTags<T extends Pick<CostTagRef, "name">>(
  tags: readonly T[],
): T[] {
  return [...tags].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** The names of tags as one string, e.g. for a screen reader or a `title`. */
export function tagNames(tags: readonly Pick<CostTagRef, "name">[]): string {
  return tags.map((tag) => tag.name).join(", ");
}

/** The ids of the tags an entry carries, in the order of the entry. */
export function tagIdsOf(tags: readonly Pick<CostTagRef, "id">[]): string[] {
  return tags.map((tag) => tag.id);
}

/** Whether two lists name the same tags, whatever their order. */
export function sameTagIds(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** Whether another tag can be put on an entry (or a recurring cost). */
export function canAddTag(
  ids: readonly string[],
  max: number = MAX_TAGS_PER_COST,
): boolean {
  return ids.length < max;
}

/**
 * The chosen tags after one was tapped: a chosen tag is taken off; another one is added unless the limit is reached,
 * where the list stays as it is.
 */
export function toggleTagId(
  ids: readonly string[],
  id: string,
  max: number = MAX_TAGS_PER_COST,
): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  return canAddTag(ids, max) ? [...ids, id] : [...ids];
}

/** Drops ids of tags that are not in the list any more (deleted since the page loaded). */
export function knownTagIds(
  ids: readonly string[],
  tags: readonly Pick<CostTag, "id">[],
): string[] {
  return ids.filter((id) => tags.some((tag) => tag.id === id));
}

/** What the filter on the costs page asks for: the tag if it exists, else no tag (the server answers 404 for others). */
export function knownTagId(
  id: string,
  tags: readonly Pick<CostTag, "id">[],
): string {
  return tags.some((tag) => tag.id === id) ? id : "";
}

/**
 * The colour for a tag that is made on the spot: the palette colour (not grey) the fewest tags have so far, the first one
 * in the palette on a tie, so a run of new tags tells apart.
 */
export function nextTagColor(
  tags: readonly Pick<CostTag, "color">[],
): CostTagColor {
  const palette = COST_TAG_COLORS.filter((color) => color !== "gray");
  const used = (color: CostTagColor) =>
    tags.filter((tag) => tag.color === color).length;
  return palette.reduce((best, color) =>
    used(color) < used(best) ? color : best,
  );
}

/** Whether another tag already has the name (without regard to case), ignoring the tag being edited. */
export function tagNameTaken(
  name: string,
  tags: readonly Pick<CostTag, "id" | "name">[],
  exceptId?: string,
): boolean {
  const wanted = nameKey(name);
  return tags.some(
    (tag) => tag.id !== exceptId && nameKey(tag.name) === wanted,
  );
}

/** What is wrong with a tag name as typed, in words; `undefined` when it can be sent. */
export function tagNameProblem(
  name: string,
  tags: readonly Pick<CostTag, "id" | "name">[],
  exceptId?: string,
): string | undefined {
  const trimmed = name.trim();
  if (trimmed === "") return m.field_required();
  if (trimmed.length > COST_TAG_NAME_MAX) {
    return m.field_too_long({ max: COST_TAG_NAME_MAX });
  }
  if (tagNameTaken(trimmed, tags, exceptId))
    return m.costtag_error_name_taken();
  return undefined;
}

/**
 * Why a tag could not be made or renamed (409): the name belongs to another tag, or - when it is a new one and the
 * household has all it may - the limit is reached. `undefined` for any other error.
 */
export function tagSaveMessage(
  err: unknown,
  tags: readonly unknown[],
  creating: boolean,
): string | undefined {
  if (!isApiError(err) || err.code !== "conflict") return undefined;
  return creating && tags.length >= MAX_COST_TAGS
    ? m.costtag_error_limit({ max: MAX_COST_TAGS })
    : m.costtag_error_name_taken();
}

/** The sentence under the delete confirmation: what the tag is taken off, and that the entries stay. */
export function tagDeleteDescription(
  tag: Pick<CostTag, "name" | "entryCount">,
): string {
  return tag.entryCount === 0
    ? m.costtag_delete_description_unused({ name: tag.name })
    : m.costtag_delete_description({
        name: tag.name,
        count: tag.entryCount,
      });
}
