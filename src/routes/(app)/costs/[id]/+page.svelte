<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import Attachments from "$lib/components/attachments/attachments.svelte";
  import Comments from "$lib/components/comments/comments.svelte";
  import LinkedDocuments from "$lib/components/documents/linked-documents.svelte";
  import CostAmount from "$lib/components/costs/cost-amount.svelte";
  import CostFlags from "$lib/components/costs/cost-flags.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import {
    categoryIcons,
    categoryLabels,
    deductibleLabels,
    sourceLabels,
    splitModeLabels,
  } from "$lib/costs/labels";
  import { formatDateTime, formatDay, formatPercent } from "$lib/format";
  import { formatMoney } from "$lib/format-money";
  import { assetHref, roomHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const cost = $derived(data.cost);
  const canWrite = $derived(data.scopes.includes("costs:write"));
  const CategoryIcon = $derived(categoryIcons[cost.category]);
  const providerUrl = $derived(
    cost.providerUrl && /^https?:\/\//i.test(cost.providerUrl)
      ? cost.providerUrl
      : null,
  );
  const createdBy = $derived(
    cost.createdBy ? data.people.get(cost.createdBy) : undefined,
  );

  let deleteOpen = $state(false);

  async function remove() {
    await api.call(endpoints.costsDelete, { params: { id: cost.id } });
    toast.success(m.cost_deleted_toast({ title: cost.title }));
    await goto(resolve("/costs"), { invalidateAll: true });
  }

  const linkClass =
    "focus-visible:ring-ring/50 rounded underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]";
</script>

<svelte:head>
  <title>{cost.title} · {m.nav_costs()} · {m.app_name()}</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div>
    <a
      href={resolve("/costs")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -ms-1 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      <ArrowLeftIcon class="size-4" aria-hidden="true" />
      {m.cost_back()}
    </a>
  </div>

  <header class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <p class="text-muted-foreground flex items-center gap-2 text-sm">
        <CategoryIcon class="size-4" aria-hidden="true" />
        <span>{categoryLabels[cost.category]()}</span>
        <span aria-hidden="true">·</span>
        <span class="tabular-nums">{formatDay(cost.date)}</span>
      </p>
      <h1
        class="text-2xl font-semibold tracking-tight text-balance break-words md:text-3xl"
      >
        {cost.title}
      </h1>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <CostAmount
          amountMinor={cost.amountMinor}
          currency={cost.currency}
          class="text-2xl font-semibold"
        />
        <CostFlags {cost} />
      </div>
    </div>

    {#if canWrite}
      <div class="flex flex-wrap items-center gap-2">
        <Button
          size="lg"
          variant="outline"
          href={resolve(`/costs/${cost.id}/edit` as "/")}
        >
          <PencilIcon />
          {m.common_edit()}
        </Button>
        <Button
          size="lg"
          variant="outline"
          class="text-destructive hover:text-destructive"
          onclick={() => (deleteOpen = true)}
        >
          <Trash2Icon />
          {m.common_delete()}
        </Button>
      </div>
    {/if}
  </header>

  <div
    class="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
  >
    <Card.Root class="lg:col-start-1">
      <Card.Header>
        <Card.Title class="text-base">{m.cost_facts()}</Card.Title>
      </Card.Header>
      <Card.Content>
        <dl class="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-muted-foreground text-xs">{m.cost_paid_by()}</dt>
            <dd class="mt-0.5 break-words">
              {cost.paidByName ?? m.cost_payer_open()}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">{m.cost_payee()}</dt>
            <dd class="mt-0.5 break-words">{cost.payee ?? "–"}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">{m.cost_asset()}</dt>
            <dd class="mt-0.5 break-words">
              {#if cost.assetId && cost.assetName}
                <a href={assetHref(cost.assetId)} class={linkClass}
                  >{cost.assetName}</a
                >
              {:else}
                –
              {/if}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">{m.cost_room()}</dt>
            <dd class="mt-0.5 break-words">
              {#if cost.roomId && cost.roomName}
                <a href={roomHref(cost.roomId)} class={linkClass}
                  >{cost.roomName}</a
                >
              {:else}
                –
              {/if}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">{m.cost_defect()}</dt>
            <dd class="mt-0.5 break-words">
              {#if cost.defectId}
                <a
                  href={resolve(`/defects/${cost.defectId}` as "/")}
                  class={linkClass}>#{cost.defectNumber} {cost.defectTitle}</a
                >
              {:else}
                –
              {/if}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">
              {m.cost_service_entry()}
            </dt>
            <dd class="mt-0.5 break-words">
              {#if cost.serviceLogId && cost.assetId}
                <a href={assetHref(cost.assetId)} class={linkClass}
                  >{cost.serviceLogTitle}</a
                >
              {:else}
                {cost.serviceLogTitle ?? "–"}
              {/if}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">{m.cost_deductible()}</dt>
            <dd class="mt-0.5">{deductibleLabels[cost.deductible]()}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">
              {m.cost_counts_as_expense()}
            </dt>
            <dd class="mt-0.5">
              {cost.countsAsExpense ? m.common_yes() : m.common_no()}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">{m.cost_source()}</dt>
            <dd class="mt-0.5">{sourceLabels[cost.source]()}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs">{m.cost_created()}</dt>
            <dd class="mt-0.5 break-words tabular-nums">
              {formatDateTime(cost.createdAt, { timeZone: data.timeZone })}
              {#if createdBy}
                <span class="text-muted-foreground block text-xs"
                  >{m.cost_created_by({ name: createdBy })}</span
                >
              {/if}
            </dd>
          </div>
        </dl>
        {#if providerUrl}
          <div class="mt-5 border-t pt-4">
            <Button
              variant="outline"
              size="lg"
              href={providerUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLinkIcon />
              {m.cost_provider_open()}
            </Button>
          </div>
        {/if}
      </Card.Content>
    </Card.Root>

    <aside
      class="flex flex-col gap-6 lg:col-start-2 lg:row-span-4 lg:row-start-1"
    >
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-base">{m.cost_shares_title()}</Card.Title>
          <Card.Description>
            {splitModeLabels[cost.splitMode]()}
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {#if cost.shares.length === 0}
            <p class="text-muted-foreground text-sm text-pretty">
              {m.cost_shares_none()}
            </p>
          {:else}
            <ul class="divide-y text-sm">
              {#each cost.shares as share (share.userId)}
                <li
                  class="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <span class="min-w-0 break-words">
                    {share.userName ?? m.cost_person_unknown()}
                    <span
                      class="text-muted-foreground ms-1 text-xs tabular-nums"
                      >{m.cost_percent({
                        value: formatPercent(share.shareBps),
                      })}</span
                    >
                  </span>
                  <span
                    class="shrink-0 font-medium whitespace-nowrap tabular-nums"
                    >{formatMoney(share.amountMinor, cost.currency)}</span
                  >
                </li>
              {/each}
            </ul>
            <p class="text-muted-foreground mt-4 text-xs text-pretty">
              {m.cost_shares_frozen()}
            </p>
          {/if}
        </Card.Content>
      </Card.Root>
    </aside>

    {#if cost.notes}
      <Card.Root class="lg:col-start-1">
        <Card.Header>
          <Card.Title class="text-base">{m.cost_notes()}</Card.Title>
        </Card.Header>
        <Card.Content>
          <p class="text-sm break-words whitespace-pre-line">{cost.notes}</p>
        </Card.Content>
      </Card.Root>
    {/if}

    <Attachments
      class="lg:col-start-1"
      ownerType="cost"
      ownerId={cost.id}
      editable={canWrite}
      title={m.cost_receipts()}
      description={m.cost_receipts_description()}
    />

    <LinkedDocuments
      class="lg:col-start-1"
      ownerType="cost"
      ownerId={cost.id}
    />

    <div class="lg:col-start-1">
      <Comments entityType="cost" entityId={cost.id} timeZone={data.timeZone} />
    </div>
  </div>
</div>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.cost_delete_title()}
  description={m.cost_delete_description({ title: cost.title })}
  confirmLabel={m.common_delete()}
  pendingLabel={m.common_deleting()}
  destructive
  onconfirm={remove}
/>
