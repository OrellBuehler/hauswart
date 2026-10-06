<script lang="ts">
  import type { Task } from "$lib/api/schemas/tasks";
  import { resolve } from "$app/paths";
  import DueBadge from "./due-badge.svelte";

  let {
    tasks,
    showAsset = false,
  }: {
    tasks: Task[];
    /** Adds the name of the asset each task belongs to. */
    showAsset?: boolean;
  } = $props();
</script>

<ul class="divide-y rounded-lg border">
  {#each tasks as task (task.id)}
    <li>
      <a
        href={resolve(`/tasks/${task.id}` as "/tasks")}
        class="hover:bg-accent/50 focus-visible:ring-ring/50 flex flex-col gap-1.5 px-4 py-3 transition-colors outline-none first:rounded-t-lg last:rounded-b-lg focus-visible:ring-[3px] sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium">{task.title}</span>
          {#if showAsset && task.assetName}
            <span class="text-muted-foreground block truncate text-xs">
              {task.assetName}
            </span>
          {/if}
        </span>
        <DueBadge state={task.state} class="shrink-0" />
      </a>
    </li>
  {/each}
</ul>
