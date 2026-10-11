import type { AppointmentStatus } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";

export const statusLabels: Record<AppointmentStatus, () => string> = {
  planned: () => m.appointment_status_planned(),
  done: () => m.appointment_status_done(),
  cancelled: () => m.appointment_status_cancelled(),
};

/** Tinted pill and dot per status; readable in light and dark. */
export const statusTones: Record<
  AppointmentStatus,
  { pill: string; dot: string }
> = {
  planned: { pill: "bg-chart-2/15 text-foreground", dot: "bg-chart-2" },
  done: { pill: "bg-success/12 text-success", dot: "bg-success" },
  cancelled: {
    pill: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/60",
  },
};
