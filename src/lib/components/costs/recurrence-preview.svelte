<script lang="ts">
  import CalendarClockIcon from "@lucide/svelte/icons/calendar-clock";
  import InfoIcon from "@lucide/svelte/icons/info";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import type { RecurrenceRule } from "$lib/costs/recurrence";
  import {
    PREVIEW_DATES,
    clampNote,
    immediateBookings,
    immediateWarning,
    ruleWording,
    upcomingDates,
  } from "$lib/costs/recurrences";
  import { formatDateShort } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    rule,
    today,
    lastBooked = null,
    booking = true,
    ruleHint,
    class: className,
  }: {
    /** The rule as typed, or `null` while a field of it is not valid. */
    rule: RecurrenceRule | null;
    today: string;
    /** The newest occurrence that was booked (an existing recurring cost), else null. */
    lastBooked?: string | null;
    /** Saving books what is due at once; false for a paused or finished recurring cost, which books nothing. */
    booking?: boolean;
    /** A sentence under the dates, e.g. what a changed rhythm does to the entries booked already. */
    ruleHint?: string | undefined;
    class?: string;
  } = $props();

  const wording = $derived(rule ? ruleWording(rule) : null);
  const clamp = $derived(rule ? clampNote(rule) : null);
  const dates = $derived(rule ? upcomingDates(rule, today) : []);
  const warning = $derived(
    rule && booking
      ? immediateWarning(immediateBookings(rule, lastBooked, today), today)
      : null,
  );
</script>

<section
  class={cn(
    "bg-muted/40 flex min-w-0 flex-col gap-3 rounded-xl border p-4",
    className,
  )}
  aria-labelledby="recurrence-preview-title"
  aria-live="polite"
>
  <h3
    id="recurrence-preview-title"
    class="flex items-center gap-2 text-sm font-semibold"
  >
    <CalendarClockIcon
      class="text-muted-foreground size-4 shrink-0"
      aria-hidden="true"
    />
    {m.recurrence_preview_title()}
  </h3>
  {#if wording === null}
    <p class="text-muted-foreground text-sm text-pretty">
      {m.recurrence_preview_invalid()}
    </p>
  {:else}
    <p class="text-sm font-medium text-pretty">{wording}</p>
    {#if clamp}
      <p
        class="text-muted-foreground flex items-start gap-2 text-xs text-pretty"
      >
        <InfoIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>{clamp}</span>
      </p>
    {/if}
    {#if warning}
      <p
        class="border-warning/40 bg-warning/10 text-warning flex items-start gap-2 rounded-lg border px-3 py-2 text-sm text-pretty"
        role="status"
      >
        <TriangleAlertIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{warning}</span>
      </p>
    {/if}
    <div class="flex flex-col gap-1.5">
      <p class="text-muted-foreground text-xs font-medium">
        {m.recurrence_preview_upcoming()}
      </p>
      {#if dates.length === 0}
        <p class="text-sm text-pretty">{m.recurrence_preview_none()}</p>
      {:else}
        <ol class="flex flex-col gap-1 text-sm tabular-nums">
          {#each dates.slice(0, PREVIEW_DATES) as date (date)}
            <li>{formatDateShort(date, { today })}</li>
          {/each}
        </ol>
      {/if}
    </div>
    {#if ruleHint}
      <p class="text-muted-foreground text-xs text-pretty">{ruleHint}</p>
    {/if}
  {/if}
</section>
