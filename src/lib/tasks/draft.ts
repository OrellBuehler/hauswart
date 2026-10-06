import type { PreparationKind } from "$lib/api/enums";

/** A preparation as the task form edits it; `id` is set for those that already exist. */
export type PreparationDraft = {
  key: string;
  id?: string;
  title: string;
  kind: PreparationKind;
  leadDays: number | undefined;
};
