import type { DueStatus } from "$lib/tasks/engine/types";

/** Colours per due status: the dot, and the tinted pill with readable text in light and dark. */
export const statusTones: Record<DueStatus, { dot: string; pill: string }> = {
  overdue: {
    dot: "bg-destructive",
    pill: "bg-destructive/10 text-destructive",
  },
  due: { dot: "bg-warning", pill: "bg-warning/15 text-warning" },
  open: { dot: "bg-chart-2", pill: "bg-chart-2/15 text-foreground" },
  ok: { dot: "bg-success", pill: "bg-success/12 text-success" },
  snoozed: {
    dot: "bg-muted-foreground/60",
    pill: "bg-muted text-muted-foreground",
  },
  unknown: {
    dot: "border-muted-foreground/70 border bg-transparent",
    pill: "bg-muted text-muted-foreground",
  },
};
