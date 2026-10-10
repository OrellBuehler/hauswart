<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import InboxIcon from "@lucide/svelte/icons/inbox";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PlugZapIcon from "@lucide/svelte/icons/plug-zap";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import { goto, invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api/browser";
  import { FINANCE_SUGGESTION_KINDS } from "$lib/api/enums";
  import { isApiError } from "$lib/api/errors";
  import { endpoints } from "$lib/api/registry";
  import type {
    AcceptFinanceSuggestionRequest,
    FinanceSuggestion,
  } from "$lib/api/schemas/finance";
  import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
  import EmptyState from "$lib/components/app/empty-state.svelte";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import PageHeader from "$lib/components/app/page-header.svelte";
  import AcceptSuggestionDialog from "$lib/components/costs/accept-suggestion-dialog.svelte";
  import SuggestionCard from "$lib/components/costs/suggestion-card.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { suggestionKindLabels } from "$lib/costs/labels";
  import { apiErrorMessage } from "$lib/error-message";
  import { assetHref, taskHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const canWrite = $derived(data.scopes.includes("costs:write"));
  const groups = $derived(
    FINANCE_SUGGESTION_KINDS.map((kind) => ({
      kind,
      items: data.suggestions.filter((s) => s.kind === kind),
    })).filter((group) => group.items.length > 0),
  );

  let busy = $state<{ id: string; action: "accept" | "dismiss" } | null>(null);
  let actionError = $state<string | undefined>();
  let syncing = $state(false);
  let syncError = $state<string | undefined>();

  let adjustTarget = $state<FinanceSuggestion | undefined>();
  let adjustOpen = $state(false);
  let dismissTarget = $state<FinanceSuggestion | undefined>();
  let dismissOpen = $state(false);

  function titleOf(suggestion: FinanceSuggestion): string {
    return suggestion.kind === "asset"
      ? suggestion.payload.name
      : suggestion.payload.title;
  }

  async function failed(err: unknown) {
    actionError = apiErrorMessage(err, { conflict: m.finance_conflict() });
    if (isApiError(err) && err.code === "conflict") await invalidateAll();
  }

  async function accept(
    suggestion: FinanceSuggestion,
    body: AcceptFinanceSuggestionRequest = {},
  ) {
    actionError = undefined;
    const result = await api.call(endpoints.financeSuggestionsAccept, {
      params: { id: suggestion.id },
      body,
    });
    const { entity } = result;
    const target =
      entity.type === "cost"
        ? resolve(`/costs/${entity.id}` as "/")
        : entity.type === "asset"
          ? assetHref(entity.id)
          : taskHref(entity.id);
    toast.success(
      entity.type === "cost"
        ? m.finance_accepted_cost_toast({ title: titleOf(suggestion) })
        : entity.type === "asset"
          ? m.finance_accepted_asset_toast({ title: titleOf(suggestion) })
          : m.finance_accepted_bill_task_toast({ title: titleOf(suggestion) }),
      {
        action: { label: m.finance_view(), onClick: () => void goto(target) },
      },
    );
    await invalidateAll();
  }

  async function quickAccept(suggestion: FinanceSuggestion) {
    if (busy) return;
    busy = { id: suggestion.id, action: "accept" };
    try {
      await accept(suggestion);
    } catch (err) {
      await failed(err);
    } finally {
      busy = null;
    }
  }

  function adjust(suggestion: FinanceSuggestion) {
    adjustTarget = suggestion;
    adjustOpen = true;
  }

  function askDismiss(suggestion: FinanceSuggestion) {
    dismissTarget = suggestion;
    dismissOpen = true;
  }

  async function dismiss() {
    const suggestion = dismissTarget;
    if (!suggestion) return;
    actionError = undefined;
    busy = { id: suggestion.id, action: "dismiss" };
    try {
      await api.call(endpoints.financeSuggestionsDismiss, {
        params: { id: suggestion.id },
      });
      toast.success(m.finance_dismissed_toast({ title: titleOf(suggestion) }));
      await invalidateAll();
    } catch (err) {
      if (isApiError(err) && err.code === "conflict") await invalidateAll();
      throw err;
    } finally {
      busy = null;
    }
  }

  async function sync() {
    if (syncing) return;
    syncing = true;
    syncError = undefined;
    try {
      const result = await api.call(endpoints.financeSync);
      if (result.ok) {
        toast.success(m.finance_sync_done());
      } else {
        syncError = m.finance_sync_failed({
          code: result.error?.code ?? "unknown",
        });
      }
      await invalidateAll();
    } catch (err) {
      syncError = apiErrorMessage(err, {
        not_found: m.finance_sync_not_connected(),
      });
    } finally {
      syncing = false;
    }
  }
</script>

<svelte:head>
  <title>{m.finance_inbox_title()} · {m.app_name()}</title>
</svelte:head>

{#snippet syncButton(variant: "default" | "outline")}
  <Button size="lg" {variant} disabled={syncing} onclick={sync}>
    {#if syncing}
      <LoaderCircleIcon class="animate-spin" />{m.finance_syncing()}
    {:else}
      <RefreshCwIcon />{m.finance_sync()}
    {/if}
  </Button>
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
    title={m.finance_inbox_title()}
    description={m.finance_inbox_description()}
  >
    {#snippet actions()}
      {#if data.financeConnected && canWrite}
        {@render syncButton("outline")}
      {/if}
    {/snippet}
  </PageHeader>

  <FormAlert message={syncError} />
  <FormAlert message={actionError} />

  {#if data.suggestions.length === 0}
    {#if data.financeConnected}
      <EmptyState
        icon={InboxIcon}
        title={m.finance_empty_title()}
        description={m.finance_empty_body()}
      >
        {#snippet actions()}
          {#if canWrite}
            {@render syncButton("default")}
          {/if}
        {/snippet}
      </EmptyState>
    {:else}
      <EmptyState
        icon={PlugZapIcon}
        title={m.finance_not_connected_title()}
        description={m.finance_not_connected_body()}
      >
        {#snippet actions()}
          <Button href={resolve("/settings/integrations")}>
            {m.finance_not_connected_action()}
          </Button>
        {/snippet}
      </EmptyState>
    {/if}
  {:else}
    <p class="text-muted-foreground -mb-3 text-sm" aria-live="polite">
      {m.finance_count({ count: data.suggestions.length })}
    </p>
    {#each groups as group (group.kind)}
      <section
        class="flex flex-col gap-2"
        aria-labelledby={`group-${group.kind}`}
      >
        <h2
          id={`group-${group.kind}`}
          class="text-muted-foreground flex items-baseline gap-2 text-sm font-semibold"
        >
          {suggestionKindLabels[group.kind]()}
          <span class="text-xs font-normal tabular-nums"
            >{group.items.length}</span
          >
        </h2>
        <Card.Root class="gap-0 py-0">
          <ul class="divide-y">
            {#each group.items as suggestion (suggestion.id)}
              <SuggestionCard
                {suggestion}
                busy={busy?.id === suggestion.id ? busy.action : null}
                locked={busy !== null || !canWrite}
                onaccept={() => quickAccept(suggestion)}
                onadjust={() => adjust(suggestion)}
                ondismiss={() => askDismiss(suggestion)}
              />
            {/each}
          </ul>
        </Card.Root>
      </section>
    {/each}
  {/if}
</div>

{#if adjustTarget}
  {#key adjustTarget.id}
    <AcceptSuggestionDialog
      bind:open={adjustOpen}
      suggestion={adjustTarget}
      rooms={data.rooms}
      assets={data.assets}
      people={data.people}
      currentUserId={data.user.id}
      onaccept={(body) => accept(adjustTarget as FinanceSuggestion, body)}
    />
  {/key}
{/if}

<ConfirmDialog
  bind:open={dismissOpen}
  title={m.finance_dismiss_title()}
  description={m.finance_dismiss_description({
    title: dismissTarget ? titleOf(dismissTarget) : "",
  })}
  confirmLabel={m.finance_dismiss()}
  pendingLabel={m.finance_dismissing()}
  destructive
  onconfirm={dismiss}
/>
