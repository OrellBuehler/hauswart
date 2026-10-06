import type { Component } from "svelte";
import BookMarkedIcon from "@lucide/svelte/icons/book-marked";
import CpuIcon from "@lucide/svelte/icons/cpu";
import DoorOpenIcon from "@lucide/svelte/icons/door-open";
import FileTextIcon from "@lucide/svelte/icons/file-text";
import ListChecksIcon from "@lucide/svelte/icons/list-checks";
import SirenIcon from "@lucide/svelte/icons/siren";
import { DOC_SECTIONS, type DocSection } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";

export { DOC_SECTIONS };

export const sectionLabels: Record<DocSection, () => string> = {
  general: () => m.docs_section_general(),
  device: () => m.docs_section_device(),
  room: () => m.docs_section_room(),
  emergency: () => m.docs_section_emergency(),
  rules: () => m.docs_section_rules(),
  howto: () => m.docs_section_howto(),
};

export const sectionIcons: Record<DocSection, Component> = {
  general: FileTextIcon,
  device: CpuIcon,
  room: DoorOpenIcon,
  emergency: SirenIcon,
  rules: BookMarkedIcon,
  howto: ListChecksIcon,
};
