import type { DefectSeverity, DefectStatus } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";

export const statusLabels: Record<DefectStatus, () => string> = {
  open: () => m.defect_status_open(),
  reported: () => m.defect_status_reported(),
  in_progress: () => m.defect_status_in_progress(),
  fixed: () => m.defect_status_fixed(),
  rejected: () => m.defect_status_rejected(),
};

export const severityLabels: Record<DefectSeverity, () => string> = {
  low: () => m.defect_severity_low(),
  medium: () => m.defect_severity_medium(),
  high: () => m.defect_severity_high(),
};

/** Tinted pill and dot per status; readable in light and dark. */
export const statusTones: Record<
  DefectStatus,
  { pill: string; dot: string; step: string }
> = {
  open: {
    pill: "bg-warning/15 text-warning",
    dot: "bg-warning",
    step: "border-warning bg-warning text-background",
  },
  reported: {
    pill: "bg-chart-2/15 text-foreground",
    dot: "bg-chart-2",
    step: "border-chart-2 bg-chart-2 text-background",
  },
  in_progress: {
    pill: "bg-chart-4/15 text-foreground",
    dot: "bg-chart-4",
    step: "border-chart-4 bg-chart-4 text-background",
  },
  fixed: {
    pill: "bg-success/12 text-success",
    dot: "bg-success",
    step: "border-success bg-success text-background",
  },
  rejected: {
    pill: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/60",
    step: "border-muted-foreground bg-muted-foreground text-background",
  },
};

export const severityTones: Record<DefectSeverity, string> = {
  high: "border-destructive/30 bg-destructive/10 text-destructive",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "text-muted-foreground",
};
