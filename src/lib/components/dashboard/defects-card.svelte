<script lang="ts">
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import WrenchIcon from "@lucide/svelte/icons/wrench";
  import { resolve } from "$app/paths";
  import type { Dashboard } from "$lib/api/schemas/dashboard";
  import DefectDeadline from "$lib/components/defects/defect-deadline.svelte";
  import DefectSeverityBadge from "$lib/components/defects/defect-severity-badge.svelte";
  import DefectStatusBadge from "$lib/components/defects/defect-status-badge.svelte";
  import * as Card from "$lib/components/ui/card/index.js";
  import { defectPlace } from "$lib/defects/place";
  import { m } from "$lib/paraglide/messages";

  const LIMIT = 5;

  let { defects, today }: { defects: Dashboard["openDefects"]; today: string } =
    $props();
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="flex items-center gap-2 text-base">
      <WrenchIcon class="text-muted-foreground size-4" aria-hidden="true" />
      {m.dashboard_open_defects()}
      <span
        class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
        >{defects.length}</span
      >
    </Card.Title>
  </Card.Header>
  <Card.Content class="flex flex-col gap-2">
    <ul class="divide-y">
      {#each defects.slice(0, LIMIT) as defect (defect.id)}
        <li>
          <a
            href={resolve(`/defects/${defect.id}` as "/")}
            class="hover:bg-accent/50 focus-visible:ring-ring/50 -mx-2 flex flex-col gap-1.5 rounded-md px-2 py-2.5 outline-none focus-visible:ring-[3px]"
          >
            <span class="flex items-baseline gap-2 text-sm">
              <span class="text-muted-foreground shrink-0 tabular-nums"
                >#{defect.number}</span
              >
              <span class="min-w-0 font-medium break-words">{defect.title}</span
              >
            </span>
            {#if defectPlace({ ...defect, locationDetail: null })}
              <span class="text-muted-foreground -mt-0.5 text-xs break-words"
                >{defectPlace({ ...defect, locationDetail: null })}</span
              >
            {/if}
            <span class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <DefectStatusBadge status={defect.status} />
              <DefectSeverityBadge severity={defect.severity} />
              <DefectDeadline
                date={defect.date}
                status={defect.status}
                {today}
              />
            </span>
          </a>
        </li>
      {/each}
    </ul>
    <a
      href={resolve("/defects")}
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1 inline-flex min-h-10 items-center gap-1.5 self-start rounded px-1 text-sm outline-none focus-visible:ring-[3px]"
    >
      {defects.length > LIMIT
        ? m.dashboard_all_defects({ count: defects.length })
        : m.dashboard_to_defects()}
      <ArrowRightIcon class="size-4" aria-hidden="true" />
    </a>
  </Card.Content>
</Card.Root>
