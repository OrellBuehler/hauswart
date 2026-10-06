<script lang="ts">
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import ShieldAlertIcon from "@lucide/svelte/icons/shield-alert";
  import { resolve } from "$app/paths";
  import type { Dashboard } from "$lib/api/schemas/dashboard";
  import * as Card from "$lib/components/ui/card/index.js";
  import { formatDay } from "$lib/format";
  import { assetHref } from "$lib/links";
  import { m } from "$lib/paraglide/messages";
  import { cn } from "$lib/utils";

  let { warranties }: { warranties: Dashboard["expiringWarranties"] } =
    $props();

  const wording = (days: number) =>
    days === 0
      ? m.warranty_today()
      : days < 0
        ? m.warranty_days_ago({ days: -days })
        : m.warranty_days_left({ days });
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="flex items-center gap-2 text-base">
      <ShieldAlertIcon
        class="text-muted-foreground size-4"
        aria-hidden="true"
      />
      {m.dashboard_expiring_warranties()}
      <span
        class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
        >{warranties.length}</span
      >
    </Card.Title>
  </Card.Header>
  <Card.Content class="flex flex-col gap-2">
    <ul class="divide-y">
      {#each warranties as warranty (warranty.id)}
        <li>
          <a
            href={assetHref(warranty.assetId)}
            class="hover:bg-accent/50 focus-visible:ring-ring/50 -mx-2 flex items-start justify-between gap-3 rounded-md px-2 py-2.5 outline-none focus-visible:ring-[3px]"
          >
            <span class="min-w-0 text-sm font-medium break-words"
              >{warranty.title}</span
            >
            <span class="shrink-0 text-end text-xs tabular-nums">
              <span
                class={cn(
                  "block font-medium",
                  warranty.status === "expired"
                    ? "text-destructive"
                    : "text-warning",
                )}>{wording(warranty.daysLeft)}</span
              >
              {#if warranty.date}
                <span class="text-muted-foreground block"
                  >{formatDay(warranty.date)}</span
                >
              {/if}
            </span>
          </a>
        </li>
      {/each}
    </ul>
    <a
      href={resolve("/warranties")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1 inline-flex min-h-10 items-center gap-1.5 self-start rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      {m.dashboard_to_warranties()}
      <ArrowRightIcon class="size-4" aria-hidden="true" />
    </a>
  </Card.Content>
</Card.Root>
