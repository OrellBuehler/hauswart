<script lang="ts">
  import CalendarClockIcon from "@lucide/svelte/icons/calendar-clock";
  import HistoryIcon from "@lucide/svelte/icons/history";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SearchXIcon from "@lucide/svelte/icons/search-x";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { goto, invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { APPOINTMENT_STATUSES } from "$lib/api/enums";
  import { fetchAll } from "$lib/api/fetch-all";
  import { endpoints } from "$lib/api/registry";
  import type { Appointment } from "$lib/api/schemas/appointments";
  import { formatDayHeading } from "$lib/appointments/format";
  import { statusLabels } from "$lib/appointments/labels";
  import {
    APPOINTMENT_VIEWS,
    countSections,
    defaultStatuses,
    filterQuery,
    isDefaultFilter,
    olderRange,
    parseStatuses,
    sectionsFor,
    toggleStatus,
    type AppointmentFilters,
    type AppointmentView,
  } from "$lib/appointments/list";
  import AppointmentFormDialog from "$lib/components/appointments/appointment-form-dialog.svelte";
  import AppointmentRow from "$lib/components/appointments/appointment-row.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const canWrite = $derived(data.scopes.includes("write"));
  const filters = $derived<AppointmentFilters>({
    view: data.view,
    statuses: parseStatuses(page.url.searchParams.get("status"), data.view),
  });

  let createOpen = $state(false);

  let olderState = $state.raw<{
    base: Appointment[];
    items: Appointment[];
  } | null>(null);
  let loadingOlder = $state(false);
  const older = $derived(
    olderState && olderState.base === data.appointments
      ? olderState.items
      : null,
  );
  const all = $derived(
    older ? [...data.appointments, ...older] : data.appointments,
  );

  const sections = $derived(
    sectionsFor(all, filters, { today: data.today, timeZone: data.timeZone }),
  );
  const total = $derived(countSections(sections));
  const isDefault = $derived(isDefaultFilter(filters));

  const viewLabels: Record<AppointmentView, () => string> = {
    upcoming: () => m.appointments_view_upcoming(),
    past: () => m.appointments_view_past(),
  };
  const viewOptions = APPOINTMENT_VIEWS.map((view) => ({
    value: view,
    label: viewLabels[view](),
  }));

  async function apply(next: AppointmentFilters, replace: boolean) {
    await goto(resolve(`/appointments${filterQuery(next)}` as "/"), {
      keepFocus: true,
      noScroll: true,
      replaceState: replace,
    });
  }

  function switchView(view: AppointmentView) {
    void apply({ view, statuses: defaultStatuses(view) }, false);
  }

  function reset() {
    void apply(
      { view: filters.view, statuses: defaultStatuses(filters.view) },
      true,
    );
  }

  async function loadOlder() {
    if (loadingOlder) return;
    loadingOlder = true;
    try {
      const items = await fetchAll((cursor) =>
        api.call(endpoints.appointmentsList, {
          query: {
            ...olderRange(data.today),
            limit: 200,
            ...(cursor ? { cursor } : {}),
          },
        }),
      );
      olderState = { base: data.appointments, items };
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      loadingOlder = false;
    }
  }
</script>

<svelte:head>
  <title>{m.nav_appointments()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader
    title={m.appointments_title()}
    description={m.appointments_description()}
  >
    {#snippet actions()}
      {#if canWrite}
        <Button size="lg" onclick={() => (createOpen = true)}>
          <PlusIcon />{m.appointment_new()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <div class="flex flex-col gap-3">
    <Segmented
      options={viewOptions}
      value={filters.view}
      label={m.appointments_view_label()}
      onchange={switchView}
    />
    <div
      role="group"
      aria-label={m.appointments_filter_status()}
      class="flex flex-wrap gap-1.5"
    >
      {#each APPOINTMENT_STATUSES as status (status)}
        {@const on = filters.statuses.includes(status)}
        <button
          type="button"
          class={cn(
            "focus-visible:ring-ring/50 h-10 rounded-md border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]",
            on
              ? "bg-brand text-brand-foreground border-transparent"
              : "bg-background hover:bg-accent dark:bg-input/30",
          )}
          aria-pressed={on}
          onclick={() =>
            apply(
              { ...filters, statuses: toggleStatus(filters.statuses, status) },
              true,
            )}
        >
          {statusLabels[status]()}
        </button>
      {/each}
    </div>
  </div>

  <p class="text-muted-foreground -mb-3 text-sm" aria-live="polite">
    {m.appointments_count({ count: total })}
  </p>

  {#if total === 0}
    {#if !isDefault}
      <EmptyState
        icon={SearchXIcon}
        title={m.appointments_empty_filtered_title()}
        description={m.appointments_empty_filtered_body()}
      >
        {#snippet actions()}
          <Button variant="outline" onclick={reset}>
            {m.appointments_filter_reset()}
          </Button>
        {/snippet}
      </EmptyState>
    {:else if filters.view === "upcoming"}
      <EmptyState
        icon={CalendarClockIcon}
        title={m.appointments_empty_upcoming_title()}
        description={m.appointments_empty_upcoming_body()}
      >
        {#snippet actions()}
          {#if canWrite}
            <Button onclick={() => (createOpen = true)}>
              <PlusIcon />{m.appointment_new()}
            </Button>
          {/if}
          <Button variant="outline" onclick={() => switchView("past")}>
            {m.appointments_show_past()}
          </Button>
        {/snippet}
      </EmptyState>
    {:else}
      <EmptyState
        icon={HistoryIcon}
        title={m.appointments_empty_past_title()}
        description={m.appointments_empty_past_body()}
      />
    {/if}
  {:else}
    {#if sections.open.length > 0}
      <section class="flex flex-col gap-2" aria-labelledby="appointments-open">
        <h2
          id="appointments-open"
          class="text-warning flex items-center gap-2 text-sm font-semibold"
        >
          <TriangleAlertIcon class="size-4" aria-hidden="true" />
          {m.appointments_open_title()}
          <span
            class="bg-warning/15 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
            >{sections.open.length}</span
          >
        </h2>
        <p class="text-muted-foreground -mt-1 text-xs text-pretty">
          {m.appointments_open_hint()}
        </p>
        <Card.Root class="gap-0 py-0">
          <ul class="divide-y">
            {#each sections.open as appointment (appointment.id)}
              <AppointmentRow
                {appointment}
                timeZone={data.timeZone}
                today={data.today}
              />
            {/each}
          </ul>
        </Card.Root>
      </section>
    {/if}

    {#each sections.days as group (group.date)}
      <section
        class="flex flex-col gap-2"
        aria-labelledby={`appointments-day-${group.date}`}
      >
        <h2
          id={`appointments-day-${group.date}`}
          class="text-sm font-semibold wrap-anywhere"
        >
          {formatDayHeading(group.date, { today: data.today })}
        </h2>
        <Card.Root class="gap-0 py-0">
          <ul class="divide-y">
            {#each group.items as appointment (appointment.id)}
              <AppointmentRow
                {appointment}
                timeZone={data.timeZone}
                today={data.today}
                day={group.date}
              />
            {/each}
          </ul>
        </Card.Root>
      </section>
    {/each}
  {/if}

  {#if filters.view === "past"}
    <div class="flex flex-col items-center gap-2">
      {#if older === null}
        <Button
          variant="outline"
          size="lg"
          disabled={loadingOlder}
          onclick={loadOlder}
        >
          {#if loadingOlder}
            <LoaderCircleIcon class="animate-spin" />
          {/if}
          {m.appointments_load_older()}
        </Button>
      {:else if older.length === 0}
        <p class="text-muted-foreground text-sm">
          {m.appointments_older_none()}
        </p>
      {/if}
    </div>
  {/if}
</div>

{#if canWrite}
  <AppointmentFormDialog
    bind:open={createOpen}
    timeZone={data.timeZone}
    today={data.today}
    onsaved={() => invalidateAll()}
  />
{/if}
