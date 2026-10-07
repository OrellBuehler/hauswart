<script lang="ts">
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import CircleXIcon from "@lucide/svelte/icons/circle-x";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import type { z } from "zod";
  import { api } from "$lib/api/browser";
  import { endpoints } from "$lib/api/registry";
  import type { Integration } from "$lib/api/schemas/integrations";
  import type { financeSyncResponseSchema } from "$lib/api/schemas/finance";
  import FormAlert from "$lib/components/app/form-alert.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import {
    keptErrorMessage,
    offersWaiting,
    syncStatLines,
  } from "$lib/connections/kept";
  import { apiErrorMessage } from "$lib/error-message";
  import { m } from "$lib/paraglide/messages";

  type SyncResult = z.infer<typeof financeSyncResponseSchema>;

  let {
    integration,
    unsaved,
    busy,
    onchanged,
  }: {
    integration: Integration;
    /** The settings have changes that are not saved: a sync would use the saved ones. */
    unsaved: boolean;
    /** Something else on the card is saving or testing. */
    busy: boolean;
    onchanged: () => Promise<void>;
  } = $props();

  let running = $state(false);
  let result = $state<SyncResult | undefined>();
  let error = $state<string | undefined>();

  const lines = $derived(result?.ok ? syncStatLines(result.stats) : []);

  async function run() {
    if (running) return;
    running = true;
    error = undefined;
    result = undefined;
    try {
      result = await api.call(endpoints.financeSync);
    } catch (err) {
      error = apiErrorMessage(err);
    }
    // A sync records the connection's health, so the card shows the new state.
    if (result) await onchanged();
    running = false;
  }
</script>

<section class="flex flex-col gap-3">
  <div class="flex flex-col gap-1">
    <h3 class="text-base font-semibold tracking-tight">
      {m.integration_kept_sync_title()}
    </h3>
    <p class="text-muted-foreground text-sm text-pretty">
      {m.integration_kept_sync_hint()}
    </p>
  </div>

  <FormAlert message={error} />

  {#if result}
    <div
      role="status"
      class={result.ok
        ? "bg-success/10 text-foreground flex items-start gap-3 rounded-lg border border-transparent px-4 py-3 text-sm"
        : "bg-destructive/10 text-foreground flex items-start gap-3 rounded-lg border border-transparent px-4 py-3 text-sm"}
    >
      {#if result.ok}
        <CircleCheckIcon
          class="text-success mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        <div class="flex min-w-0 flex-col gap-1.5">
          <p class="font-medium">{m.integration_kept_sync_done()}</p>
          {#if lines.length === 0}
            <p class="text-muted-foreground text-xs text-pretty">
              {m.integration_kept_sync_nothing()}
            </p>
          {:else}
            <ul class="text-muted-foreground flex flex-col gap-0.5 text-xs">
              {#each lines as line (line)}
                <li>{line}</li>
              {/each}
            </ul>
          {/if}
          {#if offersWaiting(result.stats)}
            <p class="text-xs font-medium text-pretty">
              {m.integration_kept_sync_review()}
            </p>
          {/if}
        </div>
      {:else}
        <CircleXIcon
          class="text-destructive mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        <div class="flex min-w-0 flex-col gap-0.5">
          <p class="font-medium">{m.integration_kept_sync_failed()}</p>
          <p class="text-muted-foreground text-xs text-pretty">
            {keptErrorMessage(result.error?.code ?? null)}
          </p>
        </div>
      {/if}
    </div>
  {/if}

  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <Button
      type="button"
      variant="outline"
      disabled={running || busy || unsaved || !integration.enabled}
      onclick={run}
    >
      {#if running}
        <LoaderCircleIcon
          class="animate-spin"
        />{m.integration_kept_sync_running()}
      {:else}
        <RefreshCwIcon />{m.integration_kept_sync_now()}
      {/if}
    </Button>
    {#if !integration.enabled}
      <p class="text-muted-foreground text-xs text-pretty">
        {m.integration_kept_sync_paused()}
      </p>
    {:else if unsaved}
      <p class="text-muted-foreground text-xs text-pretty">
        {m.integration_kept_sync_save_first()}
      </p>
    {/if}
  </div>
</section>
