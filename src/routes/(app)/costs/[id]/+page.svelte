<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import FuelIcon from "@lucide/svelte/icons/fuel";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { gotoFromOverlay } from "$lib/overlays/use-overlay-history.svelte";
  import { invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import Attachments from "$lib/components/attachments/attachments.svelte";
  import Comments from "$lib/components/comments/comments.svelte";
  import LinkedDocuments from "$lib/components/documents/linked-documents.svelte";
  import CostAmount from "$lib/components/costs/cost-amount.svelte";
  import CostFlags from "$lib/components/costs/cost-flags.svelte";
  import TagChips from "$lib/components/costs/tag-chips.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { apiErrorMessage } from "$lib/error-message";
  import { fuelLogOfConflict } from "$lib/costs/fuel-owner";
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
  import { fuelLogHref } from "$lib/vehicles/links";
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

  const reviewedBy = $derived(
    cost.reviewedByUserId ? data.people.get(cost.reviewedByUserId) : undefined,
  );

  let deleteOpen = $state(false);
  let reviewing = $state(false);
  let reviewError = $state<string | undefined>();

  async function markReviewed() {
    if (reviewing) return;
    reviewing = true;
    reviewError = undefined;
    try {
      await api.call(endpoints.costsReview, { params: { id: cost.id } });
      toast.success(m.cost_review_done_toast({ title: cost.title }));
      await invalidateAll();
    } catch (err) {
      reviewError = apiErrorMessage(err);
    } finally {
      reviewing = false;
    }
  }

  /** A fuel log entry booked this entry and deletes it with itself. */
  const fuelOwned = $derived(Boolean(cost.fuelLogId));

  async function remove() {
    await api.call(endpoints.costsDelete, { params: { id: cost.id } });
    toast.success(m.cost_deleted_toast({ title: cost.title }));
    await gotoFromOverlay(resolve("/costs"), { invalidateAll: true });
  }

  function deleteError(err: unknown): string {
    return apiErrorMessage(
      err,
      fuelLogOfConflict(err) ? { conflict: m.cost_fuel_conflict() } : {},
    );
  }

  const linkClass =
    "focus-visible:ring-ring/50 rounded underline-offset-4 outline-none hover:underline focus-visible:ring-[3px]";
</script>

<svelte:head>
  <title>{cost.title} · {m.nav_costs()} · {m.app_name()}</title>
</svelte:head>

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

  <header class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <p class="text-muted-foreground flex items-center gap-2 text-sm">
        <CategoryIcon class="size-4" aria-hidden="true" />
        <span>{categoryLabels[cost.category]()}</span>
        <span aria-hidden="true">·</span>
        <span class="tabular-nums">{formatDay(cost.date)}</span>
      </p>
      <h1
        class="text-2xl font-semibold tracking-tight text-balance wrap-anywhere md:text-3xl"
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
      <TagChips tags={cost.tags} limit={10} />
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
        {#if fuelOwned}
          <p
            class="text-muted-foreground flex min-w-0 flex-1 basis-60 items-start gap-2 text-sm text-pretty"
          >
            <FuelIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span class="min-w-0">
              {m.cost_fuel_owned_delete_hint()}
              {#if cost.assetId}
                <!-- eslint-disable svelte/no-navigation-without-resolve -- the path is resolved in fuelLogHref, only the fragment is appended -->
                <a
                  href={fuelLogHref(cost.assetId)}
                  class="text-foreground focus-visible:ring-ring/50 rounded font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px]"
                  >{m.cost_fuel_owned_link()}</a
                >
                <!-- eslint-enable svelte/no-navigation-without-resolve -->
              {/if}
            </span>
          </p>
        {:else}
          <Button
            size="lg"
            variant="outline"
            class="text-destructive hover:text-destructive"
            onclick={() => (deleteOpen = true)}
          >
            <Trash2Icon />
            {m.common_delete()}
          </Button>
        {/if}
      </div>
    {/if}
  </header>

  {#if cost.reviewNeeded}
    <Alert.Root class="border-warning/40 bg-warning/5">
      <EyeIcon class="text-warning" />
      <Alert.Title class="text-warning">{m.cost_review_title()}</Alert.Title>
      <Alert.Description>
        <p class="text-pretty">{m.cost_review_body()}</p>
        {#if canWrite}
          <div class="mt-3 flex flex-col gap-3">
            <FormAlert message={reviewError} />
            <Button
              size="lg"
              class="self-start"
              disabled={reviewing}
              onclick={markReviewed}
            >
              {#if reviewing}
                <LoaderCircleIcon class="animate-spin" />{m.common_saving()}
              {:else}
                <CircleCheckIcon />{m.cost_review_action()}
              {/if}
            </Button>
          </div>
        {/if}
      </Alert.Description>
    </Alert.Root>
  {/if}

  <div
    class="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
  >
    <Card.Root class="min-w-0 lg:col-start-1">
      <Card.Header>
        <Card.Title class="text-base">{m.cost_facts()}</Card.Title>
      </Card.Header>
      <Card.Content>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-4 text-sm sm:gap-x-6">
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{m.cost_book()}</dt>
            <dd class="mt-0.5 wrap-anywhere">
              <!-- eslint-disable svelte/no-navigation-without-resolve -- the address is resolved here, only the query is appended -->
              <a
                href={resolve(
                  `/costs?book=${encodeURIComponent(cost.bookId)}` as "/",
                )}
                class={linkClass}>{cost.bookName}</a
              >
              <!-- eslint-enable svelte/no-navigation-without-resolve -->
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{m.cost_paid_by()}</dt>
            <dd class="mt-0.5 wrap-anywhere">
              {cost.paidByName ?? m.cost_payer_open()}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{m.cost_payee()}</dt>
            <dd class="mt-0.5 wrap-anywhere">{cost.payee ?? "–"}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{m.cost_asset()}</dt>
            <dd class="mt-0.5 wrap-anywhere">
              {#if cost.assetId && cost.assetName}
                <a href={assetHref(cost.assetId)} class={linkClass}
                  >{cost.assetName}</a
                >
              {:else}
                –
              {/if}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{m.cost_room()}</dt>
            <dd class="mt-0.5 wrap-anywhere">
              {#if cost.roomId && cost.roomName}
                <a href={roomHref(cost.roomId)} class={linkClass}
                  >{cost.roomName}</a
                >
              {:else}
                –
              {/if}
            </dd>
          </div>
          <div class="col-span-2 min-w-0 sm:col-span-1">
            <dt class="text-muted-foreground text-xs">{m.cost_defect()}</dt>
            <dd class="mt-0.5 wrap-anywhere">
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
          <div class="col-span-2 min-w-0 sm:col-span-1">
            <dt class="text-muted-foreground text-xs">
              {m.cost_service_entry()}
            </dt>
            <dd class="mt-0.5 wrap-anywhere">
              {#if cost.serviceLogId && cost.assetId}
                <a href={assetHref(cost.assetId)} class={linkClass}
                  >{cost.serviceLogTitle}</a
                >
              {:else}
                {cost.serviceLogTitle ?? "–"}
              {/if}
            </dd>
          </div>
          {#if cost.bookTaxRelevant || cost.deductible !== "unknown"}
            <div class="min-w-0">
              <dt class="text-muted-foreground text-xs">
                {m.cost_deductible()}
              </dt>
              <dd class="mt-0.5">{deductibleLabels[cost.deductible]()}</dd>
            </div>
          {/if}
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">
              {m.cost_counts_as_expense()}
            </dt>
            <dd class="mt-0.5">
              {cost.countsAsExpense ? m.common_yes() : m.common_no()}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{m.cost_source()}</dt>
            <dd class="mt-0.5">{sourceLabels[cost.source]()}</dd>
          </div>
          {#if cost.reviewedAt && !cost.reviewNeeded}
            <div class="min-w-0">
              <dt class="text-muted-foreground text-xs">
                {m.cost_reviewed()}
              </dt>
              <dd class="mt-0.5 wrap-anywhere tabular-nums">
                {formatDateTime(cost.reviewedAt, { timeZone: data.timeZone })}
                {#if reviewedBy}
                  <span class="text-muted-foreground block text-xs"
                    >{m.cost_created_by({ name: reviewedBy })}</span
                  >
                {/if}
              </dd>
            </div>
          {/if}
          <div class="min-w-0">
            <dt class="text-muted-foreground text-xs">{m.cost_created()}</dt>
            <dd class="mt-0.5 wrap-anywhere tabular-nums">
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
      class="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-span-4 lg:row-start-1"
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
                  <span class="min-w-0 wrap-anywhere">
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
      <Card.Root class="min-w-0 lg:col-start-1">
        <Card.Header>
          <Card.Title class="text-base">{m.cost_notes()}</Card.Title>
        </Card.Header>
        <Card.Content>
          <p class="text-sm wrap-anywhere whitespace-pre-line">{cost.notes}</p>
        </Card.Content>
      </Card.Root>
    {/if}

    <Attachments
      class="min-w-0 lg:col-start-1"
      ownerType="cost"
      ownerId={cost.id}
      editable={canWrite}
      title={m.cost_receipts()}
      description={m.cost_receipts_description()}
    />

    <LinkedDocuments
      class="min-w-0 lg:col-start-1"
      ownerType="cost"
      ownerId={cost.id}
    />

    <div class="min-w-0 lg:col-start-1">
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
  errorMessage={deleteError}
/>
