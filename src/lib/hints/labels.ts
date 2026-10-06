import type { Component } from "svelte";
import LightbulbIcon from "@lucide/svelte/icons/lightbulb";
import ScrollTextIcon from "@lucide/svelte/icons/scroll-text";
import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
import type { HintKind, ServiceLogKind } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";

export const hintKindLabels: Record<HintKind, () => string> = {
  tip: () => m.hint_kind_tip(),
  rule: () => m.hint_kind_rule(),
  warning: () => m.hint_kind_warning(),
};

export const hintKindIcons: Record<HintKind, Component> = {
  tip: LightbulbIcon,
  rule: ScrollTextIcon,
  warning: TriangleAlertIcon,
};

/** Tinted tile (icon background) and card border per kind, readable in light and dark. */
export const hintTones: Record<
  HintKind,
  { tile: string; text: string; card: string; pinned: string }
> = {
  tip: {
    tile: "bg-chart-2/15 text-chart-2",
    text: "text-chart-2",
    card: "",
    pinned: "border-chart-2/40 bg-chart-2/5",
  },
  rule: {
    tile: "bg-brand/10 text-brand",
    text: "text-brand",
    card: "",
    pinned: "border-brand/40 bg-brand/5",
  },
  warning: {
    tile: "bg-warning/15 text-warning",
    text: "text-warning",
    card: "border-warning/40 bg-warning/5",
    pinned: "border-warning/50 bg-warning/10",
  },
};

export const serviceLogKindLabels: Record<ServiceLogKind, () => string> = {
  maintenance: () => m.service_kind_maintenance(),
  repair: () => m.service_kind_repair(),
  installation: () => m.service_kind_installation(),
  inspection: () => m.service_kind_inspection(),
  replacement: () => m.service_kind_replacement(),
  other: () => m.service_kind_other(),
};
