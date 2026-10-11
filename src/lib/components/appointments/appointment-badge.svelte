<script lang="ts">
  import CalendarClockIcon from "@lucide/svelte/icons/calendar-clock";
  import type { NextAppointment } from "$lib/api/schemas/tasks";
  import { formatStart } from "$lib/appointments/format";
  import { appointmentHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    appointment,
    timeZone,
    today,
    linked = true,
    class: className,
  }: {
    /** The earliest planned appointment of a task. */
    appointment: NextAppointment;
    /** The household's time zone. */
    timeZone: string;
    today: string;
    /** A link to the appointment; `false` inside a row that is a link itself. */
    linked?: boolean;
    class?: string;
  } = $props();

  const text = $derived(formatStart(appointment, { timeZone, today }));
  const classes = $derived(
    cn(
      "bg-muted/60 text-foreground inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
      className,
    ),
  );
</script>

{#if linked}
  <a
    href={appointmentHref(appointment.id)}
    class={cn(
      classes,
      "focus-visible:ring-ring/50 relative z-10 outline-none hover:underline focus-visible:ring-[3px]",
    )}
  >
    <CalendarClockIcon class="size-3.5 shrink-0" aria-hidden="true" />
    <span class="sr-only">{m.appointment_badge_prefix()}</span>
    <span class="min-w-0 truncate">{text}</span>
  </a>
{:else}
  <span class={classes}>
    <CalendarClockIcon class="size-3.5 shrink-0" aria-hidden="true" />
    <span class="sr-only">{m.appointment_badge_prefix()}</span>
    <span class="min-w-0 truncate">{text}</span>
  </span>
{/if}
