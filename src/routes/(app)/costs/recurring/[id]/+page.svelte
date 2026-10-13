<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import InfoIcon from "@lucide/svelte/icons/info";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PauseIcon from "@lucide/svelte/icons/pause";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlayIcon from "@lucide/svelte/icons/play";
  import SquareCheckBigIcon from "@lucide/svelte/icons/square-check-big";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { goto, invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import CostAmount from "$lib/components/costs/cost-amount.svelte";
  import RecurrenceStatus from "$lib/components/costs/recurrence-status.svelte";
  import RecurrenceUpcoming from "$lib/components/costs/recurrence-upcoming.svelte";
  import TagChips from "$lib/components/costs/tag-chips.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import {
    categoryIcons,
    categoryLabels,
    deductibleLabels,
    splitModeLabels,
  } from "$lib/costs/labels";
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
  import { assetHref, roomHref } from "$lib/links";
  import { gotoFromOverlay } from "$lib/overlays/use-overlay-history.svelte";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const recurrence = $derived(data.recurrence);
  const canWrite = $derived(data.scopes.includes("costs:write"));
  const status = $derived(recurrenceState(recurrence));
  const rule = $derived(ruleOf(recurrence));
  const due = $derived(isDue(recurrence, data.today));
  const error = $derived(recurrenceErrorMessage(recurrence));
  const clamp = $derived(clampNote(rule));
  const CategoryIcon = $derived(categoryIcons[recurrence.category]);

  const controls = new RecurrenceControls({
    onchanged: () => invalidateAll(),
    viewEntry: (id) => void goto(resolve(`/costs/${id}` as "/")),
  });
  const running = $derived(
    controls.busy?.id === recurrence.id ? controls.busy.action : null,
  );

  let deleteOpen = $state(false);

  async function remove() {
    await api.call(endpoints.costRecurrencesDelete, {
      params: { id: recurrence.id },
    });
    toast.success(m.recurrence_deleted_toast({ title: recurrence.title }));
    await gotoFromOverlay(resolve("/costs/recurring"), { invalidateAll: true });
  }

  const linkClass =
    "focus-visible:ring-ring/50 rounded underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]";
</script>

<svelte:head>
  <title>{recurrence.title} · {m.recurrence_title()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="max-md:hidden">
    <a
      href={resolve("/costs/recurring")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -ms-1 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      <ArrowLeftIcon class="size-4" aria-hidden="true" />
      {m.recurrence_back()}
    </a>
  </div>

  <header class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <p class="text-muted-foreground flex items-center gap-2 text-sm">
        <CategoryIcon class="size-4" aria-hidden="true" />
        <span>{categoryLabels[recurrence.category]()}</span>
        <span aria-hidden="true">·</span>
        <span class="wrap-anywhere">{recurrence.bookName}</span>
      </p>
      <h1
        class="text-2xl font-semibold tracking-tight text-balance wrap-anywhere md:text-3xl"
      >
        {recurrence.title}
      </h1>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <CostAmount
          amountMinor={recurrence.amountMinor}
          currency={recurrence.currency}
          class="text-2xl font-semibold"
        />
        <RecurrenceStatus state={status} />
      </div>
      <TagChips tags={recurrence.tags} limit={10} />
    </div>

    {#if canWrite}
      <div class="flex flex-wrap items-center gap-2">
        <Button
          size="lg"
          variant="outline"
          href={resolve(`/costs/recurring/${recurrence.id}/edit` as "/")}
        >
          <PencilIcon />
          {m.common_edit()}
        </Button>
        {#if status === "active"}
          <Button
            size="lg"
            variant="outline"
            disabled={controls.busy !== null}
            onclick={() => controls.pause(recurrence)}
          >
            {#if running === "pause"}
              <LoaderCircleIcon class="animate-spin" />{m.recurrence_pausing()}
            {:else}
              <PauseIcon />{m.recurrence_pause()}
            {/if}
          </Button>
        {:else if status === "paused"}
          <Button
            size="lg"
            variant="outline"
            disabled={controls.busy !== null}
            onclick={() => controls.resume(recurrence)}
          >
            {#if running === "resume"}
              <LoaderCircleIcon class="animate-spin" />{m.recurrence_resuming()}
            {:else}
              <PlayIcon />{m.recurrence_resume()}
            {/if}
          </Button>
        {/if}
        {#if status === "active"}
          <Button
            size="lg"
            variant={due ? "default" : "outline"}
            disabled={!due || controls.busy !== null}
            onclick={() => controls.run(recurrence)}
          >
            {#if running === "run"}
              <LoaderCircleIcon class="animate-spin" />{m.recurrence_running()}
            {:else}
              <SquareCheckBigIcon />{m.recurrence_run_now()}
            {/if}
          </Button>
        {/if}
        <Button
          size="lg"
          variant="outline"
          class="text-destructive hover:text-destructive"
          disabled={controls.busy !== null}
          onclick={() => (deleteOpen = true)}
        >
          <Trash2Icon />
          {m.common_delete()}
        </Button>
      </div>
      {#if status === "active"}
        <p class="text-muted-foreground -mt-2 text-xs text-pretty">
          {m.recurrence_run_hint()}
        </p>
      {/if}
    {/if}
    {#if controls.error && controls.error !== error}
      <p class="text-destructive text-sm" role="alert">{controls.error}</p>
    {/if}
  </header>

  {#if error}
    <div
      class="border-destructive/40 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border px-4 py-3 text-sm text-pretty"
      role="alert"
    >
      <CircleAlertIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span class="min-w-0">{error}</span>
    </div>
  {/if}

  <div
    class="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
  >
    <Card.Root class="min-w-0 lg:col-start-1">
      <Card.Header>
        <Card.Title class="text-base">{m.recurrence_rule_label()}</Card.Title>
        <Card.Description class="text-foreground text-sm font-medium">
          {ruleWording(rule)}
        </Card.Description>
      </Card.Header>
      <Card.Content class="flex flex-col gap-4">
        {#if clamp}
          <p
            class="text-muted-foreground flex items-start gap-2 text-xs text-pretty"
          >
            <InfoIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{clamp}</span>
          </p>
        {/if}
        <dl class="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">
              {m.recurrence_start_label()}
            </dt>
            <dd class="mt-0.5 tabular-nums">
              {formatDay(recurrence.startDate)}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">
              {m.recurrence_end_label()}
            </dt>
            <dd class="mt-0.5 tabular-nums">
              {recurrence.endDate
                ? formatDay(recurrence.endDate)
                : m.recurrence_end_none()}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{m.recurrence_next()}</dt>
            <dd class="mt-0.5 tabular-nums">
              {#if recurrence.nextDate}
                {formatDay(recurrence.nextDate)}
                {#if due}
                  <span class="text-muted-foreground block text-xs"
                    >{m.recurrence_due_now()}</span
                  >
                {/if}
              {:else}
                {m.recurrence_over()}
              {/if}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">
              {m.recurrence_last_label()}
            </dt>
            <dd class="mt-0.5 tabular-nums">
              {recurrence.lastOccurrenceDate
                ? formatDay(recurrence.lastOccurrenceDate)
                : m.recurrence_never_booked()}
            </dd>
          </div>
        </dl>
      </Card.Content>
    </Card.Root>

    <aside
      class="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-span-3 lg:row-start-1"
    >
      <RecurrenceUpcoming {recurrence} {rule} today={data.today} />
    </aside>

    <Card.Root class="min-w-0 lg:col-start-1">
      <Card.Header>
        <Card.Title class="text-base">{m.recurrence_facts()}</Card.Title>
      </Card.Header>
      <Card.Content>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-4 text-sm sm:gap-x-6">
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{m.cost_book()}</dt>
            <dd class="mt-0.5 wrap-anywhere">
              <!-- eslint-disable svelte/no-navigation-without-resolve -- the address is resolved here, only the query is appended -->
              <a
                href={resolve(
                  `/costs?book=${encodeURIComponent(recurrence.bookId)}` as "/",
                )}
                class={linkClass}>{recurrence.bookName}</a
              >
              <!-- eslint-enable svelte/no-navigation-without-resolve -->
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{m.cost_paid_by()}</dt>
            <dd class="mt-0.5 wrap-anywhere">
              {recurrence.paidByName ?? m.cost_payer_open()}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{m.cost_payee()}</dt>
            <dd class="mt-0.5 wrap-anywhere">{recurrence.payee ?? "–"}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{m.cost_split()}</dt>
            <dd class="mt-0.5">{splitModeLabels[recurrence.splitMode]()}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{m.cost_asset()}</dt>
            <dd class="mt-0.5 wrap-anywhere">
              {#if recurrence.assetId && recurrence.assetName}
                <a href={assetHref(recurrence.assetId)} class={linkClass}
                  >{recurrence.assetName}</a
                >
              {:else}
                –
              {/if}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{m.cost_room()}</dt>
            <dd class="mt-0.5 wrap-anywhere">
              {#if recurrence.roomId && recurrence.roomName}
                <a href={roomHref(recurrence.roomId)} class={linkClass}
                  >{recurrence.roomName}</a
                >
              {:else}
                –
              {/if}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">
              {m.cost_counts_as_expense()}
            </dt>
            <dd class="mt-0.5">
              {recurrence.countsAsExpense ? m.common_yes() : m.common_no()}
            </dd>
          </div>
          {#if recurrence.deductible !== "unknown"}
            <div class="min-w-0">
              <dt class="text-muted-foreground text-xs">
                {m.cost_deductible()}
              </dt>
              <dd class="mt-0.5">
                {deductibleLabels[recurrence.deductible]()}
              </dd>
            </div>
          {/if}
        </dl>
        {#if recurrence.notes}
          <div class={cn("mt-5 border-t pt-4")}>
            <p class="text-muted-foreground text-xs">{m.cost_notes()}</p>
            <p class="mt-0.5 text-sm wrap-anywhere whitespace-pre-line">
              {recurrence.notes}
            </p>
          </div>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>
</div>

{#if canWrite}
  <ConfirmDialog
    bind:open={deleteOpen}
    title={m.recurrence_delete_title()}
    description={m.recurrence_delete_description({ title: recurrence.title })}
    confirmLabel={m.common_delete()}
    pendingLabel={m.common_deleting()}
    destructive
    onconfirm={remove}
  />
{/if}
