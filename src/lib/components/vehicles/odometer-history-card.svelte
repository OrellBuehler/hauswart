<script lang="ts">
  import GaugeIcon from "@lucide/svelte/icons/gauge";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { invalidateAll } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import type { OdometerSource, OdometerUnit } from "$lib/api/enums";
  import { endpoints } from "$lib/api/registry";
  import type { OdometerReading } from "$lib/api/schemas/vehicles";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { formatDay } from "$lib/format";
  import { m } from "$lib/paraglide/messages";
  import { formatOdometer } from "$lib/vehicles/format";
  import {
    odometerOwnerLabels,
    odometerSourceLabels,
  } from "$lib/vehicles/labels";
  import { canDeleteReading, readingOwner } from "$lib/vehicles/odometer-error";

  let {
    assetId,
    unit,
    readings,
    nextCursor,
    canWrite,
  }: {
    assetId: string;
    unit: OdometerUnit;
    /** The first page, newest first. */
    readings: OdometerReading[];
    nextCursor: string | null;
    canWrite: boolean;
  } = $props();

  let more = $state.raw<{
    base: OdometerReading[];
    items: OdometerReading[];
    cursor: string | null;
  } | null>(null);
  let loadingMore = $state(false);
  const loaded = $derived(more && more.base === readings ? more : null);
  const all = $derived([...readings, ...(loaded?.items ?? [])]);
  const cursor = $derived(loaded ? loaded.cursor : nextCursor);

  let deleting = $state<OdometerReading | undefined>();
  let deleteOpen = $state(false);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    loadingMore = true;
    try {
      const page = await api.call(endpoints.odometerList, {
        params: { id: assetId },
        query: { limit: 20, cursor },
      });
      more = {
        base: readings,
        items: [...(loaded?.items ?? []), ...page.items],
        cursor: page.nextCursor,
      };
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      loadingMore = false;
    }
  }

  function askDelete(reading: OdometerReading) {
    deleting = reading;
    deleteOpen = true;
  }

  async function remove() {
    if (!deleting) return;
    await api.call(endpoints.odometerDelete, { params: { id: deleting.id } });
    toast.success(m.vehicle_history_deleted_toast());
    more = null;
    await invalidateAll();
  }

  function deleteError(err: unknown): string {
    const owner = readingOwner(err);
    if (!owner) return apiErrorMessage(err);
    const label = odometerOwnerLabels[owner.source as OdometerSource];
    return label
      ? m.vehicle_history_owned_error({ owner: label() })
      : m.vehicle_history_owned_error_unknown();
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{m.vehicle_history_title()}</Card.Title>
    <Card.Description>{m.vehicle_history_description()}</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if all.length === 0}
      <EmptyState
        icon={GaugeIcon}
        title={m.vehicle_history_empty()}
        description={m.vehicle_odometer_none_hint()}
        class="py-8"
      />
    {:else}
      <ul class="divide-y">
        {#each all as reading (reading.id)}
          <li
            class="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 py-2.5 first:pt-0 last:pb-0"
          >
            <span class="text-muted-foreground text-xs tabular-nums">
              {formatDay(reading.date)}
            </span>
            <span class="flex min-w-0 flex-col items-start gap-1">
              {#if reading.source !== "manual"}
                <Badge variant="secondary">
                  {odometerSourceLabels[reading.source]()}
                </Badge>
              {/if}
              {#if reading.note}
                <span class="text-muted-foreground text-xs wrap-anywhere"
                  >{reading.note}</span
                >
              {/if}
            </span>
            <span class="text-sm font-medium whitespace-nowrap tabular-nums">
              {formatOdometer(reading.value, unit)}
            </span>
            {#if canWrite && canDeleteReading(reading)}
              <Button
                variant="ghost"
                size="icon"
                class="-me-2"
                aria-label={m.vehicle_history_delete_aria({
                  value: formatOdometer(reading.value, unit),
                  date: formatDay(reading.date),
                })}
                onclick={() => askDelete(reading)}
              >
                <Trash2Icon />
              </Button>
            {:else}
              <span></span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if cursor}
        <div class="mt-3 flex justify-center">
          <Button
            variant="outline"
            size="lg"
            disabled={loadingMore}
            onclick={loadMore}
          >
            {#if loadingMore}
              <LoaderCircleIcon class="animate-spin" />
            {/if}
            {m.common_load_more()}
          </Button>
        </div>
      {/if}
    {/if}
  </Card.Content>
</Card.Root>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.vehicle_history_delete_title()}
  description={m.vehicle_history_delete_description({
    value: deleting ? formatOdometer(deleting.value, unit) : "",
    date: deleting ? formatDay(deleting.date) : "",
  })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
  errorMessage={deleteError}
/>
