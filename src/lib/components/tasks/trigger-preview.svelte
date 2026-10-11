<script lang="ts">
  import EyeIcon from "@lucide/svelte/icons/eye";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { DueResultWire } from "$lib/api/schemas/tasks";
  import EntityReading from "$lib/components/connections/entity-reading.svelte";
  import * as Card from "$lib/components/ui/card/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";
  import { getLocale } from "$lib/paraglide/runtime";
  import { describeTrigger } from "$lib/tasks/describe";
  import { shownDate, shownDateIsEstimate } from "$lib/tasks/engine/shown";
  import { triggerSchema } from "$lib/tasks/engine/types";
  import { isOdometerKey } from "$lib/vehicles/odometer";
  import { reasonLabels } from "$lib/tasks/labels";
  import DueBadge from "./due-badge.svelte";
  import ProgressBar from "./progress-bar.svelte";
  import type { TriggerDraft } from "./trigger-builder/types";

  let {
    trigger,
    graceDays,
    dueSoonDays,
    today,
  }: {
    trigger: TriggerDraft;
    graceDays: number | undefined;
    dueSoonDays: number | undefined;
    today: string;
  } = $props();

  const parsed = $derived(triggerSchema.safeParse($state.snapshot(trigger)));
  const summary = $derived(
    parsed.success ? describeTrigger(parsed.data, getLocale()) : null,
  );

  /** The readings this trigger looks at, shown live when a connection can tell them. */
  const readingIds = $derived.by(() => {
    if (!parsed.success) return [];
    const t = parsed.data;
    if (t.type === "counter_delta") {
      return isOdometerKey(t.entityId) ? [] : [t.entityId];
    }
    if (t.type === "state_condition") {
      return [
        ...new Set(
          [t.entityId, t.estimateFrom?.entityId].filter((id): id is string =>
            Boolean(id),
          ),
        ),
      ];
    }
    return [];
  });

  let result = $state<DueResultWire | null>(null);
  let failure = $state<string | undefined>();
  let pending = $state(false);
  let sequence = 0;

  $effect(() => {
    const current = parsed;
    const grace = graceDays;
    const soon = dueSoonDays;
    if (!current.success) {
      result = null;
      failure = undefined;
      pending = false;
      return;
    }
    pending = true;
    const ticket = ++sequence;
    const handle = setTimeout(async () => {
      try {
        const next = await api.call(endpoints.tasksPreview, {
          body: {
            trigger: current.data,
            ...(grace !== undefined &&
            Number.isInteger(grace) &&
            grace >= 0 &&
            grace <= 365
              ? { graceDays: grace }
              : {}),
            ...(soon !== undefined &&
            Number.isInteger(soon) &&
            soon >= 0 &&
            soon <= 365
              ? { dueSoonDays: soon }
              : {}),
          },
        });
        if (ticket !== sequence) return;
        result = next;
        failure = undefined;
      } catch (err) {
        if (ticket !== sequence) return;
        result = null;
        failure = apiErrorMessage(err);
      } finally {
        if (ticket === sequence) pending = false;
      }
    }, 400);
    return () => clearTimeout(handle);
  });

  /**
   * The preview evaluates a trigger without any readings. For a vehicle's odometer that is no
   * missing measurement (the readings are the vehicle's own), so the hint is left out.
   */
  const reasons = $derived(
    (result?.reasons ?? []).filter(
      (reason) =>
        !(
          reason === "signal_missing" &&
          parsed.success &&
          parsed.data.type === "counter_delta" &&
          isOdometerKey(parsed.data.entityId)
        ),
    ),
  );
  const date = $derived(result ? shownDate(result) : null);
  const estimated = $derived(result !== null && shownDateIsEstimate(result));
</script>

<Card.Root class="gap-3">
  <Card.Header>
    <Card.Title class="flex items-center gap-2 text-base">
      <EyeIcon class="text-muted-foreground size-4" aria-hidden="true" />
      {m.preview_title()}
      {#if pending}
        <LoaderCircleIcon
          class="text-muted-foreground size-4 animate-spin"
          aria-hidden="true"
        />
      {/if}
    </Card.Title>
  </Card.Header>
  <Card.Content class="flex flex-col gap-3 text-sm" aria-live="polite">
    {#if !parsed.success}
      <p class="text-muted-foreground text-pretty">{m.preview_incomplete()}</p>
    {:else}
      <p class="font-medium text-pretty">{summary}</p>
      {#if readingIds.length > 0}
        <div class="flex flex-col gap-1.5">
          {#each readingIds as entityId (entityId)}
            <EntityReading {entityId} class="min-h-0" />
          {/each}
        </div>
      {/if}
      {#if failure}
        <p class="text-destructive text-pretty">{failure}</p>
      {:else if result}
        <div class="flex flex-col gap-2">
          <DueBadge
            status={result.status}
            {date}
            {estimated}
            {today}
            class="text-sm"
          />
          {#if result.progress}
            <ProgressBar
              current={result.progress.current}
              target={result.progress.target}
              unit={result.progress.unit}
            />
          {/if}
          {#if reasons.length > 0}
            <ul class="text-muted-foreground list-disc ps-4 text-xs">
              {#each reasons as reason (reason)}
                <li>{reasonLabels[reason]()}</li>
              {/each}
            </ul>
          {/if}
        </div>
        <p class="text-muted-foreground text-xs text-pretty">
          {m.preview_note()}
        </p>
      {/if}
    {/if}
  </Card.Content>
</Card.Root>
