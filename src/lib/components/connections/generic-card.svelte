<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
  import { m } from "$lib/paraglide/messages";
  import type { IntegrationCardProps } from "./cards";
  import { kindMeta } from "./kinds";
  import StatusBadge from "./status-badge.svelte";

  let { integration }: IntegrationCardProps = $props();

  const meta = $derived(kindMeta[integration.kind]);
</script>

<Card.Root>
  <Card.Header>
    <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div class="flex min-w-0 items-center gap-3">
        <span
          class="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg"
          aria-hidden="true"
        >
          <meta.icon class="size-5" />
        </span>
        <Card.Title class="min-w-0 text-base">{meta.name()}</Card.Title>
      </div>
      <StatusBadge {integration} />
    </div>
    <Card.Description class="text-pretty">
      {meta.description()}
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <p class="text-muted-foreground text-sm text-pretty">
      {integration.available
        ? m.integration_generic_available()
        : m.integration_generic_soon()}
    </p>
  </Card.Content>
</Card.Root>
