<script lang="ts">
  import { COST_SPLIT_MODES, type CostSplitMode } from "$lib/api/enums";
  import type { DirectoryUser } from "$lib/api/schemas/users";
  import Segmented from "$lib/components/tasks/segmented.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { equalShares, parseShares, sharePreview } from "$lib/costs/form";
  import { splitModeHints, splitModeLabels } from "$lib/costs/labels";
  import { formatPercent } from "$lib/format";
  import { formatMoney } from "$lib/format-money";
  import { SHARE_BPS_TOTAL } from "$lib/api/schemas/costs";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let {
    id,
    mode = $bindable("ownership"),
    shares = $bindable({}),
    participants = $bindable([]),
    people,
    amountMinor,
    currency,
    error,
    participantsError,
    onmodechange,
    class: className,
  }: {
    id: string;
    mode?: CostSplitMode;
    /** Percent as typed, per user id. */
    shares?: Record<string, string>;
    /** Who shares an equal split (user ids). */
    participants?: string[];
    people: DirectoryUser[];
    /** The entry's amount, when it is known and valid; shows each person's part. */
    amountMinor?: number | undefined;
    currency: string;
    error?: string | undefined;
    participantsError?: string | undefined;
    /** The person picked a split mode (not set by code). */
    onmodechange?: (mode: CostSplitMode) => void;
    class?: string;
  } = $props();

  const userIds = $derived(people.map((p) => p.id));
  const options = $derived(
    COST_SPLIT_MODES.map((value) => ({
      value,
      label: splitModeLabels[value](),
    })),
  );
  const parsed = $derived(parseShares(shares, userIds));
  const missingBps = $derived(SHARE_BPS_TOTAL - parsed.totalBps);
  const preview = $derived(
    amountMinor !== undefined && parsed.invalid.length === 0
      ? sharePreview(amountMinor, parsed.items)
      : new Map<string, number>(),
  );
  const status = $derived(
    parsed.invalid.length > 0
      ? { tone: "bad" as const, text: m.cost_shares_invalid() }
      : missingBps === 0
        ? { tone: "ok" as const, text: m.cost_shares_total_ok() }
        : missingBps > 0
          ? {
              tone: "bad" as const,
              text: m.cost_shares_missing({
                percent: formatPercent(missingBps),
              }),
            }
          : {
              tone: "bad" as const,
              text: m.cost_shares_over({ percent: formatPercent(-missingBps) }),
            },
  );

  const equalParts = $derived(
    amountMinor !== undefined && participants.length > 0
      ? sharePreview(
          amountMinor,
          participants.map((userId) => ({ userId, shareBps: 1 })),
        )
      : new Map<string, number>(),
  );

  function pick(next: CostSplitMode) {
    if (next === "custom" && parsed.items.length === 0) {
      shares = equalShares(userIds);
    }
    onmodechange?.(next);
  }

  function toggle(userId: string, on: boolean) {
    participants = on
      ? [...participants.filter((id) => id !== userId), userId]
      : participants.filter((id) => id !== userId);
  }
</script>

<div class={cn("flex flex-col gap-3", className)}>
  <div class="flex flex-col gap-2">
    <span class="text-sm leading-none font-medium">{m.cost_split()}</span>
    <Segmented
      {options}
      bind:value={mode}
      label={m.cost_split()}
      onchange={pick}
    />
    <p class="text-muted-foreground text-xs text-pretty">
      {splitModeHints[mode]()}
    </p>
  </div>

  {#if mode === "equal"}
    <div
      role="group"
      aria-labelledby={`${id}-whom`}
      aria-describedby={participantsError ? `${id}-whom-error` : undefined}
      class="flex flex-col gap-1"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span id={`${id}-whom`} class="text-sm leading-none font-medium"
          >{m.cost_for_whom()}</span
        >
        {#if participants.length < people.length}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onclick={() => (participants = [...userIds])}
          >
            {m.cost_for_whom_everyone()}
          </Button>
        {/if}
      </div>
      <ul class="flex flex-col">
        {#each people as person (person.id)}
          {@const part = equalParts.get(person.id)}
          <li>
            <label
              class="hover:bg-accent/50 flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 py-1"
            >
              <Checkbox
                checked={participants.includes(person.id)}
                onCheckedChange={(checked) => toggle(person.id, checked)}
                aria-invalid={Boolean(participantsError) || undefined}
              />
              <span class="min-w-0 flex-1 truncate text-sm"
                >{person.displayName}</span
              >
              {#if part !== undefined}
                <span class="text-muted-foreground text-xs tabular-nums"
                  >{formatMoney(part, currency)}</span
                >
              {/if}
            </label>
          </li>
        {/each}
      </ul>
      {#if participantsError}
        <p id={`${id}-whom-error`} class="text-destructive text-xs text-pretty">
          {participantsError}
        </p>
      {/if}
    </div>
  {/if}

  {#if mode === "custom"}
    <fieldset
      class="flex flex-col gap-3 rounded-lg border p-3"
      aria-describedby={error ? `${id}-error` : `${id}-total`}
    >
      <legend class="sr-only">{m.cost_shares_title()}</legend>
      <ul class="flex flex-col gap-3">
        {#each people as person (person.id)}
          {@const part = preview.get(person.id)}
          {@const bad = parsed.invalid.includes(person.id)}
          <li class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
            <div class="min-w-0">
              <Label
                for={`${id}-${person.id}`}
                class="block truncate leading-snug font-normal"
                >{person.displayName}</Label
              >
              {#if part !== undefined}
                <span class="text-muted-foreground text-xs tabular-nums"
                  >{formatMoney(part, currency)}</span
                >
              {/if}
            </div>
            <div class="relative w-28">
              <Input
                id={`${id}-${person.id}`}
                type="text"
                inputmode="decimal"
                autocomplete="off"
                class="h-10 pe-8 text-end tabular-nums"
                aria-invalid={bad || Boolean(error) || undefined}
                aria-label={m.cost_shares_person({ name: person.displayName })}
                bind:value={
                  () => shares[person.id] ?? "",
                  (value) => (shares[person.id] = value)
                }
              />
              <span
                class="text-muted-foreground pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-sm"
                aria-hidden="true">%</span
              >
            </div>
          </li>
        {/each}
      </ul>
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-t pt-3"
      >
        <p
          id={`${id}-total`}
          class={cn(
            "text-sm font-medium tabular-nums",
            status.tone === "ok" ? "text-success" : "text-destructive",
          )}
          aria-live="polite"
        >
          {status.text}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onclick={() => (shares = equalShares(userIds))}
        >
          {m.cost_shares_equalize()}
        </Button>
      </div>
    </fieldset>
    {#if error}
      <p id={`${id}-error`} class="text-destructive text-xs text-pretty">
        {error}
      </p>
    {/if}
  {/if}
</div>
