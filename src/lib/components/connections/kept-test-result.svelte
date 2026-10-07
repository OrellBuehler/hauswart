<script lang="ts">
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import CircleXIcon from "@lucide/svelte/icons/circle-x";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import type { z } from "zod";
  import type { testIntegrationResponseSchema } from "$lib/api/schemas/integrations";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import {
    KEPT_SCOPES,
    keptErrorMessage,
    readKeptTestInfo,
  } from "$lib/connections/kept";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let { result }: { result: z.infer<typeof testIntegrationResponseSchema> } =
    $props();

  const info = $derived(readKeptTestInfo(result.info));
  const known = new Set(KEPT_SCOPES.map((scope) => scope.id));
  const missing = $derived(
    KEPT_SCOPES.filter((scope) => info.missingScopes.includes(scope.id)),
  );
  const unknownMissing = $derived(
    info.missingScopes.filter((scope) => !known.has(scope)),
  );
  const incomplete = $derived(result.ok && info.missingScopes.length > 0);
</script>

<div
  role="status"
  class={cn(
    "text-foreground flex items-start gap-3 rounded-lg border border-transparent px-4 py-3 text-sm",
    !result.ok
      ? "bg-destructive/10"
      : incomplete
        ? "bg-warning/15"
        : "bg-success/10",
  )}
>
  {#if !result.ok}
    <CircleXIcon
      class="text-destructive mt-0.5 size-4 shrink-0"
      aria-hidden="true"
    />
  {:else if incomplete}
    <TriangleAlertIcon
      class="text-warning mt-0.5 size-4 shrink-0"
      aria-hidden="true"
    />
  {:else}
    <CircleCheckIcon
      class="text-success mt-0.5 size-4 shrink-0"
      aria-hidden="true"
    />
  {/if}
  <div class="flex min-w-0 flex-col gap-2">
    {#if !result.ok}
      <div class="flex flex-col gap-0.5">
        <p class="font-medium">{m.integration_test_failed()}</p>
        <p class="text-muted-foreground text-xs text-pretty">
          {keptErrorMessage(result.error?.code ?? null)}
        </p>
      </div>
    {:else}
      <div class="flex flex-col gap-0.5">
        <p class="font-medium text-pretty">
          {incomplete
            ? m.integration_kept_test_incomplete()
            : m.integration_test_ok()}
        </p>
        {#if info.currency}
          <p class="text-muted-foreground text-xs">
            {m.integration_kept_test_currency({ currency: info.currency })}
          </p>
        {/if}
      </div>
      {#if incomplete}
        <div class="flex flex-col gap-2">
          <p class="text-xs font-medium">{m.integration_kept_scopes_title()}</p>
          <ul class="flex flex-col gap-2">
            {#each missing as scope (scope.id)}
              <li class="flex flex-col gap-0.5">
                <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge
                    variant="outline"
                    class="border-warning/50 text-warning"
                  >
                    {m.integration_kept_scope_missing()}
                  </Badge>
                  <span class="font-medium">{scope.label()}</span>
                  <code class="text-muted-foreground font-mono text-xs"
                    >{scope.id}</code
                  >
                </span>
                <span class="text-muted-foreground text-xs text-pretty"
                  >{scope.hint()}</span
                >
              </li>
            {/each}
            {#each unknownMissing as scope (scope)}
              <li class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant="outline" class="border-warning/50 text-warning">
                  {m.integration_kept_scope_missing()}
                </Badge>
                <span class="font-medium"
                  >{m.integration_kept_scope_other()}</span
                >
                <code class="text-muted-foreground font-mono text-xs break-all"
                  >{scope}</code
                >
              </li>
            {/each}
          </ul>
          <p class="text-muted-foreground text-xs text-pretty">
            {m.integration_kept_test_fix()}
          </p>
        </div>
      {:else}
        <p class="text-muted-foreground text-xs text-pretty">
          {m.integration_kept_scopes_all()}
        </p>
      {/if}
      {#if info.restricted}
        <p class="text-muted-foreground text-xs text-pretty">
          {m.integration_kept_test_restricted()}
        </p>
      {/if}
    {/if}
  </div>
</div>
