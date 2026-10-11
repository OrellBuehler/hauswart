<script lang="ts">
  import CalendarClockIcon from "@lucide/svelte/icons/calendar-clock";
  import MapPinIcon from "@lucide/svelte/icons/map-pin";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import { invalidateAll } from "$app/navigation";
  import type { Appointment } from "$lib/api/schemas/appointments";
  import { formatWhen } from "$lib/appointments/format";
  import type { AppointmentDefaults } from "$lib/appointments/form";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { appointmentHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import AppointmentFormDialog from "./appointment-form-dialog.svelte";

  let {
    appointments,
    timeZone,
    today,
    defaults,
    canWrite,
    addLabel = m.appointment_new(),
    emptyBody,
  }: {
    /** The planned appointments of the record the card sits on, soonest first. */
    appointments: Appointment[];
    /** The household's time zone. */
    timeZone: string;
    today: string;
    /** What a new appointment from this card starts with (the task, device or contact it is for). */
    defaults: AppointmentDefaults;
    canWrite: boolean;
    addLabel?: string;
    emptyBody: string;
  } = $props();

  let createOpen = $state(false);
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="text-base">{m.appointments_card_title()}</Card.Title>
    {#if canWrite && appointments.length > 0}
      <Card.Action>
        <Button size="sm" variant="outline" onclick={() => (createOpen = true)}>
          <PlusIcon />{addLabel}
        </Button>
      </Card.Action>
    {/if}
  </Card.Header>
  <Card.Content>
    {#if appointments.length === 0}
      <EmptyState
        icon={CalendarClockIcon}
        title={m.appointments_card_empty_title()}
        description={emptyBody}
        class="py-8"
      >
        {#snippet actions()}
          {#if canWrite}
            <Button onclick={() => (createOpen = true)}>
              <PlusIcon />{addLabel}
            </Button>
          {/if}
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="divide-y rounded-lg border">
        {#each appointments as appointment (appointment.id)}
          <li>
            <a
              href={appointmentHref(appointment.id)}
              class="hover:bg-accent/50 focus-visible:ring-ring/50 flex flex-col gap-0.5 px-4 py-3 transition-colors outline-none first:rounded-t-lg last:rounded-b-lg focus-visible:ring-[3px]"
            >
              <span class="text-sm font-medium wrap-anywhere"
                >{appointment.title}</span
              >
              <span class="text-muted-foreground text-xs tabular-nums"
                >{formatWhen(appointment, { timeZone, today })}</span
              >
              {#if appointment.location}
                <span
                  class="text-muted-foreground flex items-start gap-1 text-xs wrap-anywhere"
                >
                  <MapPinIcon
                    class="mt-0.5 size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="min-w-0">{appointment.location}</span>
                </span>
              {/if}
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </Card.Content>
</Card.Root>

{#if canWrite}
  <AppointmentFormDialog
    bind:open={createOpen}
    {timeZone}
    {today}
    {defaults}
    onsaved={() => invalidateAll()}
  />
{/if}
