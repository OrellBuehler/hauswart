<script lang="ts">
  import { resolve } from "$app/paths";
  import type { Defect } from "$lib/api/schemas/defects";
  import CommentCount from "$lib/components/comments/comment-count.svelte";
  import { defectPlace } from "$lib/defects/place";
  import DefectDeadline from "./defect-deadline.svelte";
  import DefectSeverityBadge from "./defect-severity-badge.svelte";
  import DefectStatusBadge from "./defect-status-badge.svelte";

  let { defect, today }: { defect: Defect; today: string } = $props();

  const place = $derived(defectPlace(defect));
</script>

<li>
  <a
    href={resolve(`/defects/${defect.id}` as "/")}
    class="hover:bg-accent/50 focus-visible:ring-ring/50 flex flex-col gap-2 px-4 py-3.5 transition-colors outline-none first:rounded-t-xl last:rounded-b-xl focus-visible:ring-[3px]"
  >
    <span class="flex items-start gap-3">
      <span
        class="text-muted-foreground mt-0.5 shrink-0 text-sm font-medium tabular-nums"
        >#{defect.number}</span
      >
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium text-pretty break-words"
          >{defect.title}</span
        >
        {#if place}
          <span class="text-muted-foreground mt-0.5 block text-xs break-words"
            >{place}</span
          >
        {/if}
      </span>
      <CommentCount count={defect.commentCount} class="mt-0.5 shrink-0" />
    </span>
    <span class="flex flex-wrap items-center gap-x-3 gap-y-1.5 ps-9">
      <DefectStatusBadge status={defect.status} />
      <DefectSeverityBadge severity={defect.severity} />
      <DefectDeadline
        date={defect.deadlineDate}
        status={defect.status}
        {today}
      />
    </span>
  </a>
</li>
