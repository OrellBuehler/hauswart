<script lang="ts">
  import { cn } from "$lib/utils";
  import { m } from "$lib/paraglide/messages";

  let {
    class: className,
    showName = true,
  }: { class?: string; showName?: boolean } = $props();
</script>

<span class={cn("inline-flex items-center gap-2.5", className)}>
  <span
    class="bg-brand text-brand-foreground shadow-card flex size-8 shrink-0 items-center justify-center rounded-lg"
    aria-hidden="true"
  >
    <svg viewBox="0 0 256 256" class="size-5" fill="currentColor">
      <path d="M128 28 20 124h32v104h56v-64h40v64h56V124h32z" />
    </svg>
  </span>
  {#if showName}
    <span
      class="text-lg font-semibold tracking-tight group-data-[collapsible=icon]:hidden"
      >{m.app_name()}</span
    >
  {/if}
</span>
