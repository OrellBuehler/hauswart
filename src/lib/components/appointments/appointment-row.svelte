<script lang="ts">
  import BoxesIcon from "@lucide/svelte/icons/boxes";
  import ContactIcon from "@lucide/svelte/icons/contact";
  import ListChecksIcon from "@lucide/svelte/icons/list-checks";
  import MapPinIcon from "@lucide/svelte/icons/map-pin";
  import type { Appointment } from "$lib/api/schemas/appointments";
  import { timeColumn } from "$lib/appointments/format";
  import { needsClosing } from "$lib/appointments/list";
  import CommentCount from "$lib/components/comments/comment-count.svelte";
  import {
    appointmentHref,
    assetHref,
    contactHref,
    taskHref,
  } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import AppointmentStatusBadge from "./appointment-status-badge.svelte";

  let {
    appointment,
    timeZone,
    today,
    day,
    class: className,
  }: {
    appointment: Appointment;
    /** The household's time zone. */
    timeZone: string;
    today: string;
    /** The day of the heading the row sits under, when that is not the first day of the appointment. */
    day?: string;
    class?: string;
  } = $props();

  const time = $derived(
    timeColumn(appointment, { timeZone, today, ...(day ? { day } : {}) }),
  );
  const open = $derived(needsClosing(appointment, today, timeZone));
  const linkClass =
    "focus-visible:ring-ring/50 relative z-10 -my-1.5 inline-flex max-w-full items-center gap-1 rounded py-1.5 outline-none hover:underline focus-visible:ring-[3px]";
</script>

<li
  class={cn(
    "hover:bg-accent/50 relative grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 px-4 py-3.5 transition-colors first:rounded-t-xl last:rounded-b-xl",
    appointment.status === "cancelled" && "text-muted-foreground",
    className,
  )}
>
  <p class="pt-0.5 text-xs leading-snug tabular-nums">
    <span class="text-foreground block font-medium wrap-anywhere"
      >{time.primary}</span
    >
    {#if time.secondary}
      <span class="text-muted-foreground block wrap-anywhere"
        >{time.secondary}</span
      >
    {/if}
  </p>
  <div class="min-w-0">
    <div class="flex items-start justify-between gap-3">
      <a
        href={appointmentHref(appointment.id)}
        class={cn(
          "focus-visible:after:ring-ring/50 rounded-sm text-sm font-medium text-pretty wrap-anywhere outline-none after:absolute after:inset-0 hover:underline focus-visible:after:ring-[3px]",
          appointment.status === "cancelled" && "line-through",
        )}>{appointment.title}</a
      >
      <CommentCount count={appointment.commentCount} class="mt-0.5 shrink-0" />
    </div>
    {#if appointment.location}
      <p
        class="text-muted-foreground mt-0.5 flex items-start gap-1 text-xs wrap-anywhere"
      >
        <MapPinIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span class="min-w-0">{appointment.location}</span>
      </p>
    {/if}
    {#if appointment.status !== "planned" || open || appointment.taskId || appointment.assetId || appointment.contactId}
      <div
        class="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs"
      >
        {#if open}
          <span
            class="bg-warning/15 text-warning inline-flex items-center rounded-full px-2 py-0.5 font-medium whitespace-nowrap"
            >{m.appointment_open_badge()}</span
          >
        {:else if appointment.status !== "planned"}
          <AppointmentStatusBadge status={appointment.status} />
        {/if}
        {#if appointment.taskId && appointment.taskTitle}
          <a href={taskHref(appointment.taskId)} class={linkClass}>
            <ListChecksIcon class="size-3.5 shrink-0" aria-hidden="true" />
            <span class="min-w-0 truncate">{appointment.taskTitle}</span>
          </a>
        {/if}
        {#if appointment.assetId && appointment.assetName}
          <a href={assetHref(appointment.assetId)} class={linkClass}>
            <BoxesIcon class="size-3.5 shrink-0" aria-hidden="true" />
            <span class="min-w-0 truncate">{appointment.assetName}</span>
          </a>
        {/if}
        {#if appointment.contactId && appointment.contactName}
          <a href={contactHref(appointment.contactId)} class={linkClass}>
            <ContactIcon class="size-3.5 shrink-0" aria-hidden="true" />
            <span class="min-w-0 truncate">{appointment.contactName}</span>
          </a>
        {/if}
      </div>
    {/if}
  </div>
</li>
