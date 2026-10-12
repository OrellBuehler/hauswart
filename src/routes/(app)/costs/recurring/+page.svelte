<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PauseIcon from "@lucide/svelte/icons/pause";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlayIcon from "@lucide/svelte/icons/play";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import RepeatIcon from "@lucide/svelte/icons/repeat";
  import SquareCheckBigIcon from "@lucide/svelte/icons/square-check-big";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { goto, invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { CostRecurrence } from "$lib/api/schemas/cost-recurrences";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import Fab from "$lib/components/app/fab.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import CostAmount from "$lib/components/costs/cost-amount.svelte";
  import RecurrenceStatus from "$lib/components/costs/recurrence-status.svelte";
  import TagChips from "$lib/components/costs/tag-chips.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { categoryLabels } from "$lib/costs/labels";
  import { RecurrenceControls } from "$lib/costs/recurrence-controls.svelte";
  import {
    clampNote,
    isDue,
    recurrenceErrorMessage,
    recurrenceState,
    ruleOf,
    ruleWording,
  } from "$lib/costs/recurrences";
  import { formatDay } from "$lib/format";
  import { invalidateAfterOverlay } from "$lib/overlays/use-overlay-history.svelte";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const canWrite = $derived(data.scopes.includes("costs:write"));
  const sections = $derived(
    (["active", "paused", "finished"] as const)
      .map((state) => ({
        state,
        items: data.recurrences.filter((r) => recurrenceState(r) === state),
      }))
      .filter((section) => section.items.length > 0),
  );
  const sectionTitles = {
    active: () => m.recurrence_section_active(),
    paused: () => m.recurrence_section_paused(),
    finished: () => m.recurrence_section_finished(),
  } as const;

  const controls = new RecurrenceControls({
    onchanged: () => invalidateAll(),
    viewEntry: (id) => void goto(resolve(`/costs/${id}` as "/")),
  });

  let deleteOpen = $state(false);
  let deleting = $state<CostRecurrence | undefined>();

  function askDelete(recurrence: CostRecurrence) {
    deleting = recurrence;
    deleteOpen = true;
  }

  async function remove() {
    const recurrence = deleting;
    if (!recurrence) return;
    await api.call(endpoints.costRecurrencesDelete, {
      params: { id: recurrence.id },
    });
    toast.success(m.recurrence_deleted_toast({ title: recurrence.title }));
    await invalidateAfterOverlay();
  }

  const newHref = $derived(resolve("/costs/recurring/new"));
</script>

<svelte:head>
  <title>{m.recurrence_title()} · {m.nav_costs()} · {m.app_name()}</title>
</svelte:head>

{#snippet row(recurrence: CostRecurrence)}
  {@const state = recurrenceState(recurrence)}
  {@const error = recurrenceErrorMessage(recurrence)}
  {@const rule = ruleOf(recurrence)}
  {@const busy =
    controls.busy?.id === recurrence.id ? controls.busy.action : null}
  <li class="relative flex min-w-0 flex-col gap-2 p-4">
    <div class="flex min-w-0 items-start gap-3">
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold text-pretty wrap-anywhere">
          <a
            href={resolve(`/costs/recurring/${recurrence.id}` as "/")}
            class="focus-visible:ring-ring/50 focus-visible:after:ring-ring/50 rounded-sm outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px]"
            >{recurrence.title}</a
          >
        </h3>
        <p
          class="text-muted-foreground mt-0.5 text-xs text-pretty wrap-anywhere"
        >
          {ruleWording(rule)}
          <span aria-hidden="true">·</span>
          {recurrence.bookName}
          <span aria-hidden="true">·</span>
          {categoryLabels[recurrence.category]()}
        </p>
      </div>
      <CostAmount
        amountMinor={recurrence.amountMinor}
        currency={recurrence.currency}
        class="shrink-0 text-sm font-semibold"
      />
      {#if canWrite}
        <div class="relative z-10 -me-2 -mt-1.5 shrink-0">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="ghost"
                  size="icon-lg"
                  disabled={controls.busy !== null}
                  aria-label={m.recurrence_actions({ title: recurrence.title })}
                >
                  {#if busy}
                    <LoaderCircleIcon class="animate-spin" />
                  {:else}
                    <EllipsisVerticalIcon />
                  {/if}
                </Button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item
                onclick={() =>
                  goto(
                    resolve(`/costs/recurring/${recurrence.id}/edit` as "/"),
                  )}
              >
                <PencilIcon />{m.common_edit()}
              </DropdownMenu.Item>
              {#if isDue(recurrence, data.today)}
                <DropdownMenu.Item onSelect={() => controls.run(recurrence)}>
                  <SquareCheckBigIcon />{m.recurrence_run_now()}
                </DropdownMenu.Item>
              {/if}
              {#if state === "active"}
                <DropdownMenu.Item onSelect={() => controls.pause(recurrence)}>
                  <PauseIcon />{m.recurrence_pause()}
                </DropdownMenu.Item>
              {:else if state === "paused"}
                <DropdownMenu.Item onSelect={() => controls.resume(recurrence)}>
                  <PlayIcon />{m.recurrence_resume()}
                </DropdownMenu.Item>
              {/if}
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                variant="destructive"
                onclick={() => askDelete(recurrence)}
              >
                <Trash2Icon />{m.common_delete()}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      <RecurrenceStatus {state} />
      <span class="text-muted-foreground tabular-nums">
        {#if state === "finished"}
          {m.recurrence_over()}
        {:else if isDue(recurrence, data.today)}
          {m.recurrence_due_now()}
        {:else}
          {m.recurrence_next_on({ date: formatDay(recurrence.nextDate ?? "") })}
        {/if}
      </span>
      <span class="text-muted-foreground tabular-nums">
        {recurrence.lastOccurrenceDate
          ? m.recurrence_last_on({
              date: formatDay(recurrence.lastOccurrenceDate),
            })
          : m.recurrence_never_booked()}
      </span>
    </div>
    {#if clampNote(rule)}
      <p class="text-muted-foreground text-xs text-pretty">{clampNote(rule)}</p>
    {/if}
    <TagChips tags={recurrence.tags} />
    {#if error}
      <p
        class="border-destructive/40 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-pretty"
        role="alert"
      >
        <CircleAlertIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span class="min-w-0">{error}</span>
      </p>
    {/if}
  </li>
{/snippet}

<div class="flex flex-col gap-6">
  <div class="max-md:hidden">
    <a
      href={resolve("/costs")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -ms-1 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      <ArrowLeftIcon class="size-4" aria-hidden="true" />
      {m.cost_back()}
    </a>
  </div>

  <PageHeader
    title={m.recurrence_title()}
    description={m.recurrence_description()}
  >
    {#snippet actions()}
      {#if canWrite}
        <Button href={newHref} size="lg" class="max-md:hidden">
          <PlusIcon />
          {m.recurrence_new()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  {#if controls.error && !data.recurrences.some((r) => recurrenceErrorMessage(r) === controls.error)}
    <p class="text-destructive text-sm" role="alert">{controls.error}</p>
  {/if}

  {#if data.recurrences.length === 0}
    <EmptyState
      icon={RepeatIcon}
      title={m.recurrence_empty_title()}
      description={m.recurrence_empty_body()}
    >
      {#snippet actions()}
        {#if canWrite}
          <Button href={newHref}><PlusIcon />{m.recurrence_new()}</Button>
        {/if}
      {/snippet}
    </EmptyState>
  {:else}
    <p class="text-muted-foreground -mb-3 text-sm" aria-live="polite">
      {m.recurrence_count({ count: data.recurrences.length })}
    </p>
    {#each sections as section (section.state)}
      <section
        class="flex flex-col gap-2"
        aria-labelledby={`recurrence-${section.state}`}
      >
        <h2
          id={`recurrence-${section.state}`}
          class="text-muted-foreground flex items-baseline gap-2 text-sm font-semibold"
        >
          {sectionTitles[section.state]()}
          <span class="text-xs font-normal tabular-nums"
            >{section.items.length}</span
          >
        </h2>
        <Card.Root class="gap-0 py-0">
          <ul class="divide-y">
            {#each section.items as recurrence (recurrence.id)}
              {@render row(recurrence)}
            {/each}
          </ul>
        </Card.Root>
      </section>
    {/each}
  {/if}
</div>

{#if canWrite}
  <Fab href={newHref} label={m.recurrence_new()} />
  <ConfirmDialog
    bind:open={deleteOpen}
    title={m.recurrence_delete_title()}
    description={m.recurrence_delete_description({
      title: deleting?.title ?? "",
    })}
    confirmLabel={m.common_delete()}
    pendingLabel={m.common_deleting()}
    destructive
    onconfirm={remove}
  />
{/if}
