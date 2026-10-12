<script lang="ts">
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import PauseIcon from "@lucide/svelte/icons/pause";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { resolve } from "$app/paths";
  import type { CostBudgetStatusItem } from "$lib/api/schemas/cost-budgets";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Progress } from "$lib/components/ui/progress/index.js";
  import {
    budgetDisplay,
    budgetEntriesQuery,
    budgetPeriodLabels,
    budgetScope,
  } from "$lib/costs/budgets";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    item,
    canWrite = false,
    onedit,
    onpause,
    ondelete,
  }: {
    item: CostBudgetStatusItem;
    canWrite?: boolean;
    onedit: () => void;
    onpause: () => void;
    ondelete: () => void;
  } = $props();

  const display = $derived(budgetDisplay(item));
  const scope = $derived(budgetScope(item.budget));
  const name = $derived(`${scope.title} · ${scope.subtitle}`);

  /** State by colour, icon and word together: the bar's colour never carries it alone. */
  const tones = {
    ok: {
      icon: CircleCheckIcon,
      text: "text-success",
      track: "bg-brand/15 **:data-[slot=progress-indicator]:bg-brand",
      border: "",
    },
    warning: {
      icon: TriangleAlertIcon,
      text: "text-warning",
      track: "bg-warning/20 **:data-[slot=progress-indicator]:bg-warning",
      border: "border-warning/40",
    },
    exceeded: {
      icon: CircleAlertIcon,
      text: "text-destructive",
      track:
        "bg-destructive/20 **:data-[slot=progress-indicator]:bg-destructive",
      border: "border-destructive/50",
    },
  } as const;
  const tone = $derived(tones[display.state]);
  const Icon = $derived(tone.icon);
</script>

<li
  class={cn(
    "bg-card shadow-card flex min-w-0 flex-col gap-3 rounded-xl border p-4",
    tone.border,
  )}
  data-state={display.state}
>
  <div class="flex min-w-0 items-start gap-3">
    <div class="min-w-0 flex-1">
      <h3 class="text-sm font-semibold text-pretty wrap-anywhere">
        {scope.title}
      </h3>
      <p class="text-muted-foreground mt-0.5 text-xs wrap-anywhere">
        {scope.subtitle}
        <span aria-hidden="true">·</span>
        {budgetPeriodLabels[item.budget.period]()}
      </p>
    </div>
    <div class="shrink-0 text-end">
      <p class="text-sm font-semibold whitespace-nowrap tabular-nums">
        {display.spentText}
      </p>
      <p class="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
        {m.budget_of({ amount: display.amountText })}
      </p>
    </div>
    {#if canWrite}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-lg"
              class="-me-2 -mt-1.5"
              aria-label={m.budget_actions({ name })}
            >
              <EllipsisVerticalIcon />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Item onclick={onedit}>
            <PencilIcon />{m.common_edit()}
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={onpause}>
            <PauseIcon />{m.budgets_pause()}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item variant="destructive" onclick={ondelete}>
            <Trash2Icon />{m.common_delete()}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>

  <Progress
    value={display.barPercent}
    class={cn("h-2.5", tone.track)}
    aria-label={m.budget_bar_label({ name })}
    aria-valuetext={display.summary}
  />

  <div
    class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm"
  >
    <p class={cn("flex items-center gap-1.5 font-medium", tone.text)}>
      <Icon class="size-4 shrink-0" aria-hidden="true" />
      <span>{display.stateLabel}</span>
      <span class="font-normal tabular-nums">· {display.percentText}</span>
    </p>
    <p class="text-muted-foreground tabular-nums">{display.remainingText}</p>
  </div>

  <p class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
    <span>{m.budget_entries({ count: item.entryCount })}</span>
    {#if item.entryCount > 0}
      <!-- eslint-disable svelte/no-navigation-without-resolve -- the address is resolved here, only the query is appended -->
      <a
        href={resolve(`/costs${budgetEntriesQuery(item)}` as "/")}
        class="text-foreground focus-visible:ring-ring/50 rounded font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px]"
        >{m.budgets_show_entries()}</a
      >
      <!-- eslint-enable svelte/no-navigation-without-resolve -->
    {/if}
  </p>
</li>
