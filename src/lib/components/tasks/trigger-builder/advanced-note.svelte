<script lang="ts">
  import { resolve } from "$app/paths";
  import PlugZapIcon from "@lucide/svelte/icons/plug-zap";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import {
    homeAssistantOf,
    isUsable,
    loadIntegrations,
  } from "$lib/connections/connection";
  import { m } from "$lib/paraglide/messages";

  /** `null` until the connection is known, so nothing flashes while it loads. */
  let state = $state<"missing" | "connected" | null>(null);

  $effect(() => {
    let cancelled = false;
    loadIntegrations().then(
      (list) => {
        if (!cancelled)
          state = isUsable(homeAssistantOf(list)) ? "connected" : "missing";
      },
      (err) => {
        console.warn("integrations unavailable", err);
        if (!cancelled) state = "missing";
      },
    );
    return () => {
      cancelled = true;
    };
  });
</script>

{#if state === "missing"}
  <Alert.Root>
    <PlugZapIcon />
    <Alert.Title>{m.trigger_advanced_title()}</Alert.Title>
    <Alert.Description>
      <p class="text-pretty">{m.trigger_advanced_body()}</p>
      <a
        href={resolve("/settings/integrations")}
        class="text-foreground mt-1 inline-block font-medium underline underline-offset-2"
      >
        {m.trigger_advanced_link()}
      </a>
    </Alert.Description>
  </Alert.Root>
{/if}
