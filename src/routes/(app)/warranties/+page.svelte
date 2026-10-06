<script lang="ts">
  import ShieldCheckIcon from "@lucide/svelte/icons/shield-check";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { WARRANTY_STATUSES, type WarrantyStatus } from "$lib/api/enums";
  import type { Warranty } from "$lib/api/schemas/warranties";
  import WarrantyBadge from "$lib/components/assets/warranty-badge.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import { formatDay, formatRelativeDays } from "$lib/format";
  import { assetHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const filter = $derived<WarrantyStatus | "">(
    WARRANTY_STATUSES.find((s) => s === page.url.searchParams.get("status")) ??
      "",
  );
  const shown = $derived(
    filter
      ? data.warranties.filter((w) => w.status === filter)
      : data.warranties,
  );
  const counts = $derived(
    Object.fromEntries(
      WARRANTY_STATUSES.map((s) => [
        s,
        data.warranties.filter((w) => w.status === s).length,
      ]),
    ) as Record<WarrantyStatus, number>,
  );

  const labels: Record<WarrantyStatus, () => string> = {
    valid: () => m.warranty_filter_valid(),
    expiring: () => m.warranty_filter_expiring(),
    expired: () => m.warranty_filter_expired(),
  };
  const dots: Record<WarrantyStatus, string> = {
    valid: "bg-success",
    expiring: "bg-warning",
    expired: "bg-destructive",
  };

  const chips = $derived([
    {
      value: "" as const,
      label: m.warranties_filter_all(),
      count: data.warranties.length,
    },
    ...WARRANTY_STATUSES.map((s) => ({
      value: s,
      label: labels[s](),
      count: counts[s],
    })),
  ]);

  async function select(value: WarrantyStatus | "") {
    await goto(
      resolve(`/warranties${value ? `?status=${value}` : ""}` as "/"),
      { keepFocus: true, noScroll: true, replaceState: true },
    );
  }

  function info(w: Warranty) {
    return { status: w.status, until: w.effectiveUntil, daysLeft: w.daysLeft };
  }

  function subtitle(w: Warranty): string {
    return [w.roomName, w.manufacturer, w.model].filter(Boolean).join(" · ");
  }

  function extended(w: Warranty): boolean {
    return (
      w.warrantyUntil !== null &&
      w.warrantyExtendedUntil !== null &&
      w.warrantyExtendedUntil > w.warrantyUntil
    );
  }

  const daysText = (days: number) =>
    days === 0
      ? m.warranty_today()
      : days < 0
        ? m.warranty_days_ago({ days: -days })
        : m.warranty_days_left({ days });
</script>

<svelte:head>
  <title>{m.nav_warranties()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <PageHeader
    title={m.warranties_title()}
    description={m.warranties_description()}
  />

  {#if data.warranties.length === 0}
    <EmptyState
      icon={ShieldCheckIcon}
      title={m.warranties_empty_title()}
      description={m.warranties_empty_body()}
    >
      {#snippet actions()}
        <Button href={resolve("/inventory")}
          >{m.warranties_empty_action()}</Button
        >
      {/snippet}
    </EmptyState>
  {:else}
    <div
      role="group"
      aria-label={m.warranties_filter_label()}
      class="flex flex-wrap gap-1.5"
    >
      {#each chips as chip (chip.value)}
        {@const on = filter === chip.value}
        <button
          type="button"
          class={cn(
            "focus-visible:ring-ring/50 inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]",
            on
              ? "bg-brand text-brand-foreground border-transparent"
              : "bg-background hover:bg-accent dark:bg-input/30",
          )}
          aria-pressed={on}
          onclick={() => select(chip.value)}
        >
          {#if chip.value}
            <span
              class={cn("inline-block size-2.5 rounded-full", dots[chip.value])}
              aria-hidden="true"
            ></span>
          {/if}
          {chip.label}
          <span class="text-xs tabular-nums opacity-80">{chip.count}</span>
        </button>
      {/each}
    </div>

    {#if shown.length === 0}
      <EmptyState
        icon={ShieldCheckIcon}
        title={m.warranties_filter_empty_title()}
        description={m.warranties_filter_empty_body()}
      >
        {#snippet actions()}
          <Button variant="outline" onclick={() => select("")}
            >{m.warranties_filter_all()}</Button
          >
        {/snippet}
      </EmptyState>
    {:else}
      <Card.Root class="gap-0 py-0 md:hidden">
        <ul class="divide-y">
          {#each shown as w (w.assetId)}
            <li>
              <a
                href={assetHref(w.assetId)}
                class="hover:bg-accent/50 focus-visible:ring-ring/50 flex flex-col gap-2 px-4 py-3.5 transition-colors outline-none first:rounded-t-xl last:rounded-b-xl focus-visible:ring-[3px]"
              >
                <span class="block text-sm font-medium break-words"
                  >{w.assetName}</span
                >
                {#if subtitle(w)}
                  <span
                    class="text-muted-foreground -mt-1 block text-xs break-words"
                    >{subtitle(w)}</span
                  >
                {/if}
                <span class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <WarrantyBadge info={info(w)} />
                  <span
                    class={cn(
                      "text-xs tabular-nums",
                      w.status === "expired"
                        ? "text-destructive"
                        : w.status === "expiring"
                          ? "text-warning"
                          : "text-muted-foreground",
                    )}>{daysText(w.daysLeft)}</span
                  >
                </span>
                {#if extended(w)}
                  <span class="text-muted-foreground text-xs">
                    {m.asset_warranty_detail({
                      until: formatDay(w.warrantyUntil ?? w.effectiveUntil),
                      extended: formatDay(w.effectiveUntil),
                    })}
                  </span>
                {/if}
              </a>
            </li>
          {/each}
        </ul>
      </Card.Root>

      <Card.Root class="gap-0 py-0 max-md:hidden">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{m.warranties_col_asset()}</Table.Head>
              <Table.Head>{m.asset_room()}</Table.Head>
              <Table.Head>{m.asset_purchase_date()}</Table.Head>
              <Table.Head>{m.warranties_col_until()}</Table.Head>
              <Table.Head>{m.warranties_col_status()}</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each shown as w (w.assetId)}
              <Table.Row class="relative">
                <Table.Cell class="font-medium whitespace-normal">
                  <a
                    href={assetHref(w.assetId)}
                    class="focus-visible:ring-ring/50 focus-visible:after:ring-ring/50 rounded-sm break-words outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px]"
                    >{w.assetName}</a
                  >
                  {#if w.manufacturer || w.model}
                    <span
                      class="text-muted-foreground block text-xs font-normal"
                      >{[w.manufacturer, w.model]
                        .filter(Boolean)
                        .join(" ")}</span
                    >
                  {/if}
                </Table.Cell>
                <Table.Cell class="text-muted-foreground">
                  {w.roomName ?? "–"}
                </Table.Cell>
                <Table.Cell class="text-muted-foreground tabular-nums">
                  {w.purchaseDate ? formatDay(w.purchaseDate) : "–"}
                </Table.Cell>
                <Table.Cell class="tabular-nums">
                  {formatDay(w.effectiveUntil)}
                  <span class="text-muted-foreground block text-xs"
                    >{formatRelativeDays(w.daysLeft)}</span
                  >
                  {#if extended(w)}
                    <span class="text-muted-foreground block text-xs">
                      {m.warranty_extended_marker()}
                    </span>
                  {/if}
                </Table.Cell>
                <Table.Cell>
                  <WarrantyBadge info={info(w)} />
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Card.Root>
    {/if}
  {/if}
</div>
